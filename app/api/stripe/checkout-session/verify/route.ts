import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/server/profile-store";
import {
  stripeClient,
  stripeTestClient,
  verifiedRebuySession,
  verifiedTierSession,
  type StripeMode,
} from "@/lib/server/stripe";
import { fulfillStripePayment } from "@/lib/server/stripe-store";

export const runtime = "nodejs";

const sessionSchema = z.string().min(10).max(200);

/**
 * The success-page recovery path: called when a player lands back on
 * ?payment=success, in case the webhook has not landed yet (or at all --
 * this is also the only fulfillment path in local/dev environments with no
 * public URL for Stripe to reach). Shares fulfillStripePayment with the
 * webhook, which is what makes a refresh here safe: the database's unique
 * session id is the idempotency key, not "did we already show a message."
 *
 * Live and test sessions live in separate Stripe namespaces -- a live secret
 * key cannot retrieve a cs_test_ session or vice versa -- so Stripe's own
 * `cs_live_`/`cs_test_` id prefix is what picks the client here, the same
 * way the webhook route picks a mode from which secret verifies a body. It
 * is not a trust decision: only a genuine session Stripe issued in that mode
 * will ever resolve through the matching client, and every field that
 * matters (price, amount, kind, profile ownership) is still re-validated
 * against Stripe's own record of the session, never taken from the request.
 */
export async function GET(request: NextRequest) {
  try {
    const ownerToken = request.cookies.get("river_session")?.value;
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const sessionId = sessionSchema.safeParse(request.nextUrl.searchParams.get("session_id"));
    if (!sessionId.success) return NextResponse.json({ error: "Invalid Stripe session." }, { status: 400 });

    const mode: StripeMode = sessionId.data.startsWith("cs_test_") ? "test" : "live";
    const stripe = mode === "live" ? stripeClient() : stripeTestClient();
    if (!stripe) return NextResponse.json({ error: "Stripe payments are not configured yet." }, { status: 503 });

    const profile = await ensureProfile(ownerToken);

    // A cheap, unexpanded peek at which kind this session is, so only one
    // full (expanded, validated) verification runs -- not one per branch,
    // which is what trying the tier path and falling back to rebuy on
    // failure would cost on every legacy rebuy verification.
    const peek = await stripe.checkout.sessions.retrieve(sessionId.data);
    let paid: boolean;
    if (peek.metadata?.kind === "gold_purchase") {
      const { session, tier, profileId } = await verifiedTierSession(sessionId.data, profile.id, mode);
      paid = session.payment_status === "paid";
      if (paid) await fulfillStripePayment(session.id, profileId, tier.goldAmount, { kind: "gold_purchase", tierKey: tier.key });
    } else {
      const { session, config, profileId } = await verifiedRebuySession(sessionId.data, profile.id, mode);
      paid = session.payment_status === "paid";
      if (paid) await fulfillStripePayment(session.id, profileId, config.goldAmount);
    }

    if (!paid) return NextResponse.json({ paid: false, profile });
    return NextResponse.json({ paid: true, profile: await ensureProfile(ownerToken) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify Stripe payment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
