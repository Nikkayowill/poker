import { NextRequest, NextResponse } from "next/server";
import { toHomesteadPlotSnapshots } from "@/lib/homestead/plots";
import { readHomestead, toHomesteadErrorResponse } from "@/lib/server/homestead-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

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
 *
 * Open to any caller. The Homestead was briefly behind an admin session while
 * it was unreleased; that is gone, and its `unlisted` catalog status is now
 * the only thing keeping it off the arcade floor.
 */
export async function GET(request: NextRequest) {
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
