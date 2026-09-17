import { describe, expect, it } from "vitest";
import { MAX_FRAME_MS, seededRandom } from "./world";
import { HUNTING_WEAPONS, QUARRY_SPECIES } from "./hunting";
import {
  HUNT_WEAPON_PROFILES,
  QUARRY_PROFILES,
  QUARRY_RADIUS,
  abandonStalk,
  createHuntScopeState,
  huntWeaponProfile,
  markHold,
  quarryProfile,
  rollQuarryDifficulty,
  stalkAlarm,
  stepHuntScope,
  takeMark,
  type HuntScopeState,
  type ScopePoint,
} from "./hunt-scope";

const FRAME_MS = 16;

/** Runs a stalk with a caller-supplied hand, the way the scene's `update`
 *  does, and hands back the last state.
 *
 * Stops the moment the stalk leaves `stalking`, INCLUDING on `locked`: that
 * phase is a window the player is meant to close with Use, and a harness
 * that kept stepping through it would just watch wariness run out and call
 * every successful stalk a flight. */
function stalk(
  state: HuntScopeState,
  handAt: (state: HuntScopeState) => ScopePoint,
  random: () => number,
  frames = 4_000,
): HuntScopeState {
  let current = state;
  for (let i = 0; i < frames && current.phase === "stalking"; i += 1) {
    current = stepHuntScope(current, FRAME_MS, handAt(current), random);
  }
  return current;
}

/** A perfect tracker: the lens is wherever the animal already is. */
const glued = (state: HuntScopeState): ScopePoint => state.quarry;

/** A hand that never moves off the middle of the patch. */
const still = (): ScopePoint => ({ x: 0.5, y: 0.5 });

/** A Deer standing watchfully at `at`, with the lens already on it -- the
 *  state every spook rule below is measured against. */
function resting(at: ScopePoint): HuntScopeState {
  return {
    ...createHuntScopeState("deer", "bow", seededRandom(4)),
    quarry: at,
    quarryTarget: at,
    quarryMode: "resting",
    restMs: 5_000,
    lens: at,
  };
}

describe("HUNT_WEAPON_PROFILES", () => {
  it("covers every weapon", () => {
    expect(Object.keys(HUNT_WEAPON_PROFILES).sort()).toEqual([...HUNTING_WEAPONS].sort());
  });

  it("makes the rifle better at all four, since it is an earned reward", () => {
    const bow = huntWeaponProfile("bow");
    const rifle = huntWeaponProfile("rifle");
    expect(rifle.lensRadius).toBeGreaterThan(bow.lensRadius);
    expect(rifle.lockPerSec).toBeGreaterThan(bow.lockPerSec);
    expect(rifle.lockDrainPerSec).toBeLessThan(bow.lockDrainPerSec);
    expect(rifle.steadiness).toBeGreaterThan(bow.steadiness);
  });

  it("leaves the lens and the quarry room inside the patch", () => {
    for (const weapon of HUNTING_WEAPONS) {
      expect(huntWeaponProfile(weapon).lensRadius + QUARRY_RADIUS).toBeLessThan(0.5);
    }
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
    expect(common.warinessPerSec).toBeLessThan(fair.warinessPerSec);
    expect(fair.warinessPerSec).toBeLessThan(rare.warinessPerSec);
    expect(common.jumpiness).toBeLessThan(fair.jumpiness);
    expect(fair.jumpiness).toBeLessThan(rare.jumpiness);
  });
});

describe("createHuntScopeState", () => {
  it("starts centred, empty and already moving", () => {
    const state = createHuntScopeState("rabbit", "bow", seededRandom(3));
    expect(state.phase).toBe("stalking");
    expect(state.lens).toEqual({ x: 0.5, y: 0.5 });
    expect(state.lock).toBe(0);
    expect(state.spook).toBe(0);
    expect(state.elapsedMs).toBe(0);
    expect(state.onMarkMs).toBe(0);
    expect(state.quarry).not.toEqual(state.quarryTarget);
  });

  it("keeps the animal fully inside the brush", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const state = createHuntScopeState("boar", "rifle", seededRandom(seed));
      expect(state.quarry.x).toBeGreaterThanOrEqual(QUARRY_RADIUS);
      expect(state.quarry.x).toBeLessThanOrEqual(1 - QUARRY_RADIUS);
      expect(state.quarry.y).toBeGreaterThanOrEqual(QUARRY_RADIUS);
      expect(state.quarry.y).toBeLessThanOrEqual(1 - QUARRY_RADIUS);
    }
  });
});

describe("markHold", () => {
  it("is full dead centre and nothing past the lens", () => {
    const state = createHuntScopeState("rabbit", "bow", seededRandom(1));
    const centred: HuntScopeState = { ...state, lens: state.quarry };
    expect(markHold(centred)).toBe(1);

    const reach = huntWeaponProfile("bow").lensRadius + QUARRY_RADIUS;
    const offMark: HuntScopeState = {
      ...state,
      quarry: { x: 0.5, y: 0.5 },
      lens: { x: 0.5 + reach, y: 0.5 },
    };
    expect(markHold(offMark)).toBe(0);
  });

  it("tapers, so centring the mark is worth more than clipping its edge", () => {
    const state = createHuntScopeState("rabbit", "bow", seededRandom(1));
    const reach = huntWeaponProfile("bow").lensRadius + QUARRY_RADIUS;
    const near: HuntScopeState = { ...state, quarry: { x: 0.5, y: 0.5 }, lens: { x: 0.52, y: 0.5 } };
    const far: HuntScopeState = {
      ...state,
      quarry: { x: 0.5, y: 0.5 },
      lens: { x: 0.5 + reach * 0.9, y: 0.5 },
    };
    expect(markHold(near)).toBeGreaterThan(markHold(far));
  });
});

describe("stepHuntScope", () => {
  it("locks on for a hand that holds the mark", () => {
    const state = createHuntScopeState("rabbit", "bow", seededRandom(5));
    const ended = stalk(state, glued, seededRandom(5));
    expect(ended.phase).toBe("locked");
    expect(ended.lock).toBe(1);
    expect(ended.spook).toBeLessThan(1);
  });

  it("loses the animal for a hand that never finds it", () => {
    const state = createHuntScopeState("boar", "bow", seededRandom(9));
    const ended = stalk(state, still, seededRandom(9));
    expect(ended.phase).toBe("fled");
    expect(stalkAlarm(ended)).toBe(1);
  });

  it("ends a patient stalk on wariness alone, so waiting is never a strategy", () => {
    // A hand parked exactly on the animal still runs out of stalk: `locked`
    // is a window, and this proves it closes.
    let current = createHuntScopeState("rabbit", "bow", seededRandom(2));
    const random = seededRandom(2);
    for (let i = 0; i < 4_000 && current.phase !== "fled"; i += 1) {
      current = stepHuntScope(current, FRAME_MS, current.quarry, random);
    }
    expect(current.phase).toBe("fled");
    expect(current.elapsedMs / 1000).toBeLessThanOrEqual(30);
  });

  it("spooks a lens that moves while the animal is watching", () => {
    const watched = resting({ x: 0.5, y: 0.5 });
    const frozen = () => 0.5;

    const crept = stepHuntScope(watched, FRAME_MS, { x: 0.501, y: 0.5 }, frozen);
    const snatched = stepHuntScope(watched, FRAME_MS, { x: 0.56, y: 0.5 }, frozen);
    expect(snatched.spook).toBeGreaterThan(crept.spook);
  });

  it("charges nothing for the same move while the animal is walking", () => {
    // Red light, green light: repositioning is free until it stops. Without
    // this the player has no safe moment to get into place at all.
    const frozen = () => 0.5;
    const walking: HuntScopeState = {
      ...resting({ x: 0.5, y: 0.5 }),
      quarryMode: "moving",
      quarryTarget: { x: 0.5, y: 0.9 },
    };
    const swept = stepHuntScope(walking, FRAME_MS, { x: 0.56, y: 0.5 }, frozen);
    const wariness = quarryProfile("deer").warinessPerSec * (FRAME_MS / 1000);
    expect(swept.spook).toBeCloseTo(wariness, 6);
  });

  it("charges nothing for a sweep across the far side of the brush", () => {
    // The animal is watching, but nowhere near the lens -- getting into
    // position from a distance must stay free.
    const frozen = () => 0.5;
    const away: HuntScopeState = { ...resting({ x: 0.9, y: 0.9 }), lens: { x: 0.25, y: 0.25 } };
    const swept = stepHuntScope(away, FRAME_MS, { x: 0.32, y: 0.25 }, frozen);
    const wariness = quarryProfile("deer").warinessPerSec * (FRAME_MS / 1000);
    expect(swept.spook).toBeCloseTo(wariness, 6);
  });

  it("builds no lock while the animal is walking, however well it is covered", () => {
    // The lens is dead on it, but it is moving and so is the lens -- this is
    // the rule that makes the rest window the thing worth playing for.
    const frozen = () => 0.5;
    const walking: HuntScopeState = {
      ...resting({ x: 0.5, y: 0.5 }),
      quarryMode: "moving",
      quarryTarget: { x: 0.95, y: 0.5 },
    };
    const chased = stepHuntScope(walking, FRAME_MS, { x: 0.5 + 0.42 * (FRAME_MS / 1000), y: 0.5 }, frozen);
    expect(chased.lock).toBe(0);
  });

  it("gives the rifle a faster lock than the bow on the same hold", () => {
    const frozen = () => 0.5;
    const at: ScopePoint = { x: 0.5, y: 0.5 };
    const withBow = createHuntScopeState("deer", "bow", seededRandom(6));
    const withRifle = createHuntScopeState("deer", "rifle", seededRandom(6));
    const bowOn: HuntScopeState = { ...withBow, quarry: at, lens: at };
    const rifleOn: HuntScopeState = { ...withRifle, quarry: at, lens: at };
    expect(stepHuntScope(rifleOn, FRAME_MS, at, frozen).lock).toBeGreaterThan(
      stepHuntScope(bowOn, FRAME_MS, at, frozen).lock,
    );
  });

  it("keeps the lens inside the patch however far the finger goes", () => {
    const state = createHuntScopeState("rabbit", "bow", seededRandom(8));
    const radius = huntWeaponProfile("bow").lensRadius;
    const shoved = stepHuntScope(state, FRAME_MS, { x: 99, y: -99 }, seededRandom(8));
    expect(shoved.lens.x).toBeCloseTo(1 - radius, 6);
    expect(shoved.lens.y).toBeCloseTo(radius, 6);
  });

  it("survives a long frame without teleporting the animal", () => {
    const state = createHuntScopeState("boar", "bow", seededRandom(12));
    const jumped = stepHuntScope(state, 10_000, state.lens, seededRandom(12));
    const travelled = Math.hypot(jumped.quarry.x - state.quarry.x, jumped.quarry.y - state.quarry.y);
    expect(travelled).toBeLessThanOrEqual(quarryProfile("boar").speed * (MAX_FRAME_MS / 1000) + 1e-9);
  });

  it("stands still on a zero-length frame", () => {
    const state = createHuntScopeState("rabbit", "bow", seededRandom(13));
    expect(stepHuntScope(state, 0, { x: 0.1, y: 0.1 }, seededRandom(13))).toBe(state);
  });

  it("replays a whole stalk exactly from a seed", () => {
    const run = () => stalk(createHuntScopeState("deer", "bow", seededRandom(21)), glued, seededRandom(21));
    expect(run()).toEqual(run());
  });
});

describe("takeMark", () => {
  it("bags the animal once the meter is full", () => {
    const locked = stalk(createHuntScopeState("rabbit", "bow", seededRandom(5)), glued, seededRandom(5));
    expect(locked.phase).toBe("locked");
    expect(takeMark(locked).phase).toBe("bagged");
  });

  it("is a silent no-op before the lock, never a miss that costs the stalk", () => {
    const state = createHuntScopeState("rabbit", "bow", seededRandom(5));
    expect(takeMark(state)).toBe(state);
    expect(takeMark(state).spook).toBe(0);
  });

  it("cannot re-open a stalk that already ended", () => {
    const fled = abandonStalk(createHuntScopeState("rabbit", "bow", seededRandom(5)));
    expect(takeMark(fled)).toBe(fled);
  });
});

describe("a finished stalk", () => {
  it("ignores every later frame, either way it ended", () => {
    const bagged = takeMark(
      stalk(createHuntScopeState("rabbit", "bow", seededRandom(5)), glued, seededRandom(5)),
    );
    expect(stepHuntScope(bagged, FRAME_MS, { x: 0.1, y: 0.1 }, seededRandom(1))).toBe(bagged);

    const fled = abandonStalk(createHuntScopeState("rabbit", "bow", seededRandom(5)));
    expect(fled.phase).toBe("fled");
    expect(stepHuntScope(fled, FRAME_MS, { x: 0.1, y: 0.1 }, seededRandom(1))).toBe(fled);
    expect(abandonStalk(fled)).toBe(fled);
  });
});

describe("rollQuarryDifficulty", () => {
  it("only ever returns a species the profile table covers", () => {
    const random = seededRandom(17);
    for (let i = 0; i < 300; i += 1) {
      expect(QUARRY_PROFILES[rollQuarryDifficulty(random)]).toBeDefined();
    }
  });

  it("reaches every difficulty, including both ends of the range", () => {
    expect(rollQuarryDifficulty(() => 0)).toBe("rabbit");
    expect(rollQuarryDifficulty(() => 0.999)).toBe("boar");
    const seen = new Set(Array.from({ length: 400 }, (_, i) => rollQuarryDifficulty(seededRandom(i))));
    expect(seen.size).toBe(QUARRY_SPECIES.length);
  });
});
