import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readCoinFlipRound, startCoinFlipRun } from "@/lib/server/coin-flip-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { STAKES_TIERS } from "@/lib/game/tiers";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const startSchema = z.object({
  tier: z.enum(STAKES_TIERS),
});

/**
 * Coin Flip.
 *
 * GET restores the caller's live run -- a refresh must not drop a pot that has
 * already been ridden up -- and POST buys a new one. The flips themselves are
 * the actions route.
 *
 * One stake buys a whole run, however long it gets, so this is the only place
 * Gold is taken. Every later request either compounds the pot or ends it.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readCoinFlipRound(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:coinflip:start", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick a stake to start a run." }, { status: 400 }),
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
      NextResponse.json(await startCoinFlipRun(token, parsed.data.tier)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
