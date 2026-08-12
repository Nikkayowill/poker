import { describe, expect, it } from "vitest";
import { CLIP_FADE_S } from "./avatar-state";
import {
  activeClip,
  initialPlayback,
  isGesturing,
  requestBase,
  requestGesture,
  settleGesture,
  tickPlayback,
} from "./avatar-playback";

/** Poker_Bet is 52 frames at 24fps; the longest gesture the bake ships. */
const BET_S = 52 / 24;

describe("activeClip", () => {
  it("always has something to play", () => {
    expect(activeClip(initialPlayback("idle"))).toMatchObject({
      state: "idle",
      once: false,
    });
  });

  it("plays fold and celebrate as held one-shots", () => {
    expect(activeClip(initialPlayback("fold")).once).toBe(true);
    expect(activeClip(initialPlayback("celebrate")).once).toBe(true);
    expect(activeClip(initialPlayback("thinking")).once).toBe(false);
  });

  it("prefers a running gesture over the base, as a one-shot", () => {
    const state = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    expect(activeClip(state)).toMatchObject({ state: "bet", once: true });
  });
});

describe("requestBase", () => {
  it("is a no-op for the base it already holds, gesture intact", () => {
    // The re-render case. An effect that re-runs for a reason unrelated to
    // the server must not take a half-played gesture off the figure.
    const playing = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const again = requestBase(playing, "idle");
    expect(again).toBe(playing);
    expect(isGesturing(again)).toBe(true);
  });

  it("cancels a running gesture when the base genuinely changes", () => {
    const playing = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const folded = requestBase(playing, "fold");
    expect(isGesturing(folded)).toBe(false);
    expect(activeClip(folded)).toMatchObject({ state: "fold", once: true });
  });
});

describe("requestGesture", () => {
  it("refuses to interrupt a base that holds the figure", () => {
    for (const base of ["fold", "celebrate"] as const) {
      const held = initialPlayback(base);
      expect(requestGesture(held, "bet", BET_S, 10)).toBe(held);
    }
  });

  it("sets the hand-back a fade early so the return overlaps the tail", () => {
    const state = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    expect(state.gestureEndsAt).toBeCloseTo(10 + BET_S - CLIP_FADE_S, 6);
  });

  it("never sets a deadline in the past for a clip shorter than the fade", () => {
    const state = requestGesture(initialPlayback("idle"), "check", 0.1, 10);
    expect(state.gestureEndsAt).toBe(10);
  });

  it("replaces a running gesture and takes a fresh epoch", () => {
    const first = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const second = requestGesture(first, "raise", BET_S, 10.2);
    expect(second.epoch).toBeGreaterThan(first.epoch);
    expect(activeClip(second).state).toBe("raise");
  });
});

describe("epoch guarding", () => {
  it("ignores a finished signal from a superseded gesture", () => {
    // The rapid-fire case: bet is replaced by raise, then bet's own
    // `finished` arrives late. It must not strip the raise off the figure.
    const bet = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const raise = requestGesture(bet, "raise", BET_S, 10.2);
    const stale = settleGesture(raise, bet.epoch);
    expect(stale).toBe(raise);
    expect(activeClip(stale).state).toBe("raise");
  });

  it("ignores a finished signal once the base has already taken over", () => {
    const bet = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const folded = requestBase(bet, "fold");
    expect(settleGesture(folded, bet.epoch)).toBe(folded);
    expect(activeClip(folded).state).toBe("fold");
  });

  it("retires the gesture it was actually issued for", () => {
    const bet = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const done = settleGesture(bet, bet.epoch);
    expect(isGesturing(done)).toBe(false);
    expect(activeClip(done).state).toBe("idle");
  });

  it("is idempotent — a second finished signal changes nothing", () => {
    const bet = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const done = settleGesture(bet, bet.epoch);
    expect(settleGesture(done, bet.epoch)).toBe(done);
  });
});

describe("tickPlayback", () => {
  it("leaves a gesture alone before its deadline", () => {
    const bet = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const ticked = tickPlayback(bet, bet.gestureEndsAt - 0.001);
    expect(ticked).toBe(bet);
  });

  it("hands the figure back at the deadline", () => {
    const bet = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const ticked = tickPlayback(bet, bet.gestureEndsAt);
    expect(isGesturing(ticked)).toBe(false);
    expect(activeClip(ticked).state).toBe("idle");
  });

  it("is a no-op when no gesture is running", () => {
    const idle = initialPlayback("idle");
    expect(tickPlayback(idle, 1e6)).toBe(idle);
  });

  it("recovers a gesture whose finished signal never arrives", () => {
    // The freeze this module was written for: the restore is lost, no event
    // is delivered, and the base is unchanged so nothing else re-runs. One
    // frame past the deadline must be enough to put the figure back.
    const bet = requestGesture(initialPlayback("idle"), "bet", BET_S, 10);
    const recovered = tickPlayback(bet, 10 + BET_S);
    expect(activeClip(recovered)).toMatchObject({ state: "idle", once: false });
  });
});

describe("rapid-fire sequences", () => {
  it("converges on the last request, whatever the order", () => {
    // Six transitions inside one clip's length — heavier than any real
    // packet burst — must still leave exactly one thing on the figure.
    let state = initialPlayback("idle");
    state = requestGesture(state, "bet", BET_S, 10);
    state = requestGesture(state, "check", BET_S, 10.05);
    state = requestBase(state, "thinking");
    state = requestGesture(state, "raise", BET_S, 10.1);
    state = settleGesture(state, 0); // stale, from the very first gesture
    state = requestGesture(state, "bet", BET_S, 10.15);

    expect(activeClip(state)).toMatchObject({ state: "bet", once: true });
    // And it is still a gesture over `thinking`, not over the stale `idle`.
    expect(state.base).toBe("thinking");
    expect(activeClip(tickPlayback(state, 1e6)).state).toBe("thinking");
  });

  it("cannot be left with a gesture once every deadline has passed", () => {
    // Whatever sequence ran, one tick far past every deadline is a total
    // reset to the sustained state. This is the deterministic-recovery
    // guarantee the whole machine exists to provide.
    let state = initialPlayback("idle");
    for (let i = 0; i < 50; i += 1) {
      state = requestGesture(state, i % 2 ? "bet" : "raise", BET_S, 10 + i * 0.01);
      if (i % 7 === 0) state = requestBase(state, i % 14 ? "thinking" : "idle");
      if (i % 5 === 0) state = settleGesture(state, i);
    }
    const settled = tickPlayback(state, 1e6);
    expect(isGesturing(settled)).toBe(false);
    expect(activeClip(settled).once).toBe(false);
  });

  it("gives every committed change a distinct epoch", () => {
    const seen = new Set<number>();
    let state = initialPlayback("idle");
    seen.add(state.epoch);
    for (let i = 0; i < 20; i += 1) {
      state = requestGesture(state, "bet", BET_S, 10 + i);
      seen.add(state.epoch);
      state = settleGesture(state, state.epoch);
      seen.add(state.epoch);
    }
    expect(seen.size).toBe(41);
  });
});
