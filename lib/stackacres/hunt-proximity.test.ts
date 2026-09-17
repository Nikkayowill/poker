import { describe, expect, it } from "vitest";
import { seededRandom } from "./world";
import { HUNTING_WEAPONS, QUARRY_SPECIES } from "./hunting";
import {
  ALERT_MAX,
  HUNT_WEAPON_PROFILES,
  QUARRY_PROFILES,
  abandonStalk,
  attemptCatch,
  createHuntProximityState,
  huntWeaponProfile,
  inFocusRange,
  markDistance,
  quarryProfile,
  rollQuarryDifficulty,
  stalkAlarm,
  stepHuntProximity,
  type HuntProximityState,
} from "./hunt-proximity";
import type { WorldPoint } from "./world";

const FRAME_MS = 16;
const ORIGIN: WorldPoint = { x: 0, y: 0 };

/** Runs a stalk with a caller-supplied walk, the way a scene's own `update`
 *  would, and hands back the last state. Stops the moment the stalk leaves
 *  `stalking`, INCLUDING on `inRange`: that phase is a window the player is
 *  meant to close with Use, not one this harness should walk through. */
function stalk(
  state: HuntProximityState,
  walkTo: (state: HuntProximityState) => WorldPoint,
  random: () => number,
  frames = 4_000,
): HuntProximityState {
  let current = state;
  for (let i = 0; i < frames && current.phase === "stalking"; i += 1) {
    current = stepHuntProximity(current, FRAME_MS, walkTo(current), random);
  }
  return current;
}

/** A player who never moves off the spot the stalk started at. */
const still = (): WorldPoint => ORIGIN;

/** A Deer standing watchfully at `at`, the state every alert rule below is
 *  measured against. */
function resting(at: WorldPoint): HuntProximityState {
  return {
    ...createHuntProximityState("deer", "bow", ORIGIN, seededRandom(4)),
    quarry: at,
    quarryTarget: at,
    quarryMode: "resting",
    restMs: 5_000,
  };
}

describe("HUNT_WEAPON_PROFILES", () => {
  it("covers every weapon", () => {
    expect(Object.keys(HUNT_WEAPON_PROFILES).sort()).toEqual([...HUNTING_WEAPONS].sort());
  });

  it("makes the rifle reach farther and discount the approach more, since it is an earned reward", () => {
    const bow = huntWeaponProfile("bow");
    const rifle = huntWeaponProfile("rifle");
    expect(rifle.focusRadius).toBeGreaterThan(bow.focusRadius);
    expect(rifle.approachDiscount).toBeGreaterThan(bow.approachDiscount);
  });
});

describe("QUARRY_PROFILES", () => {
  it("covers every species the reward roll can return", () => {
    expect(Object.keys(QUARRY_PROFILES).sort()).toEqual([...QUARRY_SPECIES].sort());
  });

  it("gets harder as the quarry gets rarer", () => {
    const [common, fair, rare] = QUARRY_SPECIES.map(quarryProfile);
    expect(common.speed).toBeLessThan(fair.speed);
    expect(fair.speed).toBeLessThan(rare.speed);
    expect(common.warinessPerSec).toBeLessThan(rare.warinessPerSec);
  });
});

describe("rollQuarryDifficulty", () => {
  it("only ever returns a real species", () => {
    const random = seededRandom(1);
    for (let i = 0; i < 50; i += 1) {
      expect(QUARRY_SPECIES).toContain(rollQuarryDifficulty(random));
    }
  });
});

describe("createHuntProximityState", () => {
  it("starts stalking, unalerted, with the quarry already moving", () => {
    const state = createHuntProximityState("rabbit", "bow", ORIGIN, seededRandom(1));
    expect(state.phase).toBe("stalking");
    expect(state.alertMeter).toBe(0);
    expect(state.quarryMode).toBe("moving");
  });

  it("spawns the quarry within ROAM_HALF_EXTENT of the player, not on top of them", () => {
    const state = createHuntProximityState("boar", "rifle", ORIGIN, seededRandom(2));
    expect(markDistance(state)).toBeGreaterThan(0);
  });
});

describe("stepHuntProximity", () => {
  it("does nothing once the stalk has resolved", () => {
    const bagged: HuntProximityState = {
      ...createHuntProximityState("rabbit", "bow", ORIGIN, seededRandom(1)),
      phase: "bagged",
    };
    const stepped = stepHuntProximity(bagged, FRAME_MS, { x: 100, y: 100 }, seededRandom(1));
    expect(stepped).toBe(bagged);
  });

  it("moves to inRange once the player closes within focusRadius of a stationary quarry", () => {
    const state = resting({ x: 20, y: 0 });
    const stepped = stepHuntProximity(state, FRAME_MS, { x: 0, y: 0 }, seededRandom(5));
    expect(inFocusRange(stepped)).toBe(true);
    expect(stepped.phase).toBe("inRange");
  });

  it("never adds alert on top of the base clock while the quarry is moving (green light)", () => {
    const moving: HuntProximityState = {
      ...createHuntProximityState("boar", "bow", ORIGIN, seededRandom(3)),
      quarry: { x: 200, y: 0 },
      quarryTarget: { x: 500, y: 0 },
      quarryMode: "moving",
    };
    const random = seededRandom(3);
    let current = moving;
    let previousAlert = current.alertMeter;
    const baselinePerFrame = quarryProfile("boar").warinessPerSec * ALERT_MAX * (FRAME_MS / 1000);
    for (let i = 0; i < 30 && current.quarryMode === "moving"; i += 1) {
      current = stepHuntProximity(current, FRAME_MS, { x: i * 5, y: 0 }, random);
      expect(current.alertMeter - previousAlert).toBeLessThanOrEqual(baselinePerFrame + 1e-6);
      previousAlert = current.alertMeter;
    }
  });

  it("builds alert faster from a fast approach on a resting, watching quarry than a slow one (red light)", () => {
    const at: WorldPoint = { x: 60, y: 0 };
    const patient = stalk(resting(at), () => ({ x: 40, y: 0 }), seededRandom(5), 60);
    const rushed = stalk(resting(at), () => ({ x: 55, y: 0 }), seededRandom(5), 60);
    expect(rushed.alertMeter).toBeGreaterThan(patient.alertMeter);
  });

  it("staying put near a resting, watching quarry only builds the base clock's worth of alert", () => {
    const state = resting({ x: 30, y: 0 });
    const player = { x: 0, y: 0 };
    const stepped = stepHuntProximity(state, FRAME_MS, player, seededRandom(9));
    const baseline = quarryProfile("deer").warinessPerSec * ALERT_MAX * (FRAME_MS / 1000);
    expect(stepped.alertMeter).toBeCloseTo(baseline, 5);
  });

  it("eventually flees a stalk that never closes in, from wariness alone", () => {
    const result = stalk(
      createHuntProximityState("boar", "bow", ORIGIN, seededRandom(7)),
      still,
      seededRandom(7),
      20_000,
    );
    expect(result.phase).toBe("fled");
  });
});

describe("attemptCatch", () => {
  it("bags the animal when inRange and under ALERT_MAX", () => {
    const state: HuntProximityState = { ...resting({ x: 10, y: 0 }), phase: "inRange", alertMeter: 40 };
    expect(attemptCatch(state).phase).toBe("bagged");
  });

  it("is a no-op while only stalking", () => {
    const state = createHuntProximityState("rabbit", "bow", ORIGIN, seededRandom(1));
    expect(attemptCatch(state)).toBe(state);
  });

  it("refuses a catch once alert has already filled, even if inRange lingers", () => {
    const state: HuntProximityState = {
      ...resting({ x: 10, y: 0 }),
      phase: "inRange",
      alertMeter: ALERT_MAX,
    };
    expect(attemptCatch(state)).toBe(state);
  });
});

describe("abandonStalk", () => {
  it("always ends in fled, at full alert", () => {
    const state = createHuntProximityState("rabbit", "bow", ORIGIN, seededRandom(1));
    const abandoned = abandonStalk(state);
    expect(abandoned.phase).toBe("fled");
    expect(abandoned.alertMeter).toBe(ALERT_MAX);
  });

  it("does not disturb an already-resolved stalk", () => {
    const bagged: HuntProximityState = {
      ...createHuntProximityState("rabbit", "bow", ORIGIN, seededRandom(1)),
      phase: "bagged",
    };
    expect(abandonStalk(bagged)).toBe(bagged);
  });
});

describe("stalkAlarm", () => {
  it("tracks alertMeter as a 0..1 fraction", () => {
    const state: HuntProximityState = {
      ...createHuntProximityState("rabbit", "bow", ORIGIN, seededRandom(1)),
      alertMeter: 25,
    };
    expect(stalkAlarm(state)).toBeCloseTo(0.25, 5);
  });
});
