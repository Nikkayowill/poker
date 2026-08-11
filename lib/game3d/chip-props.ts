/**
 * Where each player's own chips sit, and which pile they get.
 *
 * WHAT THIS ADDS. The room already draws the chips the ENGINE knows about —
 * standing street bets on each bet spot and the centre pot (chips/chip-field
 * .tsx). What it has never drawn is the thing that actually makes a card
 * room look occupied: every player's own bankroll, parked at the rail in
 * front of them, between hands as much as during one. A real table is mostly
 * chips that are nobody's bet yet.
 *
 * These are modelled props (public/props/*.glb), not the procedural cylinder
 * chip-stack.tsx builds, and the two are deliberately allowed to coexist: a
 * bet is a live, per-denomination quantity the engine owns and must be able
 * to fly, so it stays procedural; a bankroll is scenery whose job is to read
 * as a heap of real clay from two metres away.
 *
 * THE PROPS ARE AT TRUE SCALE, AND THAT IS CHECKED RATHER THAN HOPED FOR.
 * The .glb chips measure 39.5 x 3.3 mm, against the 39 x 3.3 mm real chip
 * dimensions.ts already states — within 1.3%. So they mount at
 * UNITS_PER_METRE like any other physical prop and land the same size as the
 * procedural chips already on the felt. If a future asset batch disagrees,
 * that is the number to check first: measure the .glb, do not scale by eye
 * against a render.
 *
 * FOUR PILES, PICKED BY HOW THE SEAT IS DOING. The tier is a ratio against
 * the TABLE's average stack, never an absolute chip count — buy-ins run from
 * the 1k tier to the 500k tier, so any absolute threshold would put every
 * seat at high stakes on the biggest pile and every seat at low stakes on the
 * smallest. As a ratio it also carries real information: you can see who is
 * winning from across the table, the way you can in a card room.
 *
 * Pure arithmetic with no three.js import, so `npm test` reaches it —
 * vitest.config.ts collects only lib/ and app/, which is why the placement
 * maths lives here and not in the component that mounts it.
 */

import { UNITS_PER_METRE } from "./dimensions";
import type { StakesTier } from "../game/tiers";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  seatAngle,
  type Vec3,
} from "./seat-layout";

/**
 * Diameter of one modelled chip, in metres, read off a single `chip_body`
 * node's own bounds in the .glb — NOT off a stack's bounding box, which
 * includes whatever else the artist laid beside the column.
 *
 * This is the number that licenses mounting these props at UNITS_PER_METRE
 * with no fudge factor: 39.5 mm against the 39 mm real chip dimensions.ts
 * already states, a 1.3% disagreement nobody can see. A future asset batch
 * that disagrees by more than a few percent is authored to some other unit,
 * and the fix is to re-measure it here rather than to scale by eye against a
 * render.
 */
export const MODELLED_CHIP_DIAMETER_M = 0.0395;

export type ChipPropTier = "short" | "stack" | "mid" | "deep";

export interface ChipPropSpec {
  tier: ChipPropTier;
  url: string;
  /**
   * Bounding size in METRES, read off the .glb's own accessor bounds with
   * every node transform applied — not eyeballed, and not the exporter's
   * unit assumption. Used to prove clearance in chip-props.test.ts, so it
   * has to stay in step with the file: re-measure if an asset is replaced.
   */
  size: { x: number; y: number; z: number };
}

/**
 * Ascending by how much money the heap represents, which is also ascending
 * by height: 6 chips, 36, 45, 188.
 *
 * poker-chips-table.glb is deliberately NOT here. Its six `seat_N` groups
 * are byte-identical copies of poker-chips-player-set.glb on a small
 * hexagon — no extra art — and its baked ring is a circle at a scale that
 * has nothing to do with this room's seat ellipse. Placing the single set at
 * our own seat positions is strictly better and 455KB cheaper.
 */
export const CHIP_PROPS: Record<ChipPropTier, ChipPropSpec> = {
  short: {
    tier: "short",
    url: "/props/poker-chips-short.glb",
    size: { x: 0.0994, y: 0.021, z: 0.0723 },
  },
  stack: {
    tier: "stack",
    url: "/props/poker-chips-player-set.glb",
    size: { x: 0.1852, y: 0.0411, z: 0.0565 },
  },
  mid: {
    tier: "mid",
    url: "/props/poker-chips-mid.glb",
    size: { x: 0.1433, y: 0.0611, z: 0.0672 },
  },
  deep: {
    tier: "deep",
    url: "/props/poker-chips-all-in.glb",
    size: { x: 0.2444, y: 0.1279, z: 0.1297 },
  },
};

/** Every tier, smallest heap first. */
export const CHIP_PROP_TIERS: readonly ChipPropTier[] = [
  "short",
  "stack",
  "mid",
  "deep",
] as const;

/**
 * TWO FACTORS, NOT ONE. An earlier cut picked the pile purely as a ratio to
 * the table's own live average stack — which reads identically at a 1k
 * table and a 500k table for the same relative standing, and that is
 * exactly the bug: a table's stakes rung is real information (a 500k table
 * is objectively a bigger game than a 1k one) and a pure ratio throws it
 * away. The opposite mistake — sizing purely off the table's stakes rung,
 * with no per-seat variation — is just as wrong the other way: every table
 * in this app has ONE fixed buy-in for every seat (`TIER_CONFIG`'s
 * `minBuyIn === maxBuyIn`), so realistic play at a single table's own
 * stakes compresses into one pile size and "who's winning" — the whole
 * other reason this exists — disappears.
 *
 * So: a BASELINE pile from the table's stakes rung (`STAKES_BASELINE_TIER`),
 * then a per-seat NUDGE of at most one tier, from that seat's own stack as a
 * ratio to ITS OWN table's buy-in (never the live table average, and never
 * a player's total Gold balance — a whale can sit at a 1k table and only
 * ever has 1k in play there). A 1k table can never look "deep" no matter
 * who's winning it, a 500k table can never look "short" no matter who's
 * losing it, and within any single table a double-up or a bust-down still
 * visibly moves the pile.
 */
export const STAKES_BASELINE_TIER: Record<StakesTier, ChipPropTier> = {
  "1k": "short",
  "5k": "short",
  "10k": "stack",
  "25k": "stack",
  "50k": "mid",
  "100k": "mid",
  "250k": "deep",
  "500k": "deep",
};

/**
 * Ratio-to-buy-in thresholds that move a seat off its table's baseline
 * pile. Wide on purpose, same reasoning the old ratio-to-average bands
 * gave: the stack these read is live, so a narrow band would swap the
 * model back and forth mid-hand for no information. A seat has to roughly
 * halve or roughly double its own buy-in to move.
 */
export const SEAT_NUDGE_RATIO = {
  /** Below this multiple of the table's buy-in, nudge one tier down. */
  down: 0.5,
  /** Above this multiple, nudge one tier up. */
  up: 2,
} as const;

/**
 * Which pile a seat gets. `null` means draw nothing — a busted or empty seat
 * has no chips in front of it, and a heap there would be a lie the HUD's own
 * "0" contradicts.
 *
 * `buyIn` is the table's own fixed buy-in for `stakesTier`
 * (`TIER_CONFIG[stakesTier].minBuyIn`) — the caller passes it rather than
 * this function reaching into `lib/game/tiers` itself, so a snapshot fixture
 * can hand it a number without also having to fabricate a config lookup.
 */
export function tierForSeat(
  stack: number,
  buyIn: number,
  stakesTier: StakesTier,
): ChipPropTier | null {
  if (!Number.isFinite(stack) || stack <= 0) return null;
  const baseline = STAKES_BASELINE_TIER[stakesTier];
  const baselineIndex = CHIP_PROP_TIERS.indexOf(baseline);
  const ratio = Number.isFinite(buyIn) && buyIn > 0 ? stack / buyIn : 1;
  const nudge = ratio < SEAT_NUDGE_RATIO.down ? -1 : ratio > SEAT_NUDGE_RATIO.up ? 1 : 0;
  const index = Math.min(
    CHIP_PROP_TIERS.length - 1,
    Math.max(0, baselineIndex + nudge),
  );
  return CHIP_PROP_TIERS[index];
}

/**
 * The local player's own pile gets a floor of "short" → "stack", never
 * shorter. Measured on a render, not assumed: at slot 0's near-camera
 * position a "short" pile (6 chips) sits close enough to the centre pot's
 * own chip clutter that it visually disappears into it — the player's own
 * stack is the one pile on this felt they have to be able to find at a
 * glance, unlike an opponent's, whose exact size is not information they
 * need to read out of the 3D scene. Every seat above "short" is already
 * tall enough to read clearly and passes through unchanged; only the
 * bottom rung gets lifted, and only for slot 0 — see seat-bankrolls.tsx's
 * one caller.
 */
export function nearSeatTier(tier: ChipPropTier | null): ChipPropTier | null {
  if (tier === "short") return "stack";
  return tier;
}

/**
 * How far out the bankroll sits, as a fraction of the felt radii — outside
 * the hole cards (0.78), toward the rail, which is where a player's chips
 * physically are. The order from the rail inward is bankroll, cards, bet,
 * board, and it matches a real table read from any chair.
 *
 * Re-solved from 0.84 when the felt took its true 2.13 x 1.07 proportions.
 * The props are real chips at a real size, so a plate that lost 18% of its
 * depth did not lose any of THEM: the deep tier's far corner measured 1.02
 * of the felt ellipse — chips over the rail, the same failure the angle
 * offset below was originally introduced to fix, arriving by a different
 * route. 0.82 is the outermost inset at which no tier's corner leaves the
 * cloth (worst load 0.981).
 */
const BANKROLL_INSET = 0.82;

/**
 * Slot 0 gets its own, deeper inset for the same reason every other
 * near-seat constant in this room does: the local player's figure stands
 * between the camera and their own edge of the felt, so a prop at the
 * ordinary inset is behind their own body. Pulled onto the cloth it becomes
 * the one stack the player can always see — theirs.
 */
const NEAR_SEAT_BANKROLL_INSET = 0.74;

/**
 * Offset toward the player's right, AS AN ANGLE AROUND THE SEAT RING rather
 * than a straight slide along the tangent — and the difference is the whole
 * reason this constant is in radians.
 *
 * A straight sideways offset was the first cut and it walked two piles off
 * the cloth. The felt is 2.15 x 1.08, so it is nothing like circular: at the
 * diagonal seats (slots 2 and 5) a tangent that is correct at the seat's own
 * angle points outward relative to the ellipse, and the deepest pile's far
 * corner measured 1.07 of the felt's own radius — chips floating over the
 * rail. Rotating around the ring instead keeps every pile on an ellipse
 * CONCENTRIC with the felt, which cannot leave it for any offset at all;
 * only the pile's own footprint can, and that is what the inset covers.
 *
 * 0.50 rad is 28.6 degrees — about half the way to the next chair, which is
 * where a player's chips sit relative to their cards. Solved, not picked:
 * it is the smallest offset at which no tier overlaps its own hole cards,
 * its own bet spot, or a neighbour's pile, at any of the six seats.
 *
 * Re-solved from 0.36 when the felt took its true proportions. A rotation
 * around the ring converts to less ARC at the sides of a narrower ellipse,
 * so the offset that cleared a seat's own bet spot on a 1.32-deep plate no
 * longer did on a 1.08-deep one — slots 1 and 4 landed their piles on the
 * spot their own chips fly to. The scan that picked this walked inset
 * 0.78-0.86 against offset 0.44-0.68 over all six seats and all four tiers.
 */
const BANKROLL_ANGLE_OFFSET = 0.5;

function bankrollInset(slot: number): number {
  return slot === 0 ? NEAR_SEAT_BANKROLL_INSET : BANKROLL_INSET;
}

/** The seat's own ring angle, rotated toward that player's right hand. */
export function bankrollAngle(slot: number): number {
  return seatAngle(slot) + BANKROLL_ANGLE_OFFSET;
}

/**
 * Unit vector pointing to the player's right as they face the table centre.
 *
 * Derived rather than tabulated: facing is (-sin, 0, -cos) and up is +Y, so
 * right = facing x up = (cos, 0, -sin). At slot 0 that is +X, which is the
 * local player's right on screen — the check worth keeping, because a
 * mirrored basis puts every stack on the wrong hand and still looks
 * plausible in isolation.
 */
export function seatRightVector(slot: number): Vec3 {
  const angle = seatAngle(slot);
  return { x: Math.cos(angle), y: 0, z: -Math.sin(angle) };
}

/** Where a slot's own bankroll rests on the felt. */
export function bankrollPosition(slot: number): Vec3 {
  const angle = bankrollAngle(slot);
  const inset = bankrollInset(slot);
  return {
    x: Math.sin(angle) * FELT_RADIUS_X * inset,
    y: FELT_TOP_Y,
    z: Math.cos(angle) * FELT_RADIUS_Z * inset,
  };
}

/**
 * Y rotation for the pile, so its long axis lies along the rail rather than
 * pointing at the board. Same convention faceCentreRotationY uses: a model
 * whose forward is +Z ends up facing the centre, which puts its local X — the
 * long axis of every one of these heaps — on the tangent.
 */
export function bankrollRotationY(slot: number): number {
  const position = bankrollPosition(slot);
  return Math.atan2(-position.x, -position.z);
}

/** Prop bounding size converted from the .glb's metres into world units. */
export function bankrollSizeUnits(tier: ChipPropTier): Vec3 {
  const { size } = CHIP_PROPS[tier];
  return {
    x: size.x * UNITS_PER_METRE,
    y: size.y * UNITS_PER_METRE,
    z: size.z * UNITS_PER_METRE,
  };
}

/**
 * The four corners of an axis-oriented rectangle lying on the felt, given its
 * centre and the ring angle its long axis follows.
 *
 * Everything on this cloth — a pile, a fanned pair of cards, a bet spot — is
 * a rectangle turned to face the middle, so one helper describes all of them
 * and the collision checks below can be honest about geometry instead of
 * comparing one distance and hoping.
 */
export function feltFootprint(
  centre: Vec3,
  angle: number,
  halfWidth: number,
  halfDepth: number,
): Vec3[] {
  // Long axis along the rail; short axis radial.
  const ax = Math.cos(angle);
  const az = -Math.sin(angle);
  const bx = -az;
  const bz = ax;
  const corners: Vec3[] = [];
  for (const sw of [-1, 1]) {
    for (const sd of [-1, 1]) {
      corners.push({
        x: centre.x + ax * halfWidth * sw + bx * halfDepth * sd,
        y: FELT_TOP_Y,
        z: centre.z + az * halfWidth * sw + bz * halfDepth * sd,
      });
    }
  }
  return corners;
}

/** The footprint a slot's bankroll actually occupies on the cloth. */
export function bankrollFootprint(slot: number, tier: ChipPropTier): Vec3[] {
  const size = bankrollSizeUnits(tier);
  return feltFootprint(
    bankrollPosition(slot),
    bankrollAngle(slot),
    size.x / 2,
    size.z / 2,
  );
}

/**
 * Separating-axis overlap test for two footprints on the felt.
 *
 * A plain centre-distance check is not good enough here and getting that
 * wrong is how the first placement passed its own test while putting a pile
 * through a pair of cards: these rectangles are long, thin, and turned to
 * different angles, so two that are comfortably apart centre-to-centre can
 * still intersect at a corner.
 */
export function footprintsOverlap(a: Vec3[], b: Vec3[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i];
      const q = polygon[(i + 1) % polygon.length];
      let nx = -(q.z - p.z);
      let nz = q.x - p.x;
      const length = Math.hypot(nx, nz);
      if (length < 1e-9) continue;
      nx /= length;
      nz /= length;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const v of a) {
        const d = v.x * nx + v.z * nz;
        aMin = Math.min(aMin, d);
        aMax = Math.max(aMax, d);
      }
      for (const v of b) {
        const d = v.x * nx + v.z * nz;
        bMin = Math.min(bMin, d);
        bMax = Math.max(bMax, d);
      }
      if (aMax < bMin - 1e-9 || bMax < aMin - 1e-9) return false;
    }
  }
  return true;
}
