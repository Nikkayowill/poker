import * as THREE from "three";
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
} from "@/lib/scene/chip-physics";
import { MAX_CHIPS_PER_COLUMN, potChipStacks } from "@/lib/game/pot-chips";
import { FELT, type Vec3 } from "@/lib/scene/scene-config";
import { POT_POSITION, ringPoint, seatBetOrigin, seatPlacement } from "@/lib/scene/seat-ring";
import { chipMaterials, type ChipMaterials } from "./chip-texture";

/**
 * Every chip on the felt: the pot as a physical pile, the spray a bet pushes
 * in, and the pot going back out to whoever won it.
 *
 * This replaces the CSS chip system wholesale -- `.pot-pile-chip`,
 * `.pot-chip-flight` and `.seat-chip-flight`, their four background-image
 * layers and their three keyframe animations. What carries over is every
 * decision that was about poker rather than about CSS: the pot is still
 * broken into denominations by `potChipStacks` in big blinds (so a pile means
 * the same thing at every tier), columns are still capped at
 * MAX_CHIPS_PER_COLUMN, the settle jitter is still seeded from a chip's own
 * identity rather than `Math.random()`, and the two sprays keep their counts
 * and staggers.
 *
 * What changes is that a chip is now a solid object with an edge. The old one
 * was a disc that could only ever be seen face-on, which is why it needed
 * four stacked gradients to suggest a rim it did not have.
 */

/** The token, per the spec: a low-poly cylinder, 0.4 across and 0.08 thick. */
const CHIP_RADIUS = 0.4;
const CHIP_THICKNESS = 0.08;
const CHIP_SEGMENTS = 32;

/** How far apart the pile's denomination columns stand. */
const COLUMN_SPACING = 0.98;

/** How high a newly added pile chip drops in from. */
const PILE_DROP = 1.1;

/**
 * Spin, in radians per unit travelled.
 *
 * Chips are pushed across cloth, not thrown, so this is small on purpose --
 * enough that the edge banding turns as a chip crosses the felt and the eye
 * reads it as a solid object, not enough to look like a coin toss.
 */
const SPIN_PER_UNIT = 0.9;

interface MovingChip {
  mesh: THREE.Mesh;
  target: Vec3;
  originalDistance: number;
  /** Counts down before the chip starts moving, which is what staggers a spray. */
  delayMs: number;
  spin: number;
  /** Pile chips stay when they land; spray chips are recycled. */
  keepOnArrival: boolean;
  arrived: boolean;
}

export class ChipLayer {
  private readonly geometry: THREE.CylinderGeometry;
  private readonly materials = new Map<number, ChipMaterials>();
  private readonly moving: MovingChip[] = [];
  /** Pile chips by their identity in the breakdown, so a settled one is reused. */
  private readonly pile = new Map<string, THREE.Mesh>();
  /** Recycled meshes, so a busy table stops allocating after its first hand. */
  private readonly free: THREE.Mesh[] = [];
  private paying = false;

  constructor(
    private readonly group: THREE.Group,
    private readonly onChanged: () => void,
  ) {
    this.geometry = new THREE.CylinderGeometry(
      CHIP_RADIUS,
      CHIP_RADIUS,
      CHIP_THICKNESS,
      CHIP_SEGMENTS,
    );
  }

  private materialsFor(denomination: number): ChipMaterials {
    let existing = this.materials.get(denomination);
    if (!existing) {
      existing = chipMaterials(denomination);
      this.materials.set(denomination, existing);
    }
    return existing;
  }

  /** A mesh from the pool, or a new one if the pool is empty. */
  private take(denomination: number): THREE.Mesh {
    const mesh = this.free.pop() ?? new THREE.Mesh(this.geometry);
    mesh.material = this.materialsFor(denomination).materials;
    mesh.visible = true;
    mesh.rotation.set(0, 0, 0);
    this.group.add(mesh);
    return mesh;
  }

  private release(mesh: THREE.Mesh): void {
    this.group.remove(mesh);
    mesh.visible = false;
    this.free.push(mesh);
  }

  /**
   * The pot, as chips.
   *
   * Keyed by denomination and position in the column, exactly as the DOM pile
   * was keyed: raising a pot from three chips to four has to *add one chip*,
   * not rebuild the stack, or every chip already on the felt replays its
   * landing every time anybody bets.
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
        const mesh = this.take(stack.denomination);
        mesh.position.set(rest.x, rest.y + PILE_DROP, rest.z);
        // A stack of identical discs looks machined. A few degrees of turn
        // per chip is what makes it look pushed together by hand.
        mesh.rotation.y = ((stack.denomination * 7 + index * 29) % 360) * (Math.PI / 180);
        this.pile.set(key, mesh);
        this.moving.push({
          mesh,
          target: rest,
          originalDistance: PILE_DROP,
          delayMs: index * 18,
          spin: 0,
          keepOnArrival: true,
          arrived: false,
        });
        this.onChanged();
      }
    });

    for (const [key, mesh] of this.pile) {
      if (wanted.has(key)) continue;
      // Drop it from the moving list too, or a chip that was still settling
      // would be animated after being recycled.
      const index = this.moving.findIndex((chip) => chip.mesh === mesh);
      if (index >= 0) this.moving.splice(index, 1);
      this.release(mesh);
      this.pile.delete(key);
      this.onChanged();
    }
  }

  /**
   * A bet: the amount actually committed, as chips, pushed from a seat's
   * edge of the felt to the pot 20ms apart -- smallest denominations first,
   * so the big chips land on top where they read.
   *
   * The spray *is* the number now: `betSprayDenominations` breaks the bet
   * down exactly as the pile it joins is broken down, so a 1BB call is one
   * white chip and a shove is a heavy spray topped with hundreds. The old
   * fixed three-chip decorative spray survives only as the fallback for a
   * malformed amount, where showing something is better than a silent bet.
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
      const mesh = this.take(denomination);
      mesh.position.set(start.x, start.y, start.z);
      this.moving.push({
        mesh,
        target,
        originalDistance: distance(start, target),
        delayMs: index * BET_CHIP_STAGGER_MS,
        spin: SPIN_PER_UNIT,
        keepOnArrival: false,
        arrived: false,
      });
    });
    this.onChanged();
  }

  /**
   * The pot going home: each winner's actual payout as chips, 34ms apart,
   * landing on the winner's own edge of the felt rather than on the seat
   * itself -- chips are pushed to a player, not thrown at them.
   *
   * `funnelSprayDenominations` breaks each winner's own amount down, so a
   * split pot pays each share as the money it is rather than an
   * equal-looking dozen each, and the chips leaving the middle are
   * denominated as the pile that just vacated it. Capped at
   * FUNNEL_CHIP_COUNT per winner because the celebration budget is solved
   * from that worst case. The old fixed twelve-chip decorative spray is the
   * fallback for a malformed amount only.
   */
  spawnFunnel(winners: Array<{ slot: number; amount: number }>, seatCount: number, bigBlind: number): void {
    for (const { slot, amount } of winners) {
      const seat = seatPlacement(slot, seatCount);
      const denominations = funnelSprayDenominations(amount, bigBlind);
      const spray = denominations.length > 0
        ? denominations
        : Array.from({ length: FUNNEL_CHIP_COUNT }, (_, index) => decorativeDenomination(index));
      spray.forEach((denomination, index) => {
        const jitter = chipSettleJitter(denomination, index);
        /**
         * Land in front of the winner, at the rail -- not on the felt near
         * them.
         *
         * This aims at the seat ring rather than at an inset of the felt, and
         * the distinction is the whole readability of a payout. Landing at
         * 0.68 of the felt's radius (which is what this did first) leaves the
         * chips nearer the middle of the table than the player: measured at
         * 1440x900, a side seat's payout closed only a fifth of the distance
         * to that seat's own plate, and on screen it read as the pot moving
         * vaguely leftward rather than as anyone being paid.
         *
         * 0.92 of the seat ring puts them just inside the rail, which is
         * where a dealer actually pushes a pot -- and where the DOM funnel
         * this replaced aimed, since it measured `.seat-stack` directly.
         */
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
        const mesh = this.take(denomination);
        mesh.position.set(start.x, start.y, start.z);
        mesh.rotation.y = seat.facing;
        this.moving.push({
          mesh,
          target,
          originalDistance: distance(start, target),
          delayMs: index * FUNNEL_CHIP_STAGGER_MS,
          spin: SPIN_PER_UNIT,
          keepOnArrival: false,
          arrived: false,
        });
      });
    }
    this.onChanged();
  }

  /** Clear everything in flight, e.g. when a new hand starts. */
  clearFlights(): void {
    for (let index = this.moving.length - 1; index >= 0; index -= 1) {
      const chip = this.moving[index];
      if (chip.keepOnArrival) continue;
      this.release(chip.mesh);
      this.moving.splice(index, 1);
    }
  }

  /**
   * Advance every chip by one frame. Returns whether anything moved, which is
   * what keeps the render loop awake.
   *
   * `reducedMotion` snaps rather than slides. A player who has asked their
   * system for less movement should still see where the pot went -- removing
   * the chips entirely would remove information, not motion.
   */
  update(deltaMs: number, reducedMotion: boolean): boolean {
    if (this.moving.length === 0) return false;
    let moved = false;

    for (let index = this.moving.length - 1; index >= 0; index -= 1) {
      const chip = this.moving[index];
      if (chip.delayMs > 0) {
        chip.delayMs -= deltaMs;
        // A chip waiting its turn is still "motion": the scheduler must not
        // sleep between a spray being requested and its last chip leaving.
        moved = true;
        if (chip.delayMs > 0) continue;
      }

      if (reducedMotion) {
        chip.mesh.position.set(chip.target.x, chip.target.y, chip.target.z);
        chip.arrived = true;
      } else {
        const current = {
          x: chip.mesh.position.x,
          y: chip.mesh.position.y,
          z: chip.mesh.position.z,
        };
        const step = stepChip(current, chip.target, chip.originalDistance, deltaMs);
        chip.mesh.position.set(step.position.x, step.position.y, step.position.z);
        chip.mesh.rotation.y += chip.spin * distance(current, step.base);
        chip.arrived = step.arrived;
        moved = true;
      }

      if (chip.arrived) {
        if (!chip.keepOnArrival) this.release(chip.mesh);
        this.moving.splice(index, 1);
      }
    }
    return moved;
  }

  dispose(): void {
    for (const chip of this.moving) this.group.remove(chip.mesh);
    for (const mesh of this.pile.values()) this.group.remove(mesh);
    for (const mesh of this.free) this.group.remove(mesh);
    this.moving.length = 0;
    this.pile.clear();
    this.free.length = 0;
    this.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  /**
   * Every chip's world position, for the e2e check that the pot lands on the
   * player it was paid to.
   *
   * The DOM chips this replaced could be measured with
   * `getBoundingClientRect`; a mesh cannot, so the assertion needs a seam or
   * it silently stops asserting anything. Exposed through
   * `window.__stackchipsScene` by `table-scene.tsx` -- see the note there
   * about why that is safe to ship.
   */
  debugChipPositions(): Array<{ x: number; y: number; z: number }> {
    const positions: Array<{ x: number; y: number; z: number }> = [];
    for (const chip of this.moving) {
      positions.push({ x: chip.mesh.position.x, y: chip.mesh.position.y, z: chip.mesh.position.z });
    }
    return positions;
  }

  /** Chips currently resting in the pot pile, for the same test seam. */
  debugPileSize(): number {
    return this.pile.size;
  }
}
