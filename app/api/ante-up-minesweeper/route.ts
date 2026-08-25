import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  openAnteUpMinesweeper,
  readAnteUpMinesweeper,
  toAnteUpMinesweeperErrorResponse,
} from "@/lib/server/ante-up-minesweeper-service";
import { MIN_ANTE_UP_WAGER } from "@/lib/arcade/ante-up-minesweeper";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/** Ante Up: Minesweeper's lobby. Same shape as app/api/ante-up/route.ts (Sudoku). */
const startSchema = z.object({
  difficulty: z.string().min(1).max(20),
  wager: z.number().int().min(0),
});

export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readAnteUpMinesweeper(token)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpMinesweeperErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-minesweeper:start", 30, 60 * 1000);
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

    const result = await openAnteUpMinesweeper(token, parsed.data.difficulty, parsed.data.wager);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpMinesweeperErrorResponse(error), token);
  }
}
