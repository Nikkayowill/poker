import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import { isBanned } from "@/lib/server/profile-store";
import {
  listOpenCribbageTables,
  openCribbageTable,
  readMyCribbageTable,
  toCribbageErrorResponse,
} from "@/lib/server/cribbage-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The cribbage lobby.
 *
 * GET answers "where do I stand" in one call, same shape as
 * app/api/pvp/[game]/route.ts: the caller's own live table if there is one
 * (so the lobby cannot show an open-table list to somebody already seated),
 * otherwise every open table across every stake.
 *
 * POST opens a table, which DEBITS the caller and seats them at seat 0. The
 * table waits for 2 more (auto-starts at 4) or lets the host start early
 * once a 3rd is seated -- see lib/server/cribbage-service.ts.
 */

const openSchema = z.object({
  stake: z.number().int().min(MIN_DUEL_STAKE),
});

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "cribbage:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const mine = await readMyCribbageTable(token);
    if (mine.table) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ table: mine.table, tables: [], profile: mine.profile }),
        token,
      );
    }

    const open = await listOpenCribbageTables(token);
    return withRequestSessionCookie(
      request,
      NextResponse.json({ table: null, tables: open.tables, profile: open.profile }),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toCribbageErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Every accepted call here escrows Gold, same posture as pvp:challenge.
  const limited = enforceRateLimit(request, "cribbage:open", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = openSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json(
          { error: `Wager at least ${MIN_DUEL_STAKE.toLocaleString()} Gold to open a table.` },
          { status: 400 },
        ),
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

    const result = await openCribbageTable(token, parsed.data.stake);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toCribbageErrorResponse(error), token);
  }
}
