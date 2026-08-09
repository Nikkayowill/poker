import { NextRequest, NextResponse } from "next/server";
import { persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { toArcadeErrorResponse } from "@/lib/server/arcade-request";
import { claimRewardedAd } from "@/lib/server/rewarded-ad-service";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Credits the reward for a completed grant.
 *
 * The body carries a grant id and nothing else -- no duration, no "completed"
 * flag, no player-reported timestamp. There is deliberately nothing here for a
 * client to lie about: the wait is measured from the issued_at this server
 * wrote, and the payout is gated on an UPDATE that can only match once. See
 * the header of lib/server/rewarded-ad-service.ts for why that is the most
 * that can be established about an ad view at all.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:gold:rewarded:claim", 12, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });

    const body = await request.json().catch(() => null);
    const grantId = typeof body?.grantId === "string" ? body.grantId : null;
    if (!grantId) return NextResponse.json({ error: "Missing grant." }, { status: 400 });

    const result = await claimRewardedAd(token, grantId);
    return NextResponse.json({ ...result, persistence: persistenceMode() });
  } catch (error) {
    return toArcadeErrorResponse(error, "Could not claim that reward.");
  }
}
