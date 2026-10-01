import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  answerBrainSequenceRecall,
  resignBrainSequenceRecall,
  toBrainSequenceRecallErrorResponse,
} from "@/lib/server/brain-sequence-recall-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/** Acts on the caller's own live Sequence Recall run: `answer` submits the repeated pattern, `resign` cashes out early. */
// A generous cap, not 200: the sequence grows by one entry every correct
// answer, so an exceptional streak's own answer string can run well past a
// short-answer game's length -- and a cap that clips a genuinely correct
// answer would wrongly end an otherwise-earned run.
const answerSchema = z.object({ action: z.literal("answer"), version: z.number().int().positive(), given: z.string().min(1).max(4000) });
const resignSchema = z.object({ action: z.literal("resign") });
const bodySchema = z.discriminatedUnion("action", [answerSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "brain-sequence-recall:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request, NextResponse.json({ error: "Send an answer." }, { status: 400 }), token);
    }

    if (parsed.data.action === "answer" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignBrainSequenceRecall(token)
      : await answerBrainSequenceRecall(token, { version: parsed.data.version, given: parsed.data.given });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBrainSequenceRecallErrorResponse(error), token);
  }
}
