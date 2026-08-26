import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  joinCribbageTable,
  leaveCribbageTable,
  playCribbageMove,
  readCribbageTableById,
  resignCribbageTable,
  startCribbageTableAsHost,
  toCribbageErrorResponse,
} from "@/lib/server/cribbage-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * One table: read it, join it, start it early, leave it, move in it, or
 * resign it. One route file discriminated on `action`, same shape
 * app/api/pvp/matches/[id]/route.ts uses for move/resign. join/start/leave
 * all act on this same table id, so a separate route segment per action
 * would just be the same id parsed four more times.
 *
 * `version` is required on a move and pins it to the exact state the player
 * was looking at, so a retried or double-fired request cannot move twice.
 */

const joinSchema = z.object({ action: z.literal("join") });
const startSchema = z.object({ action: z.literal("start") });
const leaveSchema = z.object({ action: z.literal("leave") });
const moveSchema = z.object({
  action: z.literal("move"),
  version: z.number().int().positive(),
  move: z.unknown(),
});
const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [
  joinSchema,
  startSchema,
  leaveSchema,
  moveSchema,
  resignSchema,
]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readCribbageTableById(token, id)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCribbageErrorResponse(error), token);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // Generous compared with opening a table: nothing here except a move
  // that ends the table moves Gold, and the version guard already makes
  // that idempotent.
  const limited = enforceRateLimit(request, "cribbage:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send an action." }, { status: 400 }),
        token,
      );
    }

    // Leaving and resigning are both ways of walking away from your own
    // stake, and a suspended account must still be able to do that. Joining,
    // starting, or continuing to play (any of which could win a payout) is
    // what's gated, same posture the pvp routes take.
    const gated = parsed.data.action === "join" || parsed.data.action === "start" || parsed.data.action === "move";
    if (gated && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = await (async () => {
      switch (parsed.data.action) {
        case "join":
          return joinCribbageTable(token, id);
        case "start":
          return startCribbageTableAsHost(token, id);
        case "leave":
          return leaveCribbageTable(token, id);
        case "move":
          return playCribbageMove(token, { tableId: id, version: parsed.data.version, move: parsed.data.move });
        case "resign":
          return resignCribbageTable(token, id);
      }
    })();
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toCribbageErrorResponse(error), token);
  }
}
