import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fillSudoku, toSudokuErrorResponse } from "@/lib/server/sudoku-service";
import { SUDOKU_CELLS, SUDOKU_DIFFICULTIES, SUDOKU_SIZE } from "@/lib/arcade/puzzles/sudoku";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Write one digit into the caller's board.
 *
 * One request per cell, because the server is the only thing that knows the
 * answer -- see the note at the top of lib/arcade/puzzles/sudoku.ts for why
 * that is worth a round trip per digit rather than handing the client a
 * solution to check against.
 *
 * `value: 0` erases. It is inside the same range check rather than a separate
 * verb because erasing is a fill of nothing, and the engine already refuses to
 * count it as a mistake.
 *
 * The bounds are read from the engine's own constants, so a nine-by-nine that
 * ever became something else could not leave this schema behind.
 */
const actionSchema = z.object({
  difficulty: z.enum(SUDOKU_DIFFICULTIES),
  version: z.number().int().positive(),
  index: z.number().int().min(0).max(SUDOKU_CELLS - 1),
  value: z.number().int().min(0).max(SUDOKU_SIZE),
});

export async function POST(request: NextRequest) {
  // Generous: a fast solver legitimately fires one of these every second or
  // two for several minutes.
  const limited = enforceRateLimit(request, "arcade:sudoku:fill", 400, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick a cell and a digit." }, { status: 400 }),
        token,
      );
    }
    const { difficulty, ...fill } = parsed.data;
    return withRequestSessionCookie(
      request,
      NextResponse.json(await fillSudoku(token, difficulty, fill)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toSudokuErrorResponse(error), token);
  }
}
