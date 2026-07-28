import { NextRequest, NextResponse } from "next/server";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";
import { listGoldTiers } from "@/lib/server/stripe";
import { ensureProfile } from "@/lib/server/profile-store";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The storefront's own read: every configured tier (price/currency/Gold
 * resolved from Stripe, not hardcoded), plus whether this player still has
 * an acceptance prompt to clear before they can buy. One call gives the
 * page everything it needs to render, including whether to show the prompt
 * at all.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:tiers", 60, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readOrCreateSessionToken(request);
    const profile = await ensureProfile(token);
    const [tiers, pending] = await Promise.all([
      listGoldTiers(),
      pendingAcceptances(profile.id),
    ]);
    return withSessionCookie(
      NextResponse.json({
        tiers,
        pendingAcceptances: pending,
        pendingDocuments: pending.map((slug) => LEGAL_DOCUMENTS[slug]),
      }),
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the Gold storefront.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
