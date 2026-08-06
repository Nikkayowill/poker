import { describe, expect, it } from "vitest";
import { CHIP_THICKNESS, ChipLayer } from "./chip-layer";
import { flightDurationMs, FUNNEL_CHIP_COUNT, REFERENCE_FRAME_MS } from "./chip-physics";
import { NEAT_SLIDE_DURATION_MS, SPLASH_SCATTER_RADIUS } from "./bet-style";
import { seatBetOrigin } from "./seat-ring";
import { FELT } from "./scene-config";

/**
 * The chip system's state machine, now testable because it is pure — its
 * three.js predecessor lived in `components/` where `npm test` never
 * reached, and the only proof of its behaviour was e2e. Motion arithmetic
 * itself is fixed by `chip-physics.test.ts`; what belongs here is the layer
 * on top: keyed pile sync, spray composition, and lifecycle.
 */

const BB = 10;
const layer = () => {
  let changed = 0;
  const chips = new ChipLayer(() => { changed += 1; });
  return { chips, changed: () => changed };
};

/** Run the layer to rest: every delay elapsed, every slide settled. */
function settle(chips: ChipLayer, frames = 3000): void {
  for (let i = 0; i < frames; i += 1) {
    if (!chips.update(REFERENCE_FRAME_MS, false)) return;
  }
}

describe("the pile", () => {
  it("builds the pot's exact breakdown and reuses settled chips", () => {
    const { chips } = layer();
    chips.syncPile(1310, BB, false);   // 131 BB -> 100 + 25 + 5 + 1
    expect(chips.debugPileSize()).toBe(4);
    const before = chips.drawList().map((chip) => chip.position);

    // Raising the pot must *add* chips, not rebuild the stack: the four
    // already settled keep their exact objects and positions.
    settle(chips);
    const settled = chips.drawList().map((chip) => ({ ...chip.position }));
    chips.syncPile(1360, BB, false);   // adds one 5-chip
    expect(chips.debugPileSize()).toBe(5);
    const after = chips.drawList();
    for (const position of settled) {
      expect(after.some((chip) =>
        chip.position.x === position.x && chip.position.z === position.z)).toBe(true);
    }
    expect(before.length).toBeGreaterThan(0);
  });

  it("empties while the pot is being paid out, so chips are not shown twice", () => {
    const { chips } = layer();
    chips.syncPile(500, BB, false);
    expect(chips.debugPileSize()).toBeGreaterThan(0);
    chips.syncPile(500, BB, true);
    expect(chips.debugPileSize()).toBe(0);
  });

  it("does not list a dropping-in pile chip twice", () => {
    const { chips } = layer();
    chips.syncPile(1310, BB, false);
    // Before any update the four pile chips are all still in flight.
    expect(chips.drawList().length).toBe(4);
  });
});

describe("the airborne flag", () => {
  it("is set while a chip flies and cleared the moment it parks", () => {
    const { chips } = layer();
    chips.syncPile(1310, BB, false);
    // Dropping in: every pile chip is in flight and says so.
    expect(chips.drawList().every((chip) => chip.airborne)).toBe(true);
    settle(chips);
    // Settled: the painter must see a resting pile — a chip resting
    // mid-stack is above the felt too, and keeping the flag would paint a
    // hovering shadow pool under every chip but the bottom one, which is
    // exactly the floating-stack bug.
    expect(chips.drawList().some((chip) => chip.airborne)).toBe(false);
  });

  it("re-arms when a settled standing bet sweeps into the pot", () => {
    const { chips } = layer();
    chips.syncBets([{ slot: 1, amount: 70 }], 6, BB);
    settle(chips);
    expect(chips.drawList().some((chip) => chip.airborne)).toBe(false);
    chips.sweepBets();
    expect(chips.drawList().every((chip) => chip.airborne)).toBe(true);
  });
});

describe("sprays", () => {
  it("flies a bet as the amount's own breakdown", () => {
    const { chips } = layer();
    chips.spawnBet(2, 6, 70, BB);      // 7 BB -> 5 + 1 + 1, smallest first
    const flying = chips.debugChipPositions();
    expect(flying.length).toBe(3);
    settle(chips);
    // Spray chips are removed on arrival, not kept.
    expect(chips.debugChipPositions().length).toBe(0);
    expect(chips.debugPileSize()).toBe(0);
  });

  it("pays each winner their own amount, capped at the budget's worst case", () => {
    const { chips } = layer();
    chips.spawnFunnel(
      [{ slot: 1, amount: 30 }, { slot: 4, amount: 999_999 }],
      6,
      BB,
    );
    // 3 BB -> one 1-chip + one 1... (3 -> 1x3) and a monster capped at 12.
    const flying = chips.debugChipPositions();
    expect(flying.length).toBeGreaterThan(3);
    expect(flying.length).toBeLessThanOrEqual(3 + FUNNEL_CHIP_COUNT);
  });

  it("aims a payout at its winner's side of the table", () => {
    const { chips } = layer();
    chips.spawnFunnel([{ slot: 0, amount: 500 }], 6, BB);
    settle(chips, 20_000);
    // Nothing remains in flight once settled; mid-flight, every chip was
    // between pot and the near seat (positive z). Re-run and sample.
    const { chips: again } = layer();
    again.spawnFunnel([{ slot: 0, amount: 500 }], 6, BB);
    for (let i = 0; i < 400; i += 1) again.update(REFERENCE_FRAME_MS, false);
    const positions = again.debugChipPositions();
    for (const position of positions) {
      expect(position.z).toBeGreaterThanOrEqual(-0.5);
    }
  });

  it("clearFlights sweeps sprays but never the pile", () => {
    const { chips } = layer();
    chips.syncPile(500, BB, false);
    chips.spawnBet(3, 6, 100, BB);
    chips.clearFlights();
    expect(chips.debugChipPositions().length).toBeLessThanOrEqual(chips.debugPileSize());
    expect(chips.debugPileSize()).toBeGreaterThan(0);
  });
});

describe("standing street bets", () => {
  const BETS = [{ slot: 1, amount: 70 }, { slot: 4, amount: 250 }];

  it("stands each seat's bet as its own exact breakdown", () => {
    const { chips } = layer();
    chips.syncBets(BETS, 6, BB);
    // 7 BB -> 5+1+1 (3 chips); 25 BB -> 25 (1 chip).
    expect(chips.debugBetChips()).toBe(4);
  });

  it("adds chips on a raise without rebuilding the stack", () => {
    const { chips } = layer();
    chips.syncBets([{ slot: 2, amount: 50 }], 6, BB);   // 5 BB -> one chip
    settle(chips);
    const before = chips.drawList().map((chip) => ({ ...chip.position }));
    chips.syncBets([{ slot: 2, amount: 100 }], 6, BB);  // 10 BB -> 5+5
    expect(chips.debugBetChips()).toBe(2);
    // The settled chip kept its exact spot; only the second chip is new.
    const after = chips.drawList();
    expect(after.some((chip) =>
      chip.position.x === before[0].x && chip.position.z === before[0].z)).toBe(true);
  });

  it("re-hands a settled chip its identical spot on a refetch", () => {
    const { chips } = layer();
    chips.syncBets(BETS, 6, BB);
    settle(chips);
    const before = chips.drawList().map((chip) => ({ ...chip.position }));
    chips.syncBets(BETS, 6, BB);
    const after = chips.drawList().map((chip) => ({ ...chip.position }));
    expect(after).toEqual(before);
  });

  it("keeps the felt summing to the pot: pile plus standing equals the whole", () => {
    // The invariant the split exists for. A pot of 500 with 320 still
    // standing shows 180 in the middle; the chips drawn are exactly the
    // breakdowns of those two numbers, never a double count.
    const { chips } = layer();
    chips.syncPile(180, BB, false);
    chips.syncBets([{ slot: 1, amount: 200 }, { slot: 3, amount: 120 }], 6, BB);
    settle(chips);
    expect(chips.drawList().length).toBe(
      chips.debugPileSize() + chips.debugBetChips(),
    );
  });

  it("sweeps every standing chip into the middle from where it rested", () => {
    const { chips } = layer();
    chips.syncBets(BETS, 6, BB);
    settle(chips);
    const standing = chips.debugBetChips();
    chips.sweepBets();
    expect(chips.debugBetChips()).toBe(0);
    // The same chips, now in flight toward the pot -- transferred, not
    // respawned.
    expect(chips.debugChipPositions().length).toBe(standing);
    settle(chips, 20_000);
    expect(chips.debugChipPositions().length).toBe(0);
  });

  it("sweeps a chip that was still dropping in without animating it twice", () => {
    const { chips } = layer();
    chips.syncBets(BETS, 6, BB);   // no settle: everything mid-drop
    chips.sweepBets();
    expect(chips.debugChipPositions().length).toBe(4);
  });

  it("clears instantly at a hand boundary or payout instead of sweeping", () => {
    const { chips } = layer();
    chips.syncBets(BETS, 6, BB);
    chips.clearBets();
    expect(chips.debugBetChips()).toBe(0);
    expect(chips.debugChipPositions().length).toBe(0);
  });

  it("spreads a wide bet along the seat's tangent, staying on the felt", () => {
    const { chips } = layer();
    // 131 BB -> four denominations, four columns, at a side seat.
    chips.syncBets([{ slot: 1, amount: 1310 }], 6, BB);
    settle(chips);
    for (const chip of chips.drawList()) {
      const inside = (chip.position.x / FELT.radiusX) ** 2 + (chip.position.z / FELT.radiusZ) ** 2;
      expect(inside).toBeLessThan(1);
    }
  });
});

describe("selectable bet styles", () => {
  it("neat slide flies the bet as one rigid pillar, no scatter, no stagger", () => {
    const { chips } = layer();
    chips.setBetStyle("neat_slide");
    chips.spawnBet(2, 6, 70, BB);      // 3 chips
    // One frame in, the pillar is still perfectly aligned: every chip on
    // the same x/z, stacked exactly a thickness apart, because nothing was
    // staggered and every chip rides the same clock.
    chips.update(REFERENCE_FRAME_MS, false);
    const flying = chips.debugChipPositions();
    expect(flying.length).toBe(3);
    for (const position of flying) {
      expect(position.x).toBeCloseTo(flying[0].x, 10);
      expect(position.z).toBeCloseTo(flying[0].z, 10);
    }
    const heights = flying.map((position) => position.y).sort((a, b) => a - b);
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i] - heights[i - 1]).toBeCloseTo(CHIP_THICKNESS, 10);
    }
  });

  it("neat slide terminates exactly on its clock and lets the loop sleep", () => {
    const { chips } = layer();
    chips.setBetStyle("neat_slide");
    chips.spawnBet(1, 6, 250, BB);
    const frames = Math.ceil(NEAT_SLIDE_DURATION_MS / REFERENCE_FRAME_MS) + 1;
    for (let i = 0; i < frames; i += 1) chips.update(REFERENCE_FRAME_MS, false);
    // Every flight chip destroyed on arrival — no ghosts left to paint —
    // and the layer reports quiet, so the scheduler stops requesting frames.
    expect(chips.debugChipPositions().length).toBe(0);
    expect(chips.update(REFERENCE_FRAME_MS, false)).toBe(false);
  });

  it("splash lands the cluster inside the scatter radius of the bet spot", () => {
    const { chips } = layer();
    chips.setBetStyle("splash_chunk");
    chips.spawnBet(2, 6, 70, BB);
    const spot = seatBetOrigin(2, 6);
    // Far enough in that every chip is a whisker from its landing, not so
    // far that any has arrived and been removed.
    for (let i = 0; i < 60; i += 1) chips.update(REFERENCE_FRAME_MS, false);
    const flying = chips.debugChipPositions();
    expect(flying.length).toBe(3);
    for (const position of flying) {
      const planDistance = Math.hypot(position.x - spot.x, position.z - spot.z);
      expect(planDistance).toBeLessThanOrEqual(SPLASH_SCATTER_RADIUS + 0.2);
    }
  });

  it("splash is deterministic: the same bet flies the same frames twice", () => {
    const run = () => {
      const { chips } = layer();
      chips.setBetStyle("splash_chunk");
      chips.spawnBet(4, 6, 1310, BB);
      const samples: number[][] = [];
      for (let i = 0; i < 40; i += 1) {
        chips.update(REFERENCE_FRAME_MS, false);
        if (i % 10 === 0) {
          samples.push(chips.debugChipPositions().flatMap((p) => [p.x, p.y, p.z]));
        }
      }
      return samples;
    };
    expect(run()).toEqual(run());
  });

  it("the default style is splash — continuity with the spray it replaces", () => {
    const { chips: styled } = layer();
    styled.setBetStyle("splash_chunk");
    const { chips: unstyled } = layer();
    styled.spawnBet(3, 6, 100, BB);
    unstyled.spawnBet(3, 6, 100, BB);
    styled.update(REFERENCE_FRAME_MS, false);
    unstyled.update(REFERENCE_FRAME_MS, false);
    expect(unstyled.debugChipPositions()).toEqual(styled.debugChipPositions());
  });

  it("restyling never rewrites a flight already in the air", () => {
    const { chips } = layer();
    chips.setBetStyle("splash_chunk");
    chips.spawnBet(1, 6, 50, BB);
    chips.update(REFERENCE_FRAME_MS, false);
    const before = chips.debugChipPositions();
    chips.setBetStyle("neat_slide");
    // The in-flight chip keeps its splash trajectory; only future sprays
    // pick up the new style.
    chips.update(0, false);
    expect(chips.debugChipPositions()).toEqual(before);
  });
});

describe("motion lifecycle", () => {
  it("actually arrives within the solved flight duration, arc and all", () => {
    // The regression this pins: the WebGL predecessor fed the arc-inflated
    // drawn position back into the slide, so the residue re-amplified near
    // the target and chips hovered forever — the celebration budget was
    // proven against a base position nothing ever followed. The slide's
    // base is the motion state now, so a spray must be fully landed within
    // its stagger plus the solved duration, with margin for quantisation.
    const { chips } = layer();
    chips.spawnFunnel([{ slot: 3, amount: 5_000 }], 6, BB);
    const longestFlight = 12;
    const budgetFrames = Math.ceil(
      ((FUNNEL_CHIP_COUNT - 1) * 34 + flightDurationMs(longestFlight)) / REFERENCE_FRAME_MS,
    ) + 10;
    for (let i = 0; i < budgetFrames; i += 1) chips.update(REFERENCE_FRAME_MS, false);
    expect(chips.debugChipPositions().length).toBe(0);
  });

  it("reports motion while anything is delayed or sliding, then goes quiet", () => {
    const { chips } = layer();
    chips.spawnBet(1, 6, 50, BB);
    expect(chips.update(REFERENCE_FRAME_MS, false)).toBe(true);
    settle(chips);
    expect(chips.update(REFERENCE_FRAME_MS, false)).toBe(false);
  });

  it("snaps to rest under reduced motion without losing the information", () => {
    const { chips } = layer();
    chips.syncPile(BB, BB, false);   // one big blind: a single chip
    // One update: the chip parks exactly on target, half a thickness above
    // the felt, instead of sliding there.
    chips.update(REFERENCE_FRAME_MS, true);
    const [chip] = chips.drawList();
    expect(chip.position.y).toBeCloseTo(FELT.y + CHIP_THICKNESS / 2, 6);
  });

  it("keeps every chip on a real denomination", () => {
    const { chips } = layer();
    chips.syncPile(12345, 7, false);
    chips.spawnBet(0, 6, 12345, 7);
    for (const chip of chips.drawList()) {
      expect([100, 25, 5, 1]).toContain(chip.denomination);
    }
  });
});
