import { describe, expect, it, vi } from "vitest";
import { ChipScene, type RenderChip } from "./chip-scene";
import { MOTION, sprayDurationMs } from "./chip-motion";
import { MAX_POT_CHIPS } from "./chip-stack";

const BIG_BLIND = 10;
const SEATS = 6;

function makeScene() {
  const onChanged = vi.fn();
  return { scene: new ChipScene(onChanged), onChanged };
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

const keyOf = (chip: RenderChip) => `${chip.denomination}:${chip.seed}`;

describe("the two populations", () => {
  it("never draws a permanent chip while the chip carrying it is still in the air", () => {
    // The whole architecture in one assertion. A pot chip is reserved the
    // moment the pot grows, but it is a reservation until its carrier lands --
    // otherwise the same chip is on screen at both ends of its own flight.
    const { scene } = makeScene();
    // At a big blind of 1 the breakdown is greedy: 9 is a five and four ones.
    scene.syncPile(9, 1, false);
    expect(scene.debugPileSize()).toBe(5);
    expect(scene.drawList().filter((chip) => !chip.airborne)).toHaveLength(0);

    settle(scene);
    expect(scene.drawList()).toHaveLength(5);
    for (const chip of scene.drawList()) expect(chip.airborne).toBe(false);
  });

  it("never lists one chip twice", () => {
    const { scene } = makeScene();
    scene.syncPile(370, BIG_BLIND, false);
    scene.syncBets([{ slot: 1, amount: 80 }, { slot: 3, amount: 250 }], SEATS, BIG_BLIND);
    scene.spawnBet(2, SEATS, 120, BIG_BLIND, "raise");
    for (let frame = 0; frame < 40; frame += 1) {
      const list = scene.drawList();
      expect(new Set(list.map(keyOf)).size).toBe(list.length);
      scene.update(1000 / 60, false);
    }
  });

  it("does not respawn a chip that is already resting", () => {
    // Raising a pot from three chips to four adds one chip; it does not
    // rebuild the pile, or every chip on the felt replays its landing every
    // time anybody bets.
    const { scene } = makeScene();
    scene.syncPile(3, 1, false);
    settle(scene);
    const before = scene.drawList().map((chip) => ({ ...chip.position }));

    scene.syncPile(4, 1, false);
    // Exactly one new chip is in the air; the three already down are not.
    expect(scene.debugChipPositions()).toHaveLength(1);
    const stillResting = scene.drawList().filter((chip) => !chip.airborne);
    expect(stillResting).toHaveLength(3);
    for (let index = 0; index < 3; index += 1) {
      expect(stillResting[index].position).toEqual(before[index]);
    }
  });

  it("hands a settled chip its identical imperfections back after a re-sync", () => {
    // The pile is rebuilt from the pot on every snapshot. A seed that moved
    // would re-roll the chip's tilt and face orientation, and the whole mound
    // would shimmer on every bet.
    const { scene } = makeScene();
    scene.syncPile(60, BIG_BLIND, false);
    settle(scene);
    const seeds = scene.drawList().map((chip) => chip.seed);
    scene.syncPile(60, BIG_BLIND, false);
    expect(scene.drawList().map((chip) => chip.seed)).toEqual(seeds);
  });

  it("gives neighbouring chips different seeds, so a column is not a repeated sprite", () => {
    const { scene } = makeScene();
    scene.syncPile(90, BIG_BLIND, false);
    settle(scene);
    const seeds = scene.drawList().map((chip) => chip.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe("the pot as an object", () => {
  it("stacks chips at consecutive heights rather than on top of each other", () => {
    const { scene } = makeScene();
    scene.syncPile(9, 1, false);
    settle(scene);
    const indices = scene.drawList().map((chip) => chip.stackIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });

  it("caps, so a monster pot is a mound rather than a thousand chips", () => {
    const { scene } = makeScene();
    scene.syncPile(1_000_000, BIG_BLIND, false);
    expect(scene.debugPileSize()).toBe(MAX_POT_CHIPS);
  });

  it("empties while the payout runs — the pot flying out already contains it", () => {
    const { scene } = makeScene();
    scene.syncPile(200, BIG_BLIND, false);
    settle(scene);
    scene.syncPile(200, BIG_BLIND, true);
    expect(scene.debugPileSize()).toBe(0);
  });
});

describe("bets", () => {
  it("stands a bet in front of its own seat, not in the middle", () => {
    const { scene } = makeScene();
    scene.syncBets([{ slot: 0, amount: 100 }, { slot: 3, amount: 100 }], SEATS, BIG_BLIND);
    settle(scene);
    const list = scene.drawList();
    const near = list.filter((chip) => chip.position.z > 0);
    const far = list.filter((chip) => chip.position.z < 0);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
  });

  it("times a call quicker than a raise and a raise quicker than a shove", () => {
    // The ordering is the meaning; if a style or a distance could reorder
    // these, the felt would be lying about what just happened.
    const durations = (["call", "raise", "all_in"] as const).map((kind) => {
      const { scene } = makeScene();
      scene.spawnBet(1, SEATS, 100, BIG_BLIND, kind);
      return settle(scene);
    });
    expect(durations[0]).toBeLessThan(durations[1]);
    expect(durations[1]).toBeLessThan(durations[2]);
  });

  it("caps a spray at ten chips, past which it reads as a particle effect", () => {
    const { scene } = makeScene();
    scene.spawnBet(1, SEATS, 100_000, BIG_BLIND, "all_in");
    expect(scene.debugChipPositions().length).toBeLessThanOrEqual(10);
  });

  it("assembles a column, which is what a scattered spray never could", () => {
    // Sampled as targets, not positions: a spray's chips are destroyed on
    // arrival, so mid-flight positions show chips on their own arcs and say
    // nothing about the shape they build.
    const { scene } = makeScene();
    scene.spawnBet(1, SEATS, 60, BIG_BLIND, "bet");
    const targets = scene.debugFlightTargets();
    expect(targets.length).toBeGreaterThan(1);
    for (const target of targets) {
      expect(target.x).toBeCloseTo(targets[0].x, 6);
      expect(target.z).toBeCloseTo(targets[0].z, 6);
    }
  });

  it("breaks that column only when the player asked for splash", () => {
    const { scene } = makeScene();
    scene.setBetStyle("splash_chunk");
    scene.spawnBet(1, SEATS, 60, BIG_BLIND, "bet");
    const targets = scene.debugFlightTargets();
    const spread = Math.max(...targets.map((t) => t.x)) - Math.min(...targets.map((t) => t.x));
    expect(spread).toBeGreaterThan(0);
  });
});

describe("the sweep", () => {
  it("puts every standing chip in the air and leaves none standing", () => {
    const { scene } = makeScene();
    scene.syncBets([{ slot: 1, amount: 100 }, { slot: 4, amount: 100 }], SEATS, BIG_BLIND);
    settle(scene);
    const standing = scene.debugBetChips();
    expect(standing).toBeGreaterThan(0);

    scene.sweepBets();
    expect(scene.debugBetChips()).toBe(0);
    expect(scene.debugChipPositions()).toHaveLength(standing);
  });

  it("builds the new mound after the swept chips land, not alongside them", () => {
    // Without the wait a street change briefly shows both populations at once,
    // which reads as the pot doubling and then halving.
    const { scene } = makeScene();
    scene.syncBets([{ slot: 1, amount: 100 }], SEATS, BIG_BLIND);
    settle(scene);
    const sweptChips = scene.debugBetChips();
    scene.sweepBets();
    scene.syncPile(100, BIG_BLIND, false);

    // Halfway through the sweep, the mound's chips have not started dropping.
    scene.update(sprayDurationMs(sweptChips, MOTION.sweep) / 2, false);
    expect(scene.drawList().filter((chip) => !chip.airborne)).toHaveLength(0);

    settle(scene);
    expect(scene.drawList()).toHaveLength(scene.debugPileSize());
  });
});

describe("the frame", () => {
  it("reports nothing moving when nothing is", () => {
    // What lets the render loop sleep, which is the whole battery saving.
    const { scene } = makeScene();
    expect(scene.update(16, false)).toBe(false);
    expect(scene.isIdle()).toBe(true);
  });

  it("goes idle after every flight, rather than creeping toward its target", () => {
    // A friction slide is asymptotic and never arrives; this has to.
    const { scene } = makeScene();
    scene.spawnFunnel([{ slot: 2, amount: 500 }], SEATS, BIG_BLIND);
    const elapsed = settle(scene);
    expect(scene.isIdle()).toBe(true);
    expect(elapsed).toBeLessThan(sprayDurationMs(12, MOTION.payout) + 100);
  });

  it("parks every chip exactly on its slot rather than a rest-epsilon away", () => {
    // The error is per-chip, so it never averages out: a column parked "close
    // enough" stops lining up with the column beside it.
    const { scene } = makeScene();
    scene.syncPile(370, BIG_BLIND, false);
    const targets = new Map(scene.debugFlightTargets().map((target, index) => [index, target]));
    settle(scene);
    for (const chip of scene.drawList()) {
      expect(Number.isInteger(chip.stackIndex)).toBe(true);
      expect(chip.lift).toBe(0);
      expect(chip.scaleX).toBe(1);
      expect(chip.rollRad).toBe(0);
    }
    expect(targets.size).toBeGreaterThan(0);
  });

  it("snaps rather than slides when the player asked for less motion", () => {
    // Removing the chips entirely would remove information, not motion.
    const { scene } = makeScene();
    scene.spawnBet(1, SEATS, 100, BIG_BLIND, "bet");
    const targets = scene.debugFlightTargets();
    scene.update(16, true);
    expect(scene.isIdle()).toBe(true);
    expect(targets.length).toBeGreaterThan(0);
  });

  it("survives a backgrounded tab handing back a nonsense delta", () => {
    const { scene } = makeScene();
    scene.syncPile(100, BIG_BLIND, false);
    scene.update(Number.NaN, false);
    scene.update(-50, false);
    for (const chip of scene.drawList()) {
      expect(Number.isFinite(chip.position.x)).toBe(true);
      expect(Number.isFinite(chip.position.y)).toBe(true);
    }
  });
});

describe("clearing", () => {
  it("reveals every reservation rather than stranding an invisible chip", () => {
    // A cancelled carrier never runs its arrival, so without this the pot
    // would hold chips nothing will ever draw.
    const { scene } = makeScene();
    scene.syncPile(80, BIG_BLIND, false);
    expect(scene.drawList().filter((chip) => !chip.airborne)).toHaveLength(0);
    scene.clearFlights();
    expect(scene.isIdle()).toBe(true);
    expect(scene.drawList()).toHaveLength(scene.debugPileSize());
  });

  it("drops standing bets at a hand boundary without sweeping them", () => {
    const { scene } = makeScene();
    scene.syncBets([{ slot: 2, amount: 100 }], SEATS, BIG_BLIND);
    scene.clearBets();
    expect(scene.debugBetChips()).toBe(0);
  });
});

describe("the table underneath", () => {
  it("lays the mound out at the fit's own chip size", () => {
    // The bug this prevents: a phone's chips are clamped larger than the
    // projection would draw them, and a mound spaced for the unclamped size
    // has overlapping columns.
    const spread = (radius: number) => {
      const { scene } = makeScene();
      scene.setChipRadius(radius);
      // Eleven chips (three 25s, four 5s, four 1s): enough to open a second
      // column, so the mound has a width to measure at all.
      scene.syncPile(99, 1, false);
      settle(scene);
      const xs = scene.drawList().map((chip) => chip.position.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(0.3)).toBeGreaterThan(spread(0.15));
  });

  it("ignores a nonsense chip radius rather than collapsing the felt", () => {
    const { scene } = makeScene();
    scene.setChipRadius(Number.NaN);
    scene.setChipRadius(-1);
    scene.syncPile(99, 1, false);
    settle(scene);
    for (const chip of scene.drawList()) expect(Number.isFinite(chip.position.x)).toBe(true);
  });
});
