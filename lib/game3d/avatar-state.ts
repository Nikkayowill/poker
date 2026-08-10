/**
 * Avatar animation-clip selection and head-tracking limits. Pure, so the
 * fuzzy clip matching — the part most likely to silently break against an
 * arbitrary .glb — is pinned by unit tests instead of discovered on a
 * device.
 */

import type { AvatarMood, SeatModel } from "./scene-model";

/** Transient states layered over the sustained moods by the scene. */
export type AvatarAnimationState =
  | AvatarMood
  | "fold"
  | "check"
  | "bet"
  | "raise";

/**
 * External GLBs (Ready Player Me, Mixamo re-exports…) name their clips
 * however they like; match by intent, not by exact name.
 */
const CLIP_PATTERNS: Record<AvatarAnimationState, RegExp> = {
  idle: /idle|breath|stand/i,
  thinking: /think|anxious|worri|nervous|ponder/i,
  fold: /fold|muck/i,
  check: /check|tap/i,
  bet: /toss|throw|bet|call|chip|interact/i,
  raise: /raise|all.?in/i,
  celebrate: /celebrat|win|dance|clap|cheer|victory/i,
};

/**
 * Pick the clip to play for a state from the clip names a model actually
 * ships. Falls back to the idle match, then the first clip, then null (a
 * clipless model animates procedurally instead).
 */
export function clipForState(
  clipNames: string[],
  state: AvatarAnimationState
): string | null {
  const direct = clipNames.find((name) => CLIP_PATTERNS[state].test(name));
  if (direct) return direct;
  const idle = clipNames.find((name) => CLIP_PATTERNS.idle.test(name));
  if (idle) return idle;
  return clipNames[0] ?? null;
}

/** Cross-fade time between animation states, in seconds. */
export const CLIP_FADE_S = 0.35;

/** How long a poker-action transient holds before the mood resumes, in ms. */
export const ACTION_HOLD_MS = 2_400;

/** A head only turns so far before the body would follow. */
export const HEAD_YAW_LIMIT = 0.65;
export const HEAD_PITCH_LIMIT = 0.25;

export function clampHeadYaw(yaw: number): number {
  return Math.min(HEAD_YAW_LIMIT, Math.max(-HEAD_YAW_LIMIT, yaw));
}

export function clampHeadPitch(pitch: number): number {
  return Math.min(HEAD_PITCH_LIMIT, Math.max(-HEAD_PITCH_LIMIT, pitch));
}

/**
 * Resolve the state an avatar should be in: a live action transient beats the
 * sustained mood, except celebration, which always wins — a winner mid-toss
 * should celebrate, not finish miming a bet.
 */
export function resolveAnimationState(
  mood: AvatarMood,
  actionStartedAt: number | null,
  nowMs: number
): AvatarAnimationState {
  if (mood === "celebrate") return "celebrate";
  if (actionStartedAt !== null && nowMs - actionStartedAt < ACTION_HOLD_MS) return "bet";
  return mood;
}

/** Folded/out seats hold the fold clip's final frame; winners always celebrate. */
export function baseAnimationState(
  mood: AvatarMood,
  status: SeatModel["status"],
): AvatarAnimationState {
  if (mood === "celebrate") return "celebrate";
  if (status === "folded" || status === "out") return "fold";
  return mood;
}

/** Map the server-authored action label to one of the reusable GLB gestures. */
export function transientAnimationState(lastAction: string | null): AvatarAnimationState | null {
  if (!lastAction) return null;
  if (/check/i.test(lastAction)) return "check";
  if (/raise|all.?in/i.test(lastAction)) return "raise";
  if (/bet|call/i.test(lastAction)) return "bet";
  return null;
}
