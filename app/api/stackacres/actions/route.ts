import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STACKACRES_FEED_IDS, STACKACRES_STOCK } from "@/lib/stackacres/catalogue";
import { ZONE_IDS } from "@/lib/stackacres/zones";
import { MACHINE_KINDS } from "@/lib/stackacres/machines";
import { RECIPE_IDS } from "@/lib/stackacres/recipes";
import { HIDDEN_ZONE_IDS, SECRET_ITEM_IDS } from "@/lib/stackacres/secrets";
import { SYNERGY_ARCHETYPES, SYNERGY_MAX_ACTIVE_SLOTS } from "@/lib/stackacres/synergy-perks";
import {
  activateStackAcresSynergyPerk,
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresSector,
  clearStackAcresUnit,
  consumeStackAcresSecretItem,
  donateStackAcresSecretItem,
  expandStackAcresCapacity,
  feedStackAcres,
  retireStackAcresStock,
  harvestStackAcres,
  runStackAcresAction,
  stockStackAcres,
  tapStackAcresSecretZone,
  toStackAcresErrorResponse,
  tradeStackAcresSecretItemToRay,
  unlockStackAcresSynergyPerk,
  upgradeStackAcresTool,
  waterStackAcres,
  sowStackAcresWheat,
  placeStackAcresMachine,
  workStackAcres,
  requestStackAcresContract,
  fulfillStackAcresTownContract,
  divertStackAcresUnit,
  processStackAcresRecipeAction,
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
 * TEN ACTIONS SPEND GOLD and exactly TWO PAY IT OUT, and that asymmetry is
 * what keeps this safe. `expand-capacity`, `clear-sector`, `stock`,
 * `buy-stock`, `buy-feed`, `clear`, `upgrade-tool`, `sow-wheat`,
 * `place-machine` and `unlock-synergy-perk` all spend; `collect` and
 * `fulfill-contract` pay, both under the SAME flat per-player daily ceiling
 * -- see `harvestStackAcres` and `fulfillStackAcresTownContract` in
 * lib/server/stackacres-service.ts. There is no second currency any more, so
 * "which direction does this action move Gold, and if it pays, does it
 * reserve against the ceiling first" is the question a new action has to
 * answer, and a new payer that does not reserve first is the change to stop
 * over. `activate-synergy-perk` moves no Gold at all -- see below.
 *
 * `work`, `divert`, `process` and `request-contract` move no Gold at all --
 * inventory only. `divert` is worth reading twice: it takes a ready animal's
 * produce into the processing inventory INSTEAD of paying for it, through the
 * same version-guarded write `collect` uses, so it reduces what the farm pays
 * out today rather than adding to it. So do the four hidden-secrets actions
 * (`tap-secret-zone`, `donate-secret-item`, `consume-secret-item`,
 * `trade-secret-item`): a discovered Lucky Poker Dice only ever reshapes a
 * probability (`consume-secret-item`, folded into `collect`'s own crit roll)
 * or a target `raiseStackAcresUpkeep` already accepts or refuses
 * (`trade-secret-item`) -- see lib/server/stackacres-service.ts's "Hidden
 * secrets" section.
 *
 * The equipment ladder's CRITICAL HARVEST is not a third payer: it is paid
 * by `collect` itself, inside the same reservation, so it is bounded by the
 * same daily ceiling as the harvest it rides on. See `harvestStackAcres`. The
 * Synergy Tree's `sunlight_harvester` (a crit-chance boost) and
 * `high_yield_processing` (a Mill double-output chance) are the same
 * non-payer shape: both only reshape a probability an existing roll already
 * makes, inside `collect` and `work` respectively, and neither is a fourth
 * or fifth way Gold can move.
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
const synergyArchetypeSchema = z.enum(SYNERGY_ARCHETYPES as unknown as [string, ...string[]]);
// [0, SYNERGY_MAX_ACTIVE_SLOTS) -- the service layer re-checks this too (see
// `activateSynergyPerk`'s own comment), but a clean 400 here is cheaper than
// a round trip for a value no real client would ever send.
const synergySlotSchema = z.number().int().min(0).max(SYNERGY_MAX_ACTIVE_SLOTS - 1);

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
  // Processing: wheat, machines, Town Contracts. See
  // lib/server/stackacres-service.ts's own header for the two actions here
  // that move Gold -- `collect` above, and `fulfill-contract`.
  z.object({ action: z.literal("sow-wheat") }),
  z.object({
    action: z.literal("place-machine"),
    kind: z.enum(MACHINE_KINDS as unknown as [string, ...string[]]),
  }),
  // The idle-worker pass: settles every ripe wheat plot and every machine
  // that has become startable or finished since the last call. Spends no
  // Gold; the client calls this on a short interval the same way the PvP
  // duel and cribbage shells run their own Realtime backup poll.
  z.object({ action: z.literal("work") }),
  // Takes one ready animal's produce into the processing inventory instead of
  // the harvest's Gold. Settles the SAME unit row a `collect` would, so the
  // two race and exactly one wins -- it is not a second payout path, it is
  // the absence of one. Moves no Gold.
  z.object({ action: z.literal("divert"), unitId: unitIdSchema }),
  // One batch of a recipe. Instant for a Dairy or a Loom (one transaction, no
  // queue row); a Mill enqueues and `work` collects it. Moves no Gold.
  z.object({
    action: z.literal("process"),
    recipe: z.enum(RECIPE_IDS as unknown as [string, ...string[]]),
  }),
  z.object({ action: z.literal("request-contract") }),
  z.object({ action: z.literal("fulfill-contract") }),
  // Hidden secrets: three small discovery spots, one collectible. See
  // lib/server/stackacres-service.ts's own "Hidden secrets" section --
  // `tap-secret-zone` moves no Gold at all, and neither do the other three;
  // `donate-secret-item`/`consume-secret-item`/`trade-secret-item` each spend
  // one held item on a different effect, never a Gold credit.
  z.object({
    action: z.literal("tap-secret-zone"),
    zoneId: z.enum(HIDDEN_ZONE_IDS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal("donate-secret-item"),
    itemId: z.enum(SECRET_ITEM_IDS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal("consume-secret-item"),
    itemId: z.enum(SECRET_ITEM_IDS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal("trade-secret-item"),
    itemId: z.enum(SECRET_ITEM_IDS as unknown as [string, ...string[]]),
  }),
  // The Synergy Tree. `unlock-synergy-perk` spends Gold, once, permanent --
  // see lib/server/stackacres-synergy-service.ts's own money-ordering note.
  // `activate-synergy-perk` moves no Gold; it only changes which already-
  // owned archetypes are slotted for this session.
  z.object({ action: z.literal("unlock-synergy-perk"), archetype: synergyArchetypeSchema }),
  z.object({
    action: z.literal("activate-synergy-perk"),
    archetype: synergyArchetypeSchema,
    slot: synergySlotSchema,
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
    case "sow-wheat":
      return sowStackAcresWheat(token);
    case "place-machine":
      return placeStackAcresMachine(token, action.kind);
    case "work":
      return workStackAcres(token);
    case "divert":
      return divertStackAcresUnit(token, action.unitId);
    case "process":
      return processStackAcresRecipeAction(token, action.recipe);
    case "request-contract":
      return requestStackAcresContract(token);
    case "fulfill-contract":
      return fulfillStackAcresTownContract(token);
    case "tap-secret-zone":
      return tapStackAcresSecretZone(token, action.zoneId);
    case "donate-secret-item":
      return donateStackAcresSecretItem(token, action.itemId);
    case "consume-secret-item":
      return consumeStackAcresSecretItem(token, action.itemId);
    case "trade-secret-item":
      return tradeStackAcresSecretItemToRay(token, action.itemId);
    case "unlock-synergy-perk":
      return unlockStackAcresSynergyPerk(token, action.archetype);
    case "activate-synergy-perk":
      return activateStackAcresSynergyPerk(token, action.archetype, action.slot);
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
