import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readSudokuRound, startSudoku, toSudokuErrorResponse } from "@/lib/server/sudoku-service";
import { SUDOKU_DIFFICULTIES } from "@/lib/arcade/puzzles/sudoku";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Daily Sudoku.
 *
 * GET reads the caller's attempt at today's board -- finished or not -- and
 * POST opens one. Four difficulties are four separate boards with four
 * separate attempts, so the difficulty is required on both.
 *
 * The browser never receives the solution. What comes back is
 * toSudokuSnapshot()'s redacted view: the givens, the player's own entries and
 * their mistake count, and nothing that would let a client fill a cell it has
 * not earned.
 */
const difficultySchema = z.enum(SUDOKU_DIFFICULTIES);

const startSchema = z.object({
  difficulty: difficultySchema,
});

export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  const parsed = difficultySchema.safeParse(request.nextUrl.searchParams.get("difficulty"));
  if (!parsed.success) {
    return withRequestSessionCookie(
      request,
      NextResponse.json({ error: "Pick a difficulty." }, { status: 400 }),
      token,
    );
  }
  try {
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readSudokuRound(token, parsed.data)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toSudokuErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Free to play, so this is only about keeping a scripted loop from carving
  // boards -- generation is the most expensive thing in the arcade.
  const limited = enforceRateLimit(request, "arcade:sudoku:start", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick a difficulty." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await startSudoku(token, parsed.data.difficulty)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toSudokuErrorResponse(error), token);
  }
}
