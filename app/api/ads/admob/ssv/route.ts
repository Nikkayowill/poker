import { NextRequest, NextResponse } from "next/server";
import { AdmobSsvVerificationError, processAdmobSsvCallback } from "@/lib/server/admob-ssv-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/**
 * AdMob's server-side verification (SSV) callback for the native app's
 * rewarded-video ad unit -- Google calls this as a GET with a signed query
 * string once a rewarded video genuinely completes on a player's device.
 * This is the real proof-of-watch the web Adsterra flow explicitly cannot
 * have (see lib/server/rewarded-ad-service.ts's header comment); nothing
 * here trusts anything the player's own device sends, only what Google's
 * signature attests.
 *
 * Verify-first, unconditionally, same principle as
 * app/api/stripe/webhook/route.ts. Business logic (eligibility, the daily
 * cap, the credit) all lives in processAdmobSsvCallback; this route only
 * decides the HTTP response.
 *
 * Always acks 200 once the signature verifies, even for a no-op outcome
 * (duplicate transaction_id, daily cap already spent, an unknown or
 * ineligible user_id) -- Google retries a non-2xx SSV response, and none of
 * those cases benefit from a retry. A signature that doesn't verify is the
 * one case that refuses outright: it might be a genuine callback arriving
 * against a stale key cache, and refusing (rather than acking) is what lets
 * Google's own redelivery try again after this server's key cache refreshes.
 */
export async function GET(request: NextRequest) {
  // Google's signature check below is the real gate; this is only defense
  // in depth against a flood of junk requests forcing a signature-key
  // fetch/verify per hit. Generous, since Google's own SSV traffic can
  // burst from a shared IP range.
  const limited = enforceRateLimit(request, "ads:admob:ssv", 120, 60 * 1000);
  if (limited) return limited;

  const rawQuery = request.nextUrl.search.replace(/^\?/, "");
  try {
    const outcome = await processAdmobSsvCallback(rawQuery);
    if (!outcome.credited && (outcome.reason === "bad-signature" || outcome.reason === "unknown-key")) {
      return NextResponse.json({ error: "Could not verify the ad-view signature." }, { status: 400 });
    }
    return NextResponse.json({ received: true, ...outcome });
  } catch (error) {
    if (error instanceof AdmobSsvVerificationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not process the ad-view callback.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
