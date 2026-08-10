import { describe, expect, it } from "vitest";
import {
  ACTION_HOLD_MS,
  HEAD_PITCH_LIMIT,
  HEAD_YAW_LIMIT,
  baseAnimationState,
  clampHeadPitch,
  clampHeadYaw,
  clipForState,
  resolveAnimationState,
  transientAnimationState,
} from "./avatar-state";

describe("clipForState", () => {
  const READY_PLAYER_ME_LIKE = ["Idle_Breathing", "Nervous_Look", "Chip_Throw", "Victory_Dance"];

  it("matches each state to its clip by intent, not exact name", () => {
    expect(clipForState(READY_PLAYER_ME_LIKE, "idle")).toBe("Idle_Breathing");
    expect(clipForState(READY_PLAYER_ME_LIKE, "thinking")).toBe("Nervous_Look");
    expect(clipForState(READY_PLAYER_ME_LIKE, "bet")).toBe("Chip_Throw");
    expect(clipForState(READY_PLAYER_ME_LIKE, "celebrate")).toBe("Victory_Dance");
  });

  it("falls back to the idle clip when a state has no match", () => {
    expect(clipForState(["Breathing", "Walk"], "celebrate")).toBe("Breathing");
  });

  it("falls back to the first clip when nothing matches at all", () => {
    expect(clipForState(["Mixamo_Layer_0"], "bet")).toBe("Mixamo_Layer_0");
  });

  it("returns null for a clipless model, which animates procedurally", () => {
    expect(clipForState([], "idle")).toBeNull();
  });
});

describe("resolveAnimationState", () => {
  it("lets a fresh action transient override idle and thinking", () => {
    expect(resolveAnimationState("idle", 1000, 1400)).toBe("bet");
    expect(resolveAnimationState("thinking", 1000, 1400)).toBe("bet");
  });

  it("expires the toss after its hold window", () => {
    expect(resolveAnimationState("idle", 1000, 1000 + ACTION_HOLD_MS)).toBe("idle");
  });

  it("celebration always wins, even mid-toss", () => {
    expect(resolveAnimationState("celebrate", 1000, 1100)).toBe("celebrate");
  });

  it("passes the mood through with no toss on record", () => {
    expect(resolveAnimationState("thinking", null, 5000)).toBe("thinking");
  });
});

describe("poker action states", () => {
  it("matches every authored StackChips clip by intent", () => {
    const clips = [
      "Poker_Idle",
      "Poker_Thinking",
      "Poker_Fold",
      "Poker_Check",
      "Poker_Bet",
      "Poker_Raise",
      "Poker_Celebrate",
    ];
    for (const state of ["idle", "thinking", "fold", "check", "bet", "raise", "celebrate"] as const) {
      expect(clipForState(clips, state)).toBe(`Poker_${state[0].toUpperCase()}${state.slice(1)}`);
    }
  });

  it("holds folded and out seats in their fold pose unless they won", () => {
    expect(baseAnimationState("idle", "folded")).toBe("fold");
    expect(baseAnimationState("idle", "out")).toBe("fold");
    expect(baseAnimationState("celebrate", "folded")).toBe("celebrate");
  });

  it("maps server action labels to reusable clips", () => {
    expect(transientAnimationState("Check")).toBe("check");
    expect(transientAnimationState("Timed out · Check")).toBe("check");
    expect(transientAnimationState("Call · 20")).toBe("bet");
    expect(transientAnimationState("Bet · 40")).toBe("bet");
    expect(transientAnimationState("Raise to · 120")).toBe("raise");
    expect(transientAnimationState("All-in · 500")).toBe("raise");
    expect(transientAnimationState("Small blind · 5")).toBeNull();
  });
});

describe("head clamps", () => {
  it("limits yaw and pitch symmetrically", () => {
    expect(clampHeadYaw(2)).toBe(HEAD_YAW_LIMIT);
    expect(clampHeadYaw(-2)).toBe(-HEAD_YAW_LIMIT);
    expect(clampHeadPitch(1)).toBe(HEAD_PITCH_LIMIT);
    expect(clampHeadPitch(-1)).toBe(-HEAD_PITCH_LIMIT);
    expect(clampHeadYaw(0.1)).toBe(0.1);
  });
});
