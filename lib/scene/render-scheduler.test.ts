import { describe, expect, it } from "vitest";
import {
  afterFrame,
  clampDelta,
  IDLE_LINGER_MS,
  isAwake,
  markDirty,
  MAX_FRAME_DELTA_MS,
  SLEEPING,
} from "./render-scheduler";

describe("render scheduler", () => {
  it("starts asleep, so an idle table never draws a frame", () => {
    expect(isAwake(SLEEPING)).toBe(false);
  });

  it("wakes on anything that changes the picture", () => {
    expect(isAwake(markDirty(SLEEPING, 1_000))).toBe(true);
  });

  it("keeps drawing while anything is still moving", () => {
    let state = markDirty(SLEEPING, 0);
    // Far past the linger: motion on every frame must hold it awake anyway,
    // or a long pot funnel would put itself to sleep mid-flight.
    for (let now = 16; now < 5_000; now += 16) {
      state = afterFrame(state, now, true);
      expect(isAwake(state)).toBe(true);
    }
  });

  it("sleeps once the table has been still for the linger", () => {
    let state = markDirty(SLEEPING, 0);
    state = afterFrame(state, 16, false);
    // Still awake: the linger exists because a friction slide reports arrival
    // a frame or two before it is visually at rest, and a fade needs a frame
    // after its last update to present.
    expect(isAwake(state)).toBe(true);
    state = afterFrame(state, IDLE_LINGER_MS - 1, false);
    expect(isAwake(state)).toBe(true);
    state = afterFrame(state, IDLE_LINGER_MS, false);
    expect(isAwake(state)).toBe(false);
  });

  it("restarts the linger when something moves again", () => {
    let state = markDirty(SLEEPING, 0);
    state = afterFrame(state, 300, false);
    state = afterFrame(state, 320, true);
    state = afterFrame(state, 320 + IDLE_LINGER_MS - 1, false);
    expect(isAwake(state)).toBe(true);
    state = afterFrame(state, 320 + IDLE_LINGER_MS, false);
    expect(isAwake(state)).toBe(false);
  });

  it("is idempotent, so callers never have to ask whether it is running", () => {
    const first = markDirty(SLEEPING, 500);
    expect(markDirty(first, 500)).toBe(first);
    // A later dirty is a real change and pushes the linger back.
    expect(markDirty(first, 900).lastMotionMs).toBe(900);
  });

  it("does not wake itself by finishing a frame while asleep", () => {
    expect(afterFrame(SLEEPING, 1_000, false)).toBe(SLEEPING);
  });

  /**
   * The frame after a tab is restored, or a phone unlocked, carries a delta
   * of anything up to minutes. Handed to a slide that closes a fraction of
   * the remaining gap per elapsed frame, that one delta closes all of it and
   * every chip in the room teleports onto its target.
   */
  it("clamps a stalled tab's first delta instead of teleporting everything", () => {
    expect(clampDelta(400_000)).toBe(MAX_FRAME_DELTA_MS);
    expect(clampDelta(16)).toBe(16);
    expect(clampDelta(0)).toBe(0);
    expect(clampDelta(-5)).toBe(0);
    expect(clampDelta(Number.NaN)).toBe(0);
  });
});
