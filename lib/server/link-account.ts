import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureProfile, findSessionByUserId, linkProfileToUser } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";
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
 */
export async function linkAuthenticatedUser(
  userId: string,
  request: NextRequest,
): Promise<{ profile: PlayerProfile; restored: boolean; token: string }> {
  const existing = await findSessionByUserId(userId);
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
