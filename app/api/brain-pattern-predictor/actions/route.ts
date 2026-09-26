import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  answerBrainPatternPredictor,
  resignBrainPatternPredictor,
  toBrainPatternPredictorErrorResponse,
} from "@/lib/server/brain-pattern-predictor-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const answerSchema = z.object({ action: z.literal("answer"), version: z.number().int().positive(), given: z.string().min(1).max(200) });
const resignSchema = z.object({ action: z.literal("resign") });
const bodySchema = z.discriminatedUnion("action", [answerSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "brain-pattern-predictor:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request, NextResponse.json({ error: "Send an answer." }, { status: 400 }), token);
    }

    // Cash out pays the ladder here, so it is gated the same as an answer.
    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignBrainPatternPredictor(token)
      : await answerBrainPatternPredictor(token, { version: parsed.data.version, given: parsed.data.given });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBrainPatternPredictorErrorResponse(error), token);
  }
}
