/**
 * A member of staff: IDLE -> CHOOSE_TASK -> MOVE -> WORK -> COMPLETE, and round again, with BREAK when worn out.
 *
 * An idle worker only looks at the board on a 500ms clock, not every frame, and each worker's clock is
 * offset from the others' so a crew doesn't all turn round at once. A job can have more than one leg (a
 * restock is the stockroom, then the shelf), and each leg is walk there, check it still needs doing, then
 * do it for a while. When the thing a note was about has gone (the customer walked out, the stockroom ran
 * dry) the note is torn up and whatever they were carrying goes back where it came from.
 *
 * Each has a post: the cashier's till, the produce counter, the stockroom door. With nothing to do they
 * go back to it and wait there, the way shop staff do, rather than standing wherever the last job ended.
 *
 * What makes one worker not like the next, after Chef RPG's staff:
 *
 * - Each has a profile: how fast they walk, how quick their hands are, how long they last, and traits.
 * - Energy runs down with work (walking wears less). A tired worker walks a little slower, and once worn
 *   out finishes what they're doing and goes on break at the site's break spot until they've had a rest.
 * - A worker on their way to a job, hands empty, still glances at the board on the same clock, and drops
 *   it for anything more urgent.
 * - A job can run on into the next one nearby of the same kind, claimed off the board as they go.
 *
 * Pure, tested without Phaser (worksite.test.ts).
 */

import type { Dir } from "./npc-routine";
import {
  PRIORITY,
  faceToward,
  type Act,
  keyOf,
  makeWay,
  sameTile,
  standingAt,
  stepWalk,
  walkAmong,
  type Board,
  type Crowd,
  type Job,
  type Router,
  type Task,
  type Tile,
  type Walker,
  type WalkerView,
} from "./work-board";

export type WorkerState = "IDLE" | "CHOOSE_TASK" | "MOVE" | "WORK" | "COMPLETE" | "BREAK";

/** How often an idle worker looks at the board, and a busy one glances at it. */
export const LOOK_EVERY_MS = 500;

export type Trait = "overworker" | "brisk" | "steady" | "dawdler";

export const TRAITS: Readonly<Record<Trait, { label: string; blurb: string }>> = {
  overworker: { label: "Overworker", blurb: "Never needs a break, but now and then fumbles a job and takes twice as long." },
  brisk: { label: "Brisk", blurb: "Works a tenth faster, and the pace wears the rest of the crew down sooner." },
  steady: { label: "Steady", blurb: "Tires a third slower than most." },
  dawdler: { label: "Dawdler", blurb: "Takes their time walking anywhere." },
};

export interface WorkerProfile {
  /** Multiplies the site's walking pace (ms a tile): under 1 is quicker. */
  walk: number;
  /** Multiplies how long each piece of work takes: under 1 is quicker. */
  hands: number;
  /** Real ms of steady work from rested to worn out. */
  endurance: number;
  traits: readonly Trait[];
}

export const DEFAULT_PROFILE: WorkerProfile = { walk: 1, hands: 1, endurance: 120_000, traits: [] };

/** Worn out below this: they go on break at the next chance. */
export const TIRED = 0.2;
/** Below this they walk a little slower. */
const WEARY = 0.4;
/** Walking wears this fraction of what working does. */
const WALK_WEAR = 0.35;
/** Held up this long on the way to the break spot, a worker rests where they are. */
const REST_HERE_AFTER_MS = 1500;
/** Held up this long at a job's square, a worker works it from beside it, where they can. */
const WORK_BESIDE_AFTER_MS = 800;
/** Held up this long at a square that can't be worked from beside, the job goes back on the board. */
const GIVE_UP_AFTER_MS = 15_000;
/** How often an overworker fumbles a piece of work. */
const FUMBLE_CHANCE = 0.06;

export interface Leg {
  at: Tile;
  facing: Dir;
  doing: Act;
  ms: number;
  /** Still worth doing, checked on arrival. */
  ready: () => boolean;
  /** The work has begun, at `now`: anything it needs held or set going is done from here. */
  start?: (now: number) => void;
  finish: (now: number) => void;
  /** The note this leg is for, when it came from a job run on into (see `Plan.chain`). */
  taskKey?: string;
  /** After this leg, ask the plan whether a job nearby can be run on into. */
  chains?: boolean;
  /** The work can be done from any free square beside `at` too (a shelf, a barn door), so someone
   *  standing on `at` itself doesn't hold the job up. */
  around?: boolean;
}

export interface Plan {
  legs: Leg[];
  /** Put back whatever the worker is carrying when the job falls through halfway. */
  giveBack: (count: number) => void;
  /** Another job to run on into from here, claimed off the board for this worker, or null. */
  chain?: (worker: Worker) => { task: Task; legs: Leg[] } | null;
}

/** Turns a note into the legs of the job, or null when the note has gone stale. */
export type Planner = (task: Task, worker: Worker) => Plan | null;

/** What a worker steps with, handed in by the site each step. */
export interface WorkContext {
  board: Board;
  route: Router;
  planner: Planner;
  crowd: Crowd;
  /** The site's walking pace, ms a tile. */
  msPerTile: number;
  /** How much faster than usual everyone else is tiring (a brisk colleague). */
  wear: number;
  /** Where to rest, or null to rest where they stand. */
  breakSpot: Tile | null;
  /** How long a full rest takes, from worn out to rested. */
  restMs: number;
  random: () => number;
}

export class Worker {
  state: WorkerState = "IDLE";
  readonly walker: Walker;
  carrying = 0;
  /** 1 rested, 0 worn out. */
  energy = 1;
  private tasks: Task[] = [];
  /** Notes whose work has started: never put back on the board, only torn up. */
  private started = new Set<string>();
  private plan: Plan | null = null;
  private leg = 0;
  private workLeft = 0;
  private nextLook: number;
  private goal: Tile | null = null;
  /** Their post, and which way they face there. */
  readonly home: Tile | null;
  private readonly homeFacing: Dir;
  /** Sitting down on the break chair (rather than just standing about). */
  private seated = false;

  constructor(
    readonly name: string,
    readonly job: Job,
    readonly sprite: string,
    at: Tile,
    firstLook: number,
    readonly profile: WorkerProfile = DEFAULT_PROFILE,
    post: (Tile & { facing?: Dir }) | null = null,
    /** Which of their job's notes are theirs to take (a cashier takes only their own till's). */
    private readonly mine: (task: Task) => boolean = () => true,
  ) {
    this.walker = standingAt(at);
    this.nextLook = firstLook;
    this.home = post ? { tx: post.tx, ty: post.ty } : null;
    this.homeFacing = post?.facing ?? "down";
  }

  has(trait: Trait): boolean {
    return this.profile.traits.includes(trait);
  }

  get taskKey(): string | null {
    return this.tasks[0]?.key ?? null;
  }

  get onBreak(): boolean {
    return this.state === "BREAK";
  }

  private msPerTile(ctx: WorkContext): number {
    const weary = this.energy < WEARY ? 1.15 : 1;
    const dawdle = this.has("dawdler") ? 1.2 : 1;
    return ctx.msPerTile * this.profile.walk * weary * dawdle;
  }

  private wearOut(dt: number, rate: number, ctx: WorkContext): void {
    if (this.has("overworker")) return;
    const steady = this.has("steady") ? 0.7 : 1;
    this.energy = Math.max(0, this.energy - (dt / this.profile.endurance) * rate * steady * ctx.wear);
  }

  step(now: number, dt: number, ctx: WorkContext): void {
    const { board, route, planner } = ctx;
    // A few transitions can happen in one tick (a note is claimed and the walk begins); never loop forever.
    for (let hops = 0; hops < 4; hops++) {
      switch (this.state) {
        case "IDLE":
          if (now < this.nextLook) {
            // Standing about in someone's way: step aside. Walking back to their post, they go round and squeeze
            // past people like anyone else.
            if (makeWay(this.walker, ctx.crowd, route) || this.walker.path.length > 0 || this.walker.stepLeft > 0) {
              const to = this.walker.path[this.walker.path.length - 1] ?? this.walker.tile;
              walkAmong(this.walker, to, dt, this.msPerTile(ctx), ctx.crowd, route);
            }
            return;
          }
          if (this.energy < TIRED) {
            this.goOnBreak(ctx);
            break;
          }
          this.state = "CHOOSE_TASK";
          break;

        case "CHOOSE_TASK": {
          const got = board.claim(this.name, this.job, this.walker.tile, route, 0, this.mine);
          if (!got) {
            this.rest(now);
            this.goHome(ctx);
            return;
          }
          const plan = planner(got.task, this);
          if (!plan || plan.legs.length === 0) {
            board.tear(got.task.key);
            this.rest(now);
            return;
          }
          this.tasks = [got.task];
          this.plan = plan;
          this.leg = 0;
          this.walker.path = got.path;
          this.goal = plan.legs[0].at;
          this.state = "MOVE";
          break;
        }

        case "MOVE": {
          if (this.glanceForWorse(now, ctx)) break;
          const arrived = walkAmong(this.walker, this.goal ?? this.walker.tile, dt, this.msPerTile(ctx), ctx.crowd, route);
          // Walking wears; standing waiting doesn't.
          if (this.walker.stepLeft > 0) this.wearOut(dt, WALK_WEAR, ctx);
          if (!arrived) {
            this.whenHeldUp(now, ctx);
            return;
          }
          const leg = this.currentLeg();
          this.walker.facing = this.goal && !sameTile(this.goal, leg.at) ? faceToward(this.walker.tile, leg.at, leg.facing) : leg.facing;
          if (!leg.ready()) {
            // A job run on into that has gone stale is just skipped; the job they set out on falls through.
            if (leg.taskKey) {
              board.tear(leg.taskKey);
              this.tasks = this.tasks.filter((t) => t.key !== leg.taskKey);
              this.nextLeg(now, ctx);
              return;
            }
            this.abandon(board, now);
            return;
          }
          leg.start?.(now);
          const fumble = this.has("overworker") && ctx.random() < FUMBLE_CHANCE ? 2 : 1;
          const brisk = this.has("brisk") ? 0.9 : 1;
          this.workLeft = leg.ms * this.profile.hands * brisk * fumble;
          this.state = "WORK";
          return;
        }

        case "WORK": {
          this.workLeft -= dt;
          this.wearOut(dt, 1, ctx);
          if (this.workLeft > 0) return;
          const done = this.currentLeg();
          this.started.add(done.taskKey ?? this.tasks[0].key);
          done.finish(now);
          if (done.chains && this.plan?.chain) {
            const more = this.plan.chain(this);
            if (more) {
              this.tasks.push(more.task);
              this.plan.legs.splice(this.leg + 1, 0, ...more.legs.map((l) => ({ ...l, taskKey: more.task.key })));
            }
          }
          this.nextLeg(now, ctx);
          // nextLeg may have finished the job; TypeScript still thinks this is WORK.
          if ((this.state as WorkerState) === "COMPLETE") break;
          return;
        }

        case "COMPLETE":
          for (const task of this.tasks) board.tear(task.key);
          this.clear();
          this.rest(now);
          return;

        case "BREAK": {
          if (this.goal && !walkAmong(this.walker, this.goal, dt, this.msPerTile(ctx), ctx.crowd, route)) {
            // Someone's already resting on the spot: rest here instead of waiting for it.
            if (this.walker.blockedMs < REST_HERE_AFTER_MS) return;
            this.walker.path = [];
          }
          this.goal = null;
          if (makeWay(this.walker, ctx.crowd, route) || this.walker.path.length > 0 || this.walker.stepLeft > 0) {
            this.seated = false;
            stepWalk(this.walker, dt, this.msPerTile(ctx), (t) => !ctx.crowd.isTaken(t, this.walker));
          } else if (ctx.breakSpot && sameTile(this.walker.tile, ctx.breakSpot)) {
            this.seated = true;
            this.walker.facing = "down";
          }
          this.energy = Math.min(1, this.energy + dt / ctx.restMs);
          if (this.energy < 1) return;
          this.seated = false;
          this.rest(now);
          return;
        }
      }
    }
  }

  /**
   * Stuck short of the job's own square because someone stands on it: work it from a free square beside
   * it if the job allows, or after long enough put the job back on the board for later.
   */
  private whenHeldUp(now: number, ctx: WorkContext): void {
    const leg = this.currentLeg();
    const next = this.walker.path[0];
    if (!leg || !this.goal || !next || !sameTile(next, this.goal)) return;
    if (leg.around && this.walker.blockedMs >= WORK_BESIDE_AFTER_MS) {
      const taken = ctx.crowd.taken(this.walker);
      let best: { at: Tile; path: Tile[] } | null = null;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const at = { tx: leg.at.tx + dx, ty: leg.at.ty + dy };
        if (taken.has(keyOf(at))) continue;
        const path = sameTile(at, this.walker.tile) ? [] : ctx.route(this.walker.tile, at, taken);
        if (path && (!best || path.length < best.path.length)) best = { at, path };
      }
      if (best) {
        this.goal = best.at;
        this.walker.path = best.path;
        this.walker.blockedMs = 0;
        this.walker.rerouted = false;
        return;
      }
    }
    if (this.walker.blockedMs >= GIVE_UP_AFTER_MS) this.putBack(ctx.board, now);
  }

  /** Can't get at it: notes not yet started go back up for later, started ones come down, anything carried goes back. */
  private putBack(board: Board, now: number): void {
    for (const task of this.tasks) {
      if (this.started.has(task.key)) board.tear(task.key);
      else board.release(task.key);
    }
    if (this.carrying > 0) this.plan?.giveBack(this.carrying);
    this.carrying = 0;
    this.walker.path = [];
    this.clear();
    this.rest(now);
  }

  /** On the way to a job, hands still empty: drop it for a worse one on the board, if there is one. */
  private glanceForWorse(now: number, ctx: WorkContext): boolean {
    if (now < this.nextLook || this.leg !== 0 || this.carrying > 0 || this.tasks.length !== 1) return false;
    this.nextLook = now + LOOK_EVERY_MS;
    const current = this.tasks[0];
    const got = ctx.board.claim(this.name, this.job, this.walker.tile, ctx.route, PRIORITY[current.kind] + 1, this.mine);
    if (!got) return false;
    const plan = ctx.planner(got.task, this);
    if (!plan || plan.legs.length === 0) {
      ctx.board.release(got.task.key);
      return false;
    }
    ctx.board.release(current.key);
    this.tasks = [got.task];
    this.plan = plan;
    this.leg = 0;
    // Finish the square underfoot, then turn for the new job.
    this.walker.path = got.path;
    this.goal = plan.legs[0].at;
    return true;
  }

  private nextLeg(now: number, ctx: WorkContext): void {
    this.leg += 1;
    if (this.leg >= this.legs().length) {
      this.state = "COMPLETE";
      return;
    }
    const path = ctx.route(this.walker.tile, this.currentLeg().at);
    if (!path) {
      this.abandon(ctx.board, now);
      return;
    }
    this.walker.path = path;
    this.goal = this.currentLeg().at;
    this.state = "MOVE";
  }

  /** Nothing to do: back to their post, if they're not there already, to wait facing the right way. */
  private goHome(ctx: WorkContext): void {
    if (!this.home || this.walker.path.length > 0 || this.walker.stepLeft > 0) return;
    if (sameTile(this.walker.tile, this.home)) {
      this.walker.facing = this.homeFacing;
      return;
    }
    const path = ctx.route(this.walker.tile, this.home, ctx.crowd.taken(this.walker));
    if (path) this.walker.path = path;
  }

  private goOnBreak(ctx: WorkContext): void {
    this.state = "BREAK";
    this.goal = null;
    if (!ctx.breakSpot) return;
    const path = ctx.route(this.walker.tile, ctx.breakSpot);
    if (path && path.length > 0) {
      this.walker.path = path;
      this.goal = ctx.breakSpot;
    }
  }

  /** The job fell through: its note comes down, any it ran on into go back up, and anything carried goes back. */
  private abandon(board: Board, now: number): void {
    const [first, ...rest] = this.tasks;
    if (first) board.tear(first.key);
    for (const task of rest) {
      if (this.started.has(task.key)) board.tear(task.key);
      else board.release(task.key);
    }
    if (this.carrying > 0) this.plan?.giveBack(this.carrying);
    this.carrying = 0;
    this.walker.path = [];
    this.clear();
    this.rest(now);
  }

  private clear(): void {
    this.tasks = [];
    this.started.clear();
    this.plan = null;
    this.leg = 0;
    this.workLeft = 0;
    this.goal = null;
  }

  private rest(now: number): void {
    this.state = "IDLE";
    this.nextLook = now + LOOK_EVERY_MS;
  }

  private legs(): Leg[] {
    return this.plan?.legs ?? [];
  }

  private currentLeg(): Leg {
    return this.legs()[this.leg];
  }

  doing(): Act {
    if (this.state === "WORK") return this.currentLeg().doing;
    const walking = this.walker.stepLeft > 0 || this.walker.path.length > 0;
    if (walking) return this.carrying > 0 ? "carry" : "walk";
    if (this.state === "BREAK" && this.seated) return "sit";
    return "idle";
  }

  view(): WalkerView {
    const { tile, from, stepMs, stepLeft, facing } = this.walker;
    return { id: this.name, sprite: this.sprite, tile, from, stepMs, stepLeft, facing, doing: this.doing(), carrying: this.carrying };
  }
}
