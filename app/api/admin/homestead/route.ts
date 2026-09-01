import { NextRequest, NextResponse } from "next/server";
import { toHomesteadPlotSnapshots } from "@/lib/homestead/plots";
import { readHomestead, toHomesteadErrorResponse } from "@/lib/server/homestead-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { isStaffRequest, staffOnlyNotFound } from "@/lib/server/staff-gate";

export const runtime = "nodejs";

/**
 * The Homestead's read side: the caller's whole plot grid, their profile, and
 * their feed. Progress is derived client-side from the timestamps this
 * returns, so the client only ever calls this on mount and on tab-return,
 * never on a poll -- the limit is sized for that.
 *
 * Read-only, so it must never mint a session (session-minting.test.ts's
 * rule): a caller with no cookie sees the pristine farm -- four free plots, a
 * locked ladder -- and their first stocking is what creates their identity,
 * through the actions route.
 */
export async function GET(request: NextRequest) {
  // Not offered publicly yet: staff session or nothing. Checked before the
  // rate limiter so an anonymous caller cannot even measure the limit.
  if (!isStaffRequest(request)) return staffOnlyNotFound();

  const limited = enforceRateLimit(request, "homestead:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token) {
    return NextResponse.json({
      plots: toHomesteadPlotSnapshots([], new Date()),
      profile: null,
      feed: 0,
    });
  }
  try {
    return NextResponse.json(await readHomestead(token));
  } catch (error) {
    return toHomesteadErrorResponse(error);
  }
}
