import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { PlayerProfile } from "@/lib/profile/types";
import { ensureProfile } from "./profile-store";
import { readSessionToken } from "./session";

/**
 * Resolves the caller to a registered profile, or to the response to send.
 *
 * The 401/403 split here matches app/api/history/route.ts, which established
 * it: no session at all is "sign in", a guest session is "create an account".
 * They are different problems with different buttons, and collapsing them
 * would leave a guest staring at a sign-in prompt they are already past.
 *
 * Extracted because the friends routes repeat it five times and drift is the
 * failure mode that matters -- one route that forgets `isRegistered` is a
 * guest quietly writing rows keyed to a profile their cookie may outlive.
 */
export async function requireRegisteredProfile(
  request: NextRequest,
  guestMessage: string,
  /** Overrides the 401 copy where a route has its own wording worth keeping. */
  signedOutMessage = "Sign in to continue.",
): Promise<{ profile: PlayerProfile; response?: never } | { profile?: never; response: NextResponse }> {
  const token = readSessionToken(request);
  if (!token) {
    return { response: NextResponse.json({ error: signedOutMessage }, { status: 401 }) };
  }

  const profile = await ensureProfile(token);
  if (!profile.isRegistered) {
    return { response: NextResponse.json({ error: guestMessage }, { status: 403 }) };
  }
  return { profile };
}
