import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { openAnteUpAttempt, readAnteUpAttempt, toAnteUpErrorResponse } from "@/lib/server/ante-up-service";
import { MIN_ANTE_UP_WAGER } from "@/lib/arcade/ante-up";
import { SUDOKU_DIFFICULTIES } from "@/lib/arcade/puzzles/sudoku";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Ante Up: Sudoku's lobby.
 *
 * GET reads the caller's live attempt, if there is one. POST opens a fresh
 * one, which DEBITS the caller when the wager is nonzero -- see the ordering
 * rules in lib/server/ante-up-service.ts.
 */
const startSchema = z.object({
  difficulty: z.enum(SUDOKU_DIFFICULTIES),
  // 0 is a real wager (free practice, no payout) -- see MIN_ANTE_UP_WAGER's
  // doc comment for why a nonzero one still needs a floor.
  wager: z.number().int().min(0),
});

export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readAnteUpAttempt(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // A wagered start moves Gold, same tightness as pvp:challenge.
  const limited = enforceRateLimit(request, "ante-up:start", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json(
          { error: `Pick a difficulty, and wager 0 or at least ${MIN_ANTE_UP_WAGER.toLocaleString()}.` },
          { status: 400 },
        ),
        token,
      );
    }
    if (parsed.data.wager > 0 && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = await openAnteUpAttempt(token, parsed.data.difficulty, parsed.data.wager);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpErrorResponse(error), token);
  }
}
