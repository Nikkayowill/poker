import { NextRequest, NextResponse } from "next/server";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_SLUGS } from "@/lib/legal/documents";
import { listSupportTiers } from "@/lib/server/stripe";
import { latestStripeSubscription } from "@/lib/server/stripe-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The support panel's own read: every configured support tier (one-time and
 * monthly prices resolved from Stripe, not hardcoded), this player's current
 * membership state if any, and whether they still have a legal-acceptance
 * prompt to clear. No tier here ever grants Gold or anything gameplay-
 * relevant -- see lib/legal/documents.ts's support_disclosure.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:tiers", 60, 60 * 1000);
  if (limited) return limited;
  try {
    // Rendering the panel must not create a player. Checkout is where a
    // real session is required, and it enforces that itself.
    const token = readSessionToken(request);
    const profile = token ? await ensureProfile(token) : null;
    const [options, pending, membership] = await Promise.all([
      listSupportTiers(),
      profile ? pendingAcceptances(profile.id) : Promise.resolve([...LEGAL_DOCUMENT_SLUGS]),
      profile ? latestStripeSubscription(profile.id) : Promise.resolve(null),
    ]);
    return NextResponse.json({
      options,
      membership,
      pendingAcceptances: pending,
      pendingDocuments: pending.map((slug) => LEGAL_DOCUMENTS[slug]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load support options.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
