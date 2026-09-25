import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  guessBrainWordGuessLetter,
  resignBrainWordGuessAttempt,
  toBrainWordGuessErrorResponse,
} from "@/lib/server/brain-word-guess-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const guessSchema = z.object({
  action: z.literal("guess"),
  version: z.number().int().positive(),
  letter: z.string().length(1),
});
const resignSchema = z.object({ action: z.literal("resign") });
const bodySchema = z.discriminatedUnion("action", [guessSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "brain-word-guess:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request, NextResponse.json({ error: "Guess a letter." }, { status: 400 }), token);
    }

    if (parsed.data.action === "guess" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignBrainWordGuessAttempt(token)
      : await guessBrainWordGuessLetter(token, { version: parsed.data.version, letter: parsed.data.letter });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBrainWordGuessErrorResponse(error), token);
  }
}
