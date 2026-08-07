import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dealBaccarat } from "@/lib/server/baccarat-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Deal the coup on the caller's live bet.
 *
 * The body carries nothing but which round is being dealt and at what version,
 * because after the bet there is nothing left to choose: punto banco's tableau
 * plays every card. `version` pins the deal to the bet the player was looking
 * at, so a retried or double-fired request cannot deal one bet twice.
 */
const actionSchema = z.object({
  roundId: z.string().uuid(),
  version: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:baccarat:deal", 240, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "There is no bet on the felt to deal." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await dealBaccarat(token, parsed.data)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
