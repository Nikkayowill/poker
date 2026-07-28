import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  stripeClient,
  stripeTestClient,
  stripeTestWebhookSecret,
  stripeWebhookSecret,
  verifiedRebuySession,
  verifiedTierSession,
  type StripeMode,
} from "@/lib/server/stripe";
import { fulfillStripePayment } from "@/lib/server/stripe-store";

export const runtime = "nodejs";

/**
 * One endpoint for both purchase shapes -- the rebuy-after-busting flow and
 * the general storefront -- distinguished by `metadata.kind` on the session
 * itself, which is set at Checkout creation time (see
 * app/api/stripe/checkout-session/route.ts) and echoed back on every event
 * Stripe sends about it.
 *
 * It is also one endpoint for both live and test mode: Stripe supports
 * registering the same URL twice, once per mode, each with its own signing
 * secret. Raw-body signature verification happens first, unconditionally --
 * every other line only runs once one of the two secrets has verified the
 * body, and *which* secret verified it is the only thing that decides live
 * vs test for the rest of the request. A live-signed body cannot verify
 * against the test secret or vice versa (different HMAC keys), so trying
 * both in turn is safe and never ambiguous. event.livemode is then checked
 * against that same conclusion as a sanity cross-check, not as a second
 * source of truth -- nothing here ever lets the request itself pick a mode.
 */
export async function POST(request: NextRequest) {
  const liveSecret = stripeWebhookSecret();
  const testSecret = stripeTestWebhookSecret();
  const signature = request.headers.get("stripe-signature");
  if ((!liveSecret && !testSecret) || !signature) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event | null = null;
  let mode: StripeMode | null = null;

  const liveStripe = stripeClient();
  if (liveSecret && liveStripe) {
    try {
      event = liveStripe.webhooks.constructEvent(rawBody, signature, liveSecret);
      mode = "live";
    } catch {
      // Not signed with the live secret -- fall through to try test.
    }
  }
  const testStripe = stripeTestClient();
  if (!event && testSecret && testStripe) {
    try {
      event = testStripe.webhooks.constructEvent(rawBody, signature, testSecret);
      mode = "test";
    } catch {
      // Matched neither secret.
    }
  }
  if (!event || !mode) {
    return NextResponse.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }
  if (event.livemode !== (mode === "live")) {
    return NextResponse.json({ error: "Stripe event livemode did not match the verifying secret." }, { status: 400 });
  }

  try {
    // checkout.session.completed covers card and every synchronous method.
    // async_payment_succeeded only fires for delayed methods (bank debits,
    // vouchers) if such a payment_method_type were ever enabled -- this app
    // only offers "card", which never takes that path, but the handler costs
    // nothing to keep in place against a future payment method change.
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return NextResponse.json({ received: true });
    }

    const eventSession = event.data.object as Stripe.Checkout.Session;
    if (eventSession.payment_status !== "paid") {
      return NextResponse.json({ received: true });
    }

    if (eventSession.metadata?.kind === "gold_purchase") {
      const { session, tier, profileId } = await verifiedTierSession(eventSession.id, undefined, mode);
      if (session.payment_status !== "paid") return NextResponse.json({ received: true });
      await fulfillStripePayment(session.id, profileId, tier.goldAmount, {
        kind: "gold_purchase",
        tierKey: tier.key,
      });
    } else {
      const { session, config, profileId } = await verifiedRebuySession(eventSession.id, undefined, mode);
      if (session.payment_status !== "paid") return NextResponse.json({ received: true });
      await fulfillStripePayment(session.id, profileId, config.goldAmount);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
