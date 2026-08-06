import { describe, expect, it } from "vitest";
import {
  HEAD_PITCH_LIMIT,
  HEAD_YAW_LIMIT,
  TOSS_HOLD_MS,
  clampHeadPitch,
  clampHeadYaw,
  clipForState,
  resolveAnimationState,
} from "./avatar-state";

describe("clipForState", () => {
  const READY_PLAYER_ME_LIKE = ["Idle_Breathing", "Nervous_Look", "Chip_Throw", "Victory_Dance"];

  it("matches each state to its clip by intent, not exact name", () => {
    expect(clipForState(READY_PLAYER_ME_LIKE, "idle")).toBe("Idle_Breathing");
    expect(clipForState(READY_PLAYER_ME_LIKE, "thinking")).toBe("Nervous_Look");
    expect(clipForState(READY_PLAYER_ME_LIKE, "toss")).toBe("Chip_Throw");
    expect(clipForState(READY_PLAYER_ME_LIKE, "celebrate")).toBe("Victory_Dance");
  });

  it("falls back to the idle clip when a state has no match", () => {
    expect(clipForState(["Breathing", "Walk"], "celebrate")).toBe("Breathing");
  });

  it("falls back to the first clip when nothing matches at all", () => {
    expect(clipForState(["Mixamo_Layer_0"], "toss")).toBe("Mixamo_Layer_0");
  });

  it("returns null for a clipless model, which animates procedurally", () => {
    expect(clipForState([], "idle")).toBeNull();
  });
});

describe("resolveAnimationState", () => {
  it("lets a fresh toss transient override idle and thinking", () => {
    expect(resolveAnimationState("idle", 1000, 1400)).toBe("toss");
    expect(resolveAnimationState("thinking", 1000, 1400)).toBe("toss");
  });

  it("expires the toss after its hold window", () => {
    expect(resolveAnimationState("idle", 1000, 1000 + TOSS_HOLD_MS)).toBe("idle");
  });

  it("celebration always wins, even mid-toss", () => {
    expect(resolveAnimationState("celebrate", 1000, 1100)).toBe("celebrate");
  });

  it("passes the mood through with no toss on record", () => {
    expect(resolveAnimationState("thinking", null, 5000)).toBe("thinking");
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
