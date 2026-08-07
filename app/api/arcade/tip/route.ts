import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TIP_AMOUNTS } from "@/lib/arcade/tipping";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";
import { tipDealer, toTipErrorResponse } from "@/lib/server/tip-service";

export const runtime = "nodejs";

/**
 * The amounts, straight off the same tuple the buttons render from.
 *
 * z.literal over TIP_AMOUNTS rather than a hand-written z.union of numbers,
 * for the reason four routes were fixed to take z.enum(STAKES_TIERS): a
 * hand-copied list is a second definition of the price, and the two drift the
 * day somebody adds a fourth amount. A tip the felt offers and the route
 * rejects is a button that always errors.
 */
const tipSchema = z.object({
  amount: z.union(
    TIP_AMOUNTS.map((amount) => z.literal(amount)) as unknown as [
      z.ZodLiteral<number>,
      z.ZodLiteral<number>,
      ...z.ZodLiteral<number>[],
    ],
  ),
});

/**
 * Tipping the house dealers.
 *
 * POST only, and it moves real Gold in one direction with nothing coming back
 * -- see lib/server/tip-service.ts for why that makes it the simplest money
 * path in the arcade and what replaces the usual settlement guards.
 */
export async function POST(request: NextRequest) {
  /*
   * Tighter than the deal limit, and for the opposite reason.
   *
   * A scripted deal loop drains a wallet through a game that pays most of it
   * back; a scripted tip loop empties it outright. Six a minute is far above
   * anything a person does with a button that appears once every twelve hands,
   * and far below anything worth calling a drain. It does not make a genuine
   * double-click idempotent -- nothing here does, deliberately, since a tip
   * clicked twice is two tips and the house is never the party at risk.
   */
  const limited = enforceRateLimit(request, "arcade:tip", 6, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = tipSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "That is not a tip the dealers take." }, { status: 400 }),
        token,
      );
    }
    if (await isBanned(token)) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = await tipDealer(token, parsed.data.amount);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toTipErrorResponse(error), token);
  }
}
