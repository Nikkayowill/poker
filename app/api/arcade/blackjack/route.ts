import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  dealBlackjackRound,
  readBlackjackRound,
  toBlackjackErrorResponse,
} from "@/lib/server/blackjack-service";
import { STAKES_TIERS } from "@/lib/game/tiers";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

// A deal is either a real stake off the ladder, or Blackjack's own free
// practice mode -- lib/server/blackjack-service.ts's dealBlackjackRound takes
// the same two shapes.
const dealSchema = z.union([
  z.object({ tier: z.enum(STAKES_TIERS) }),
  z.object({ practice: z.literal(true) }),
]);

/**
 * The arcade Blackjack table.
 *
 * GET restores the caller's live round (a refresh mid-hand must not lose a
 * hand they have already paid for); POST deals a new one. Both are thin --
 * the rules, the ordering guarantees and the wallet all live in
 * lib/server/blackjack-service.ts.
 *
 * The browser never receives the deck. What comes back is
 * toBlackjackSnapshot()'s redacted view, which omits the undealt cards
 * entirely and withholds the dealer's hole card until the dealer's turn.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    const result = await readBlackjackRound(token);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBlackjackErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Deliberately tighter than the poker table's create limit: every accepted
  // call here debits Gold, so a scripted loop is a wallet-drainer rather than
  // just noise.
  const limited = enforceRateLimit(request, "arcade:blackjack:deal", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = dealSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "Pick a stake to deal." }, { status: 400 }),
        token,
      );
    }
    if (await isBanned(token)) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = "practice" in parsed.data
      ? await dealBlackjackRound(token, { practice: true })
      : await dealBlackjackRound(token, { tier: parsed.data.tier });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBlackjackErrorResponse(error), token);
  }
}
