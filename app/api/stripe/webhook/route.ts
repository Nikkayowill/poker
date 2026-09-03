import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  enforceGoldBillingRestriction,
  isTestPurchaseAllowed,
  stripeClient,
  stripeTestClient,
  stripeTestWebhookSecret,
  stripeWebhookSecret,
  verifiedGoldSession,
  verifiedSupportSession,
  type StripeMode,
} from "@/lib/server/stripe";
import { fulfillStripePayment, syncSubscriptionState } from "@/lib/server/stripe-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/**
 * One endpoint for every payment shape (Gold purchases, one-time support,
 * and the full monthly-subscription lifecycle), distinguished by event
 * type, and for checkout.session.completed, by `metadata.kind`/
 * `session.mode` set at Checkout creation time (see
 * app/api/stripe/checkout-session/route.ts).
 *
 * It is also one endpoint for both live and test mode: Stripe supports
 * registering the same URL twice, once per mode, each with its own signing
 * secret. Raw-body signature verification happens first, unconditionally;
 * every other line only runs once one of the two secrets has verified the
 * body, and which secret verified it is the only thing that decides live
 * vs test for the rest of the request. A live-signed body cannot verify
 * against the test secret or vice versa (different HMAC keys), so trying
 * both in turn is safe and never ambiguous. event.livemode is then checked
 * against that same conclusion as a sanity cross-check, not a second source
 * of truth: nothing here ever lets the request itself pick a mode.
 */
export async function POST(request: NextRequest) {
  // Signature verification below is the real gate; this is only defense in
  // depth against a flood of junk requests forcing a raw-body read + HMAC
  // check per hit. Generous, since a real sale can fire a burst of genuine
  // events from Stripe's own IPs in a short window.
  const limited = enforceRateLimit(request, "stripe:webhook", 120, 60 * 1000);
  if (limited) return limited;

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
      // Not signed with the live secret; fall through to try test.
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

  const ack = () => NextResponse.json({ received: true });
  const stripe = mode === "live" ? liveStripe! : testStripe!;
  // Stripe's own event ordering, not our arrival order: retries and
  // redeliveries can arrive out of order, and syncSubscriptionState's
  // recency guard compares against this, never Date.now().
  const eventCreatedAt = new Date(event.created * 1000);

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        // async_payment_succeeded only fires for delayed methods (bank
        // debits, vouchers) if such a payment_method_type were ever enabled.
        // This app only offers "card", which never takes that path, but
        // the handler costs nothing to keep in place against a future
        // payment method change.
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription") {
          if (typeof session.subscription !== "string") return ack();
          await syncSubscriptionState(stripe, session.subscription, mode === "live", eventCreatedAt);
          return ack();
        }
        // mode === "payment": the only kinds left are gold_purchase and
        // support_one_time.
        if (session.payment_status !== "paid") return ack();

        if (session.metadata?.kind === "gold_purchase") {
          const { session: verified, tier, profileId } = await verifiedGoldSession(session.id, undefined, mode);
          if (verified.payment_status !== "paid") return ack();
          if (mode === "test" && !isTestPurchaseAllowed(profileId)) return ack();
          // Refunded (never fulfilled) if the collected billing address is
          // in a restricted state; see enforceGoldBillingRestriction.
          if (await enforceGoldBillingRestriction(verified, mode)) return ack();
          await fulfillStripePayment(verified.id, profileId, tier.goldAmount, {
            kind: "gold_purchase",
            tierKey: tier.key,
            livemode: mode === "live",
          });
          return ack();
        }

        if (session.metadata?.kind !== "support_one_time") return ack();
        const { session: verified, tier, profileId } = await verifiedSupportSession(session.id, undefined, mode);
        if (verified.payment_status !== "paid") return ack();
        // A test-mode event for a profile not on the allowlist is
        // acknowledged (so Stripe stops retrying) but never fulfilled.
        // Ordinary players are never on this list, so this only ever blocks
        // a stray test event.
        if (mode === "test" && !isTestPurchaseAllowed(profileId)) return ack();
        await fulfillStripePayment(verified.id, profileId, null, {
          kind: "support_one_time",
          tierKey: tier.key,
          livemode: mode === "live",
        });
        return ack();
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscriptionState(stripe, subscription.id, mode === "live", eventCreatedAt);
        return ack();
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.parent?.subscription_details?.subscription;
        // A one-off invoice (not tied to a subscription) isn't ours.
        if (!subscriptionId || typeof subscriptionId !== "string") return ack();
        await syncSubscriptionState(stripe, subscriptionId, mode === "live", eventCreatedAt);
        return ack();
      }
      default:
        return ack();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
