import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  joinHeadsUpTable,
  leaveHeadsUpTable,
  readHeadsUpTableById,
  toHeadsUpErrorResponse,
} from "@/lib/server/heads-up-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * One heads-up table: read it, join it (an open quick-play table, or one a
 * friend invited you to), or leave it before it deals. There's no move/act
 * action here -- once both seats fill, play happens through the ordinary
 * poker routes (app/api/games/[id]/actions, /advance) against the real
 * game_id this table dealt into, not against this table's own id.
 */

const joinSchema = z.object({ action: z.literal("join") });
const leaveSchema = z.object({ action: z.literal("leave") });
const bodySchema = z.discriminatedUnion("action", [joinSchema, leaveSchema]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "heads-up:table:read", 180, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readHeadsUpTableById(token, id)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toHeadsUpErrorResponse(error), token);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "heads-up:act", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request, NextResponse.json({ error: "Send an action." }, { status: 400 }), token);
    }

    // Leaving is walking away from your own stake before anything is at
    // risk, so a suspended account must still be able to do that -- joining
    // (which stakes Gold) is what's gated, same posture cribbage's route
    // takes.
    if (parsed.data.action === "join" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "join"
      ? await joinHeadsUpTable(token, id)
      : await leaveHeadsUpTable(token, id);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toHeadsUpErrorResponse(error), token);
  }
}
