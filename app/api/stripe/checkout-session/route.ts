import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStoredGame } from "@/lib/server/game-store";
import { ensureProfile } from "@/lib/server/profile-store";
import {
  resolveGoldTier,
  stripeClient,
  stripeRebuyConfig,
} from "@/lib/server/stripe";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/**
 * Two request shapes, kept genuinely separate rather than merged into one
 * fuzzy schema:
 *
 *  - {gameId} is the original rebuy-after-busting flow (Codex's), unchanged
 *    in every respect below except the Terms gate, which now applies to it
 *    too -- "before creating Checkout" was never scoped to only the new path.
 *  - {tierKey, gameId?} is the general storefront: any tier, any time,
 *    gameId only used to send you back to the table you were at, if any.
 */
const bodySchema = z.union([
  z.object({ gameId: z.string().uuid() }),
  z.object({ tierKey: z.string().min(1), gameId: z.string().uuid().optional() }),
]);

const noCashValueNotice = "River Room Gold is virtual entertainment currency with no cash value and cannot be redeemed, exchanged, or withdrawn for real money.";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:checkout", 5, 60 * 1000);
  if (limited) return limited;

  try {
    const ownerToken = request.cookies.get("river_session")?.value;
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "A valid Gold pack is required." }, { status: 400 });

    const stripe = stripeClient();
    if (!stripe) {
      return NextResponse.json({ error: "Gold purchases are not configured yet." }, { status: 503 });
    }

    const profile = await ensureProfile(ownerToken);

    // Required before any Checkout Session exists, for both paths. Checked
    // here rather than trusted from a client-side checkbox, because the
    // client is never trusted with anything that gates a charge.
    const pending = await pendingAcceptances(profile.id);
    if (pending.length > 0) {
      return NextResponse.json(
        { error: "Please accept the Terms of Service and Gold disclosure first.", pendingAcceptances: pending },
        { status: 412 },
      );
    }

    const origin = request.nextUrl.origin;

    if ("tierKey" in parsed.data) {
      const tier = await resolveGoldTier(parsed.data.tierKey);
      const gameId = parsed.data.gameId;
      const returnPath = gameId ? `/store?table=${gameId}` : "/store";
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
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

    // The original rebuy-after-busting flow, unchanged below this point.
    const game = await getStoredGame(parsed.data.gameId);
    const seat = game?.seats.find((candidate) => candidate.ownerToken === ownerToken);
    if (!game || !seat) return NextResponse.json({ error: "You are not seated at this table." }, { status: 403 });
    if (game.status !== "complete" || seat.stack > 0) {
      return NextResponse.json({ error: "A Stripe rebuy is only available after you bust." }, { status: 409 });
    }

    const config = await stripeRebuyConfig();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: config.priceId, quantity: 1 }],
      success_url: `${origin}/?table=${game.id}&payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?table=${game.id}&payment=cancelled`,
      client_reference_id: profile.id,
      custom_text: { submit: { message: noCashValueNotice } },
      metadata: {
        kind: "rebuy_gold",
        profile_id: profile.id,
        game_id: game.id,
        gold_amount: String(config.goldAmount),
      },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Stripe checkout.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
