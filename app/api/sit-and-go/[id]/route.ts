import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  joinSitAndGoTable,
  leaveSitAndGoTable,
  readSitAndGoTableById,
  toSitAndGoErrorResponse,
} from "@/lib/server/sit-and-go-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * One table's registration: read it, join it, or leave it before it deals.
 *
 * There is no "start" or "move" or "resign" action here, unlike
 * app/api/cribbage/[id]/route.ts -- once a table deals, play happens
 * entirely through the ordinary poker routes
 * (app/api/games/[id]/actions|advance) against the gameId this table
 * carries. This route's whole job ends at "the table is now active."
 */

const joinSchema = z.object({ action: z.literal("join") });
const leaveSchema = z.object({ action: z.literal("leave") });

const bodySchema = z.discriminatedUnion("action", [joinSchema, leaveSchema]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readSitAndGoTableById(token, id)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toSitAndGoErrorResponse(error), token);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // Joining escrows Gold; leaving doesn't (it refunds). Generous either way,
  // same posture as cribbage:act -- there's no version-guarded move here to
  // worry about racing.
  const limited = enforceRateLimit(request, "sit-and-go:act", 60, 60 * 1000);
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

    // Leaving is walking away from your own stake, and a suspended account
    // must still be able to do that -- same posture the cribbage route
    // takes for leave/resign. Joining (which stakes Gold) is what's gated.
    if (parsed.data.action === "join" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = await (async () => {
      switch (parsed.data.action) {
        case "join":
          return joinSitAndGoTable(token, id);
        case "leave":
          return leaveSitAndGoTable(token, id);
      }
    })();
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toSitAndGoErrorResponse(error), token);
  }
}
