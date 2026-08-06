import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { playConnectionsGuess, toConnectionsErrorResponse } from "@/lib/server/connections-service";
import { CONNECTIONS_GROUP_SIZE } from "@/lib/arcade/puzzles/connections";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Submit one selection of four words against today's board.
 *
 * `day` and `version` do the same two jobs they do at Wordle: catch a board
 * that rolled over at 00:00 UTC, and stop a double-fired submit from spending
 * two of the player's four mistakes on one selection.
 *
 * The selection is words, not indices. Indices would be shorter and would
 * couple the client's tile order to the server's -- the board is shuffled per
 * player, so an off-by-one there would submit a group the player never picked
 * and charge them a mistake for it.
 */
const actionSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  version: z.number().int().positive(),
  selection: z.array(z.string().trim().min(1).max(24)).length(CONNECTIONS_GROUP_SIZE),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:connections:guess", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick four words." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await playConnectionsGuess(token, parsed.data)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toConnectionsErrorResponse(error), token);
  }
}
