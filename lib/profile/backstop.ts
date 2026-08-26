import type { PlayerProfile } from "./types";

/**
 * Who may claim the broke-player recovery top-up, and when.
 *
 * Same split as lib/profile/daily-gold.ts: lib/server/profile-store.ts's
 * claimBackstopGold is the authority and re-checks the same cooldown before
 * crediting anything (it imports BACKSTOP_COOLDOWN_MS from here rather than
 * defining its own copy). What lives here is the display half, so the
 * lobby's "Claim a top-up" banner can agree with the server about when the
 * offer is real.
 *
 * Before this file existed, the banner (components/lobby/lobby.tsx's
 * `needsTopUp`) had no display half at all: it keyed off goldBalance alone,
 * because `lastBackstopAt` was never even part of the client-facing
 * PlayerProfile the server sent down. A player who topped up and then busted
 * back below the threshold within the cooldown saw the banner reappear and a
 * "you've already had a top-up recently" error on the very button it showed
 * them, with no way for the client to have known better.
 *
 * In lib/ rather than beside the component for the reason daily-gold.ts is:
 * vitest.config.ts collects only lib/ and app/, so a predicate written next
 * to the banner would be untestable.
 */

/**
 * The broke-player recovery grant. Kept small, exactly one seat at the
 * cheapest table rather than a farmable income, because a player who cannot
 * afford the cheapest seat has no way back into the game, and a stranded
 * player is a lost one. lib/server/profile-store.ts imports this rather than
 * defining its own.
 */
export const BACKSTOP_GRANT = 1000;

/** How long after a top-up before another is offered. lib/server/profile-store.ts imports this rather than defining its own. */
export const BACKSTOP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/**
 * - `ready`: below the threshold and the cooldown has passed; offer the top-up.
 * - `cooldown`: below the threshold, but already claimed within BACKSTOP_COOLDOWN_MS.
 * - `not-needed`: balance already covers the threshold.
 * - `unlimited`: crediting a profile that is never charged means nothing.
 */
export type BackstopState = "ready" | "cooldown" | "not-needed" | "unlimited";

export function backstopState(
  profile: PlayerProfile | null,
  now: Date,
  threshold: number,
): BackstopState | null {
  if (!profile) return null;
  if (profile.unlimitedGold) return "unlimited";
  if (profile.goldBalance >= threshold) return "not-needed";
  if (profile.lastBackstopAt && now.getTime() - Date.parse(profile.lastBackstopAt) < BACKSTOP_COOLDOWN_MS) {
    return "cooldown";
  }
  return "ready";
}
