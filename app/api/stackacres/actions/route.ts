import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  STACKACRES_CROPS,
  STACKACRES_FEED_IDS,
  STACKACRES_SEED_BAGS_PER_PURCHASE,
  STACKACRES_STOCK,
} from "@/lib/stackacres/catalogue";
import { ZONE_IDS } from "@/lib/stackacres/zones";
import { MACHINE_KINDS } from "@/lib/stackacres/machines";
import { RECIPE_IDS } from "@/lib/stackacres/recipes";
import { HIDDEN_ZONE_IDS, SECRET_ITEM_IDS } from "@/lib/stackacres/secrets";
import { SYNERGY_ARCHETYPES, SYNERGY_MAX_ACTIVE_SLOTS } from "@/lib/stackacres/synergy-perks";
import { MYTHIC_BLUEPRINT_IDS } from "@/lib/stackacres/blueprints";
import { MACHINE_ITEM_IDS } from "@/lib/stackacres/machine-items";
import { MIDNIGHT_MERCHANT_ITEM_IDS } from "@/lib/stackacres/midnight-merchant";
import { FORGE_ENCHANTMENT_IDS } from "@/lib/stackacres/forge";
import { FRIENDSHIP_NPCS } from "@/lib/stackacres/friendship";
import {
  activateStackAcresSynergyPerk,
  buildStackAcresGreenhouse,
  buyFromMidnightMerchant,
  buyStackAcresFeed,
  buyStackAcresStock,
  clearStackAcresSector,
  clearStackAcresUnit,
  unlockStackAcresCropFields,
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
  startStackAcresMythicBlueprint,
  contributeToStackAcresMythicBlueprint,
  prestigeResetStackAcres,
  forgeStackAcresToolEnchantment,
  placeStackAcresPipeTile,
  removeStackAcresPipeTile,
  buyStackAcresSoil,
  placeStackAcresSoilTile,
  removeStackAcresSoilTile,
  buyStackAcresSeed,
  prayAtStackAcresShrine,
  giveStackAcresGift,
  sealStackAcresVat,
  collectStackAcresVat,
  deployStackAcresDrone,
  collectStackAcresDroneForage,
} from "@/lib/server/stackacres-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { readSessionToken, withRequestSessionCookie } from "@/lib/server/session";
import { resolveChronoNow } from "@/lib/server/chrono-delorean";
import { SOIL_BAGS_PER_PURCHASE, SOIL_TIERS } from "@/lib/stackacres/soil-tiers";

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
 * FOURTEEN ACTIONS SPEND GOLD and exactly TWO PAY IT OUT, and that asymmetry
 * is what keeps this safe. `expand-capacity`, `clear-sector`,
 * `unlock-crop-fields`, `stock`, `buy-stock`, `buy-feed`, `clear`,
 * `upgrade-tool`, `sow-wheat`, `place-machine`, `unlock-synergy-perk`,
 * `midnight-merchant-buy`, `place-pipe` and `place-soil-tile` all spend; `collect` and
 * `fulfill-contract` pay, both under
 * the SAME flat per-player daily ceiling -- see `harvestStackAcres` and
 * `fulfillStackAcresTownContract` in lib/server/stackacres-service.ts. There
 * is no second currency any more, so "which direction does this action move
 * Gold, and if it pays, does it reserve against the ceiling first" is the
 * question a new action has to answer, and a new payer that does not reserve
 * first is the change to stop over. `activate-synergy-perk` moves no Gold at
 * all -- see below. `midnight-merchant-buy` is worth reading twice: it
 * spends Gold but NEVER reserves against the daily payout ceiling, because
 * it is not a payout at all -- Gold only ever leaves the caller here,
 * through the same `spend_gold_by_profile` every other spend in this list
 * already uses.
 *
 * `work`, `divert`, `process`, `request-contract`, `build-greenhouse`,
 * `remove-pipe` and `remove-soil-tile` move no Gold at all -- inventory only
 * (`build-greenhouse` spends processing-track Flour/Cloth; see
 * buildStackAcresGreenhouse's own header). Neither `remove-pipe` nor
 * `remove-soil-tile` is a refund: a placed irrigation tile or soil bed is a
 * spent sink, like a placed Mill. `divert` is worth reading twice: it takes
 * a ready animal's produce into the processing inventory INSTEAD of paying
 * for it, through the same version-guarded write `collect` uses, so it
 * reduces what the farm pays out today rather than adding to it. So do the
 * four hidden-secrets actions
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
 * `prestige-reset` moves no Gold either, and is not like `work`/`divert`'s
 * "inventory only" either: it is the one action with no undo, trading the
 * whole grid and every stockpile riding on it for a permanent multiplier on
 * every future `collect`. See prestigeResetStackAcres's own header
 * (lib/server/stackacres-service.ts) for exactly what it sweeps.
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
  // No field, unlike `clear-sector`: there is only one such flag, not one
  // per district. Gold, once, permanent -- see unlockStackAcresCropFields's
  // own header on why this is not a `clear-sector` variant.
  z.object({ action: z.literal("unlock-crop-fields") }),
  // No field: the ladder is walked one rung at a time from whatever the
  // SERVER says is held, so a request cannot name a rung and skip one.
  z.object({ action: z.literal("upgrade-tool") }),
  // Builds the Greenhouse once, spending processing-track goods, not Gold --
  // see buildStackAcresGreenhouse's own header.
  z.object({ action: z.literal("build-greenhouse") }),
  // `inGreenhouse` is optional and defaults to the ordinary open-air path;
  // sending it true only ever narrows what is accepted (crops only, the
  // Greenhouse must already stand, a free slot must exist) -- it can never
  // let a request skip a check the plain `stock` action already enforces.
  // `tx`/`ty` are optional too, and just as harmless to trust: they name the
  // bed the player tapped to open the seed menu, and `assignSoilSlot` only
  // ever honours one that resolves to a real, unoccupied bed the player
  // owns -- anything else (no soil there, someone else's slot, out of range)
  // falls straight through to the ordinary lowest-free-slot pick.
  z.object({
    action: z.literal("stock"),
    stock: stockSchema,
    inGreenhouse: z.boolean().optional(),
    tx: z.number().int().min(-512).max(512).optional(),
    ty: z.number().int().min(-512).max(512).optional(),
  }),
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
  // The Fermenting Vat. `seal-vat` spends Cheese (never Gold) and locks it
  // inside the vat's own manifest; `collect-vat` is the one action here that
  // pays -- through the same daily ceiling `fulfill-contract` does. See
  // lib/server/stackacres-service.ts's sealStackAcresVat/collectStackAcresVat.
  z.object({ action: z.literal("seal-vat") }),
  z.object({ action: z.literal("collect-vat") }),
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
  // Ray's Mythic Blueprints: multi-stage structures filled with processing-
  // track materials. See lib/server/stackacres-blueprint-service.ts's own
  // header -- neither action moves Gold.
  z.object({
    action: z.literal("start-blueprint"),
    structureId: z.enum(MYTHIC_BLUEPRINT_IDS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal("contribute-blueprint"),
    structureId: z.enum(MYTHIC_BLUEPRINT_IDS as unknown as [string, ...string[]]),
    itemId: z.enum(MACHINE_ITEM_IDS as unknown as [string, ...string[]]),
    // Bounded well above any single requirement line the shipped ladder
    // asks for (the largest today is 20), the same "generous but not
    // unbounded" posture `collect`'s own unitIds cap takes.
    amount: z.number().int().min(1).max(999),
  }),
  // The Midnight Merchant: a temporary NPC visit, spawned server-side off a
  // critical harvest (see harvestStackAcres's step 3c), never by a client
  // request. This is the only action the visit exposes -- there is no
  // client-named "spawn" or "expire". Spends Gold, at a price that climbs
  // 20% per item already sold this same visit; see
  // lib/stackacres/midnight-merchant.ts's `priceForNextPurchase`.
  z.object({
    action: z.literal("midnight-merchant-buy"),
    itemId: z.enum(MIDNIGHT_MERCHANT_ITEM_IDS as unknown as [string, ...string[]]),
  }),
  // The Prestige Reset Valve. Moves no Gold; wipes the grid and every
  // resource stockpile riding on it in exchange for a permanent harvest
  // multiplier -- see prestigeResetStackAcres's own header. `confirm: true`
  // is required at the wire level, not just in the client's own dual-
  // confirmation UI: this is the one action here with no undo, so the
  // request body itself has to say the caller meant it, the same way a
  // destructive CLI flag is spelled out rather than implied by the verb
  // alone. The client is also expected to always send `key` for this action
  // even though the schema leaves it optional for every action -- see
  // runStackAcresAction's own header for why an intent key is what makes a
  // duplicated request safe for an action with no row of its own to
  // version-guard, exactly the category this one is in.
  z.object({ action: z.literal("prestige-reset"), confirm: z.literal(true) }),
  // The Sunlight Forge: permanent tool enchantments. Spends Gold AND a
  // processing-track material in one call -- see forge_stackacres_
  // enchantment's own migration comment for why both are checked under
  // lock before either is mutated. `itemId` is the bare catalogue key
  // (FORGE_ENCHANTMENT_IDS), not the versioned `enchant_..._v1` wrapper --
  // see lib/stackacres/forge.ts's own comment on forgeEnchantmentItemId.
  z.object({
    action: z.literal("forge-enchantment"),
    itemId: z.enum(FORGE_ENCHANTMENT_IDS as unknown as [string, ...string[]]),
  }),
  // The irrigation pipe network. `place-pipe` spends Gold -- a construction
  // sink, like `place-machine`, refunded only if the tile cannot land;
  // `remove-pipe` moves no Gold. Hydration itself is free (a hydrated pipe
  // watering a crop costs nothing, the same as tapping `water`), so this
  // adds one spender and no payer. Coordinates are the STACKACRES_TILE
  // lattice (floor(worldX / 16)); the range is bounded so a fabricated
  // coordinate cannot push the layout somewhere the camera can never reach.
  z.object({
    action: z.literal("place-pipe"),
    tx: z.number().int().min(-512).max(512),
    ty: z.number().int().min(-512).max(512),
    kind: z.enum(["well", "pipe"]),
  }),
  z.object({
    action: z.literal("remove-pipe"),
    tx: z.number().int().min(-512).max(512),
    ty: z.number().int().min(-512).max(512),
  }),
  // Placeable soil beds (lib/stackacres/soil.ts): the SOIL_TILE lattice
  // (floor(worldX / 64), floor(worldY / 64)), same bounding posture as
  // place-pipe above -- the coordinate range is generous but not unbounded,
  // and placeStackAcresSoilTile itself is what actually confines a tile to
  // the Crop Fields. `place-soil-tile` spends Gold -- how MUCH is set by the
  // tier and read from SOIL_TIER_DEFS on the server, never from the body, so
  // the client only ever names which bed it wants. `remove-soil-tile` moves
  // none. The tier is optional so a client from before tiers shipped still
  // places a plain bed.
  z.object({
    action: z.literal("place-soil-tile"),
    tx: z.number().int().min(-512).max(512),
    ty: z.number().int().min(-512).max(512),
    tier: z.enum(SOIL_TIERS).optional(),
  }),
  // Ray's soil shelf. SPENDS Gold (tier price x quantity, both read from
  // SOIL_TIER_DEFS on the server) and moves no coordinate; `place-soil-tile`
  // below now spends a BAG rather than Gold, so soil costs the player exactly
  // once, here.
  z.object({
    action: z.literal("buy-soil"),
    tier: z.enum(SOIL_TIERS),
    quantity: z.number().int().min(1).max(SOIL_BAGS_PER_PURCHASE),
  }),
  z.object({
    action: z.literal("remove-soil-tile"),
    tx: z.number().int().min(-512).max(512),
    ty: z.number().int().min(-512).max(512),
  }),
  // Ray's seed shelf. SPENDS Gold (crop's own seedCost x quantity, read from
  // STACKACRES_CATALOGUE on the server) and plants nothing; `stock` above now
  // spends one seed off this shelf for a crop instead of charging Gold
  // directly, so a crop's seed costs the player exactly once, here.
  z.object({
    action: z.literal("buy-seed"),
    crop: z.enum(STACKACRES_CROPS),
    quantity: z.number().int().min(1).max(STACKACRES_SEED_BAGS_PER_PURCHASE),
  }),
  // The Pixel Pilgrim's shrine. Moves no Gold and spends no row of the
  // caller's own -- only ever sent after the dialogue's own "yes" (see
  // stackacres-monk-dialogue.tsx), never from the tap itself, so a decline
  // never reaches this route at all.
  z.object({ action: z.literal("pray") }),
  // NPC friendship: a gift. Moves no Gold either way -- it spends one unit
  // of a processing-track item, never a purse. See
  // lib/stackacres/friendship.ts's own header.
  z.object({
    action: z.literal("give-gift"),
    npc: z.enum(FRIENDSHIP_NPCS as unknown as [string, ...string[]]),
    item: z.enum(MACHINE_ITEM_IDS as unknown as [string, ...string[]]),
  }),
  // Mechanical Forage Drone: a flat-fee deploy, gated on the hangar's own
  // derived museum-donation unlock (see stackacres-drone-service.ts).
  z.object({ action: z.literal("deploy-drone") }),
  // A drone id, not a tile or a collectible id: the server re-derives
  // whether that drone is actually eligible (owned, off cooldown) rather
  // than trusting anything the client claims about where it is or what it
  // swept up.
  z.object({ action: z.literal("collect-drone-forage"), droneId: z.string().uuid() }),
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
 *
 * `now` is threaded through every case rather than left to each function's
 * own `new Date()` default -- this is Chrono-DeLorean Mode's whole seam (see
 * lib/server/chrono-delorean.ts): outside a dev build with it explicitly
 * enabled, `now` IS `new Date()` (resolved once in POST below), so this
 * changes nothing about what a real request does.
 */
function run(token: string, action: StackAcresAction, now: Date) {
  switch (action.action) {
    case "expand-capacity":
      return expandStackAcresCapacity(token, action.stock, now);
    case "clear-sector":
      return clearStackAcresSector(token, action.sector, now);
    case "unlock-crop-fields":
      return unlockStackAcresCropFields(token, now);
    case "upgrade-tool":
      return upgradeStackAcresTool(token, now);
    case "build-greenhouse":
      return buildStackAcresGreenhouse(token, now);
    case "stock":
      return stockStackAcres(
        token,
        {
          stock: action.stock,
          inGreenhouse: action.inGreenhouse,
          tile: action.tx !== undefined && action.ty !== undefined ? { tx: action.tx, ty: action.ty } : null,
        },
        now,
      );
    case "buy-stock":
      return buyStackAcresStock(token, { stock: action.stock }, now);
    case "retire":
      return retireStackAcresStock(token, action.unitId, now);
    case "collect":
      return harvestStackAcres(token, { unitIds: action.unitIds }, now);
    case "feed":
      return feedStackAcres(token, action.unitId, now);
    case "water":
      return waterStackAcres(token, action.unitId, now);
    case "clear":
      return clearStackAcresUnit(token, action.unitId, now);
    case "buy-feed":
      return buyStackAcresFeed(token, action.itemId, now);
    case "sow-wheat":
      return sowStackAcresWheat(token, now);
    case "place-machine":
      return placeStackAcresMachine(token, action.kind, now);
    case "work":
      return workStackAcres(token, now);
    case "divert":
      return divertStackAcresUnit(token, action.unitId, now);
    case "process":
      return processStackAcresRecipeAction(token, action.recipe, now);
    case "request-contract":
      return requestStackAcresContract(token, now);
    case "fulfill-contract":
      return fulfillStackAcresTownContract(token, now);
    case "seal-vat":
      return sealStackAcresVat(token, now);
    case "collect-vat":
      return collectStackAcresVat(token, now);
    case "tap-secret-zone":
      return tapStackAcresSecretZone(token, action.zoneId, now);
    case "donate-secret-item":
      return donateStackAcresSecretItem(token, action.itemId, now);
    case "consume-secret-item":
      return consumeStackAcresSecretItem(token, action.itemId, now);
    case "trade-secret-item":
      return tradeStackAcresSecretItemToRay(token, action.itemId, now);
    case "unlock-synergy-perk":
      return unlockStackAcresSynergyPerk(token, action.archetype, now);
    case "activate-synergy-perk":
      return activateStackAcresSynergyPerk(token, action.archetype, action.slot, now);
    case "start-blueprint":
      return startStackAcresMythicBlueprint(token, action.structureId, now);
    case "contribute-blueprint":
      return contributeToStackAcresMythicBlueprint(token, action.structureId, action.itemId, action.amount, now);
    case "midnight-merchant-buy":
      return buyFromMidnightMerchant(token, action.itemId, now);
    case "prestige-reset":
      return prestigeResetStackAcres(token, now);
    case "forge-enchantment":
      return forgeStackAcresToolEnchantment(token, action.itemId, now);
    case "place-pipe":
      return placeStackAcresPipeTile(token, { tx: action.tx, ty: action.ty, kind: action.kind }, now);
    case "remove-pipe":
      return removeStackAcresPipeTile(token, { tx: action.tx, ty: action.ty }, now);
    case "place-soil-tile":
      return placeStackAcresSoilTile(token, { tx: action.tx, ty: action.ty, tier: action.tier }, now);
    case "buy-soil":
      return buyStackAcresSoil(token, { tier: action.tier, quantity: action.quantity }, now);
    case "remove-soil-tile":
      return removeStackAcresSoilTile(token, { tx: action.tx, ty: action.ty }, now);
    case "buy-seed":
      return buyStackAcresSeed(token, { crop: action.crop, quantity: action.quantity }, now);
    case "pray":
      return prayAtStackAcresShrine(token, now);
    case "give-gift":
      return giveStackAcresGift(token, action.npc, action.item, now);
    case "deploy-drone":
      return deployStackAcresDrone(token, now);
    case "collect-drone-forage":
      return collectStackAcresDroneForage(token, action.droneId, now);
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
    const now = await resolveChronoNow(token);
    // At most once per intent. The key is the client's; `runStackAcresAction`
    // decides whether this request is the one that gets to act. `now` is
    // also passed to `runStackAcresAction` itself (its own default is
    // `new Date()`), so a replay/in-flight answer's view is read at the same
    // simulated moment as the action that triggered it.
    const result = await runStackAcresAction(
      token,
      action.key ?? null,
      action.action,
      () => run(token, action, now),
      now,
    );
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toStackAcresErrorResponse(error), token);
  }
}
