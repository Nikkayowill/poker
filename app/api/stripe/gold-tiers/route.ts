import { NextRequest, NextResponse } from "next/server";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_SLUGS } from "@/lib/legal/documents";
import { listGoldTiers } from "@/lib/server/stripe";
import { ensureProfile } from "@/lib/server/profile-store";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The Buy Gold panel's own read: every configured Gold tier (resolved from
 * Stripe, not hardcoded), plus whether this player still has a legal-
 * acceptance prompt to clear. Mirrors app/api/stripe/tiers/route.ts for the
 * support panel -- kept as a separate route rather than merged into that one
 * so a Gold-purchase regression can never take support payments down with it.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:tiers", 60, 60 * 1000);
  if (limited) return limited;
  try {
    // Rendering the panel must not create a player. Checkout is where a
    // real session is required, and it enforces that itself.
    const token = readSessionToken(request);
    const profile = token ? await ensureProfile(token) : null;
    const [tiers, pending] = await Promise.all([
      listGoldTiers(),
      profile ? pendingAcceptances(profile.id) : Promise.resolve([...LEGAL_DOCUMENT_SLUGS]),
    ]);
    return NextResponse.json({
      tiers,
      pendingAcceptances: pending,
      pendingDocuments: pending.map((slug) => LEGAL_DOCUMENTS[slug]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the Gold store.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
