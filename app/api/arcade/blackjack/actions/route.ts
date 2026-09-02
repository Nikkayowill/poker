import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  actOnBlackjackRound,
  toBlackjackErrorResponse,
} from "@/lib/server/blackjack-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Hit, stand, double or resign on the caller's live round.
 *
 * `version` is not optional and is not advisory: the service pins the action
 * to the exact state the player was looking at, so a retried or double-fired
 * request cannot draw a second card from the same deck. A client that has
 * fallen behind gets a 409 carrying the real round to re-render from.
 *
 * There is no round id in the path because a player has at most one live
 * round; the id in the body is checked against it rather than used to look it
 * up, so it cannot address anybody else's hand.
 */
const actionSchema = z.object({
  roundId: z.string().uuid(),
  version: z.number().int().positive(),
  action: z.enum(["hit", "stand", "double", "resign"]),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:blackjack:act", 240, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "That is not a move this table takes." }, { status: 400 }),
        token,
      );
    }
    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = await actOnBlackjackRound(token, parsed.data);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBlackjackErrorResponse(error), token);
  }
}
