import { NextRequest, NextResponse } from "next/server";
import { readHomestead, toHomesteadErrorResponse } from "@/lib/server/homestead-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { homesteadLocked, tokenHasHomesteadAccess } from "@/lib/server/homestead-access";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The Homestead's read side: the caller's whole plot grid, their profile, and
 * their feed. Progress is derived client-side from the timestamps this
 * returns, so the client only ever calls this on mount and on tab-return,
 * never on a poll -- the limit is sized for that.
 *
 * Read-only, so it must never mint a session (session-minting.test.ts's
 * rule).
 *
 * On the floor but not open: only a profile an admin has let in gets past
 * this, and everyone else gets a 401 that names the reason so the client can
 * show the "ask for access" screen. See lib/server/homestead-access.ts.
 *
 * The limiter runs FIRST, and that ordering is load-bearing again: the gate
 * costs a database read, so putting it in front of the limiter would hand an
 * unauthenticated flood a query amplifier.
 *
 * The gate needs a session token to know whose farm this is, which also means
 * a caller with no cookie is simply not on the list -- there is no tokenless
 * preview of the farm any more, because there is nobody a grant could have
 * been made to.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "homestead:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasHomesteadAccess(token))) return homesteadLocked();

  try {
    return NextResponse.json(await readHomestead(token));
  } catch (error) {
    return toHomesteadErrorResponse(error);
  }
}
