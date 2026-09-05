/**
 * The automated farmhand: the state machine that walks the wheat field on its
 * own, without a tap to answer.
 *
 * HOW THIS DIFFERS FROM ./farmhand.ts, WHICH IT DOES NOT REPLACE. That
 * farmhand is PRESENTATION -- the player taps a hen, the request has already
 * left the browser, and he ambles over to play an animation on top of a write
 * that happened without him. He is allowed to drop any job he likes because
 * losing one loses an animation. This one is the opposite: he CHOOSES the
 * work (./farmhand-plan.ts) and the work has a consequence, so every job he
 * finishes has to reach the server exactly once.
 *
 * WHAT THAT DOES NOT MEAN. It does not mean the browser writes anything. The
 * machine never touches Supabase, never imports a store, and cannot: it emits
 * an EFFECT and hands it to an injected hook, and the only hook this app
 * wires up posts an intent to /api/stackacres/actions, where the server reads
 * the live rows itself and settles under its own guard. That is the project's
 * standing rule (mutate through server routes + engine; never accept
 * client-owned game truth) and it is load-bearing here rather than
 * ceremonial: a farmhand that could credit inventory from the client would be
 * a Gold printer one contract away, since a fulfilled contract pays real Gold.
 *
 * ON THE HOOK'S NAME. The brief for this called it
 * `adjust_homestead_inventory(profileId, itemId, delta)`. That RPC is real
 * and is THE WRONG ONE: it belongs to the barn-era `homestead_inventory`
 * table, which has been inert since a harvest started paying Gold in one
 * step. The processing track's own RPC is
 * `adjust_homestead_processing_inventory`, reached through
 * `adjustStackAcresInventory` -- see the header on that function in
 * lib/server/stackacres-store.ts, which exists because this exact collision
 * was nearly shipped once. `FarmhandHooks.adjustInventory` keeps the
 * brief's (profileId, itemId, delta) shape and is wired to the live one.
 *
 * CONCURRENCY. The player may be doing something else entirely while this
 * runs -- StackAcres shares a browser with a poker table, and a tap-heavy
 * session refetches this farm on tab-return and on every action's response.
 * A completed harvest therefore updates a LOCAL OPTIMISTIC OVERLAY on the
 * same frame it happens, before the request is even sent, and that overlay is
 * retired only once a snapshot taken after the write confirmed has landed.
 * See `pendingDelta` below for why that is a sequence check and not a timer.
 */

import { CONTRACT_DROP, planFarmhandWork, type FarmhandJob, type FarmhandPlanInput } from "./farmhand-plan";
import {
  FARMHAND_SPEED,
  advanceTowards,
  frameSeconds,
  tileOf,
  withinReach,
  type TileCoord,
  type Walker,
} from "./farmhand-path";
import { FARMHAND_BASE, FARMHAND_WORK_MS } from "./farmhand";
import { addToInventory, inventoryQuantity, type StackAcresInventory } from "./inventory";
import type { MachineItemId } from "./machine-items";
import { WHEAT_YIELD_QUANTITY } from "./wheat-plot";
import type { WorldPoint } from "./world";

/* ------------------------------------------------------------------ */
/* The four states                                                     */
/* ------------------------------------------------------------------ */

/**
 * The four states, and the only four.
 *
 * `IDLE` is "nothing assigned", which includes the amble back to
 * `FARMHAND_BASE` after a job -- there is no separate RETURNING state,
 * because a walk home is not work and a job arriving mid-amble must turn him
 * around where he stands rather than wait for him to finish a trip nobody is
 * waiting on. `WALKING_TO_PLOT` and `DELIVERING_TO_CONTRACT` are both
 * targeted walks; the second covers the handover at the far end too, told
 * apart by `workMs` being non-zero. `HARVESTING` is only ever entered on
 * arrival, so its `workMs` is always non-zero.
 */
export type FarmhandAutoState = "IDLE" | "WALKING_TO_PLOT" | "HARVESTING" | "DELIVERING_TO_CONTRACT";

/** How long the handover at the crates takes. Shorter than a harvest: he is
 *  setting a sack down, not cutting a field. */
export const FARMHAND_DELIVER_MS = 700;

export interface FarmhandAutomation extends Walker {
  state: FarmhandAutoState;
  /** Where he is heading, in WORLD units. Equal to his own position when he
   *  has arrived. */
  target: WorldPoint;
  /** The tile `target` sits in -- the grid cell the job actually named. Held
   *  rather than recomputed so a caller can ask "which tile is he working"
   *  without re-deriving it, and so a re-plan onto the same tile is cheap to
   *  detect. */
  tile: TileCoord;
  /** The plot he has claimed, null unless walking to or cutting one. */
  plotId: string | null;
  /** The contract he is carrying goods to, null unless delivering. Held so
   *  the effect can name it: `fulfillContract` does not take an id (the
   *  server reads the one open contract itself, under its own guard), but a
   *  sound cue or a float label wants to know which one was paid. */
  contractId: string | null;
  /** Milliseconds left of the action he is playing. Zero while walking. */
  workMs: number;
}

export function spawnFarmhandAutomation(): FarmhandAutomation {
  return {
    x: FARMHAND_BASE.x,
    y: FARMHAND_BASE.y,
    state: "IDLE",
    target: { ...FARMHAND_BASE },
    tile: tileOf(FARMHAND_BASE),
    plotId: null,
    contractId: null,
    workMs: 0,
    // Facing down the picture, toward the camera and toward the hen ground,
    // which is where he is looking when the player arrives at the farm.
    facing: 1,
    towards: 1,
    travelled: 0,
  };
}

/** Whether he is putting one foot in front of the other right now. What the
 *  scene's step-frame toggle and its mirror both key off. */
export function automationWalking(hand: FarmhandAutomation): boolean {
  if (hand.workMs > 0) return false;
  if (hand.state === "IDLE") return !withinReach(hand, hand.target);
  return true;
}

/* ------------------------------------------------------------------ */
/* Effects: what a finished cycle owes the server                      */
/* ------------------------------------------------------------------ */

/**
 * One completed cycle, in the shape the hook needs: an item and a signed
 * delta, the same two arguments every inventory RPC in this app takes.
 *
 * `delta` is the OPTIMISTIC prediction, not a reading. A harvest predicts
 * `WHEAT_YIELD_QUANTITY` because that is what `workStackAcres` credits per
 * ripe plot; a delivery predicts nothing at all, because the goods leaving
 * inventory and the Gold arriving are both settled server-side inside one
 * guarded write and there is no half of it worth guessing at. The overlay
 * exists to stop the number flickering backwards for a second, not to be
 * right about money.
 */
export type FarmhandEffect =
  | { kind: "harvested"; plotId: string; item: MachineItemId; delta: number }
  | { kind: "delivered"; contractId: string };

export interface FarmhandStepResult {
  hand: FarmhandAutomation;
  /** The state he was in before this frame, so a caller can react to a
   *  transition without keeping its own copy. */
  from: FarmhandAutoState;
  /** Emitted on the one frame a cycle completes. At most one per frame: a
   *  single man finishes a single job. */
  effect: FarmhandEffect | null;
}

/**
 * One frame of the automated farmhand's day.
 *
 * `job` is what ./farmhand-plan.ts wants him on THIS FRAME, re-planned every
 * frame rather than latched. Re-planning is what makes him correct under a
 * refetch: a plot cut by the player's own tap while he was walking to it
 * simply stops appearing, and null on a frame he is mid-walk aborts the trip
 * instead of marching him to bare ground.
 *
 * The one thing re-planning must NOT do is interrupt him mid-action. Once
 * `workMs` is running he is committed: cutting the animation short the
 * instant a snapshot lands would mean the job is only ever seen being
 * finished on a slow connection, and -- worse for a machine that emits
 * effects -- an aborted `HARVESTING` would drop the one frame the effect is
 * emitted on and lose the write.
 *
 * `speedMultiplier` defaults to 1 -- every existing call site is unaffected.
 * Same seam as `stepFarmhand`'s own (lib/stackacres/farmhand.ts): the
 * Synergy Tree's `automated_logistics` perk is a multiplier on
 * `FARMHAND_SPEED`, computed server-side and handed in rather than read
 * here, since this module has no business knowing about a synergy loadout.
 */
export function stepFarmhandAutomation(
  hand: FarmhandAutomation,
  job: FarmhandJob | null,
  dtMs: number,
  speedMultiplier = 1,
): FarmhandStepResult {
  const dt = frameSeconds(dtMs);
  const speed = FARMHAND_SPEED * speedMultiplier;
  const from = hand.state;
  const nothing = (next: FarmhandAutomation): FarmhandStepResult => ({ hand: next, from, effect: null });

  // Committed. Nothing below can take him off an action in progress.
  if (hand.workMs > 0) {
    const workMs = hand.workMs - dt * 1000;
    if (workMs > 0) return nothing({ ...hand, workMs });
    return { hand: goIdle(hand), from, effect: effectOf(hand) };
  }

  switch (hand.state) {
    case "IDLE": {
      if (job) return nothing(advance(accept(hand, job), dt, speed));
      // Amble home. Already there is the common case and costs one hypot.
      if (withinReach(hand, hand.target)) return nothing(hand);
      return nothing(advance(hand, dt, speed));
    }

    case "WALKING_TO_PLOT": {
      // His plot is gone -- cut by the player's own tap, or refetched away.
      if (!job || job.kind !== "harvest" || job.plotId !== hand.plotId) {
        return nothing(job ? advance(accept(hand, job), dt, speed) : goIdle(hand));
      }
      // Re-aim at the plot's live spot every frame. It does not move today
      // (a plot is hashed to one point), but re-aiming costs nothing and is
      // what stops this needing a rewrite the day a job's target does move --
      // exactly the bug `stepFarmhand` had to fix for wandering livestock.
      const chasing = retarget(hand, job);
      const moved = advanceTowards(chasing, chasing.target, dt, speed);
      if (!moved.arrived) return nothing(moved.walker);
      return nothing({ ...moved.walker, state: "HARVESTING", workMs: FARMHAND_WORK_MS });
    }

    case "DELIVERING_TO_CONTRACT": {
      // The contract stopped being fulfillable while he walked -- the player
      // fulfilled it themselves, or spent the goods.
      if (!job || job.kind !== "deliver") {
        return nothing(job ? advance(accept(hand, job), dt, speed) : goIdle(hand));
      }
      const carrying = retarget(hand, job);
      const moved = advanceTowards(carrying, carrying.target, dt, speed);
      if (!moved.arrived) return nothing(moved.walker);
      // Re-stamp the contract id from the live job: the one he set out with
      // may have been fulfilled and replaced while he walked, and paying the
      // NEW one is right (the goods are in hand and it is the only one open)
      // while naming the old one in the effect is not.
      return nothing({ ...moved.walker, contractId: job.contractId, workMs: FARMHAND_DELIVER_MS });
    }

    // Unreachable: `HARVESTING` is only ever entered with `workMs` set, and
    // the guard at the top of this function owns every frame where it runs.
    // Falling through to IDLE rather than throwing, because a farmhand who
    // stops is a cosmetic bug and a farmhand who throws inside Phaser's
    // update loop takes the whole scene down with him.
    case "HARVESTING":
      return nothing(goIdle(hand));
  }
}

/** Take a job: aim at it and record what it was. Does not move him -- the
 *  caller advances on the same frame, so a job arriving on a long-delta frame
 *  is not silently stalled for one tick. */
function accept(hand: FarmhandAutomation, job: FarmhandJob): FarmhandAutomation {
  return {
    ...hand,
    state: job.kind === "harvest" ? "WALKING_TO_PLOT" : "DELIVERING_TO_CONTRACT",
    plotId: job.kind === "harvest" ? job.plotId : null,
    contractId: job.kind === "deliver" ? job.contractId : null,
    target: job.at,
    tile: job.tile,
    workMs: 0,
  };
}

/** Re-read a job he has already accepted, without re-entering its state. */
function retarget(hand: FarmhandAutomation, job: FarmhandJob): FarmhandAutomation {
  return { ...hand, target: job.at, tile: job.tile };
}

function advance(hand: FarmhandAutomation, dt: number, speed: number): FarmhandAutomation {
  return advanceTowards(hand, hand.target, dt, speed).walker;
}

/** Drop everything and head for the post. */
function goIdle(hand: FarmhandAutomation): FarmhandAutomation {
  return {
    ...hand,
    state: "IDLE",
    target: { ...FARMHAND_BASE },
    tile: tileOf(FARMHAND_BASE),
    plotId: null,
    contractId: null,
    workMs: 0,
  };
}

/** What a completed action owes. Read off the state he is FINISHING, which
 *  is why this is called before `goIdle` clears it. */
function effectOf(hand: FarmhandAutomation): FarmhandEffect | null {
  if (hand.state === "HARVESTING" && hand.plotId) {
    return { kind: "harvested", plotId: hand.plotId, item: "wheat", delta: WHEAT_YIELD_QUANTITY };
  }
  if (hand.state === "DELIVERING_TO_CONTRACT" && hand.contractId) {
    return { kind: "delivered", contractId: hand.contractId };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The class the scene drives                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything the machine is allowed to do to the world outside itself.
 *
 * All optional. A scene that wires none of them gets a farmhand who walks the
 * field and cuts wheat entirely in mime, which is exactly what a test and a
 * memory-mode dev box want -- and what the scene falls back to before the
 * first snapshot arrives.
 */
export interface FarmhandHooks {
  /**
   * A harvest cycle finished. Named and shaped after the brief's
   * `adjust_homestead_inventory(profileId, itemId, delta)`, wired to the live
   * `adjustStackAcresInventory` -> `adjust_homestead_processing_inventory`
   * (see this file's header for why the two are not the same RPC).
   *
   * Resolving with a number means the server applied it and the optimistic
   * overlay for this effect can retire on the next snapshot. Resolving null,
   * or rejecting, is a refusal or a lost race -- the overlay is rolled back
   * immediately and NOTHING is treated as credited. That is the same
   * "null must never be treated as a successful spend" contract
   * `adjustStackAcresInventory` itself carries.
   */
  adjustInventory?: (
    profileId: string,
    itemId: MachineItemId,
    delta: number,
  ) => Promise<number | null>;
  /** A contract handover finished. Settled entirely server-side (goods out,
   *  Gold in, under one guarded write), so there is nothing to predict and
   *  no overlay for it. */
  fulfillContract?: () => Promise<void>;
  /** Every effect, before either call above. For sound, a float label, or a
   *  test. Must not throw; anything that does is swallowed rather than
   *  allowed to kill the frame. */
  onEffect?: (effect: FarmhandEffect) => void;
}

/**
 * How many snapshots a confirmed credit will wait for its base to catch up
 * before it gives up and retires anyway. Two is a long time on this screen
 * (a snapshot lands per action and on tab-return, not on a timer) and exists
 * only so a concurrent spend cannot strand a prediction on screen forever --
 * see `settled` below for the case.
 */
export const OVERLAY_PATIENCE = 2;

/** One optimistic credit, waiting to be told it may stop pretending. */
interface PendingDelta {
  id: number;
  item: MachineItemId;
  delta: number;
  /**
   * What the server said this item's quantity IS, once the write confirmed --
   * null while it is still in the air.
   *
   * A QUANTITY, NOT A TIMER AND NOT A SEQUENCE, and getting here took two
   * wrong answers worth writing down. A timer retires after N milliseconds
   * and hopes a fresh snapshot has landed; under a tap-heavy session sharing
   * a browser with a poker table it often has not, and the number flickers
   * backwards. A sequence ("retire on the next snapshot after confirmation")
   * is better but depends on whether the host's own state flush beats the
   * promise microtask that records it -- lose that race and the base snapshot
   * ALREADY contains this credit while the overlay is still adding it, which
   * flickers the number UP instead. A quantity has no race in it: the entry
   * retires exactly when the base has caught up to what the server said, and
   * it does not matter which order the two arrived in.
   */
  confirmedQuantity: number | null;
  /** Snapshots seen since confirmation. See `OVERLAY_PATIENCE`. */
  waited: number;
}

/**
 * The automated farmhand, driven from `Phaser.Scene.update`.
 *
 * Owns three things and nothing else: the pure state above, the world
 * snapshot to plan against, and the optimistic overlay. It holds no Phaser
 * object -- the scene reads `hand` each frame and moves its own sprite, the
 * same split `walkFarmhand` already uses for the errand runner, which is what
 * keeps this file testable under vitest.
 *
 *     const auto = new FarmhandStateMachine({ adjustInventory, fulfillContract });
 *     // in the scene:
 *     update(_time: number, delta: number) { auto.update(delta); paint(auto.hand); }
 *     // whenever a snapshot lands:
 *     auto.setWorld({ profileId, contract, inventory, machines, wheatPlots });
 */
export class FarmhandStateMachine {
  private automation = spawnFarmhandAutomation();
  private hooks: FarmhandHooks;

  private profileId: string | null = null;
  private world: Omit<FarmhandPlanInput, "claimed"> = {
    contract: null,
    inventory: {},
    machines: [],
    wheatPlots: [],
  };

  /** Plots whose harvest has been emitted but whose refetch has not landed.
   *  Keeps `planFarmhandWork` from sending him back to a plot the server
   *  still reports as ripe because nobody has re-read it yet. */
  private claimed = new Set<string>();
  private pending: PendingDelta[] = [];
  private nextPendingId = 1;
  private running = true;
  /** The Synergy Tree's `automated_logistics` multiplier -- see
   *  `setSpeedMultiplier`'s own comment. */
  private speedMultiplier = 1;

  constructor(hooks: FarmhandHooks = {}) {
    this.hooks = hooks;
  }

  /** The pure state, for the scene to draw. */
  get hand(): FarmhandAutomation {
    return this.automation;
  }

  get state(): FarmhandAutoState {
    return this.automation.state;
  }

  /** The plot he is currently walking to or cutting, for a highlight ring. */
  get workingPlotId(): string | null {
    return this.automation.plotId;
  }

  /**
   * The inventory as the UI should show it: what the server last said, plus
   * every optimistic credit not yet retired. This is the number a HUD binds
   * to, never `world.inventory` directly.
   */
  get inventory(): StackAcresInventory {
    if (this.pending.length === 0) return this.world.inventory;
    let out = this.world.inventory;
    for (const entry of this.pending) {
      out = addToInventory(out, entry.item, this.contributionOf(entry));
    }
    return out;
  }

  /**
   * What one pending credit is still worth adding on top of the base.
   *
   * While it is in the air, the full predicted delta -- there is nothing
   * better to say and the whole point is to say something immediately.
   *
   * Once confirmed, only the GAP between what the server said and what the
   * base snapshot shows. That is what stops the number reading HIGH for the
   * window between a response being applied and its own promise resolving:
   * the base already contains the wheat by then, and adding the delta again
   * would show four wheat as eight. The gap closes to zero at exactly that
   * moment, which is also what retires the entry in `setWorld`.
   *
   * Two confirmed credits on one item can still overlap here (each measures
   * its own gap against the same base), so a second harvest landing inside
   * the first one's window can read high for a snapshot. Left as is: it
   * needs two cuts inside one response, `claimed` already stops him
   * re-cutting a plot, and the `work` pass settles every ripe plot at once,
   * so the second cut usually has nothing left to find.
   */
  private contributionOf(entry: PendingDelta): number {
    if (entry.confirmedQuantity === null) return entry.delta;
    return Math.max(0, entry.confirmedQuantity - inventoryQuantity(this.world.inventory, entry.item));
  }

  /**
   * Another driver moved this man; take his position and stand down.
   *
   * There is ONE farmhand and two things that can walk him: the errand runner
   * answering a tap (./farmhand.ts) and this. Whichever one did not move him
   * has to be told where he ended up, or handing the floor back would snap
   * him to wherever the idle driver last left off.
   *
   * Standing down also DROPS whatever job he was on, which is safe and is why
   * the caller must not do this mid-action: an abandoned walk simply re-plans
   * on the next frame this machine has the floor, and `claimed` still holds
   * the plots it already cut, so nothing is cut twice. Refusing to stand down
   * while `workMs` is running is the caller's job, not this one's -- see
   * `walkFarmhand` in components/arcade/stackacres/stackacres-scene.ts, which
   * tests `workMs` before ever calling this.
   */
  followErrand(walker: Walker): void {
    this.automation = {
      ...this.automation,
      x: walker.x,
      y: walker.y,
      facing: walker.facing,
      towards: walker.towards,
      travelled: walker.travelled,
      state: "IDLE",
      target: { ...FARMHAND_BASE },
      tile: tileOf(FARMHAND_BASE),
      plotId: null,
      contractId: null,
      workMs: 0,
    };
  }

  /** Stop stepping -- a reduced-motion setting, or a scene shutting down.
   *  Leaves him standing exactly where he is; nothing in flight is cancelled,
   *  because a request already sent is going to land either way. */
  setRunning(running: boolean): void {
    this.running = running;
  }

  setHooks(hooks: FarmhandHooks): void {
    this.hooks = hooks;
  }

  /**
   * A fresh snapshot from the server. Retires every optimistic credit the
   * server has now confirmed AND been re-read since, and forgets the claim on
   * any plot that has actually gone.
   */
  setWorld(world: Omit<FarmhandPlanInput, "claimed"> & { profileId?: string | null }): void {
    this.profileId = world.profileId ?? this.profileId;
    this.world = {
      contract: world.contract,
      inventory: world.inventory,
      machines: world.machines,
      wheatPlots: world.wheatPlots,
    };

    // An unconfirmed credit always stays. A confirmed one retires as soon as
    // the base it is sitting on top of has caught up to the quantity the
    // server reported -- or, failing that, once it has waited long enough
    // that the player must have spent the item elsewhere and the base will
    // never reach it.
    this.pending = this.pending.filter((entry) => {
      if (entry.confirmedQuantity === null) return true;
      // The base has caught up: the entry has nothing left to contribute.
      if (this.contributionOf(entry) === 0) return false;
      entry.waited += 1;
      return entry.waited < OVERLAY_PATIENCE;
    });

    // A claim is released once the plot it named is no longer standing. A
    // plot the server still reports keeps its claim, however old: releasing
    // on a timer would send him straight back to re-cut it.
    if (this.claimed.size > 0) {
      const alive = new Set(world.wheatPlots.map((plot) => plot.id));
      for (const id of this.claimed) {
        if (!alive.has(id)) this.claimed.delete(id);
      }
    }
  }

  /**
   * One frame. Call from `Phaser.Scene.update(time, delta)` with the raw
   * millisecond delta -- the clamp against a backgrounded tab lives in
   * `frameSeconds`, so passing Phaser's delta straight through is correct.
   */
  update(deltaMs: number): void {
    if (!this.running) return;
    const job = planFarmhandWork({ ...this.world, claimed: this.claimed });
    const step = stepFarmhandAutomation(this.automation, job, deltaMs, this.speedMultiplier);
    this.automation = step.hand;
    if (step.effect) this.dispatch(step.effect);
  }

  /**
   * Pushed rather than rebuilt, same reasoning as the scene's own
   * `setToolTier`: a fresh loadout read must speed him up NOW, on his next
   * `update()`, without losing whatever job he is mid-walk on. Defaults to 1
   * at construction -- see `StackAcresView.synergy.farmhandSpeedMultiplier`.
   */
  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  /**
   * A finished cycle. The optimistic credit is applied on THIS frame, before
   * anything is sent -- that ordering is the whole concurrency story: a
   * snapshot arriving between the harvest and its request cannot show the
   * player a number that went down.
   */
  private dispatch(effect: FarmhandEffect): void {
    try {
      this.hooks.onEffect?.(effect);
    } catch {
      // A cosmetic hook must never take the frame down with it.
    }

    if (effect.kind === "delivered") {
      void this.hooks.fulfillContract?.().catch(() => {
        // The contract is settled server-side under its own guard; a failed
        // send just means the next snapshot still shows it open and he walks
        // the sack over again. Nothing was predicted, so there is nothing to
        // roll back.
      });
      return;
    }

    this.claimed.add(effect.plotId);
    const entry: PendingDelta = {
      id: this.nextPendingId++,
      item: effect.item,
      delta: effect.delta,
      confirmedQuantity: null,
      waited: 0,
    };
    this.pending.push(entry);

    const adjust = this.hooks.adjustInventory;
    const profileId = this.profileId;
    if (!adjust || !profileId) {
      // Nothing wired to send it, so nothing will ever confirm it. Drop the
      // prediction rather than leave a credit on screen forever.
      this.rollback(entry.id);
      this.claimed.delete(effect.plotId);
      return;
    }

    void adjust(profileId, entry.item, entry.delta)
      .then((quantity) => {
        // Null is a refusal or a lost race, never a quiet success.
        if (quantity === null) {
          this.rollback(entry.id);
          this.claimed.delete(effect.plotId);
          return;
        }
        entry.confirmedQuantity = quantity;
      })
      .catch(() => {
        this.rollback(entry.id);
        this.claimed.delete(effect.plotId);
      });
  }

  private rollback(id: number): void {
    this.pending = this.pending.filter((entry) => entry.id !== id);
  }
}

export { CONTRACT_DROP };
