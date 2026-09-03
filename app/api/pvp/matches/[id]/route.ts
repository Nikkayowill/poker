import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  playDuelMove,
  readDuelMatchById,
  resignDuelMatch,
  toDuelErrorResponse,
} from "@/lib/server/pvp-match-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * One match: read it, move in it, or resign it.
 *
 * `version` is required on a move and is not advisory. It pins the move to the
 * exact state the player was looking at, so a retried or double-fired request
 * cannot move twice, or answer one trivia question with two submissions. The
 * service re-reads the match by id and checks the caller is one of its two
 * players, so an id here cannot address anybody else's game.
 *
 * `move` stays untyped at this layer: `unknown` passed through to the engine,
 * which is the only thing that knows what a legal move looks like for its own
 * game. The shape check that matters is the engine's `applyMove`, which must
 * treat whatever arrives as a claim rather than an instruction.
 */
const moveSchema = z.object({
  action: z.literal("move"),
  version: z.number().int().positive(),
  move: z.unknown(),
});

const resignSchema = z.object({
  action: z.literal("resign"),
});

const bodySchema = z.discriminatedUnion("action", [moveSchema, resignSchema]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "pvp:match:read", 180, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readDuelMatchById(token, id)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toDuelErrorResponse(error), token);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // Generous compared with the challenge limits: a blitz game is a lot of
  // legitimate moves, and nothing here moves Gold except the one move that
  // ends the match, which the version guard already makes idempotent.
  const limited = enforceRateLimit(request, "pvp:match:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a move." }, { status: 400 }),
        token,
      );
    }

    // Resigning is forfeiting your own match, and a suspended account must
    // still be able to do that. Continuing to play (and potentially win a
    // payout) is what's gated, same posture as challenge accept vs. cancel.
    if (parsed.data.action === "move" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignDuelMatch(token, id)
      : await playDuelMove(token, {
        matchId: id,
        version: parsed.data.version,
        move: parsed.data.move,
      });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toDuelErrorResponse(error), token);
  }
}
