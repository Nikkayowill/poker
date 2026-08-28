import { NextRequest, NextResponse } from "next/server";
import { admobRewardStatus } from "@/lib/server/admob-ssv-service";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Lets the native app's own modal learn whether its watch was paid.
 *
 * AdMob's SSV callback (app/api/ads/admob/ssv/route.ts) is server-to-server
 * -- it never touches the player's device, so the client that showed the ad
 * has nothing to await except polling this. This route is read-only: it
 * never verifies or credits anything itself, only reports what the SSV
 * callback has already recorded (or hasn't yet -- a normal gap, not an
 * error) for the nonce that client generated before the ad played.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:gold:admob-status", 60, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });

    const nonce = request.nextUrl.searchParams.get("nonce");
    if (!nonce) return NextResponse.json({ error: "Missing nonce." }, { status: 400 });

    const profile = await ensureProfile(token);
    const status = await admobRewardStatus(profile.id, nonce);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check your reward status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
