import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { placeBaccaratBet, readBaccaratRound } from "@/lib/server/baccarat-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { STAKES_TIERS } from "@/lib/game/tiers";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const placeSchema = z.object({
  tier: z.enum(STAKES_TIERS),
  bet: z.enum(["player", "banker", "tie"]),
});

/**
 * Baccarat.
 *
 * GET restores the caller's live bet -- a refresh must not lose a chip already
 * paid for -- and POST places one. The cards are dealt by the actions route;
 * see the note in lib/server/baccarat-service.ts for why those are two
 * requests rather than one.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readBaccaratRound(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:baccarat:bet", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = placeSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick a stake and back player, banker or tie." }, { status: 400 }),
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
    return withRequestSessionCookie(
      request,
      NextResponse.json(await placeBaccaratBet(token, parsed.data.tier, parsed.data.bet)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
