import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  fillAnteUpAttempt,
  resignAnteUp,
  toAnteUpErrorResponse,
} from "@/lib/server/ante-up-service";
import { SUDOKU_CELLS, SUDOKU_SIZE } from "@/lib/arcade/puzzles/sudoku";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up attempt. There is at most one, so
 * unlike a duel match this needs no id in the URL. `fill` writes one digit;
 * `resign` gives up early. Same split as app/api/pvp/matches/[id]/route.ts.
 */
const fillSchema = z.object({
  action: z.literal("fill"),
  version: z.number().int().positive(),
  index: z.number().int().min(0).max(SUDOKU_CELLS - 1),
  value: z.number().int().min(0).max(SUDOKU_SIZE),
});

const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [fillSchema, resignSchema]);

export async function POST(request: NextRequest) {
  // Generous, matching pvp:match:act: a fast solver fires several of these
  // a second, and nothing here moves Gold except the fill that wins, which
  // the version guard already makes idempotent.
  const limited = enforceRateLimit(request, "ante-up:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a cell and a digit." }, { status: 400 }),
        token,
      );
    }

    // Resigning forfeits your own attempt, and a suspended account must
    // still be able to do that. Continuing to fill (and potentially win a
    // payout) is what's gated, same posture as the duel match route.
    if (parsed.data.action === "fill" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignAnteUp(token)
      : await fillAnteUpAttempt(token, {
        version: parsed.data.version,
        index: parsed.data.index,
        value: parsed.data.value,
      });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpErrorResponse(error), token);
  }
}
