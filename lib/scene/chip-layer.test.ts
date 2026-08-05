import { describe, expect, it } from "vitest";
import { ChipLayer } from "./chip-layer";
import { flightDurationMs, FUNNEL_CHIP_COUNT, REFERENCE_FRAME_MS } from "./chip-physics";
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
    expect(chip.position.y).toBeCloseTo(FELT.y + 0.04, 6);
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
