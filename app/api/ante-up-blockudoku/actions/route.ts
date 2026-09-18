import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  placeAnteUpBlockudoku,
  resignAnteUpBlockudokuAttempt,
  toAnteUpBlockudokuErrorResponse,
} from "@/lib/server/ante-up-blockudoku-service";
import { GRID_SIDE, INVENTORY_SIZE } from "@/lib/arcade/puzzles/blockudoku";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up: Blockudoku attempt. `place` drops the
 * piece in one tray slot with its top-left corner on (row, col); `resign`
 * gives up early. Same split as app/api/ante-up-minesweeper/actions/route.ts.
 *
 * The client only names a slot and a cell. Whether the piece fits, what it
 * clears and what it scores are all the engine's call.
 */
const placeSchema = z.object({
  action: z.literal("place"),
  version: z.number().int().positive(),
  slot: z.number().int().min(0).max(INVENTORY_SIZE - 1),
  row: z.number().int().min(0).max(GRID_SIDE - 1),
  col: z.number().int().min(0).max(GRID_SIDE - 1),
});
const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [placeSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "ante-up-blockudoku:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a piece and a square." }, { status: 400 }),
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
        ? await resignAnteUpBlockudokuAttempt(token)
        : await placeAnteUpBlockudoku(token, {
            version: parsed.data.version,
            slot: parsed.data.slot,
            row: parsed.data.row,
            col: parsed.data.col,
          });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpBlockudokuErrorResponse(error), token);
  }
}
