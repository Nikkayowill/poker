import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import { isDuelGameId } from "@/lib/pvp/registry";
import { isBanned } from "@/lib/server/profile-store";
import {
  listDuelChallenges,
  openDuelChallenge,
  readDuelMatch,
  toDuelErrorResponse,
} from "@/lib/server/pvp-match-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The duel lobby for one game.
 *
 * One dynamic route for all four rather than four copies, because nothing here
 * is game-specific: the `[game]` segment is resolved through lib/pvp/registry,
 * which is what stops a request naming an engine that is not offered. A fifth
 * duel is a registry entry and a page, not another route.
 *
 * GET answers "where do I stand" in one call: the live match if there is one,
 * the open challenges if there is not. The lobby renders both at once, and two
 * fetches would let it show a challenge list to somebody who is already
 * mid-game.
 *
 * POST opens a challenge, which debits the caller. The stake is escrowed until
 * somebody accepts, the challenger cancels, or it expires; see the ordering
 * rules in lib/server/pvp-match-service.ts.
 */

const openSchema = z.object({
  stake: z.number().int().min(MIN_DUEL_STAKE),
  /** Null/absent is an open challenge, which anyone may take. */
  opponentId: z.string().uuid().nullish(),
});

function resolveGame(game: string): string | null {
  return isDuelGameId(game) ? game : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ game: string }> },
) {
  const game = resolveGame((await context.params).game);
  const token = readOrCreateSessionToken(request);
  if (!game) {
    return withRequestSessionCookie(
      request,
      NextResponse.json({ error: "That game is not available." }, { status: 404 }),
      token,
    );
  }

  try {
    const [match, challenges] = await Promise.all([
      readDuelMatch(token, game),
      listDuelChallenges(token, game),
    ]);
    return withRequestSessionCookie(
      request,
      NextResponse.json({
        match: match.match,
        challenges: challenges.challenges,
        // The wallet comes from the match read: both calls return one, and
        // taking the later-resolving one would be a coin toss over which is
        // fresher.
        profile: match.profile,
      }),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toDuelErrorResponse(error), token);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ game: string }> },
) {
  // Every accepted call here escrows Gold, so this is tight: a scripted loop
  // would lock a wallet up in offers rather than just making noise.
  const limited = enforceRateLimit(request, "pvp:challenge", 30, 60 * 1000);
  if (limited) return limited;

  const game = resolveGame((await context.params).game);
  const token = readOrCreateSessionToken(request);
  if (!game) {
    return withRequestSessionCookie(
      request,
      NextResponse.json({ error: "That game is not available." }, { status: 404 }),
      token,
    );
  }

  try {
    const parsed = openSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json(
          { error: `Wager at least ${MIN_DUEL_STAKE.toLocaleString()} Gold to challenge at.` },
          { status: 400 },
        ),
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

    const result = await openDuelChallenge(
      token,
      game,
      parsed.data.stake,
      parsed.data.opponentId ?? null,
    );
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toDuelErrorResponse(error), token);
  }
}
