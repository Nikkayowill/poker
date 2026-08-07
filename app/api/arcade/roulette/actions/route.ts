import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { spinRouletteWheel } from "@/lib/server/roulette-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Spin the wheel on the caller's live bet.
 *
 * The body carries no bet and no number -- only which round is being spun and
 * at what version. The pocket is drawn here, server-side, on this request. A
 * client cannot choose it, predict it or replay it: `version` pins the spin to
 * the bet the player was looking at, so a retried or double-fired request
 * cannot turn one chip into two results.
 *
 * No round id in the path because a player has at most one live bet; the id in
 * the body is checked against it rather than used to look it up, so it cannot
 * address anybody else's round.
 */
const actionSchema = z.object({
  roundId: z.string().uuid(),
  version: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:roulette:spin", 240, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "There is no bet on the layout to spin." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await spinRouletteWheel(token, parsed.data)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
