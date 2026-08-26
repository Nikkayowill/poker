import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureProfile, isBanned, recordSeenIp, updateProfile } from "./profile-store";
import { getClientIp } from "./rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "./session";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * The shared "who is this and can they play" resolution every table-entry
 * route (host, join, quick-play) needs before it can touch Gold or a seat:
 * resolve or create the profile, apply a chosen display name, refuse a
 * banned account, and log the IP for abuse tracking. This used to be
 * copy-pasted near-verbatim across all three routes -- a route that forgot
 * the ban check would be a real money-safety gap, not just duplicated noise.
 *
 * Returns the resolved token/profile to continue with, or a NextResponse to
 * return immediately (the banned case, already cookie-stamped so the caller
 * doesn't have to remember to stamp it again).
 */
export async function resolvePlayerForTableEntry(
  request: NextRequest,
  name: string | undefined,
): Promise<{ token: string; profile: PlayerProfile } | NextResponse> {
  const token = readOrCreateSessionToken(request);
  let profile = await ensureProfile(token, name);
  if (name && name !== profile.displayName) {
    profile = await updateProfile(token, {
      displayName: name,
      avatarPreset: profile.avatarPreset,
      accent: profile.accent,
    });
  }
  if (await isBanned(token)) {
    return withRequestSessionCookie(request,
      NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
      token,
    );
  }
  void recordSeenIp(token, getClientIp(request)).catch(() => {});
  return { token, profile };
}
