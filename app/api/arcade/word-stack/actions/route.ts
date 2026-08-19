import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { playWordStackGuess, toWordStackErrorResponse } from "@/lib/server/word-stack-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Play one guess against today's board.
 *
 * `day` and `version` are both required and both load-bearing. The day catches
 * a board that rolled over at 00:00 UTC while the player was staring at it --
 * without it, a guess typed at 23:59 lands on a word they have never seen. The
 * version pins the guess to the state they were looking at, so a double-fired
 * submit cannot spend two of their six guesses on one word.
 *
 * No puzzle id in the path because a player has at most one board per day; the
 * day in the body is checked against the server's own clock rather than used
 * to look anything up, so it cannot address another day's puzzle or anyone
 * else's board.
 *
 * The guess is validated against the word list on the server. That check
 * cannot move to the client: the list is the shape of the answer space, and a
 * browser holding it could filter it against the tiles already shown.
 */
const actionSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  version: z.number().int().positive(),
  // Length is bounded here as well as in the engine so a megabyte of "guess"
  // never reaches a Set lookup.
  guess: z.string().trim().min(1).max(16),
});

export async function POST(request: NextRequest) {
  // Six guesses a day makes anything past this a script, but the limit is
  // generous enough to absorb a player retyping into a bad connection.
  const limited = enforceRateLimit(request, "arcade:word-stack:guess", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "A guess is five letters." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await playWordStackGuess(token, parsed.data)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toWordStackErrorResponse(error), token);
  }
}
