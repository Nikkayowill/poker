import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminAuthorized } from "@/lib/server/admin-auth";
import { buildCheckoutSession, isTestPurchaseAllowed, stripeTestClient, supportTierByKey } from "@/lib/server/stripe";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  tierKey: z.string().min(1),
  billing: z.enum(["one_time", "monthly"]),
});

/**
 * The only way a Stripe test-mode Checkout Session ever gets created for
 * this app: admin-gated, and only for a profile already on the
 * STRIPE_TEST_ALLOWED_PROFILE_IDS allowlist. The public panel
 * (app/api/stripe/checkout-session/route.ts) never takes a mode from the
 * browser and never will -- this route exists so verifying the test-mode
 * webhook path (one-time fulfillment, or the initial leg of the
 * subscription lifecycle) doesn't require hand-writing a Stripe API call
 * every time. It only ever produces the *initial* Checkout Session --
 * exercising renewal/payment-failed/cancellation for a subscription needs
 * Stripe CLI's `stripe trigger` or the Dashboard's test clocks against the
 * subscription this route creates.
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
      return NextResponse.json({ error: "Provide a valid profileId, tierKey, and billing." }, { status: 400 });
    }
    const { profileId, tierKey, billing } = parsed.data;
    if (!isTestPurchaseAllowed(profileId)) {
      return NextResponse.json({ error: "That profile is not on the test-purchase allowlist." }, { status: 403 });
    }
    const def = supportTierByKey(tierKey);
    if (!def) return NextResponse.json({ error: "That support tier does not exist." }, { status: 400 });

    const stripe = stripeTestClient();
    if (!stripe) return NextResponse.json({ error: "Stripe test mode is not configured." }, { status: 503 });

    const origin = request.nextUrl.origin;
    if (billing === "one_time") {
      const priceId = process.env[def.oneTimeTestEnvVar]?.trim();
      if (!priceId) return NextResponse.json({ error: "That test-mode price is not configured." }, { status: 503 });
      const session = await buildCheckoutSession(stripe, {
        mode: "payment",
        priceId,
        profileId,
        successUrl: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/?payment=cancelled`,
        metadata: { kind: "support_one_time", tier_key: def.key, profile_id: profileId, billing: "one_time" },
      });
      return NextResponse.json({ url: session.url, sessionId: session.id });
    }

    const priceId = process.env[def.monthlyTestEnvVar]?.trim();
    if (!priceId) return NextResponse.json({ error: "That test-mode price is not configured." }, { status: 503 });
    const session = await buildCheckoutSession(stripe, {
      mode: "subscription",
      priceId,
      profileId,
      successUrl: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/?payment=cancelled`,
      subscriptionMetadata: { profile_id: profileId, tier_key: def.key },
      metadata: { kind: "support_subscription", tier_key: def.key, profile_id: profileId },
    });
    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start a test checkout.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
