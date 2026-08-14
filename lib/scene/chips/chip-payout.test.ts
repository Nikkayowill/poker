import { describe, expect, it, vi } from "vitest";
import { ChipScene } from "./chip-scene";

const SEATS = 6;

function makeScene() {
  return new ChipScene(vi.fn());
}

/** Run the scene forward at a steady 60fps until it goes idle or gives up. */
function settle(scene: ChipScene, budgetMs = 6000): number {
  let elapsed = 0;
  while (!scene.isIdle() && elapsed < budgetMs) {
    scene.update(1000 / 60, false);
    elapsed += 1000 / 60;
  }
  return elapsed;
}

/** A settled hand: a mound in the middle and a caller's bet still standing. */
function feltWithChips(): ChipScene {
  const scene = makeScene();
  scene.syncPile(99, 1, false);
  scene.syncBets([{ slot: 3, amount: 60 }], SEATS, 10);
  settle(scene);
  return scene;
}

describe("paying the pot out", () => {
  it("sends the chips that were on the table, from where they were sitting", () => {
    // The defect this pins: the pot's mound and the standing bets used to be
    // deleted, and a freshly built twelve-chip stack slid out of the pot's
    // centre in their place. The chips that arrived were never the chips that
    // had been there, and the eye caught the substitution.
    const scene = feltWithChips();
    const before = scene.drawList().map((chip) => ({ ...chip.position }));
    expect(before.length).toBeGreaterThan(6);

    scene.payOut([{ slot: 2, amount: 500 }], SEATS, 10);

    const launched = scene.debugChipPositions();
    expect(launched).toHaveLength(before.length);
    for (const start of launched) {
      const fromARestingChip = before.some(
        (spot) => Math.hypot(spot.x - start.x, spot.z - start.z) < 1e-9,
      );
      expect(fromARestingChip).toBe(true);
    }
  });

  it("takes the standing bets with it — they are part of the pot that was won", () => {
    const scene = feltWithChips();
    expect(scene.debugBetChips()).toBeGreaterThan(0);
    scene.payOut([{ slot: 2, amount: 500 }], SEATS, 10);
    expect(scene.debugBetChips()).toBe(0);
    expect(scene.debugPileSize()).toBe(0);
  });

  it("leaves nothing behind on the felt, and conjures nothing in the middle", () => {
    const scene = feltWithChips();
    const total = scene.drawList().length;
    scene.payOut([{ slot: 2, amount: 500 }], SEATS, 10);
    // The same chips, now all in the air: none deleted, none invented.
    expect(scene.drawList()).toHaveLength(total);
  });

  it("holds the chips in front of the winner before fading them", () => {
    // They used to be cut on the frame they arrived, so the pot went somewhere
    // and was never seen to *be* there.
    const scene = feltWithChips();
    scene.payOut([{ slot: 2, amount: 500 }], SEATS, 10);

    let elapsed = 0;
    const run = (untilMs: number) => {
      while (elapsed < untilMs) {
        scene.update(1000 / 60, false);
        elapsed += 1000 / 60;
      }
    };

    run(800);
    const landed = scene.drawList();
    expect(landed.length).toBeGreaterThan(0);
    for (const chip of landed) {
      expect(chip.airborne).toBe(false);
      expect(chip.opacity).toBe(1);
    }

    // Still there a good while later, and only now on their way out.
    run(1500);
    const fading = scene.drawList();
    expect(fading.length).toBeGreaterThan(0);
    expect(Math.max(...fading.map((chip) => chip.opacity))).toBeLessThan(1);

    settle(scene);
    expect(scene.drawList()).toHaveLength(0);
  });

  it("finishes before the next hand is dealt over the top of it", () => {
    // NEXT_HAND_DELAY_MS is 2,800, and this is the worst case the felt can
    // hold: a capped mound plus two full standing bets.
    const scene = makeScene();
    scene.syncPile(1_000_000, 10, false);
    scene.syncBets([{ slot: 1, amount: 900 }, { slot: 4, amount: 900 }], SEATS, 10);
    settle(scene);
    scene.payOut([{ slot: 2, amount: 9000 }], SEATS, 10);
    expect(settle(scene, 6000)).toBeLessThan(2800);
  });

  it("divides one pile between split-pot winners rather than paying each in full", () => {
    const scene = feltWithChips();
    const total = scene.drawList().length;
    scene.payOut([{ slot: 1, amount: 250 }, { slot: 4, amount: 250 }], SEATS, 10);
    expect(scene.debugFlightTargets()).toHaveLength(total);
    settle(scene);
    expect(scene.drawList()).toHaveLength(0);
  });

  it("aims each winner's share at that winner", () => {
    const scene = feltWithChips();
    scene.payOut([{ slot: 1, amount: 250 }, { slot: 4, amount: 250 }], SEATS, 10);
    const targets = scene.debugFlightTargets();
    // Two distinct landing clusters, on opposite sides of the table.
    const left = targets.filter((target) => target.x < 0);
    const right = targets.filter((target) => target.x > 0);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
  });

  it("still pays a winner when the felt had nothing on it", () => {
    // A divergent snapshot, or a hand that ended before anything was
    // committed. Showing no payout at all would be worse than a fallback.
    const scene = makeScene();
    scene.payOut([{ slot: 2, amount: 500 }], SEATS, 10);
    expect(scene.debugChipPositions().length).toBeGreaterThan(0);
    settle(scene);
    expect(scene.drawList()).toHaveLength(0);
  });

  it("does nothing when there are no winners", () => {
    const scene = feltWithChips();
    const total = scene.drawList().length;
    scene.payOut([], SEATS, 10);
    expect(scene.drawList()).toHaveLength(total);
  });

  it("leaves the felt alone while paying, so the payout has chips to send", () => {
    // `syncPile` used to empty the mound the instant `paying` went true, which
    // deleted the very chips `payOut` is about to fly.
    const scene = feltWithChips();
    const resting = scene.debugPileSize();
    scene.syncPile(99, 1, true);
    expect(scene.debugPileSize()).toBe(resting);
    expect(scene.debugBetChips()).toBeGreaterThan(0);
  });

  it("clears a paid pot at the hand boundary without stranding a faded chip", () => {
    const scene = feltWithChips();
    scene.payOut([{ slot: 2, amount: 500 }], SEATS, 10);
    scene.update(900, false);
    scene.clearFlights();
    expect(scene.isIdle()).toBe(true);
    expect(scene.drawList()).toHaveLength(0);
  });
});
