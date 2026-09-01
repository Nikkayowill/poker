import { NextRequest, NextResponse } from "next/server";
import { exchangeState } from "@/lib/homestead/exchange";
import { toHomesteadPlotSnapshots } from "@/lib/homestead/plots";
import { readHomestead, toHomesteadErrorResponse } from "@/lib/server/homestead-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { homesteadLocked, requestHasHomesteadPass } from "@/lib/server/homestead-access";
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
 * On the floor but not open: only a caller carrying the access-code pass gets
 * past this, and everyone else gets a 401 that names the reason so the client
 * can show the code prompt. See lib/server/homestead-access.ts.
 *
 * The limiter still runs first. The pass check is now a cheap HMAC rather
 * than the database read the account allowlist needed, so the ordering costs
 * nothing either way -- but the rule it came from stands: never put work in
 * front of the limiter.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "homestead:read", 120, 60 * 1000);
  if (limited) return limited;

  if (!requestHasHomesteadPass(request)) return homesteadLocked();

  const token = readSessionToken(request);
  if (!token) {
    const now = new Date();
    return NextResponse.json({
      plots: toHomesteadPlotSnapshots([], now),
      profile: null,
      feed: 0,
      inventory: {},
      bushels: 0,
      // The window's terms are the same for everybody, which is the point of
      // it, so a visitor with no account still sees the real rate and ceiling.
      exchange: exchangeState(0, now),
    });
  }
  try {
    return NextResponse.json(await readHomestead(token));
  } catch (error) {
    return toHomesteadErrorResponse(error);
  }
}
