import { NextRequest, NextResponse } from "next/server";
import { toHomesteadPlotSnapshots } from "@/lib/homestead/plots";
import { readHomestead, toHomesteadErrorResponse } from "@/lib/server/homestead-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { homesteadNotFound, isHomesteadAllowed } from "@/lib/server/homestead-access";
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
 * On production but not released: only an account on
 * HOMESTEAD_ALLOWED_USER_IDS gets past this, and everyone else gets a 404.
 *
 * The rate limiter runs BEFORE that check, which is the opposite order the
 * admin gate this replaced used. That gate was a cookie signature check and
 * cost nothing, so it was worth running first to keep an anonymous caller
 * from even measuring the limit. This one costs a database read, so gating
 * ahead of the limiter would hand an unauthenticated flood a query
 * amplifier -- the cheap in-memory check has to come first.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "homestead:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!(await isHomesteadAllowed(token))) return homesteadNotFound();
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
