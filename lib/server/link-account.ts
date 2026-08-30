import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureProfile,
  findProfileBySessionToken,
  findSessionByUserId,
  linkProfileToUser,
} from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { readOrCreateSessionToken, readSessionToken, withRequestSessionCookie } from "@/lib/server/session";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Turns an authenticated Supabase user into a StackChips profile.
 *
 * Shared by the OAuth callback route handler and the email/password link
 * route: both already know the caller is who they say they are (the
 * callback via a just-completed code exchange, the link route via
 * getUser() reading the session cookie), so this only has to decide what to
 * do with that identity. Two outcomes, both ending with the response
 * carrying a session cookie for the right profile:
 *   - the account already owns a profile -> restore it (a returning player
 *     on a new device, or one whose cookie was cleared)
 *   - it doesn't -> link the profile this browser is already using, so a
 *     guest keeps the Gold and avatar they just earned
 *
 * The restore branch discards whatever this browser was using instead, which
 * is fine for an empty/never-played cookie but not for a guest mid-run --
 * see `findRestoreConflict` below, which callers check first and route to a
 * player confirmation instead of calling this silently.
 *
 * `existingSession`, when passed, is a session findRestoreConflict already
 * looked up for the same userId -- reused rather than re-fetched, since the
 * OAuth callback route calls both back to back. Any other caller (the
 * email/password link route, the password-reset callback) omits it and this
 * looks the session up itself, unchanged.
 */
export async function linkAuthenticatedUser(
  userId: string,
  request: NextRequest,
  existingSession?: { token: string; profile: PlayerProfile } | null,
): Promise<{ profile: PlayerProfile; restored: boolean; token: string }> {
  const existing = existingSession !== undefined ? existingSession : await findSessionByUserId(userId);
  if (existing) {
    // Merging balances across sessions is exactly the mechanic that makes
    // multi-accounting pay, so any Gold on the guest profile this browser
    // was using is deliberately left behind rather than merged in.
    return { profile: existing.profile, restored: true, token: existing.token };
  }

  const token = readOrCreateSessionToken(request);
  await ensureProfile(token);
  const profile = await linkProfileToUser(token, userId);
  return { profile, restored: false, token };
}

/**
 * Whether finishing this sign-in would silently throw away guest progress
 * this browser is already holding.
 *
 * True only when the Google identity already owns a *different* profile
 * (linkAuthenticatedUser's "restore" branch above) AND this browser is
 * currently playing as its own unregistered guest -- something with
 * balance/collection actually at risk. A brand-new cookie with no profile
 * yet, or a browser that's already this same registered account, has
 * nothing to lose, so those fall through to the ordinary silent link.
 *
 * Read-only on purpose: `readSessionToken` (not `readOrCreateSessionToken`)
 * never mints a cookie for a caller only asking to look, and this runs
 * before the caller has decided whether to commit to linking at all.
 *
 * Returns the session it looked up alongside the verdict, so a caller that
 * goes on to call `linkAuthenticatedUser` on the non-conflict path can hand
 * it straight through instead of triggering a second identical lookup.
 */
export async function findRestoreConflict(
  userId: string,
  request: NextRequest,
): Promise<{ hasConflict: boolean; existing: { token: string; profile: PlayerProfile } | null }> {
  const existing = await findSessionByUserId(userId);
  if (!existing) return { hasConflict: false, existing: null };

  const currentToken = readSessionToken(request);
  if (!currentToken) return { hasConflict: false, existing };

  const currentProfile = await findProfileBySessionToken(currentToken);
  const hasConflict = Boolean(currentProfile && !currentProfile.isRegistered);
  return { hasConflict, existing };
}

export function linkResultResponse(
  request: NextRequest,
  result: { profile: PlayerProfile; restored: boolean; token: string },
): NextResponse {
  return withRequestSessionCookie(request,
    NextResponse.json({
      profile: result.profile,
      restored: result.restored,
      persistence: persistenceMode(),
    }),
    result.token,
  );
}
