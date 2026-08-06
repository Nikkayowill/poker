/**
 * Every chip on the felt: the pot as a physical pile, the spray a bet pushes
 * in, and the pot going back out to whoever won it.
 *
 * This is the renderer-agnostic core of the chip system — positions,
 * identities and motion, with not a single drawing call in it. The canvas
 * component paints whatever `drawList()` returns; this module decides where
 * everything is. It lives in `lib/` rather than beside the renderer so
 * `npm test` can reach it (`vitest.config.ts` collects `lib/` and `app/`),
 * which its three.js predecessor in `components/table/scene/` never was.
 *
 * What carries over from that predecessor is every decision that was about
 * poker rather than about a renderer: the pot is broken into denominations
 * by `potChipStacks` in big blinds (so a pile means the same thing at every
 * tier), columns are capped at MAX_CHIPS_PER_COLUMN, the settle jitter is
 * seeded from a chip's own identity rather than `Math.random()`, sprays fly
 * the *amount* as chips (`betSprayDenominations`/`funnelSprayDenominations`)
 * with the decorative cycle only as a malformed-input fallback, and the
 * staggers and the friction slide are exactly the ones the celebration
 * budget in `chip-physics.test.ts` is solved against.
 */

import {
  BET_CHIP_COUNT,
  BET_CHIP_STAGGER_MS,
  betSprayDenominations,
  chipSettleJitter,
  decorativeDenomination,
  distance,
  FUNNEL_CHIP_COUNT,
  FUNNEL_CHIP_STAGGER_MS,
  funnelSprayDenominations,
  stepChip,
  stepGlideChip,
} from "./chip-physics";
import {
  DEFAULT_BET_STYLE,
  NEAT_SLIDE_DURATION_MS,
  SPLASH_ARC_PEAK,
  splashScatterOffset,
  type BetAnimationStyle,
} from "./bet-style";
import { MAX_CHIPS_PER_COLUMN, potChipStacks } from "@/lib/game/pot-chips";
import { FELT, type Vec3 } from "./scene-config";
import { potPosition, ringPoint, seatAngle, seatBetOrigin } from "./seat-ring";

/** The token: a 39mm chip against a 2.1m table, near enough exactly right. */
export const CHIP_RADIUS = 0.4;
/**
 * A real 39mm chip is 3.3mm thick — thickness = radius × 0.17, which at
 * CHIP_RADIUS 0.4 is this. The stack pitch and the painted edge height are
 * both exactly this value, which is what keeps a resting stack literally
 * flush: chip i's top face is chip i+1's bottom face, no daylight.
 */
export const CHIP_THICKNESS = 0.068;

/** How far apart the pile's denomination columns stand. */
const COLUMN_SPACING = 0.98;

/** How high a newly added pile chip drops in from. */
const PILE_DROP = 1.1;

/**
 * A standing bet's columns stand a little tighter than the pot's, and drop
 * in from lower: a bet is a hand's-width of chips pushed out by one player,
 * not the table's whole middle.
 */
const BET_COLUMN_SPACING = 0.88;
const BET_DROP = 0.7;

/** Per-chip stagger when a street's standing bets sweep into the pot. */
const SWEEP_STAGGER_MS = 14;

export interface SceneChip {
  denomination: number;
  /** The chip's centre, in world units. */
  position: Vec3;
  /**
   * True while the chip is genuinely in flight. The painter keys the
   * decoupled ground shadow off this, not off height alone: a chip resting
   * mid-stack is well above the felt too, and giving it a hovering shadow
   * pool is exactly what makes a settled pile read as floating chips.
   */
  airborne?: boolean;
}

interface MovingChip {
  chip: SceneChip;
  /**
   * The slide's own state, kept separate from the drawn position on
   * purpose. The friction slide converges geometrically *on the base*; the
   * arc is presentation layered over it each frame. Feeding the arced
   * position back into `stepChip` — which the WebGL predecessor did — makes
   * the arc residue re-amplify near the target and the chip hovers forever
   * instead of arriving, which held the render loop awake for good.
   */
  base: Vec3;
  target: Vec3;
  originalDistance: number;
  /** Counts down before the chip starts moving, which is what staggers a spray. */
  delayMs: number;
  /** Pile chips stay when they land; spray chips are removed. */
  keepOnArrival: boolean;
  /**
   * Present on a neat-slide chip: a clocked cubic-ease-out glide instead of
   * the friction slide. The pillar's chips all share one duration, which is
   * what keeps them a rigid body in flight — see `stepGlideChip`.
   */
  glide?: { from: Vec3; durationMs: number; elapsedMs: number };
  /** A splash chip's taller parabola; absent means the default slide arc. */
  arcPeak?: number;
}

export class ChipLayer {
  private readonly moving: MovingChip[] = [];
  /** Pile chips by their identity in the breakdown, so a settled one is reused. */
  private readonly pile = new Map<string, SceneChip>();
  /**
   * Standing street bets, keyed `slot:denomination:index` — the chips
   * resting in front of each bettor until the street closes. The same keyed
   * sync discipline as the pile: a raise *adds* chips to a stack that is
   * already there, and a re-fetched snapshot re-hands every settled chip
   * its identical spot.
   */
  private readonly bets = new Map<string, SceneChip>();
  private paying = false;
  /**
   * The felt's plan depth for the current fit, in world units.
   *
   * Every position in here that is "somewhere around the table" rather than
   * "somewhere on a chip" scales with it — the bet spots, the payout
   * landings, the pot itself — because the table's plan shape follows the
   * plate's aspect ratio (see `fitView`). Held as a field and pushed in by
   * the renderer rather than threaded through nine call sites, and defaulted
   * to the desktop shape so every unit test that constructs a layer without
   * one keeps describing the same table it always did.
   */
  private radiusZ: number = FELT.radiusZ;
  /**
   * How a bet's spray travels — the player's own preference, pushed in by
   * the renderer. Only future sprays read it: a chip already in flight
   * finishes the journey it left on, restyling mid-air would be the visual
   * equivalent of rewriting history.
   */
  private betStyle: BetAnimationStyle = DEFAULT_BET_STYLE;

  constructor(private readonly onChanged: () => void) {}

  /** Select how future bet sprays travel. No repaint: nothing on screen moves. */
  setBetStyle(style: BetAnimationStyle): void {
    this.betStyle = style;
  }

  /**
   * Re-shape the table under the chips already on it.
   *
   * Only the spots future chips are given are recomputed; chips already at
   * rest keep their world positions. A resize is not a game event, and
   * re-homing a settled pile mid-hand would read as the pot twitching.
   */
  setRadiusZ(radiusZ: number): void {
    if (!Number.isFinite(radiusZ) || radiusZ <= 0 || radiusZ === this.radiusZ) return;
    this.radiusZ = radiusZ;
  }

  /**
   * The pot, as chips.
   *
   * Keyed by denomination and position in the column: raising a pot from
   * three chips to four has to *add one chip*, not rebuild the stack, or
   * every chip already on the felt replays its landing every time anybody
   * bets.
   */
  syncPile(pot: number, bigBlind: number, paying: boolean): void {
    if (paying !== this.paying) {
      this.paying = paying;
      this.onChanged();
    }
    // While the funnel is running the pot has already been paid out; leaving
    // the pile under it would show the same chips twice.
    const stacks = paying ? [] : potChipStacks(pot, bigBlind);
    const wanted = new Set<string>();

    const spread = (stacks.length - 1) / 2;
    // Named for the spot, not the amount -- `pot` is already this method's
    // first parameter, and the pile is no longer at the felt's own centre.
    const centre = potPosition(this.radiusZ);
    stacks.forEach((stack, column) => {
      for (let index = 0; index < stack.count; index += 1) {
        const key = `${stack.denomination}:${index}`;
        wanted.add(key);
        if (this.pile.has(key)) continue;

        const jitter = chipSettleJitter(stack.denomination, index);
        const rest: Vec3 = {
          x: centre.x + (column - spread) * COLUMN_SPACING + jitter.x,
          y: FELT.y + CHIP_THICKNESS / 2 + index * CHIP_THICKNESS,
          z: centre.z + jitter.z,
        };
        const chip: SceneChip = {
          denomination: stack.denomination,
          position: { x: rest.x, y: rest.y + PILE_DROP, z: rest.z },
          airborne: true,
        };
        this.pile.set(key, chip);
        this.moving.push({
          chip,
          base: { ...chip.position },
          target: rest,
          originalDistance: PILE_DROP,
          delayMs: index * 18,
          keepOnArrival: true,
        });
        this.onChanged();
      }
    });

    for (const [key, chip] of this.pile) {
      if (wanted.has(key)) continue;
      // Drop it from the moving list too, or a chip that was still settling
      // would be animated after being removed.
      const index = this.moving.findIndex((entry) => entry.chip === chip);
      if (index >= 0) this.moving.splice(index, 1);
      this.pile.delete(key);
      this.onChanged();
    }
  }

  /**
   * The standing bets: each seat's committed-this-street amount as chips,
   * resting at that seat's edge of the felt until the street closes — the
   * way a real bet sits in front of its player, not in the pot it is not
   * yet part of. The centre pile's amount is the pot *minus* these, so the
   * felt's chips always sum to the pot the HUD states.
   *
   * Columns spread along the ellipse's tangent at the seat, not along the
   * screen's X: a side seat's bet would otherwise stack its columns into
   * the rail.
   */
  syncBets(bets: Array<{ slot: number; amount: number }>, seatCount: number, bigBlind: number): void {
    const wanted = new Set<string>();
    for (const { slot, amount } of bets) {
      const stacks = potChipStacks(amount, bigBlind);
      if (stacks.length === 0) continue;
      const origin = seatBetOrigin(slot, seatCount, this.radiusZ);
      const theta = seatAngle(slot, seatCount);
      // Plan-space tangent of the ellipse at this seat, unit length.
      const tangent = { x: -Math.sin(theta), z: Math.cos(theta) };
      const spread = (stacks.length - 1) / 2;
      stacks.forEach((stack, column) => {
        for (let index = 0; index < stack.count; index += 1) {
          const key = `${slot}:${stack.denomination}:${index}`;
          wanted.add(key);
          if (this.bets.has(key)) continue;
          const jitter = chipSettleJitter(stack.denomination, index);
          const along = (column - spread) * BET_COLUMN_SPACING;
          const rest: Vec3 = {
            x: origin.x + tangent.x * along + jitter.x,
            y: FELT.y + CHIP_THICKNESS / 2 + index * CHIP_THICKNESS,
            z: origin.z + tangent.z * along + jitter.z,
          };
          const chip: SceneChip = {
            denomination: stack.denomination,
            position: { x: rest.x, y: rest.y + BET_DROP, z: rest.z },
            airborne: true,
          };
          this.bets.set(key, chip);
          this.moving.push({
            chip,
            base: { ...chip.position },
            target: rest,
            originalDistance: BET_DROP,
            delayMs: index * 18,
            keepOnArrival: true,
          });
          this.onChanged();
        }
      });
    }

    for (const [key, chip] of this.bets) {
      if (wanted.has(key)) continue;
      // A standing bet only ever shrinks outside a sweep on a reconnect or
      // divergent refetch; the honest correction there is instant, exactly
      // as the pile's is.
      const index = this.moving.findIndex((entry) => entry.chip === chip);
      if (index >= 0) this.moving.splice(index, 1);
      this.bets.delete(key);
      this.onChanged();
    }
  }

  /**
   * The street closing: every standing bet slides into the middle, the way
   * a dealer sweeps the action in before the next card. The chips are
   * *transferred* out of the standing map into flight — not cleared and
   * re-spawned — so each one leaves from exactly where it was resting.
   * Immediately after this the pot pile grows by the swept amount via its
   * own keyed sync, which is the same arrive-then-drop duality every bet
   * spray has always had.
   */
  sweepBets(): void {
    let order = 0;
    const pot = potPosition(this.radiusZ);
    for (const chip of this.bets.values()) {
      // A chip still dropping in sweeps from wherever it is; drop its
      // settle flight so it is not animated twice.
      const pending = this.moving.findIndex((entry) => entry.chip === chip);
      if (pending >= 0) this.moving.splice(pending, 1);
      const jitter = chipSettleJitter(chip.denomination, order);
      const target: Vec3 = {
        x: pot.x + jitter.x * 4,
        y: FELT.y + CHIP_THICKNESS / 2,
        z: pot.z + jitter.z * 4,
      };
      chip.airborne = true;
      this.moving.push({
        chip,
        base: { ...chip.position },
        target,
        originalDistance: distance(chip.position, target),
        delayMs: order * SWEEP_STAGGER_MS,
        keepOnArrival: false,
      });
      order += 1;
    }
    if (order > 0) this.onChanged();
    this.bets.clear();
  }

  /**
   * Standing bets, gone at once — for the moments a sweep would lie: a new
   * hand mounting over a stale one, or the payout, where the pot the bets
   * already joined is the thing flying out.
   */
  clearBets(): void {
    for (const chip of this.bets.values()) {
      const index = this.moving.findIndex((entry) => entry.chip === chip);
      if (index >= 0) this.moving.splice(index, 1);
    }
    if (this.bets.size > 0) this.onChanged();
    this.bets.clear();
  }

  /**
   * A bet: the amount actually committed, as chips, from the player's own
   * rail to their bet spot — smallest denominations first, so the big chips
   * end up on top where they read. The spray lands where the standing bet
   * (`syncBets`) is about to appear, which is what makes the
   * arrive-then-settle read as one gesture. The old fixed three-chip
   * decorative spray survives only as the fallback for a malformed amount,
   * where showing something is better than a silent bet.
   *
   * How the chips travel is the selected style:
   *
   * "neat_slide" — the whole bet as one rigid pillar, stacked a thickness
   * apart (which the projection renders as the classic ~3px screen rise
   * per chip at the desktop fit), no scatter, no stagger, no arc: every
   * chip glides on the same clocked cubic ease-out, off the line fast and
   * into a heavy stop, exactly aligned the whole way.
   *
   * "splash_chunk" — chips thrown in one by one on tall parabolas
   * (SPLASH_ARC_PEAK over the friction slide), staggered by index so the
   * cluster visibly blooms, each landing on its own trigonometric
   * index-wave offset (`splashScatterOffset`) and settling on the slide's
   * exponential decay. Every offset is a pure function of the chip's
   * index, so the same bet lands the same cluster every time.
   */
  spawnBet(slot: number, seatCount: number, amount: number, bigBlind: number): void {
    const origin = ringPoint(slot, seatCount, 0.98, FELT.y, this.radiusZ);
    const spot = seatBetOrigin(slot, seatCount, this.radiusZ);
    const denominations = betSprayDenominations(amount, bigBlind);
    const spray = denominations.length > 0
      ? denominations
      : Array.from({ length: BET_CHIP_COUNT }, (_, index) => decorativeDenomination(index));
    spray.forEach((denomination, index) => {
      const restY = FELT.y + CHIP_THICKNESS / 2;
      const start: Vec3 = {
        x: origin.x,
        y: restY + index * CHIP_THICKNESS,
        z: origin.z,
      };
      if (this.betStyle === "neat_slide") {
        // The pillar keeps each chip at its own height on both ends, so the
        // stack that arrives is the stack that left.
        const target: Vec3 = { x: spot.x, y: restY + index * CHIP_THICKNESS, z: spot.z };
        this.moving.push({
          chip: { denomination, position: { ...start }, airborne: true },
          base: { ...start },
          target,
          originalDistance: distance(start, target),
          delayMs: 0,
          keepOnArrival: false,
          glide: { from: { ...start }, durationMs: NEAT_SLIDE_DURATION_MS, elapsedMs: 0 },
        });
      } else {
        const scatter = splashScatterOffset(index);
        const target: Vec3 = {
          x: spot.x + scatter.x,
          y: restY,
          z: spot.z + scatter.z,
        };
        this.moving.push({
          chip: { denomination, position: { ...start }, airborne: true },
          base: { ...start },
          target,
          originalDistance: distance(start, target),
          delayMs: index * BET_CHIP_STAGGER_MS,
          keepOnArrival: false,
          arcPeak: SPLASH_ARC_PEAK,
        });
      }
    });
    this.onChanged();
  }

  /**
   * The pot going home: each winner's actual payout as chips, 34ms apart,
   * landing on the winner's own edge of the felt rather than on the seat
   * itself — chips are pushed to a player, not thrown at them.
   *
   * The landing spot is 0.92 of the seat ring, just inside the rail, which
   * is where a dealer actually pushes a pot. (Landing at a fraction of the
   * felt's radius was tried first and left a side seat's payout closing only
   * a fifth of the distance to its plate — it read as the pot drifting
   * vaguely leftward rather than anyone being paid.)
   */
  spawnFunnel(winners: Array<{ slot: number; amount: number }>, seatCount: number, bigBlind: number): void {
    const pot = potPosition(this.radiusZ);
    for (const { slot, amount } of winners) {
      const denominations = funnelSprayDenominations(amount, bigBlind);
      const spray = denominations.length > 0
        ? denominations
        : Array.from({ length: FUNNEL_CHIP_COUNT }, (_, index) => decorativeDenomination(index));
      spray.forEach((denomination, index) => {
        const jitter = chipSettleJitter(denomination, index);
        const landing = ringPoint(slot, seatCount, 0.92, FELT.y, this.radiusZ);
        const target: Vec3 = {
          x: landing.x + jitter.x * 6 + ((index % 5) - 2) * 0.16,
          y: FELT.y + CHIP_THICKNESS / 2,
          z: landing.z + jitter.z * 6,
        };
        const start: Vec3 = {
          x: pot.x + jitter.x * 2,
          y: FELT.y + CHIP_THICKNESS / 2 + (index % MAX_CHIPS_PER_COLUMN) * CHIP_THICKNESS,
          z: pot.z + jitter.z * 2,
        };
        this.moving.push({
          chip: { denomination, position: { ...start }, airborne: true },
          base: { ...start },
          target,
          originalDistance: distance(start, target),
          delayMs: index * FUNNEL_CHIP_STAGGER_MS,
          keepOnArrival: false,
        });
      });
    }
    this.onChanged();
  }

  /** Clear everything in flight, e.g. when a new hand starts. */
  clearFlights(): void {
    for (let index = this.moving.length - 1; index >= 0; index -= 1) {
      if (this.moving[index].keepOnArrival) continue;
      this.moving.splice(index, 1);
    }
  }

  /**
   * Advance every chip by one frame. Returns whether anything moved, which
   * is what keeps the render loop awake.
   *
   * `reducedMotion` snaps rather than slides. A player who has asked their
   * system for less movement should still see where the pot went — removing
   * the chips entirely would remove information, not motion.
   */
  update(deltaMs: number, reducedMotion: boolean): boolean {
    if (this.moving.length === 0) return false;
    let moved = false;

    for (let index = this.moving.length - 1; index >= 0; index -= 1) {
      const entry = this.moving[index];
      if (entry.delayMs > 0) {
        entry.delayMs -= deltaMs;
        // A chip waiting its turn is still "motion": the scheduler must not
        // sleep between a spray being requested and its last chip leaving.
        moved = true;
        if (entry.delayMs > 0) continue;
      }

      let arrived: boolean;
      if (reducedMotion) {
        entry.base = { ...entry.target };
        entry.chip.position = { ...entry.target };
        arrived = true;
      } else if (entry.glide) {
        // The clocked glide: elapsed time in, eased position out. No arc —
        // a neat slide stays on the cloth — and it parks exactly on target
        // at the duration, so the loop always gets to sleep.
        entry.glide.elapsedMs += deltaMs;
        const step = stepGlideChip(
          entry.glide.from, entry.target, entry.glide.elapsedMs, entry.glide.durationMs,
        );
        entry.base = { ...step.position };
        entry.chip.position = step.position;
        arrived = step.arrived;
        moved = true;
      } else {
        const step = stepChip(
          entry.base, entry.target, entry.originalDistance, deltaMs, undefined, entry.arcPeak,
        );
        entry.base = step.base;
        entry.chip.position = step.position;
        arrived = step.arrived;
        moved = true;
      }

      if (arrived) {
        // A kept chip (pile or standing bet) is now resting: it must stop
        // casting the flying shadow the moment it parks, or a settled stack
        // reads as chips hovering over their own shadow pools.
        entry.chip.airborne = false;
        this.moving.splice(index, 1);
      }
    }
    return moved;
  }

  /**
   * Everything the painter should draw this frame, in no particular order —
   * the painter depth-sorts, because painting order is its concern and world
   * position is this module's.
   */
  drawList(): SceneChip[] {
    // A pile or standing-bet chip that is still dropping in is in two
    // collections under the same identity; listing it once from its keyed
    // map is what stops it being painted twice.
    return [
      ...this.pile.values(),
      ...this.bets.values(),
      ...this.moving.filter((entry) => !entry.keepOnArrival).map((entry) => entry.chip),
    ];
  }

  /**
   * Every in-flight chip's world position, for the e2e check that the pot
   * lands on the player it was paid to. Exposed through
   * `window.__stackchipsScene` by `table-scene.tsx`.
   */
  debugChipPositions(): Vec3[] {
    return this.moving.map((entry) => ({ ...entry.chip.position }));
  }

  /** Chips currently resting in the pot pile, for the same test seam. */
  debugPileSize(): number {
    return this.pile.size;
  }

  /** Chips standing in front of bettors, for the same test seam. */
  debugBetChips(): number {
    return this.bets.size;
  }
}
