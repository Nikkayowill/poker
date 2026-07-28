import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  stripeClient,
  stripeWebhookSecret,
  verifiedRebuySession,
  verifiedTierSession,
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
 * Raw-body signature verification happens first, unconditionally, before any
 * of this event's contents are trusted for anything -- the six lines above
 * `stripe.webhooks.constructEvent` are the only ones that run without it.
 */
export async function POST(request: NextRequest) {
  const stripe = stripeClient();
  const secret = stripeWebhookSecret();
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !secret || !signature) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  try {
    const event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
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
      const { session, tier, profileId } = await verifiedTierSession(eventSession.id);
      if (session.payment_status !== "paid") return NextResponse.json({ received: true });
      await fulfillStripePayment(session.id, profileId, tier.goldAmount, {
        kind: "gold_purchase",
        tierKey: tier.key,
      });
    } else {
      const { session, config, profileId } = await verifiedRebuySession(eventSession.id);
      if (session.payment_status !== "paid") return NextResponse.json({ received: true });
      await fulfillStripePayment(session.id, profileId, config.goldAmount);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
