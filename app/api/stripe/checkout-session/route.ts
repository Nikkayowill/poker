import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/server/profile-store";
import {
  resolveGoldTier,
  stripeClient,
  supportTierByKey,
} from "@/lib/server/stripe";
import { latestStripeSubscription } from "@/lib/server/stripe-store";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

const noCashValueNotice = "StackChips Gold is virtual entertainment currency with no cash value and cannot be redeemed, exchanged, or withdrawn for real money.";

/**
 * Two request shapes, distinguished by the presence of `billing`:
 *
 *  - {tierKey, billing, gameId?} is a voluntary support payment (one-time or
 *    monthly), unchanged from before.
 *  - {tierKey, gameId?} (no `billing`) is a Gold purchase -- always one-time.
 *    Tried second in the union: an object carrying `billing` would still
 *    structurally satisfy this looser shape (z.object ignores extra keys by
 *    default), so the stricter support shape must be tried first.
 *
 * There is no rebuy-with-money flow anymore -- a busted seat is recovered
 * through the backstop grant / lobby faucets or a Gold purchase, never a
 * dedicated rebuy product.
 */
const bodySchema = z.union([
  z.object({
    tierKey: z.string().min(1),
    billing: z.enum(["one_time", "monthly"]),
    gameId: z.string().uuid().optional(),
  }),
  z.object({
    tierKey: z.string().min(1),
    gameId: z.string().uuid().optional(),
  }),
]);

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:checkout", 5, 60 * 1000);
  if (limited) return limited;

  try {
    const ownerToken = readSessionToken(request);
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "A valid Gold pack or support tier is required." }, { status: 400 });

    const stripe = stripeClient();
    if (!stripe) {
      return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
    }

    const profile = await ensureProfile(ownerToken);

    // Required before any Checkout Session exists. Checked here rather than
    // trusted from a client-side checkbox, because the client is never
    // trusted with anything that gates a charge.
    const pending = await pendingAcceptances(profile.id);
    if (pending.length > 0) {
      return NextResponse.json(
        { error: "Please accept the Terms of Service and disclosures first.", pendingAcceptances: pending },
        { status: 412 },
      );
    }

    const origin = request.nextUrl.origin;

    if (!("billing" in parsed.data)) {
      const { tierKey, gameId } = parsed.data;
      const tier = await resolveGoldTier(tierKey);
      const returnPath = gameId ? `/store/gold?table=${gameId}` : "/store/gold";
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        billing_address_collection: "required",
        line_items: [{ price: tier.priceId, quantity: 1 }],
        success_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=cancelled`,
        client_reference_id: profile.id,
        custom_text: { submit: { message: noCashValueNotice } },
        metadata: {
          kind: "gold_purchase",
          tier_key: tier.key,
          profile_id: profile.id,
          gold_amount: String(tier.goldAmount),
        },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL.");
      return NextResponse.json({ url: session.url });
    }

    const def = supportTierByKey(parsed.data.tierKey);
    if (!def) return NextResponse.json({ error: "That support tier does not exist." }, { status: 400 });

    const { billing, gameId } = parsed.data;
    const returnPath = gameId ? `/store?table=${gameId}` : "/store";

    // A repeat supporter should not accumulate duplicate Stripe Customers.
    const existing = await latestStripeSubscription(profile.id);
    const customerId = existing?.stripeCustomerId;

    if (billing === "one_time") {
      const priceId = process.env[def.oneTimeEnvVar]?.trim();
      if (!priceId) return NextResponse.json({ error: "That option is not configured yet." }, { status: 503 });
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=cancelled`,
        client_reference_id: profile.id,
        ...(customerId ? { customer: customerId } : {}),
        metadata: {
          kind: "support_one_time",
          tier_key: def.key,
          profile_id: profile.id,
          billing: "one_time",
        },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL.");
      return NextResponse.json({ url: session.url });
    }

    const priceId = process.env[def.monthlyEnvVar]?.trim();
    if (!priceId) return NextResponse.json({ error: "That option is not configured yet." }, { status: 503 });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=cancelled`,
      client_reference_id: profile.id,
      ...(customerId ? { customer: customerId } : {}),
      subscription_data: {
        metadata: { profile_id: profile.id, tier_key: def.key },
      },
      metadata: {
        kind: "support_subscription",
        tier_key: def.key,
        profile_id: profile.id,
      },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Stripe checkout.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
