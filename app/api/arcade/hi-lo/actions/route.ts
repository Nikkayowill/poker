import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { playHiLoCall, toHiLoErrorResponse } from "@/lib/server/hi-lo-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Call higher or lower on the caller's live round.
 *
 * `version` is not optional and not advisory: the service pins the call to
 * the exact state the player was looking at, so a retried or double-fired
 * request cannot draw a second card from the same deck. In this game that
 * would be a free re-roll of the only card that decides anything, so the
 * guard matters more here than it does at blackjack.
 *
 * No round id in the path because a player has at most one live Hi-Lo round;
 * the id in the body is checked against it rather than used to look it up, so
 * it cannot address anybody else's round.
 */
const actionSchema = z.object({
  roundId: z.string().uuid(),
  version: z.number().int().positive(),
  call: z.enum(["higher", "lower"]),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:hilo:call", 240, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "Call higher or lower." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(request, NextResponse.json(await playHiLoCall(token, parsed.data)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toHiLoErrorResponse(error), token);
  }
}
