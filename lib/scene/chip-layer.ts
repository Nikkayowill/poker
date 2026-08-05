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
} from "./chip-physics";
import { MAX_CHIPS_PER_COLUMN, potChipStacks } from "@/lib/game/pot-chips";
import { FELT, type Vec3 } from "./scene-config";
import { POT_POSITION, ringPoint, seatBetOrigin } from "./seat-ring";

/** The token: a 39mm chip against a 2.1m table, near enough exactly right. */
export const CHIP_RADIUS = 0.4;
export const CHIP_THICKNESS = 0.08;

/** How far apart the pile's denomination columns stand. */
const COLUMN_SPACING = 0.98;

/** How high a newly added pile chip drops in from. */
const PILE_DROP = 1.1;

export interface SceneChip {
  denomination: number;
  /** The chip's centre, in world units. */
  position: Vec3;
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
}

export class ChipLayer {
  private readonly moving: MovingChip[] = [];
  /** Pile chips by their identity in the breakdown, so a settled one is reused. */
  private readonly pile = new Map<string, SceneChip>();
  private paying = false;

  constructor(private readonly onChanged: () => void) {}

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
    stacks.forEach((stack, column) => {
      for (let index = 0; index < stack.count; index += 1) {
        const key = `${stack.denomination}:${index}`;
        wanted.add(key);
        if (this.pile.has(key)) continue;

        const jitter = chipSettleJitter(stack.denomination, index);
        const rest: Vec3 = {
          x: (column - spread) * COLUMN_SPACING + jitter.x,
          y: FELT.y + CHIP_THICKNESS / 2 + index * CHIP_THICKNESS,
          z: jitter.z,
        };
        const chip: SceneChip = {
          denomination: stack.denomination,
          position: { x: rest.x, y: rest.y + PILE_DROP, z: rest.z },
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
   * A bet: the amount actually committed, as chips, pushed from a seat's
   * edge of the felt to the pot 20ms apart — smallest denominations first,
   * so the big chips land on top where they read. The old fixed three-chip
   * decorative spray survives only as the fallback for a malformed amount,
   * where showing something is better than a silent bet.
   */
  spawnBet(slot: number, seatCount: number, amount: number, bigBlind: number): void {
    const origin = seatBetOrigin(slot, seatCount);
    const denominations = betSprayDenominations(amount, bigBlind);
    const spray = denominations.length > 0
      ? denominations
      : Array.from({ length: BET_CHIP_COUNT }, (_, index) => decorativeDenomination(index));
    spray.forEach((denomination, index) => {
      const jitter = chipSettleJitter(denomination, index);
      const target: Vec3 = {
        x: POT_POSITION.x + jitter.x * 4,
        y: FELT.y + CHIP_THICKNESS / 2,
        z: POT_POSITION.z + jitter.z * 4,
      };
      const start: Vec3 = {
        x: origin.x,
        y: FELT.y + CHIP_THICKNESS / 2 + index * CHIP_THICKNESS,
        z: origin.z,
      };
      this.moving.push({
        chip: { denomination, position: { ...start } },
        base: { ...start },
        target,
        originalDistance: distance(start, target),
        delayMs: index * BET_CHIP_STAGGER_MS,
        keepOnArrival: false,
      });
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
    for (const { slot, amount } of winners) {
      const denominations = funnelSprayDenominations(amount, bigBlind);
      const spray = denominations.length > 0
        ? denominations
        : Array.from({ length: FUNNEL_CHIP_COUNT }, (_, index) => decorativeDenomination(index));
      spray.forEach((denomination, index) => {
        const jitter = chipSettleJitter(denomination, index);
        const landing = ringPoint(slot, seatCount, 0.92, FELT.y);
        const target: Vec3 = {
          x: landing.x + jitter.x * 6 + ((index % 5) - 2) * 0.16,
          y: FELT.y + CHIP_THICKNESS / 2,
          z: landing.z + jitter.z * 6,
        };
        const start: Vec3 = {
          x: POT_POSITION.x + jitter.x * 2,
          y: FELT.y + CHIP_THICKNESS / 2 + (index % MAX_CHIPS_PER_COLUMN) * CHIP_THICKNESS,
          z: POT_POSITION.z + jitter.z * 2,
        };
        this.moving.push({
          chip: { denomination, position: { ...start } },
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
      } else {
        const step = stepChip(entry.base, entry.target, entry.originalDistance, deltaMs);
        entry.base = step.base;
        entry.chip.position = step.position;
        arrived = step.arrived;
        moved = true;
      }

      if (arrived) this.moving.splice(index, 1);
    }
    return moved;
  }

  /**
   * Everything the painter should draw this frame, in no particular order —
   * the painter depth-sorts, because painting order is its concern and world
   * position is this module's.
   */
  drawList(): SceneChip[] {
    // A pile chip that is still dropping in is in both collections under the
    // same identity; listing it once from the pile is what stops it being
    // painted twice.
    return [
      ...this.pile.values(),
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
}
