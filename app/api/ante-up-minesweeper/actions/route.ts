import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  playAnteUpMinesweeper,
  resignAnteUpMinesweeperAttempt,
  toAnteUpMinesweeperErrorResponse,
} from "@/lib/server/ante-up-minesweeper-service";
import { MINESWEEPER_MAX_CELLS } from "@/lib/arcade/puzzles/minesweeper";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up: Minesweeper attempt -- same split as
 * app/api/ante-up/actions/route.ts (Sudoku): `reveal` opens a square, `flag`
 * marks one, `chord` opens everything around a satisfied number, and `resign`
 * gives up early.
 *
 * The index bound here is only the outer edge of the largest board; the real
 * per-round bound is the engine's, since the board size depends on the
 * difficulty this particular attempt was opened at.
 */
const cellSchema = {
  version: z.number().int().positive(),
  index: z.number().int().min(0).max(MINESWEEPER_MAX_CELLS - 1),
};

const revealSchema = z.object({ action: z.literal("reveal"), ...cellSchema });
const flagSchema = z.object({ action: z.literal("flag"), ...cellSchema });
const chordSchema = z.object({ action: z.literal("chord"), ...cellSchema });
const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [
  revealSchema,
  flagSchema,
  chordSchema,
  resignSchema,
]);

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-minesweeper:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a square." }, { status: 400 }),
        token,
      );
    }

    if (parsed.data.action !== "resign" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result =
      parsed.data.action === "resign"
        ? await resignAnteUpMinesweeperAttempt(token)
        : await playAnteUpMinesweeper(token, {
            version: parsed.data.version,
            action: parsed.data.action,
            index: parsed.data.index,
          });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpMinesweeperErrorResponse(error), token);
  }
}
