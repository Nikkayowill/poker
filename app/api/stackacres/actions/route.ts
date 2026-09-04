import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STACKACRES_FEED_IDS, STACKACRES_STOCK } from "@/lib/stackacres/catalogue";
import {
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresUnit,
  expandStackAcresCapacity,
  feedStackAcres,
  harvestStackAcres,
  retireStackAcresStock,
  stockStackAcres,
  toStackAcresErrorResponse,
} from "@/lib/server/stackacres-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { readSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own farm. `stock`, `buy-stock`, `expand-capacity`,
 * `buy-feed` and `clear` all DEBIT the caller -- see the ordering rules in
 * lib/server/stackacres-service.ts -- and `collect` settles every named (or
 * every ready) unit exactly once, guarded by version, and pays for the lot in
 * one credit.
 *
 * THERE IS NO PLOT ANY MORE. Every unit-scoped action takes a `unitId`
 * instead of a `plotIndex`; buying land is gone, replaced by
 * `expand-capacity`, which buys room for one stock kind rather than a tile.
 *
 * SIX ACTIONS MOVE GOLD, and the asymmetry between them is what keeps this
 * safe: five SPEND it (`expand-capacity`, `buy-stock`, `stock`, `buy-feed`,
 * `clear`) and exactly one PAYS it out (`collect`), under a flat per-player
 * daily ceiling and net of Land Maintenance. There is no second currency any
 * more, so "which direction does this action move Gold" is the only question
 * a new action has to answer -- and a new one that pays is the change to stop
 * over.
 *
 * No `version` field in any action: each handler reads the live row itself
 * and the guarded write settles at most once, so a stale client gets a 409
 * carrying the true round rather than a torn write.
 *
 * This is the route that moves money, so it is the one the gate really
 * matters on: only a profile an admin has granted access gets past, everyone
 * else gets a 401.
 */
const unitIdSchema = z.string().min(1);
const stockSchema = z.enum(STACKACRES_STOCK as unknown as [string, ...string[]]);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("expand-capacity"), stock: stockSchema }),
  z.object({ action: z.literal("stock"), stock: stockSchema }),
  z.object({ action: z.literal("buy-stock"), stock: stockSchema }),
  z.object({ action: z.literal("retire"), unitId: unitIdSchema }),
  // No `unitIds` at all means "bring in everything that is ready", which is
  // what the Harvest button sends; a single id is what tapping one unit sends.
  // Bounded well above a maxed estate (five kinds at six slots each) so a
  // fabricated list cannot make the server do unbounded work.
  z.object({
    action: z.literal("collect"),
    unitIds: z.array(unitIdSchema).min(1).max(64).optional(),
  }),
  z.object({ action: z.literal("feed"), unitId: unitIdSchema }),
  z.object({ action: z.literal("clear"), unitId: unitIdSchema }),
  z.object({
    action: z.literal("buy-feed"),
    itemId: z.enum(STACKACRES_FEED_IDS as unknown as [string, ...string[]]),
  }),
]);

type StackAcresAction = z.infer<typeof bodySchema>;

/**
 * One action to one service call. A switch rather than a ternary chain so that
 * adding a case is a one-line diff a reviewer can read -- and so the exhaustive
 * return type tells the compiler when one is missing.
 */
function run(token: string, action: StackAcresAction) {
  switch (action.action) {
    case "expand-capacity":
      return expandStackAcresCapacity(token, action.stock);
    case "stock":
      return stockStackAcres(token, { stock: action.stock });
    case "buy-stock":
      return buyStackAcresStock(token, { stock: action.stock });
    case "retire":
      return retireStackAcresStock(token, action.unitId);
    case "collect":
      return harvestStackAcres(token, { unitIds: action.unitIds });
    case "feed":
      return feedStackAcres(token, action.unitId);
    case "clear":
      return clearStackAcresUnit(token, action.unitId);
    case "buy-feed":
      return buyStackAcresFeed(token, action.itemId);
  }
}

export async function POST(request: NextRequest) {
  // Every action here moves one purse at most once and the guards make
  // replays idempotent; 60/min covers a fast restocking ritual plus feeding
  // and selling with a wide margin.
  const limited = enforceRateLimit(request, "stackacres:act", 60, 60 * 1000);
  if (limited) return limited;

  // Access is granted to a PROFILE, so the session cookie is what says who is
  // asking -- and it is read, never minted. A fresh token has no profile
  // behind it, so minting one here would fail the check anyway while handing a
  // prober an identity they never asked for, which is the one thing a refusal
  // must not do. It runs after the limiter above because it costs a database
  // read; see lib/server/stackacres-access.ts.
  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a valid action." }, { status: 400 }),
        token,
      );
    }

    // EVERY action is gated on the ban now, `collect` included, and that is a
    // deliberate change from "collecting stays open to a suspended account".
    // That carve-out was written when collecting moved no money at all -- it
    // put produce in a barn, and stranding a grown crop inside a suspended
    // account forever was a punishment nobody designed. A harvest pays Gold
    // directly now, so the carve-out had become the one way a suspended
    // account could still earn. Nothing is lost by closing it: a ready unit
    // stays ready indefinitely and is still there if the ban is lifted.
    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const action = parsed.data;
    const result = await run(token, action);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toStackAcresErrorResponse(error), token);
  }
}
