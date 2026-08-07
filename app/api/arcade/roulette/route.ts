import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { placeRouletteBet, readRouletteRound } from "@/lib/server/roulette-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { POCKET_COUNT } from "@/lib/arcade/roulette";
import { STAKES_TIERS } from "@/lib/game/tiers";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The bet, as a discriminated union rather than a `{ kind, selection }` pair.
 *
 * This is what refuses "the 7th column" and "pocket 40" at the edge of the
 * app, so nothing downstream has to decide what an out-of-range selection
 * means. The service re-checks with `isLegalBet` anyway -- a schema is a shape
 * and a layout is a meaning -- but the two agreeing is not an accident: the
 * bounds below are read from POCKET_COUNT, not typed out.
 */
const betSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("straight"), pocket: z.number().int().min(0).max(POCKET_COUNT - 1) }),
  z.object({ kind: z.literal("colour"), colour: z.enum(["red", "black"]) }),
  z.object({ kind: z.literal("parity"), parity: z.enum(["odd", "even"]) }),
  z.object({ kind: z.literal("half"), half: z.enum(["low", "high"]) }),
  z.object({ kind: z.literal("dozen"), dozen: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ kind: z.literal("column"), column: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
]);

const placeSchema = z.object({
  tier: z.enum(STAKES_TIERS),
  bet: betSchema,
});

/**
 * Roulette.
 *
 * GET restores the caller's live bet -- a refresh must not lose a chip already
 * paid for -- and POST places one. The wheel is spun by the actions route, not
 * here; see the note in lib/server/roulette-service.ts for why those are two
 * requests rather than one.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readRouletteRound(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Every accepted call here debits Gold, so this is tighter than the poker
  // table's create limit -- a scripted loop is a wallet-drainer, not noise.
  const limited = enforceRateLimit(request, "arcade:roulette:bet", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = placeSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick a stake and a bet on the layout." }, { status: 400 }),
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
      NextResponse.json(await placeRouletteBet(token, parsed.data.tier, parsed.data.bet)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
