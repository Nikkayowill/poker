import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dealVideoPokerHand, readVideoPokerRound } from "@/lib/server/video-poker-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { STAKES_TIERS } from "@/lib/game/tiers";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const dealSchema = z.object({
  tier: z.enum(STAKES_TIERS),
});

/**
 * Video Poker.
 *
 * GET restores the caller's live hand -- a refresh mid-hand must not lose five
 * cards they have already paid for -- and POST deals a new one. Both are thin;
 * the rules live in lib/arcade/video-poker.ts and the wallet ordering in
 * lib/server/casino-round-service.ts.
 *
 * The browser never receives the deck. What comes back is
 * toVideoPokerSnapshot()'s redacted view: the five cards on the glass, never
 * the ones queued behind the draw.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readVideoPokerRound(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Every accepted call here debits Gold, so this is tighter than the poker
  // table's create limit -- a scripted loop is a wallet-drainer, not noise.
  const limited = enforceRateLimit(request, "arcade:videopoker:deal", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = dealSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick a stake to deal." }, { status: 400 }),
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
      NextResponse.json(await dealVideoPokerHand(token, parsed.data.tier)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
