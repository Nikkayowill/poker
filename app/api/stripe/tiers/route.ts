import { NextRequest, NextResponse } from "next/server";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_SLUGS } from "@/lib/legal/documents";
import { listGoldTiers } from "@/lib/server/stripe";
import { ensureProfile } from "@/lib/server/profile-store";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

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
    // Rendering the storefront must not create a player. Checkout is where a
    // real session is required, and it enforces that itself.
    const token = readSessionToken(request);
    const [tiers, pending] = await Promise.all([
      listGoldTiers(),
      token
        ? ensureProfile(token).then((profile) => pendingAcceptances(profile.id))
        : Promise.resolve([...LEGAL_DOCUMENT_SLUGS]),
    ]);
    return NextResponse.json({
      tiers,
      pendingAcceptances: pending,
      pendingDocuments: pending.map((slug) => LEGAL_DOCUMENTS[slug]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the Gold storefront.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
