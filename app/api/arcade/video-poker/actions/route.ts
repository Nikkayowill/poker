import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { drawVideoPokerHand } from "@/lib/server/video-poker-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { VIDEO_POKER_HAND_SIZE } from "@/lib/arcade/video-poker";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Take the draw on the caller's live hand.
 *
 * `held` is the whole decision in one field: five booleans, one per card on
 * the glass. It is validated to exactly that length here and re-checked
 * against the actual hand in the service, so a client sending four or six
 * cannot reach the deck.
 *
 * `version` is not optional and not advisory. It pins the draw to the hand the
 * player was looking at, so a retried or double-fired request cannot draw
 * twice off one deck -- which here would be a second, free re-roll of the only
 * five cards that pay.
 *
 * No round id in the path because a player has at most one live hand; the id
 * in the body is checked against it rather than used to look it up, so it
 * cannot address anybody else's round.
 */
const actionSchema = z.object({
  roundId: z.string().uuid(),
  version: z.number().int().positive(),
  held: z.array(z.boolean()).length(VIDEO_POKER_HAND_SIZE),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:videopoker:draw", 240, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Choose which cards to hold, then draw." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await drawVideoPokerHand(token, parsed.data)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
