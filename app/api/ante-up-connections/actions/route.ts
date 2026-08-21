import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  playAnteUpConnections,
  resignAnteUpConnectionsAttempt,
  toAnteUpConnectionsErrorResponse,
} from "@/lib/server/ante-up-connections-service";
import { CONNECTIONS_GROUP_SIZE } from "@/lib/arcade/puzzles/connections";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up: Connections attempt -- same split as
 * app/api/ante-up/actions/route.ts (Sudoku): `guess` plays a selection of
 * four words, `resign` gives up early.
 */
const guessSchema = z.object({
  action: z.literal("guess"),
  version: z.number().int().positive(),
  selection: z.array(z.string().min(1).max(32)).length(CONNECTIONS_GROUP_SIZE),
});

const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [guessSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-connections:act", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send four words." }, { status: 400 }),
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
      ? await resignAnteUpConnectionsAttempt(token)
      : await playAnteUpConnections(token, { version: parsed.data.version, selection: parsed.data.selection });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpConnectionsErrorResponse(error), token);
  }
}
