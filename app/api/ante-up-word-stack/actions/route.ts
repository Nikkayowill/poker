import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  playAnteUpWordStack,
  resignAnteUpWordStackAttempt,
  toAnteUpWordStackErrorResponse,
} from "@/lib/server/ante-up-word-stack-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up: Word Stack attempt -- same split as
 * app/api/ante-up/actions/route.ts (Sudoku): `guess` plays a word, `resign`
 * gives up early.
 */
const guessSchema = z.object({
  action: z.literal("guess"),
  version: z.number().int().positive(),
  guess: z.string().min(1).max(16),
});

const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [guessSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-word-stack:act", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a guess." }, { status: 400 }),
        token,
      );
    }

    if (parsed.data.action === "guess" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignAnteUpWordStackAttempt(token)
      : await playAnteUpWordStack(token, { version: parsed.data.version, guess: parsed.data.guess });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpWordStackErrorResponse(error), token);
  }
}
