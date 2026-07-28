import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/server/profile-store";
import { stripeClient, stripeRebuyGoldAmount } from "@/lib/server/stripe";
import { fulfillStripePayment } from "@/lib/server/stripe-store";

export const runtime = "nodejs";

const sessionSchema = z.string().min(10).max(200);

export async function GET(request: NextRequest) {
  try {
    const ownerToken = request.cookies.get("river_session")?.value;
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const sessionId = sessionSchema.safeParse(request.nextUrl.searchParams.get("session_id"));
    if (!sessionId.success) return NextResponse.json({ error: "Invalid Stripe session." }, { status: 400 });
    const stripe = stripeClient();
    if (!stripe) return NextResponse.json({ error: "Stripe payments are not configured yet." }, { status: 503 });

    const profile = await ensureProfile(ownerToken);
    const session = await stripe.checkout.sessions.retrieve(sessionId.data);
    const metadata = session.metadata ?? {};
    const expectedAmount = String(stripeRebuyGoldAmount());
    if (
      metadata.kind !== "rebuy_gold"
      || metadata.profile_id !== profile.id
      || metadata.gold_amount !== expectedAmount
    ) {
      return NextResponse.json({ error: "That payment does not belong to this player." }, { status: 403 });
    }
    if (session.payment_status !== "paid") {
      return NextResponse.json({ paid: false, profile });
    }

    await fulfillStripePayment(session.id, profile.id, stripeRebuyGoldAmount());
    return NextResponse.json({ paid: true, profile: await ensureProfile(ownerToken) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify Stripe payment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
