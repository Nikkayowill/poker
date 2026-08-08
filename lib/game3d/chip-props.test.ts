import { describe, expect, it } from "vitest";
import {
  CHIP_PROPS,
  CHIP_PROP_TIERS,
  MODELLED_CHIP_DIAMETER_M,
  STAKES_BASELINE_TIER,
  bankrollAngle,
  bankrollFootprint,
  bankrollPosition,
  bankrollRotationY,
  bankrollSizeUnits,
  feltFootprint,
  footprintsOverlap,
  nearSeatTier,
  seatRightVector,
  tierForSeat,
  type ChipPropTier,
} from "./chip-props";
import { CARD, CHIP, UNITS_PER_METRE } from "./dimensions";
import { STAKES_TIERS, TIER_CONFIG } from "../game/tiers";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  SEAT_COUNT_3D,
  betSpotPosition,
  holeCardPosition,
  seatAngle,
} from "./seat-layout";

const SLOTS = Array.from({ length: SEAT_COUNT_3D }, (_, i) => i);

/**
 * The footprint a seat's fanned pair actually covers. Mirrors cards-3d.tsx:
 * HOLE_CARD_FAN is 0.52 of a card width, the near seat renders at 1.8x, and
 * the outermost point is that fan plus half a card. Treated as lying flat,
 * which is the conservative read — the near seat's pair is propped up, so its
 * real footprint is shorter than this.
 */
function holeCardFootprint(slot: number) {
  const scale = slot === 0 ? 1.8 : 1;
  const width = CARD.width * scale;
  return feltFootprint(
    holeCardPosition(slot),
    seatAngle(slot),
    width * 1.02,
    (CARD.height * scale) / 2,
  );
}

/** A generous square over a seat's standing bet, which the pile must clear. */
function betSpotFootprint(slot: number) {
  return feltFootprint(betSpotPosition(slot), seatAngle(slot), 0.16, 0.16);
}

/** Ellipse membership for the felt's top surface. */
function feltLoad(x: number, z: number): number {
  return (x * x) / (FELT_RADIUS_X * FELT_RADIUS_X) + (z * z) / (FELT_RADIUS_Z * FELT_RADIUS_Z);
}

describe("chip prop catalogue", () => {
  it("has one entry per tier, each pointing at a vendored file", () => {
    for (const tier of CHIP_PROP_TIERS) {
      const spec = CHIP_PROPS[tier];
      expect(spec.tier).toBe(tier);
      expect(spec.url).toMatch(/^\/props\/.+\.glb$/);
    }
  });

  it("orders the tiers by how much clay is on the felt", () => {
    // Height is the honest proxy: these are heaps, and a bigger bankroll is a
    // taller one. If a replacement asset breaks this, the tier ladder is
    // saying something the picture contradicts.
    const heights = CHIP_PROP_TIERS.map((tier) => CHIP_PROPS[tier].size.y);
    const ascending = [...heights].sort((a, b) => a - b);
    expect(heights).toEqual(ascending);
  });

  it("keeps the modelled chip within a few percent of the room's own chip", () => {
    // The whole reason these mount at UNITS_PER_METRE with no fudge factor.
    // Measured off a single chip node in the .glb, not off a stack's bounding
    // box: the short stack lays a flat chip beside its column, so that box is
    // 72mm across and says nothing about a chip. If a future asset batch
    // disagrees with this, it is the scale that is wrong, not this number.
    const modelledChipDiameterMm = MODELLED_CHIP_DIAMETER_M * 1000;
    const roomChipDiameterMm = (CHIP.radius * 2 * 1000) / UNITS_PER_METRE;
    expect(modelledChipDiameterMm / roomChipDiameterMm).toBeGreaterThan(0.95);
    expect(modelledChipDiameterMm / roomChipDiameterMm).toBeLessThan(1.05);
  });
});

describe("tierForSeat", () => {
  it("draws nothing for a busted or empty seat, at every stakes rung", () => {
    for (const tier of STAKES_TIERS) {
      const buyIn = TIER_CONFIG[tier].minBuyIn;
      expect(tierForSeat(0, buyIn, tier)).toBeNull();
      expect(tierForSeat(-50, buyIn, tier)).toBeNull();
      expect(tierForSeat(Number.NaN, buyIn, tier)).toBeNull();
    }
  });

  it("reads exactly the table's baseline tier when a seat holds its own buy-in", () => {
    // No winning or losing yet — every seat at its own buy-in should draw
    // the pile that stakes rung is supposed to look like, not "stack" for
    // everyone the way a ratio-to-average design would give.
    for (const tier of STAKES_TIERS) {
      const buyIn = TIER_CONFIG[tier].minBuyIn;
      expect(tierForSeat(buyIn, buyIn, tier)).toBe(STAKES_BASELINE_TIER[tier]);
    }
  });

  it("a 1k table never reads deep, and a 500k table never reads short", () => {
    // The whole point of anchoring to the stakes rung: no realistic swing at
    // the cheapest table should ever look like the priciest table's typical
    // pile, and vice versa.
    const buyIn1k = TIER_CONFIG["1k"].minBuyIn;
    for (let stack = buyIn1k * 0.01; stack <= buyIn1k * 50; stack *= 1.7) {
      expect(tierForSeat(stack, buyIn1k, "1k")).not.toBe("deep");
    }
    const buyIn500k = TIER_CONFIG["500k"].minBuyIn;
    for (let stack = buyIn500k * 0.01; stack <= buyIn500k * 50; stack *= 1.7) {
      expect(tierForSeat(stack, buyIn500k, "500k")).not.toBe("short");
    }
  });

  it("nudges up for a stack well above its own buy-in, down well below, clamped at the ladder's ends", () => {
    // "stack" is the baseline at 10k/25k, so both nudges land inside the
    // ladder and are visible; the busted-adjacent low end and the
    // topped-out high end are what prove the clamp rather than an
    // out-of-range tier.
    const buyIn = TIER_CONFIG["10k"].minBuyIn;
    expect(tierForSeat(buyIn * 3, buyIn, "10k")).toBe("mid");
    expect(tierForSeat(buyIn * 0.2, buyIn, "10k")).toBe("short");
    // "deep" is already the top of the ladder at 500k — a huge stack cannot
    // nudge past it.
    const deepBuyIn = TIER_CONFIG["500k"].minBuyIn;
    expect(tierForSeat(deepBuyIn * 3, deepBuyIn, "500k")).toBe("deep");
    // "short" is already the bottom at 1k — a near-busted stack cannot nudge
    // under it.
    const shortBuyIn = TIER_CONFIG["1k"].minBuyIn;
    expect(tierForSeat(shortBuyIn * 0.1, shortBuyIn, "1k")).toBe("short");
  });

  it("rises monotonically with the stack, for a fixed table", () => {
    const order = new Map<ChipPropTier, number>(
      CHIP_PROP_TIERS.map((tier, i) => [tier, i]),
    );
    const buyIn = TIER_CONFIG["25k"].minBuyIn;
    let previous = -1;
    for (let stack = 1; stack <= buyIn * 10; stack += buyIn / 50) {
      const tier = tierForSeat(stack, buyIn, "25k");
      expect(tier).not.toBeNull();
      const rank = order.get(tier as ChipPropTier) as number;
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it("falls back to the table's baseline rather than dividing by zero", () => {
    expect(tierForSeat(500, 0, "1k")).toBe(STAKES_BASELINE_TIER["1k"]);
    expect(tierForSeat(500, Number.NaN, "1k")).toBe(STAKES_BASELINE_TIER["1k"]);
  });
});

describe("nearSeatTier", () => {
  it("lifts short to stack, and leaves everything else untouched", () => {
    expect(nearSeatTier("short")).toBe("stack");
    expect(nearSeatTier("stack")).toBe("stack");
    expect(nearSeatTier("mid")).toBe("mid");
    expect(nearSeatTier("deep")).toBe("deep");
    expect(nearSeatTier(null)).toBeNull();
  });
});

describe("STAKES_BASELINE_TIER", () => {
  it("has one entry per stakes rung, ascending with the ladder", () => {
    const order = new Map<ChipPropTier, number>(
      CHIP_PROP_TIERS.map((tier, i) => [tier, i]),
    );
    let previous = -1;
    for (const stakesTier of STAKES_TIERS) {
      const rank = order.get(STAKES_BASELINE_TIER[stakesTier]) as number;
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });
});

describe("seatRightVector", () => {
  it("points to the local player's right on screen", () => {
    // Slot 0 sits at +Z facing -Z, so its right hand is +X. A mirrored basis
    // puts every stack on the wrong hand and still looks plausible alone.
    const right = seatRightVector(0);
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.z).toBeCloseTo(0, 6);
  });

  it("stays a unit vector, perpendicular to the seat's facing", () => {
    for (const slot of SLOTS) {
      const right = seatRightVector(slot);
      expect(Math.hypot(right.x, right.z)).toBeCloseTo(1, 6);
      // Facing is (-sin, -cos); a dot product of zero is the perpendicular.
      const angle = (slot / SEAT_COUNT_3D) * Math.PI * 2;
      const dot = right.x * -Math.sin(angle) + right.z * -Math.cos(angle);
      expect(dot).toBeCloseTo(0, 6);
    }
  });
});

describe("bankroll placement", () => {
  it("rests on the felt surface, never in it", () => {
    for (const slot of SLOTS) {
      expect(bankrollPosition(slot).y).toBe(FELT_TOP_Y);
    }
  });

  it("sits outside its own hole cards, toward the rail", () => {
    // The order from the rail inward is bankroll, cards, bet, board. A pile
    // that drifts inside the cards is sitting where the player has to reach
    // over it.
    for (const slot of SLOTS) {
      const bankroll = bankrollPosition(slot);
      const cards = holeCardPosition(slot);
      const bankrollRadius = Math.hypot(bankroll.x / FELT_RADIUS_X, bankroll.z / FELT_RADIUS_Z);
      const cardRadius = Math.hypot(cards.x / FELT_RADIUS_X, cards.z / FELT_RADIUS_Z);
      expect(bankrollRadius).toBeGreaterThan(cardRadius);
    }
  });

  it("never crosses its own player's hole cards", () => {
    // Full rectangle-against-rectangle, not a centre distance: these shapes
    // are long, thin and turned to different angles, so two that are well
    // apart centre-to-centre can still meet at a corner.
    for (const slot of SLOTS) {
      for (const tier of CHIP_PROP_TIERS) {
        const hit = footprintsOverlap(
          bankrollFootprint(slot, tier),
          holeCardFootprint(slot),
        );
        expect(`slot ${slot} ${tier}: ${hit ? "overlaps cards" : "clear"}`).toBe(
          `slot ${slot} ${tier}: clear`,
        );
      }
    }
  });

  it("leaves its own bet spot free", () => {
    // A bankroll sitting on the bet spot would be hit by every chip the seat
    // pushes out, and the flight would land inside a solid heap.
    for (const slot of SLOTS) {
      for (const tier of CHIP_PROP_TIERS) {
        expect(
          footprintsOverlap(bankrollFootprint(slot, tier), betSpotFootprint(slot)),
        ).toBe(false);
      }
    }
  });

  it("keeps every corner of every pile on the cloth", () => {
    // Measured against the felt ELLIPSE rather than a radius, because the
    // table is 2.15 x 1.32 and a seat at 60 degrees is nowhere near circular.
    // This is the check that caught the first placement: a straight sideways
    // offset put the diagonal seats' deepest pile at 1.07 of the felt — over
    // the rail — while every distance-based assertion still passed.
    for (const slot of SLOTS) {
      for (const tier of CHIP_PROP_TIERS) {
        for (const corner of bankrollFootprint(slot, tier)) {
          expect(feltLoad(corner.x, corner.z)).toBeLessThan(1);
        }
      }
    }
  });

  it("gives no two seats overlapping piles, even six deep stacks", () => {
    for (const a of SLOTS) {
      for (const b of SLOTS) {
        if (a >= b) continue;
        expect(
          footprintsOverlap(bankrollFootprint(a, "deep"), bankrollFootprint(b, "deep")),
        ).toBe(false);
      }
    }
  });

  it("sits to the player's right, not their left", () => {
    // The offset is a rotation around the ring, so the check is that the
    // bankroll's angle leads the seat's own — and at slot 0 that has to come
    // out as +X, the local player's right on screen. A sign flip here puts
    // every stack on the wrong hand and still looks entirely plausible.
    for (const slot of SLOTS) {
      expect(bankrollAngle(slot)).toBeGreaterThan(seatAngle(slot));
    }
    expect(bankrollPosition(0).x).toBeGreaterThan(0);
    expect(seatRightVector(0).x).toBeCloseTo(1, 6);
  });

  it("lies its long axis along the rail, not pointing at the board", () => {
    for (const slot of SLOTS) {
      const rotation = bankrollRotationY(slot);
      const position = bankrollPosition(slot);
      // A +Z-forward model turned by this rotation must end up facing the
      // centre; its local X is then the tangent the heap spreads along.
      const forwardX = Math.sin(rotation);
      const forwardZ = Math.cos(rotation);
      const toCentre = Math.hypot(position.x, position.z);
      expect(forwardX).toBeCloseTo(-position.x / toCentre, 6);
      expect(forwardZ).toBeCloseTo(-position.z / toCentre, 6);
    }
  });

  it("converts prop metres with the room's own ruler", () => {
    const units = bankrollSizeUnits("deep");
    expect(units.x).toBeCloseTo(CHIP_PROPS.deep.size.x * UNITS_PER_METRE, 9);
  });
});
