import { NextRequest, NextResponse } from "next/server";
import { persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { toArcadeErrorResponse } from "@/lib/server/arcade-request";
import { cancelRewardedAd, startRewardedAd } from "@/lib/server/rewarded-ad-service";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Starts a rewarded ad: issues the grant the later claim is measured against.
 *
 * Parse, authorise, respond -- every rule lives in lib/server/rewarded-ad-
 * service.ts, which is where `npm test` can reach it (vitest.config.ts collects
 * lib/ and app/ only, and money-moving logic buried in a handler is logic that
 * is awkward to test). Same division the arcade routes use.
 *
 * The limit is deliberately tighter than the other Gold routes' 10/minute. A
 * legitimate player cannot start more than two ads a minute -- each one takes
 * thirty seconds -- so anything above that is a script, and the grant table's
 * one-pending-per-profile index should not be the first thing absorbing it.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:gold:rewarded:start", 6, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });
    const grant = await startRewardedAd(token);
    return NextResponse.json({ grant, persistence: persistenceMode() });
  } catch (error) {
    return toArcadeErrorResponse(error, "Could not start that ad.");
  }
}

/**
 * Abandons a grant, so closing the modal does not block the next offer.
 *
 * Nothing is paid here and nothing is at stake, which is why it is allowed to
 * be best-effort: a DELETE that never arrives leaves a pending grant that
 * startRewardedAd resumes and, past its TTL, sweeps on its own.
 */
export async function DELETE(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:gold:rewarded:cancel", 20, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });
    const grantId = new URL(request.url).searchParams.get("grant");
    if (!grantId) return NextResponse.json({ error: "Missing grant." }, { status: 400 });
    await cancelRewardedAd(token, grantId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toArcadeErrorResponse(error, "Could not cancel that ad.");
  }
}
