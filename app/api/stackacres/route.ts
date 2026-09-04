import { NextRequest, NextResponse } from "next/server";
import { readStackAcres, toStackAcresErrorResponse } from "@/lib/server/stackacres-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The StackAcres's read side: every unit the caller owns, their profile, and
 * their feed/capacity/inventory. Progress is derived client-side from the
 * timestamps this returns, so the client only ever calls this on mount and on
 * tab-return, never on a poll -- the limit is sized for that.
 *
 * Read-only, so it must never mint a session (session-minting.test.ts's
 * rule).
 *
 * On the floor but not open: only a profile an admin has let in gets past
 * this, and everyone else gets a 401 that names the reason so the client can
 * show the "ask for access" screen. See lib/server/stackacres-access.ts.
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
  const limited = enforceRateLimit(request, "stackacres:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  try {
    return NextResponse.json(await readStackAcres(token));
  } catch (error) {
    return toStackAcresErrorResponse(error);
  }
}
