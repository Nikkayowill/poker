import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resignBrainLightsOutAttempt,
  tapBrainLightsOutAttempt,
  toBrainLightsOutErrorResponse,
} from "@/lib/server/brain-lights-out-service";
import { LIGHTS_OUT_SIZE } from "@/lib/arcade/brain-lights-out";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const tapSchema = z.object({
  action: z.literal("tap"),
  version: z.number().int().positive(),
  index: z.number().int().min(0).max(LIGHTS_OUT_SIZE * LIGHTS_OUT_SIZE - 1),
});
const resignSchema = z.object({ action: z.literal("resign") });
const bodySchema = z.discriminatedUnion("action", [tapSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "brain-lights-out:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request, NextResponse.json({ error: "Tap a tile." }, { status: 400 }), token);
    }

    if (parsed.data.action === "tap" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignBrainLightsOutAttempt(token)
      : await tapBrainLightsOutAttempt(token, { version: parsed.data.version, index: parsed.data.index });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBrainLightsOutErrorResponse(error), token);
  }
}
