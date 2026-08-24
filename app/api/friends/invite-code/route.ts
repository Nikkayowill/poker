import { NextRequest, NextResponse } from "next/server";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { getOrCreateFriendInviteCode, regenerateFriendInviteCode } from "@/lib/server/friends-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const GUEST_MESSAGE = "Create an account to get an invite code.";

/** The caller's reusable invite code, creating one on first call. */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:invite-code:read", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    return NextResponse.json(await getOrCreateFriendInviteCode(auth.profile.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your invite code.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Replaces the caller's code with a new one -- for a leaked or over-shared
 * link. Regeneration itself needs no body; there is nothing to choose.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:invite-code:regenerate", 10, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    return NextResponse.json(await regenerateFriendInviteCode(auth.profile.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a new invite code.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
