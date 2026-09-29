import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/server/profile-store";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { publicErrorMessage } from "@/lib/server/public-error";
import { tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { buildCheckoutSession, resolveStackAcresPrice, stripeClient } from "@/lib/server/stripe";

export const runtime = "nodejs";

/**
 * Starts the one-time StackAcres purchase. Deliberately outside the access
 * gate the rest of /api/stackacres sits behind: the people who need it are
 * the people who do not have access yet.
 *
 * Nothing here grants anything. Access is turned on by the webhook (or the
 * return-trip verify) after Stripe says the session is paid.
 *
 * `over18` is the buyer's own confirmation and is stored on the session for
 * the record; it is not age verification.
 */
const bodySchema = z.object({ over18: z.literal(true) });

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "stripe:stackacres", 5, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Please confirm you are 18 or older." }, { status: 400 });
    }

    const stripe = stripeClient();
    if (!stripe) return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });

    const profile = await ensureProfile(token);
    // A paid purchase is tied to an account, so a cleared cookie cannot lose it
    // and a refund or dispute always maps to one person.
    if (!profile.isRegistered) {
      return NextResponse.json({ error: "Save your progress with an account before buying.", needsAccount: true }, { status: 403 });
    }
    if (await tokenHasStackAcresAccess(token)) {
      return NextResponse.json({ error: "You already have StackAcres.", owned: true }, { status: 409 });
    }

    const pending = await pendingAcceptances(profile.id);
    if (pending.length > 0) {
      return NextResponse.json(
        { error: "Please accept the Terms of Service and disclosures first.", pendingAcceptances: pending },
        { status: 412 },
      );
    }

    const price = await resolveStackAcresPrice("live");
    const origin = request.nextUrl.origin;
    const session = await buildCheckoutSession(stripe, {
      mode: "payment",
      priceId: price.priceId,
      profileId: profile.id,
      successUrl: `${origin}/games/stackacres?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/games/stackacres?payment=cancelled`,
      metadata: {
        kind: "stackacres_purchase",
        profile_id: profile.id,
        over18: "confirmed",
      },
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Could not start the purchase.") }, { status: 400 });
  }
}
