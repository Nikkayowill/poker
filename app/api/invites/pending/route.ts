import { NextRequest, NextResponse } from "next/server";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getPendingTableInvites, TABLE_INVITE_TTL_MS } from "@/lib/server/table-invite-store";

export const runtime = "nodejs";

/**
 * Invites the caller can still act on.
 *
 * This is the polled endpoint, so the limit is sized for polling rather than
 * for a drawer opening: 120/minute leaves a client on a ten-second interval
 * two orders of magnitude of headroom across every tab a player has open, and
 * still stops a script from using it as a heartbeat.
 */
const POLL_LIMIT_PER_MINUTE = 120;

const GUEST_MESSAGE = "Create an account to get table invites.";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "invites:pending", POLL_LIMIT_PER_MINUTE, 60 * 1000);
  if (limited) return limited;

  try {
    // Registered-only, matching /api/friends and /api/history. An invite is
    // addressed to a profile id, and a guest's profile lives and dies with a
    // cookie -- there is nothing durable to address.
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    const invites = await getPendingTableInvites(auth.profile.id);

    // ttlMs lets the client render a countdown without hardcoding the window;
    // it is a display hint. Freshness is decided by the store's filter on each
    // row's own expires_at, so a client that ignores or fakes this learns
    // nothing and gets nothing extra on the next poll.
    return NextResponse.json({ invites, ttlMs: TABLE_INVITE_TTL_MS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your invites.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
