import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STACKACRES_FEED_IDS, STACKACRES_STOCK } from "@/lib/stackacres/catalogue";
import { STACKACRES_MAX_EXCHANGE_BUSHELS } from "@/lib/stackacres/exchange";
import { STACKACRES_ITEMS } from "@/lib/stackacres/items";
import { ZONE_IDS } from "@/lib/stackacres/zones";
import {
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresSector,
  clearStackAcresUnit,
  collectStackAcres,
  exchangeStackAcresBushels,
  expandStackAcresCapacity,
  feedStackAcres,
  retireStackAcresStock,
  sellStackAcresProduce,
  stockStackAcres,
  toStackAcresErrorResponse,
  waterStackAcres,
} from "@/lib/server/stackacres-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { readSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own farm. `stock`, `buy-stock`, `expand-capacity`,
 * `buy-feed`, `sell` and `clear` all DEBIT the caller -- see the ordering
 * rules in lib/server/stackacres-service.ts -- and `collect` yields a settled
 * unit's produce exactly once, guarded by version.
 *
 * THERE IS NO PLOT ANY MORE. Every unit-scoped action takes a `unitId`
 * instead of a `plotIndex`; buying land is gone, replaced by
 * `expand-capacity`, which buys room for one stock kind rather than a tile.
 *
 * Four actions move GOLD, and the asymmetry between them is what keeps this
 * safe: `expand-capacity`, `buy-stock` and `clear-sector` SPEND it,
 * `exchange` PAYS it out at the daily window under a flat per-player ceiling.
 * Everything else is denominated in Bushels or produce, both of which stay
 * inside the farm.
 *
 * `clear-sector` is the one piece of land buying that came back: three of the
 * four districts start under wild growth, and clearing one is a permanent,
 * unrefunded Gold spend. Keeping cleared land then costs a daily Bushel fee,
 * which no action here asks for -- it is taken automatically off the ones
 * that touch the land (see `settleLandUpkeep` in the service).
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
  // Buying a district's wild ground outright. Gold, once, permanent.
  z.object({
    action: z.literal("clear-sector"),
    sector: z.enum(ZONE_IDS as unknown as [string, ...string[]]),
  }),
  z.object({ action: z.literal("stock"), stock: stockSchema }),
  z.object({ action: z.literal("buy-stock"), stock: stockSchema }),
  z.object({ action: z.literal("retire"), unitId: unitIdSchema }),
  z.object({ action: z.literal("collect"), unitId: unitIdSchema }),
  z.object({ action: z.literal("feed"), unitId: unitIdSchema }),
  z.object({ action: z.literal("water"), unitId: unitIdSchema }),
  z.object({ action: z.literal("clear"), unitId: unitIdSchema }),
  z.object({
    action: z.literal("buy-feed"),
    itemId: z.enum(STACKACRES_FEED_IDS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal("sell"),
    // The enum is what keeps `bushels` -- which shares the inventory table
    // with produce -- from being sellable into itself.
    item: z.enum(STACKACRES_ITEMS as unknown as [string, ...string[]]),
    quantity: z.number().int().min(1).max(9_999),
  }),
  z.object({
    action: z.literal("exchange"),
    // Bounded by what a whole day's ceiling could ever be worth at the current
    // rate, derived rather than written down, so a retune moves this with it.
    // The real ceiling is enforced twice more, in the service and in the RPC.
    bushels: z.number().int().min(1).max(STACKACRES_MAX_EXCHANGE_BUSHELS),
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
    case "clear-sector":
      return clearStackAcresSector(token, action.sector);
    case "stock":
      return stockStackAcres(token, { stock: action.stock });
    case "buy-stock":
      return buyStackAcresStock(token, { stock: action.stock });
    case "retire":
      return retireStackAcresStock(token, action.unitId);
    case "collect":
      return collectStackAcres(token, action.unitId);
    case "feed":
      return feedStackAcres(token, action.unitId);
    case "water":
      return waterStackAcres(token, action.unitId);
    case "clear":
      return clearStackAcresUnit(token, action.unitId);
    case "sell":
      return sellStackAcresProduce(token, { item: action.item, quantity: action.quantity });
    case "exchange":
      return exchangeStackAcresBushels(token, action.bushels);
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

    // Collecting stays open to a suspended account: it only returns produce
    // already grown, same posture as resigning while banned. Spending more is
    // what's gated.
    if (parsed.data.action !== "collect" && (await isBanned(token))) {
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
