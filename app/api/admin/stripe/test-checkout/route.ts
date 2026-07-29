import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminAuthorized } from "@/lib/server/admin-auth";
import { isTestPurchaseAllowed, resolveGoldTier, stripeTestClient } from "@/lib/server/stripe";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  tierKey: z.string().min(1),
});

const noCashValueNotice = "River Room Gold is virtual entertainment currency with no cash value and cannot be redeemed, exchanged, or withdrawn for real money.";

/**
 * The only way a Stripe test-mode Checkout Session ever gets created for
 * this app: admin-gated, and only for a profile already on the
 * STRIPE_TEST_ALLOWED_PROFILE_IDS allowlist. The public storefront
 * (app/api/stripe/checkout-session/route.ts) never takes a mode from the
 * browser and never will -- this route exists so verifying the test-mode
 * webhook path doesn't require hand-writing a Stripe API call every time.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:stripe:test-checkout", 10, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId and tierKey." }, { status: 400 });
    }
    const { profileId, tierKey } = parsed.data;
    if (!isTestPurchaseAllowed(profileId)) {
      return NextResponse.json({ error: "That profile is not on the test-purchase allowlist." }, { status: 403 });
    }

    const stripe = stripeTestClient();
    if (!stripe) return NextResponse.json({ error: "Stripe test mode is not configured." }, { status: 503 });

    const tier = await resolveGoldTier(tierKey, "test");
    const origin = request.nextUrl.origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: tier.priceId, quantity: 1 }],
      success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?payment=cancelled`,
      client_reference_id: profileId,
      custom_text: { submit: { message: noCashValueNotice } },
      metadata: {
        kind: "gold_purchase",
        tier_key: tier.key,
        profile_id: profileId,
        gold_amount: String(tier.goldAmount),
      },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start a test checkout.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
