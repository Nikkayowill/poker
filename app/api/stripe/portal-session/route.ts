import { NextRequest, NextResponse } from "next/server";
import { ensureProfile } from "@/lib/server/profile-store";
import { createPortalSession, stripeClient } from "@/lib/server/stripe";
import { latestStripeSubscription } from "@/lib/server/stripe-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * A Stripe-hosted Customer Portal session for the "Manage membership"
 * button -- cancellation, payment-method updates, and receipts all happen
 * inside Stripe's own UI, never a custom in-app cancel flow. Always live:
 * the public support panel never manages a test-mode subscription this way
 * (same "the browser never picks a mode" rule the checkout route follows).
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:portal", 10, 60 * 1000);
  if (limited) return limited;
  try {
    const ownerToken = readSessionToken(request);
    if (!ownerToken) return NextResponse.json({ error: "Your session expired." }, { status: 401 });
    const stripe = stripeClient();
    if (!stripe) return NextResponse.json({ error: "Support payments are not configured yet." }, { status: 503 });

    const profile = await ensureProfile(ownerToken);
    const membership = await latestStripeSubscription(profile.id);
    if (!membership) {
      return NextResponse.json({ error: "You don't have a membership to manage yet." }, { status: 404 });
    }

    const url = await createPortalSession(membership.stripeCustomerId, `${request.nextUrl.origin}/store`, "live");
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open the membership portal.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
