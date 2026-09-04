import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STACKACRES_FEED_IDS, STACKACRES_STOCK } from "@/lib/stackacres/catalogue";
import { ZONE_IDS } from "@/lib/stackacres/zones";
import {
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresSector,
  clearStackAcresUnit,
  expandStackAcresCapacity,
  feedStackAcres,
  retireStackAcresStock,
  harvestStackAcres,
  runStackAcresAction,
  stockStackAcres,
  toStackAcresErrorResponse,
  upgradeStackAcresTool,
  waterStackAcres,
} from "@/lib/server/stackacres-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { readSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own farm. `stock`, `buy-stock`, `expand-capacity`,
 * `buy-feed` and `clear` all DEBIT the caller -- see the ordering
 * rules in lib/server/stackacres-service.ts -- and `collect` yields a settled
 * unit's produce exactly once, guarded by version.
 *
 * THERE IS NO PLOT ANY MORE. Every unit-scoped action takes a `unitId`
 * instead of a `plotIndex`; buying land is gone, replaced by
 * `expand-capacity`, which buys room for one stock kind rather than a tile.
 *
 * SEVEN ACTIONS SPEND GOLD and exactly ONE PAYS IT OUT, and that asymmetry is
 * what keeps this safe. `expand-capacity`, `clear-sector`, `stock`,
 * `buy-stock`, `buy-feed`, `clear` and `upgrade-tool` all spend; `collect`
 * pays, under a flat per-player daily ceiling and net of Land Maintenance.
 * There is no second currency any more, so "which direction does this action
 * move Gold" is the only question a new action has to answer, and a new one
 * that PAYS is the change to stop over.
 *
 * The equipment ladder's CRITICAL HARVEST is not a second payer: it is paid
 * by `collect` itself, inside the same reservation, so it is bounded by the
 * same daily ceiling as the harvest it rides on. See `harvestStackAcres`.
 *
 * `clear-sector` is the one piece of land buying that came back: three of the
 * four districts start under wild growth, and clearing one is a permanent,
 * unrefunded Gold spend. Keeping cleared land then costs a daily fee, which no
 * action here asks for -- it comes off what a harvest pays, automatically (see
 * lib/stackacres/upkeep.ts).
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

/**
 * The client's own name for one intent, and the only thing that can tell a
 * duplicated request from a second deliberate one. Optional: a client that
 * sends none is served exactly as before (see `runStackAcresAction`), so a
 * phone holding an older bundle keeps working across a deploy.
 *
 * Opaque, bounded, and never trusted as identity -- every lookup behind it is
 * scoped to the caller's own profile as well.
 */
const intentKeySchema = z.string().min(8).max(100).optional();

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("expand-capacity"), stock: stockSchema }),
  // Buying a district's wild ground outright. Gold, once, permanent.
  z.object({
    action: z.literal("clear-sector"),
    sector: z.enum(ZONE_IDS as unknown as [string, ...string[]]),
  }),
  // No field: the ladder is walked one rung at a time from whatever the
  // SERVER says is held, so a request cannot name a rung and skip one.
  z.object({ action: z.literal("upgrade-tool") }),
  z.object({ action: z.literal("stock"), stock: stockSchema }),
  z.object({ action: z.literal("buy-stock"), stock: stockSchema }),
  z.object({ action: z.literal("retire"), unitId: unitIdSchema }),
  // No `unitIds` at all means "bring in everything that is ready", which is
  // what the Harvest button sends; a single id is what tapping one unit sends.
  // Bounded well above a maxed estate so a fabricated list cannot make the
  // server do unbounded work.
  z.object({
    action: z.literal("collect"),
    unitIds: z.array(unitIdSchema).min(1).max(64).optional(),
  }),
  z.object({ action: z.literal("feed"), unitId: unitIdSchema }),
  z.object({ action: z.literal("water"), unitId: unitIdSchema }),
  z.object({ action: z.literal("clear"), unitId: unitIdSchema }),
  z.object({
    action: z.literal("buy-feed"),
    itemId: z.enum(STACKACRES_FEED_IDS as unknown as [string, ...string[]]),
  }),
]);

/**
 * The body as it arrives: an action, plus the optional intent key.
 *
 * Kept as an intersection rather than folded into all nine members so the
 * discriminated union above stays exactly what `run` switches on -- the key is
 * transport-level plumbing, not part of any action's own shape.
 */
const requestSchema = z.intersection(bodySchema, z.object({ key: intentKeySchema }));

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
    case "upgrade-tool":
      return upgradeStackAcresTool(token);
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
    case "water":
      return waterStackAcres(token, action.unitId);
    case "clear":
      return clearStackAcresUnit(token, action.unitId);
    case "buy-feed":
      return buyStackAcresFeed(token, action.itemId);
  }
}

export async function POST(request: NextRequest) {
  // Every action here moves one purse at most once and the guards make
  // replays idempotent; 60/min covers a fast restocking ritual plus feeding
  // and watering with a wide margin.
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
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
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
    // At most once per intent. The key is the client's; `runStackAcresAction`
    // decides whether this request is the one that gets to act.
    const result = await runStackAcresAction(token, action.key ?? null, action.action, () =>
      run(token, action),
    );
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toStackAcresErrorResponse(error), token);
  }
}
