import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  enforceGoldBillingRestriction,
  isTestPurchaseAllowed,
  stripeClient,
  stripeTestClient,
  verifiedGoldSession,
  verifiedSupportSession,
  type StripeMode,
} from "@/lib/server/stripe";
import { fulfillStripePayment, syncSubscriptionState } from "@/lib/server/stripe-store";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

const sessionSchema = z.string().min(10).max(200);

/**
 * The success-page recovery path: called when a player lands back on
 * ?payment=success, in case the webhook hasn't landed yet (or at all: this
 * is also the only fulfillment path in local/dev environments with no
 * public URL for Stripe to reach). Shares fulfillStripePayment/
 * syncSubscriptionState with the webhook, which is what makes a refresh here
 * safe: for a one-time payment the database's unique session id is the
 * idempotency key; for a subscription, syncSubscriptionState's recency guard
 * is (a redundant sync here never regresses a status the webhook already
 * moved past).
 *
 * Live and test sessions live in separate Stripe namespaces: a live secret
 * key cannot retrieve a cs_test_ session or vice versa. Stripe's own
 * `cs_live_`/`cs_test_` id prefix is what picks the client here, the same
 * way the webhook route picks a mode from which secret verifies a body.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:verify", 20, 60 * 1000);
  if (limited) return limited;
  try {
    const ownerToken = readSessionToken(request);
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const sessionId = sessionSchema.safeParse(request.nextUrl.searchParams.get("session_id"));
    if (!sessionId.success) return NextResponse.json({ error: "Invalid Stripe session." }, { status: 400 });

    const mode: StripeMode = sessionId.data.startsWith("cs_test_") ? "test" : "live";
    const stripe = mode === "live" ? stripeClient() : stripeTestClient();
    if (!stripe) return NextResponse.json({ error: "Stripe payments are not configured yet." }, { status: 503 });

    const profile = await ensureProfile(ownerToken);

    if (mode === "test" && !isTestPurchaseAllowed(profile.id)) {
      return NextResponse.json({ error: "Test-mode purchases are not available on this profile." }, { status: 403 });
    }

    // A cheap, unexpanded peek at which kind this session is, so only one
    // full verification/sync runs.
    const peek = await stripe.checkout.sessions.retrieve(sessionId.data);
    let paid: boolean;
    let membership = null;
    if (peek.mode === "subscription") {
      if (typeof peek.subscription !== "string") {
        // Not yet attached to a subscription: treat as not paid rather
        // than throw; the webhook (or a later refresh) will catch up.
        paid = false;
      } else {
        membership = await syncSubscriptionState(stripe, peek.subscription, mode === "live", new Date());
        paid = peek.payment_status === "paid";
      }
    } else if (peek.metadata?.kind === "gold_purchase") {
      const { session, tier, profileId } = await verifiedGoldSession(sessionId.data, profile.id, mode);
      paid = session.payment_status === "paid";
      if (paid && await enforceGoldBillingRestriction(session, mode)) {
        return NextResponse.json(
          { error: "Gold purchases aren't available in your region. Your payment has been refunded.", paid: false },
          { status: 403 },
        );
      }
      if (paid) {
        await fulfillStripePayment(session.id, profileId, tier.goldAmount, {
          kind: "gold_purchase",
          tierKey: tier.key,
          livemode: mode === "live",
        });
      }
    } else {
      const { session, tier, profileId } = await verifiedSupportSession(sessionId.data, profile.id, mode);
      paid = session.payment_status === "paid";
      if (paid) {
        await fulfillStripePayment(session.id, profileId, null, {
          kind: "support_one_time",
          tierKey: tier.key,
          livemode: mode === "live",
        });
      }
    }

    if (!paid) return NextResponse.json({ paid: false, profile, membership });
    return NextResponse.json({ paid: true, profile: await ensureProfile(ownerToken), membership });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify Stripe payment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
