import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STAKES_TIERS } from "@/lib/game/tiers";
import { isBanned } from "@/lib/server/profile-store";
import {
  openSitAndGoTable,
  readSitAndGoLobby,
  toSitAndGoErrorResponse,
} from "@/lib/server/sit-and-go-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The Sit & Go lobby.
 *
 * GET answers "where do I stand" in one call, same shape as
 * app/api/cribbage/route.ts: the caller's own live registration if there is
 * one, otherwise every open table across every tier -- via readSitAndGoLobby,
 * which resolves the caller's profile exactly once for both branches (a
 * plain readMySitAndGoTable-then-listOpenSitAndGoTables sequence, cribbage's
 * own route shape, would resolve it twice for anyone just browsing).
 *
 * POST opens a table at the chosen tier, which DEBITS the caller and
 * registers them at seat 0. The table deals the instant its 6th seat fills
 * -- there is no host-early-start here, unlike cribbage, since a Sit & Go
 * has no bot fill to cover a short-handed table. See
 * lib/server/sit-and-go-service.ts.
 */

const openSchema = z.object({
  tier: z.enum(STAKES_TIERS),
});

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "sit-and-go:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const lobby = await readSitAndGoLobby(token);
    return withRequestSessionCookie(request, NextResponse.json(lobby), token);
  } catch (error) {
    return withRequestSessionCookie(request, toSitAndGoErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Every accepted call here escrows Gold, same posture as cribbage:open.
  const limited = enforceRateLimit(request, "sit-and-go:open", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = openSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Choose a real stakes tier to open a table." }, { status: 400 }),
        token,
      );
    }
    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = await openSitAndGoTable(token, parsed.data.tier);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toSitAndGoErrorResponse(error), token);
  }
}
