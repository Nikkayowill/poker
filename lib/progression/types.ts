import type { RankProgress } from "./rank";

/**
 * The progression wire contract, shared rather than server-only.
 *
 * lib/server/progression-store.ts carries `import "server-only"`, so the lobby
 * strip cannot import its shapes from there without risking the service-role
 * client in the browser bundle -- a type-only import is erased, but the rule is
 * the convention rather than the mechanism, and one refactor from `import type`
 * to `import` is all it takes. Same reasoning as lib/social/types.ts and
 * lib/game/table-channel.ts: the consumer is the browser, so the definition
 * lives outside lib/server and the store imports it back.
 */

export interface ProgressionSnapshot extends RankProgress {
  /** Gold staked over this profile's lifetime. Never netted against winnings. */
  lifetimeWagered: number;
  /** Consecutive claim days, already zeroed if the streak has lapsed. */
  streak: number;
  /** The UTC day of the last claim (YYYY-MM-DD), or null. */
  lastClaimDay: string | null;
}

/**
 * What the next daily claim is worth, derived server-side.
 *
 * Sent rather than recomputed in the client so the menu and the claim route
 * cannot disagree about the number -- the same reason /api/invites/pending
 * sends `ttlMs` instead of letting the drawer hardcode the window.
 */
export interface DailyClaimPreview {
  baseGrant: number;
  claimedToday: boolean;
  streak: number;
  multiplier: number;
  /** What claiming next would credit, streak multiplier already applied. */
  nextAmount: number;
}

export interface ProgressionPayload {
  progression: ProgressionSnapshot;
  daily: DailyClaimPreview;
}
