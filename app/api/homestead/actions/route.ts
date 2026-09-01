import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  HOMESTEAD_FEED_IDS,
  HOMESTEAD_GRID_PLOTS,
  HOMESTEAD_STOCK,
} from "@/lib/homestead/catalogue";
import { HOMESTEAD_MAX_EXCHANGE_BUSHELS } from "@/lib/homestead/exchange";
import { HOMESTEAD_ITEMS } from "@/lib/homestead/items";
import {
  buyHomesteadFeed,
  buyHomesteadPlot,
  clearHomesteadPlot,
  collectHomestead,
  exchangeHomesteadBushels,
  feedHomestead,
  sellHomesteadProduce,
  stockHomestead,
  toHomesteadErrorResponse,
} from "@/lib/server/homestead-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { homesteadLocked, requestHasHomesteadPass } from "@/lib/server/homestead-access";
import {
  readOrCreateSessionToken,
  withRequestSessionCookie,
} from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own farm. `buy-plot`, `stock`, `buy-feed`, `sell` and
 * `clear` all DEBIT the caller -- see the ordering rules in
 * lib/server/homestead-service.ts -- and `collect` yields a settled plot's
 * produce exactly once, guarded by version.
 *
 * Exactly two actions move GOLD: `buy-plot` spends it on acreage, and
 * `exchange` pays it out at the daily window under a flat per-player ceiling.
 * Everything else is denominated in Bushels or produce, both of which stay
 * inside the farm. Adding a THIRD Gold path here is the change worth stopping
 * over -- and a Gold-to-Bushels action in particular, which would make a round
 * trip through the capped window possible, is the one that must never exist.
 *
 * No `version` field in any action: each handler reads the live row itself and
 * the guarded write settles at most once, so a stale client gets a 409
 * carrying the true grid rather than a torn write.
 *
 * This is the route that moves money, so it is the one the gate really matters
 * on: only a caller carrying the access-code pass gets past, everyone else
 * gets a 401.
 */
const plotIndexSchema = z.number().int().min(1).max(HOMESTEAD_GRID_PLOTS);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("buy-plot"), plotIndex: plotIndexSchema }),
  z.object({
    action: z.literal("stock"),
    plotIndex: plotIndexSchema,
    stock: z.enum(HOMESTEAD_STOCK as unknown as [string, ...string[]]),
  }),
  z.object({ action: z.literal("collect"), plotIndex: plotIndexSchema }),
  z.object({ action: z.literal("feed"), plotIndex: plotIndexSchema }),
  z.object({ action: z.literal("clear"), plotIndex: plotIndexSchema }),
  z.object({
    action: z.literal("buy-feed"),
    itemId: z.enum(HOMESTEAD_FEED_IDS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal("sell"),
    // The enum is what keeps `bushels` -- which shares the inventory table
    // with produce -- from being sellable into itself.
    item: z.enum(HOMESTEAD_ITEMS as unknown as [string, ...string[]]),
    quantity: z.number().int().min(1).max(9_999),
  }),
  z.object({
    action: z.literal("exchange"),
    // Bounded by what a whole day's ceiling could ever be worth at the current
    // rate, derived rather than written down, so a retune moves this with it.
    // The real ceiling is enforced twice more, in the service and in the RPC.
    bushels: z.number().int().min(1).max(HOMESTEAD_MAX_EXCHANGE_BUSHELS),
  }),
]);

type HomesteadAction = z.infer<typeof bodySchema>;

/**
 * One action to one service call. A switch rather than a ternary chain so that
 * adding a case is a one-line diff a reviewer can read -- and so the exhaustive
 * return type tells the compiler when one is missing.
 */
function run(token: string, action: HomesteadAction) {
  switch (action.action) {
    case "buy-plot":
      return buyHomesteadPlot(token, action.plotIndex);
    case "stock":
      return stockHomestead(token, { plotIndex: action.plotIndex, stock: action.stock });
    case "collect":
      return collectHomestead(token, action.plotIndex);
    case "feed":
      return feedHomestead(token, action.plotIndex);
    case "clear":
      return clearHomesteadPlot(token, action.plotIndex);
    case "sell":
      return sellHomesteadProduce(token, { item: action.item, quantity: action.quantity });
    case "exchange":
      return exchangeHomesteadBushels(token, action.bushels);
    case "buy-feed":
      return buyHomesteadFeed(token, action.itemId);
  }
}

export async function POST(request: NextRequest) {
  // Every action here moves one purse at most once and the guards make
  // replays idempotent; 60/min covers a fast Hen Coop restocking ritual plus
  // feeding and selling with a wide margin.
  const limited = enforceRateLimit(request, "homestead:act", 60, 60 * 1000);
  if (limited) return limited;

  // The pass check runs BEFORE readOrCreateSessionToken below -- otherwise
  // probing a locked endpoint hands the prober a freshly minted session, which
  // is the one thing a refusal must never hand out. It reads the cookie jar
  // and nothing else, so a caller with no pass costs us an HMAC and a 401.
  if (!requestHasHomesteadPass(request)) return homesteadLocked();

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a plot and an action." }, { status: 400 }),
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
    return withRequestSessionCookie(request, toHomesteadErrorResponse(error), token);
  }
}
