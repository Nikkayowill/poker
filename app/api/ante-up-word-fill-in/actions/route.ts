import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  clearAnteUpWordFillIn,
  placeAnteUpWordFillIn,
  resignAnteUpWordFillInAttempt,
  toAnteUpWordFillInErrorResponse,
} from "@/lib/server/ante-up-word-fill-in-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up: Word Fill-In attempt.
 *
 * `place` drops a list word into a slot, `clear` empties one, `resign` gives
 * up. The slot bound here is loose on purpose; the engine checks it against
 * this attempt's own grid.
 */
const slotIndex = z.number().int().min(0).max(31);

const placeSchema = z.object({
  action: z.literal("place"),
  version: z.number().int().positive(),
  slot: slotIndex,
  word: z.string().regex(/^[A-Za-z]{3,9}$/),
});
const clearSchema = z.object({
  action: z.literal("clear"),
  version: z.number().int().positive(),
  slot: slotIndex,
});
const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [placeSchema, clearSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "ante-up-word-fill-in:act", 300, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a slot and a word." }, { status: 400 }),
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
        ? await resignAnteUpWordFillInAttempt(token)
        : body.action === "clear"
          ? await clearAnteUpWordFillIn(token, { version: body.version, slot: body.slot })
          : await placeAnteUpWordFillIn(token, {
              version: body.version,
              slot: body.slot,
              word: body.word,
            });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpWordFillInErrorResponse(error), token);
  }
}
