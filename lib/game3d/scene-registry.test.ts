import { beforeEach, describe, expect, it } from "vitest";
import {
  publishAnimating,
  publishFlightChips,
  publishFunnel,
  publishPotPileChips,
  readSceneRegistry,
  resetSceneRegistry,
} from "./scene-registry";

beforeEach(() => {
  resetSceneRegistry();
});

describe("the scene registry", () => {
  it("starts empty, so a seam read before the first frame is not a crash", () => {
    expect(readSceneRegistry()).toEqual({
      flightChips: [],
      potPileChips: 0,
      lastFunnel: [],
      animating: false,
    });
  });

  it("reports the room settled once animation stops", () => {
    // `animating` is the seam's `awake()`. It has to fall as well as rise:
    // the falling edge is the whole of the loop-sleeps assertion, and it is
    // the edge a writer that only publishes while busy would never send.
    publishAnimating(true);
    expect(readSceneRegistry().animating).toBe(true);
    publishAnimating(false);
    expect(readSceneRegistry().animating).toBe(false);
  });

  it("keeps `animating` independent of whether chips happen to be listed", () => {
    // These come from different places -- a per-frame pose pass and an
    // effect on the flight count -- and a settled room can still be holding
    // the last frame's poses for one more read. Tying `awake()` to
    // `flightChips.length` instead would make that stale read say the loop
    // is still running.
    publishFlightChips([{ x: 0, y: 1, z: 2 }]);
    publishAnimating(false);
    expect(readSceneRegistry().animating).toBe(false);
    expect(readSceneRegistry().flightChips).toHaveLength(1);
  });

  it("keeps each field independent", () => {
    // The three are written by different layers on different schedules --
    // chips every frame of a flight, the funnel once per payout. A write to
    // one must not blank the others, which is the bug a single mutable
    // object shared by all three writers would have.
    publishFunnel([2, 4]);
    publishPotPileChips(11);
    publishFlightChips([{ x: 1, y: 2, z: 3 }]);

    expect(readSceneRegistry().lastFunnel).toEqual([2, 4]);
    expect(readSceneRegistry().potPileChips).toBe(11);
    expect(readSceneRegistry().flightChips).toHaveLength(1);
  });

  it("replaces the airborne set rather than accumulating it", () => {
    // Called once per rendered frame while anything is flying. Appending
    // would grow without bound and report chips that landed seconds ago.
    publishFlightChips([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }]);
    publishFlightChips([{ x: 9, y: 9, z: 9 }]);
    expect(readSceneRegistry().flightChips).toEqual([{ x: 9, y: 9, z: 9 }]);
  });

  it("reports an emptied set as empty, not as the last non-empty one", () => {
    // The frame every flight settles publishes []. If that were treated as
    // "nothing to report, keep what we had", the seam would show chips
    // hanging in the air forever after the last payout.
    publishFlightChips([{ x: 1, y: 1, z: 1 }]);
    publishFlightChips([]);
    expect(readSceneRegistry().flightChips).toEqual([]);
  });

  it("clears everything on reset", () => {
    // The seam calls this on unmount. A torn-down room whose chips are still
    // readable fails a racing spec by passing, which is the expensive
    // direction.
    publishFlightChips([{ x: 1, y: 2, z: 3 }]);
    publishPotPileChips(5);
    publishFunnel([0]);
    publishAnimating(true);

    resetSceneRegistry();

    expect(readSceneRegistry()).toEqual({
      flightChips: [],
      potPileChips: 0,
      lastFunnel: [],
      animating: false,
    });
  });
});
