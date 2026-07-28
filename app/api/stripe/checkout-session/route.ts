import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStoredGame } from "@/lib/server/game-store";
import { ensureProfile } from "@/lib/server/profile-store";
import {
  stripeClient,
  stripeRebuyGoldAmount,
  stripeRebuyPriceId,
} from "@/lib/server/stripe";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({ gameId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "stripe:checkout", 5, 60 * 1000);
  if (limited) return limited;

  try {
    const ownerToken = request.cookies.get("river_session")?.value;
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "A valid table is required for a rebuy." }, { status: 400 });

    const stripe = stripeClient();
    const priceId = stripeRebuyPriceId();
    if (!stripe || !priceId) {
      return NextResponse.json(
        { error: "Rebuy payments are not configured yet." },
        { status: 503 },
      );
    }

    const game = await getStoredGame(parsed.data.gameId);
    const seat = game?.seats.find((candidate) => candidate.ownerToken === ownerToken);
    if (!game || !seat) return NextResponse.json({ error: "You are not seated at this table." }, { status: 403 });
    if (game.status !== "complete" || seat.stack > 0) {
      return NextResponse.json({ error: "A Stripe rebuy is only available after you bust." }, { status: 409 });
    }

    const profile = await ensureProfile(ownerToken);
    const origin = request.nextUrl.origin;
    const goldAmount = stripeRebuyGoldAmount();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?table=${game.id}&payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?table=${game.id}&payment=cancelled`,
      client_reference_id: profile.id,
      metadata: {
        kind: "rebuy_gold",
        profile_id: profile.id,
        game_id: game.id,
        gold_amount: String(goldAmount),
      },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Stripe checkout.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
