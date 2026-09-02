import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  hintAnteUpNonogramAttempt,
  playAnteUpNonogram,
  resignAnteUpNonogramAttempt,
  strokeAnteUpNonogramCells,
  toAnteUpNonogramErrorResponse,
  undoAnteUpNonogramStroke,
} from "@/lib/server/ante-up-nonogram-service";
import { NONOGRAM_MAX_CELLS } from "@/lib/arcade/puzzles/nonogram";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up: Nonogram attempt.
 *
 * `mark` puts a fill, a cross or a clear on one square and `stroke` does the
 * same across a dragged run of them; `undo` takes the last stroke back; `hint`
 * buys a square for a mistake; `resign` gives up early.
 *
 * One action for all three marks rather than three, unlike Minesweeper's
 * reveal/flag/chord: those are three different rules, while these are one rule
 * over three values, and the engine already refuses whichever the board does
 * not allow.
 *
 * The index bound here is only the outer edge of the largest board; the real
 * per-round bound is the engine's, since the board size depends on the
 * difficulty this particular attempt was opened at. A stroke is bounded by the
 * same number of squares, since the longest legal drag is a whole board.
 */
const cellIndex = z.number().int().min(0).max(NONOGRAM_MAX_CELLS - 1);

const markSchema = z.object({
  action: z.literal("mark"),
  version: z.number().int().positive(),
  index: cellIndex,
  mark: z.enum(["fill", "cross", "clear"]),
});
const strokeSchema = z.object({
  action: z.literal("stroke"),
  version: z.number().int().positive(),
  indexes: z.array(cellIndex).min(1).max(NONOGRAM_MAX_CELLS),
  mark: z.enum(["fill", "cross", "clear"]),
});
const undoSchema = z.object({
  action: z.literal("undo"),
  version: z.number().int().positive(),
});
const hintSchema = z.object({
  action: z.literal("hint"),
  version: z.number().int().positive(),
});
const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [
  markSchema,
  strokeSchema,
  undoSchema,
  hintSchema,
  resignSchema,
]);

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-nonogram:act", 900, 60 * 1000);
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

    const body = parsed.data;
    const result =
      body.action === "resign"
        ? await resignAnteUpNonogramAttempt(token)
        : body.action === "stroke"
          ? await strokeAnteUpNonogramCells(token, {
              version: body.version,
              indexes: body.indexes,
              mark: body.mark,
            })
          : body.action === "undo"
            ? await undoAnteUpNonogramStroke(token, { version: body.version })
            : body.action === "hint"
              ? await hintAnteUpNonogramAttempt(token, { version: body.version })
              : await playAnteUpNonogram(token, {
                  version: body.version,
                  index: body.index,
                  mark: body.mark,
                });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpNonogramErrorResponse(error), token);
  }
}
