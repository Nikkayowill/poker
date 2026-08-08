/**
 * Avatar animation-clip selection and head-tracking limits. Pure, so the
 * fuzzy clip matching — the part most likely to silently break against an
 * arbitrary .glb — is pinned by unit tests instead of discovered on a
 * device.
 */

import type { AvatarMood } from "./scene-model";

/** Transient states layered over the sustained moods by the scene. */
export type AvatarAnimationState = AvatarMood | "toss";

/**
 * External GLBs (Ready Player Me, Mixamo re-exports…) name their clips
 * however they like; match by intent, not by exact name.
 */
const CLIP_PATTERNS: Record<AvatarAnimationState, RegExp> = {
  idle: /idle|breath|stand/i,
  thinking: /think|anxious|worri|nervous|ponder/i,
  toss: /toss|throw|bet|chip|interact/i,
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

/** How long a toss transient holds before the mood resumes, in ms. */
export const TOSS_HOLD_MS = 900;

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
 * Resolve the state an avatar should be in: a live toss transient beats the
 * sustained mood, except celebration, which always wins — a winner mid-toss
 * should celebrate, not finish miming a bet.
 */
export function resolveAnimationState(
  mood: AvatarMood,
  tossStartedAt: number | null,
  nowMs: number
): AvatarAnimationState {
  if (mood === "celebrate") return "celebrate";
  if (tossStartedAt !== null && nowMs - tossStartedAt < TOSS_HOLD_MS) return "toss";
  return mood;
}
