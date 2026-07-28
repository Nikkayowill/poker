import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  stripeClient,
  stripeRebuyGoldAmount,
  stripeWebhookSecret,
} from "@/lib/server/stripe";
import { fulfillStripePayment } from "@/lib/server/stripe-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const stripe = stripeClient();
  const secret = stripeWebhookSecret();
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !secret || !signature) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  try {
    const event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return NextResponse.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata ?? {};
    if (
      session.payment_status !== "paid"
      || metadata.kind !== "rebuy_gold"
      || !metadata.profile_id
      || metadata.gold_amount !== String(stripeRebuyGoldAmount())
    ) {
      return NextResponse.json({ received: true });
    }

    await fulfillStripePayment(session.id, metadata.profile_id, stripeRebuyGoldAmount());
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
