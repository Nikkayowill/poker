import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  STACKACRES_CROPS,
  STACKACRES_FEED_IDS,
  STACKACRES_FEED_SHIPMENTS_PER_PURCHASE,
  STACKACRES_SEED_BAGS_PER_PURCHASE,
  STACKACRES_STOCK,
} from "@/lib/stackacres/catalogue";
import { PEN_ZONE_IDS, ZONE_IDS, type ZoneId } from "@/lib/stackacres/zones";
import { MACHINE_KINDS } from "@/lib/stackacres/machines";
import { RECIPE_IDS } from "@/lib/stackacres/recipes";
import { FOOD_ITEMS } from "@/lib/stackacres/energy";
import { CELLAR_ITEMS } from "@/lib/stackacres/aging";
import { FARM_KITCHEN_RECIPES } from "@/lib/stackacres/farm-kitchen";
import { HIDDEN_ZONE_IDS, SECRET_ITEM_IDS } from "@/lib/stackacres/secrets";
import { WOOD_NODE_IDS } from "@/lib/stackacres/tree-nodes";
import { STONE_NODE_IDS } from "@/lib/stackacres/stone-nodes";
import { FORAGE_NODE_IDS } from "@/lib/stackacres/forage";
import { SYNERGY_ARCHETYPES, SYNERGY_MAX_ACTIVE_SLOTS } from "@/lib/stackacres/synergy-perks";
import { MYTHIC_BLUEPRINT_IDS } from "@/lib/stackacres/blueprints";
import { ALL_MACHINE_ITEM_IDS, MACHINE_ITEM_IDS } from "@/lib/stackacres/machine-items";
import { FORGE_ENCHANTMENT_IDS } from "@/lib/stackacres/forge";
import { STACKACRES_BUYABLE_CUTTERS } from "@/lib/stackacres/cutters";
import { CROSSBREED_GRID_COLS, CROSSBREED_GRID_ROWS } from "@/lib/stackacres/crossbreeding";
import { FRIENDSHIP_NPCS, GIFTABLE_ITEMS } from "@/lib/stackacres/friendship";
import { TRAVELER_IDS } from "@/lib/stackacres/story/travelers";
import {
  activateStackAcresSynergyPerk,
  buildStackAcresGreenhouse,
  buyStackAcresFeed,
  buyStackAcresStock,
  workStackAcresLand,
  clearStackAcresUnit,
  consumeStackAcresSecretItem,
  donateStackAcresSecretItem,
  expandStackAcresCapacity,
  feedStackAcres,
  feedStackAcresPen,
  eatStackAcresFoodAction,
  retireStackAcresStock,
  harvestStackAcres,
  runStackAcresAction,
  stockStackAcres,
  stockStackAcresGroup,
  tapStackAcresSecretZone,
  toStackAcresErrorResponse,
  tradeStackAcresSecretItemToRay,
  unlockStackAcresSynergyPerk,
  upgradeStackAcresTool,
  upgradeStackAcresAxe,
  buyStackAcresCutter,
  waterStackAcres,
  waterStackAcresGroup,
  drawStackAcresWater,
  bagStackAcresQuarry,
  chopStackAcresWoodTree,
  gatherStackAcresForage,
  mineStackAcresStoneNode,
  catchStackAcresFish,
  placeStackAcresMachine,
  workStackAcres,
  requestStackAcresContract,
  passStackAcresContract,
  fulfillStackAcresTownContract,
  sellStackAcresItem,
  processStackAcresRecipeAction,
  sealStackAcresCellar,
  collectStackAcresCellar,
  setStackAcresKitchenOrder,
  startStackAcresMythicBlueprint,
  contributeToStackAcresMythicBlueprint,
  prestigeResetStackAcres,
  forgeStackAcresToolEnchantment,
  plantStackAcresCrossbreedBed,
  harvestStackAcresCrossbreedBed,
  placeStackAcresSoilTile,
  placeStackAcresFencePiece,
  removeStackAcresFencePiece,
  removeStackAcresSoilTile,
  moveStackAcresSoilTileGroup,
  buyStackAcresSeed,
  prayAtStackAcresShrine,
  giveStackAcresGift,
  sealStackAcresVat,
  collectStackAcresVat,
  meetStackAcresTraveler,
  turnInStackAcresTravelerQuest,
} from "@/lib/server/stackacres-service";
import { stackAcresActionGate } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { stackacresLocked } from "@/lib/server/stackacres-access";
import { readSessionToken, withRequestSessionCookie } from "@/lib/server/session";
import { resolveChronoNow } from "@/lib/server/chrono-delorean";

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
 * `collect` (harvest) MOVES NO GOLD AT ALL any more -- it always credits
 * inventory, for every item, not just wheat/milk/wool. FIFTEEN ACTIONS SPEND
 * GOLD and exactly THREE PAY IT OUT, and that asymmetry is what keeps this
 * safe. `expand-capacity`, `clear-sector`, `stock`,
 * `buy-stock`, `buy-feed`, `clear`, `upgrade-tool`, `buy-cutter`,
 * `place-machine`, `unlock-synergy-perk` and `place-soil-tile` all spend; `sell`, `fulfill-contract`
 * and `collect-vat` pay, all three under the SAME flat per-player daily
 * ceiling -- see `sellStackAcresItem`, `fulfillStackAcresTownContract` and
 * `collectStackAcresVat` in lib/server/stackacres-service.ts. There is no
 * second currency any more, so "which direction does this action move Gold,
 * and if it pays, does it reserve against the ceiling first" is the question
 * a new action has to answer, and a new payer that does not reserve first is
 * the change to stop over. `activate-synergy-perk` moves no Gold at all --
 * see below.
 *
 * `collect`, `work`, `process`, `request-contract`, `build-greenhouse` and
 * `remove-soil-tile` move no Gold at all -- inventory only
 * (`build-greenhouse` spends processing-track Flour/Cloth; see
 * buildStackAcresGreenhouse's own header). `remove-soil-tile` is not a
 * refund: a placed soil bed is a spent sink, like a placed Mill. So do the four hidden-secrets actions
 * (`tap-secret-zone`, `donate-secret-item`, `consume-secret-item`,
 * `trade-secret-item`): a discovered Lucky Poker Dice only ever reshapes a
 * probability (`consume-secret-item`, folded into `collect`'s own crit roll)
 * or a target `raiseStackAcresUpkeep` already accepts or refuses
 * (`trade-secret-item`) -- see lib/server/stackacres-service.ts's "Hidden
 * secrets" section.
 *
 * THE EQUIPMENT LADDER'S CRITICAL HARVEST PAYS BONUS INVENTORY NOW, NOT GOLD
 * -- it is not a payer at all any more, and is folded into `collect` itself
 * (see `critBonusQuantity`, lib/stackacres/equipment.ts). The Synergy Tree's
 * `sunlight_harvester` (a crit-chance boost) and `high_yield_processing` (a
 * Mill double-output chance) are the same non-payer shape: both only reshape
 * a probability an existing roll already makes, inside `collect` and `work`
 * respectively, and neither moves Gold.
 *
 * LAND IS NEVER SOLD. A sector opens when the last thing standing on it has
 * been cut down (`work-land`, which spends energy and pays the barn). Keeping cleared
 * land then costs a daily fee, netted off whichever action next pays the
 * player any Gold (see `netUpkeepFromPayout`, lib/server/stackacres-service.ts).
 *
 * `prestige-reset` moves no Gold either, and is not like `work`/`process`'s
 * "inventory only" either: it is the one action with no undo, trading the
 * whole grid and every stockpile riding on it for a permanent multiplier on
 * every future `sell`. See prestigeResetStackAcres's own header
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
/** Every unit id is a database uuid. Checked here rather than left to the
 *  units table's own cast, which answered a bad id with Postgres' "invalid
 *  input syntax for type uuid" -- a message that reached the player as
 *  "Could not load that unit" and told them nothing. A clean 400 also keeps
 *  the shape of the storage out of the response. */
const unitIdSchema = z.string().uuid();
const stockSchema = z.enum(STACKACRES_STOCK as unknown as [string, ...string[]]);
const soilTileCoordSchema = z.object({
  tx: z.number().int().min(-512).max(512),
  ty: z.number().int().min(-512).max(512),
});
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
  // Clearing land. `work-land` is one swing and costs energy. It names no
  // sector: the obstacle id says which land it stands on, so a request cannot
  // claim a field it has not worked.
  z.object({ action: z.literal("work-land"), obstacleId: z.string().min(3).max(40) }),
  // No field: the ladder is walked one rung at a time from whatever the
  // SERVER says is held, so a request cannot name a rung and skip one.
  z.object({ action: z.literal("upgrade-tool") }),
  z.object({ action: z.literal("upgrade-axe"), pay: z.enum(["materials", "gold"]) }),
  z.object({ action: z.literal("buy-cutter"), cutter: z.enum(STACKACRES_BUYABLE_CUTTERS) }),
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
  // `tiles` is set only for a group-plant drop (a seed dragged onto a >=2x2
  // block of bare, same-tier beds -- lib/stackacres/soil.ts's
  // `plantableTileGroup`); bounded the same way `water`'s own `unitIds` set
  // is, so a fabricated list cannot make the server do unbounded work.
  // Livestock and the Greenhouse have no bed lattice to group over, and
  // `stockStackAcresGroup` refuses both outright.
  z.object({
    action: z.literal("stock"),
    stock: stockSchema,
    inGreenhouse: z.boolean().optional(),
    tx: z.number().int().min(-512).max(512).optional(),
    ty: z.number().int().min(-512).max(512).optional(),
    tiles: z.array(soilTileCoordSchema).min(2).max(64).optional(),
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
  // A pen, not a unit: the server picks which animals in it are hungry.
  z.object({
    action: z.literal("feed-pen"),
    zone: z.enum(PEN_ZONE_IDS as unknown as [ZoneId, ...ZoneId[]]),
  }),
  // unitIds is set only for a group-water drop (the water can dragged onto a
  // >=2x2 block of thirsty crops); bounded the same way `collect`'s set is,
  // so a fabricated list cannot make the server do unbounded work.
  z.object({
    action: z.literal("water"),
    unitId: unitIdSchema,
    unitIds: z.array(unitIdSchema).min(2).max(64).optional(),
  }),
  // Fills the watering can. Moves no Gold.
  z.object({ action: z.literal("draw-water") }),
  // The dock's cast, completed. Fills the shelf, same as a harvest -- moves
  // no Gold. Which fish is the server's own dice roll.
  // `bait` spends one Radish for better odds.
  z.object({ action: z.literal("catch-fish"), bait: z.boolean() }),
  // A completed stalk at the Oak's treeline. Fills the shelf with meat and a
  // pelt, same as a catch -- moves no Gold. Which quarry it was is the
  // server's own dice roll.
  z.object({ action: z.literal("bag-quarry") }),
  // One swing at a tree (lib/stackacres/wood.ts). Fills the shelf with Wood,
  // same as a catch or a bagged stalk -- moves no Gold.
  z.object({
    action: z.literal("chop-tree"),
    nodeId: z.enum(WOOD_NODE_IDS as unknown as [string, ...string[]]),
  }),
  // One swing at one of the Mine's Stone nodes. Fills the shelf with Stone,
  // same as a catch or a bagged stalk -- moves no Gold. Whether it lands is
  // the node's own server-owned hit count and regrow window
  // (lib/stackacres/stone-nodes.ts).
  z.object({
    action: z.literal("mine-stone"),
    nodeId: z.enum(STONE_NODE_IDS),
  }),
  // One pick at one of the Homestead's forage bushes. Fills the SEED shelf,
  // not the inventory, and moves no Gold. There is no crop
  // named here: which seed a bush carries is a pure function of its own
  // stored pick count (lib/stackacres/forage.ts), so the client never gets
  // to name the prize.
  z.object({
    action: z.literal("gather-forage"),
    nodeId: z.enum(FORAGE_NODE_IDS),
  }),
  z.object({ action: z.literal("clear"), unitId: unitIdSchema }),
  z.object({
    action: z.literal("buy-feed"),
    itemId: z.enum(STACKACRES_FEED_IDS as unknown as [string, ...string[]]),
    quantity: z.number().int().min(1).max(STACKACRES_FEED_SHIPMENTS_PER_PURCHASE),
  }),
  // Sells any inventory item -- raw harvest or crafted good -- for Gold, at
  // that item's own sell price, any time. See lib/server/
  // stackacres-service.ts's own header for the three actions here that move
  // Gold -- this, `fulfill-contract`, and `collect-vat`.
  z.object({
    action: z.literal("sell"),
    item: z.enum(ALL_MACHINE_ITEM_IDS as unknown as [string, ...string[]]),
    // Generous but not unbounded, the same posture every other body-supplied
    // quantity in this file takes -- an inventory count this high is not
    // reachable by ordinary play, and the real bound is what the player
    // actually holds, checked server-side under a row lock.
    quantity: z.number().int().min(1).max(9_999),
  }),
  // Eats one food (FOOD_ITEMS) for energy. Moves no Gold.
  z.object({
    action: z.literal("eat"),
    item: z.enum(FOOD_ITEMS as unknown as [string, ...string[]]),
  }),
  // Processing: wheat, machines, Town Contracts. Move no Gold.
  z.object({
    action: z.literal("place-machine"),
    kind: z.enum(MACHINE_KINDS as unknown as [string, ...string[]]),
  }),
  // The idle-worker pass: settles every ripe wheat plot and every machine
  // that has become startable or finished since the last call. Spends no
  // Gold; the client calls this on a short interval the same way the PvP
  // duel and cribbage shells run their own Realtime backup poll.
  z.object({ action: z.literal("work") }),
  // One batch of a recipe. Instant for a Dairy or a Loom (one transaction, no
  // queue row); a Mill enqueues and `work` collects it. Moves no Gold.
  z.object({
    action: z.literal("process"),
    recipe: z.enum(RECIPE_IDS as unknown as [string, ...string[]]),
  }),
  z.object({ action: z.literal("request-contract") }),
  z.object({ action: z.literal("fulfill-contract") }),
  // One a UTC day, and it moves nothing. See passStackAcresContract.
  z.object({ action: z.literal("pass-contract") }),
  // The Fermenting Vat. `seal-vat` spends Cheese (never Gold) and locks it
  // inside the vat's own manifest; `collect-vat` is the one action here that
  // pays -- through the same daily ceiling `fulfill-contract` does. See
  // lib/server/stackacres-service.ts's sealStackAcresVat/collectStackAcresVat.
  z.object({ action: z.literal("seal-vat") }),
  z.object({ action: z.literal("collect-vat") }),
  // The Preserves Cellar: the Vat's two actions for jars of Pickles or
  // Sauerkraut, on a slower ladder. Only `collect-cellar` pays.
  z.object({
    action: z.literal("seal-cellar"),
    item: z.enum(CELLAR_ITEMS),
  }),
  z.object({ action: z.literal("collect-cellar") }),
  // The Farm Kitchen's standing order. Moves no Gold and no items.
  z.object({
    action: z.literal("set-kitchen-order"),
    recipe: z.enum(FARM_KITCHEN_RECIPES as unknown as [string, ...string[]]),
  }),
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
  // The Crossbreeding Bed (lib/stackacres/crossbreeding.ts). `plant-crossbreed`
  // pays the way `stock` does -- one seed off the shelf for a crop, Gold for
  // livestock -- and is bounded to the fixed 4x4 grid here so a fabricated
  // coordinate never reaches the store. `harvest-crossbreed` moves no Gold:
  // a hybrid is inventory, credited only inside the settlement RPC.
  z.object({
    action: z.literal("plant-crossbreed"),
    row: z.number().int().min(0).max(CROSSBREED_GRID_ROWS - 1),
    col: z.number().int().min(0).max(CROSSBREED_GRID_COLS - 1),
    stock: z.enum(STACKACRES_STOCK as unknown as [string, ...string[]]),
  }),
  z.object({ action: z.literal("harvest-crossbreed"), plotId: z.string().uuid() }),
  // Placeable soil beds (lib/stackacres/soil.ts): the SOIL_TILE lattice
  // (floor(worldX / 64), floor(worldY / 64)), same bounding posture as
  // place-pipe above -- the coordinate range is generous but not unbounded,
  // and placeStackAcresSoilTile itself is what actually confines a tile to
  // the Crop Fields. Breaking ground is free: `place-soil-tile` and
  // `remove-soil-tile` move no Gold and no stock.
  z.object({
    action: z.literal("place-soil-tile"),
    tx: z.number().int().min(-512).max(512),
    ty: z.number().int().min(-512).max(512),
  }),
  z.object({
    action: z.literal("remove-soil-tile"),
    tx: z.number().int().min(-512).max(512),
    ty: z.number().int().min(-512).max(512),
  }),
  // Fence pieces, by Homestead map square. Wood only, both ways; no Gold.
  z.object({ action: z.literal("place-fence"), tx: z.number().int().min(0).max(255), ty: z.number().int().min(0).max(255) }),
  z.object({ action: z.literal("remove-fence"), tx: z.number().int().min(0).max(255), ty: z.number().int().min(0).max(255) }),
  // Hold-tap lift, tap-to-drop. `(tx, ty)` names the bed picked up (and,
  // through it, the whole contiguous group touching it -- see
  // stackacres-service.ts's `moveStackAcresSoilTileGroup`); `(toTx, toTy)` is
  // where the tapped bed lands. Same generous-but-bounded coordinate range as
  // place-soil-tile -- the Crop Fields rect is what actually confines it.
  // Moves no Gold either way.
  z.object({
    action: z.literal("move-soil-tile-group"),
    tx: z.number().int().min(-512).max(512),
    ty: z.number().int().min(-512).max(512),
    toTx: z.number().int().min(-512).max(512),
    toTy: z.number().int().min(-512).max(512),
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
  // The Pixel Pilgrim's prayer. Moves no Gold and spends no row of the
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
    item: z.enum(GIFTABLE_ITEMS as unknown as [string, ...string[]]),
  }),
  // The travelers' story (lib/stackacres/story/). Neither moves Gold:
  // `story-meet` accepts a traveler's first quest, `story-turn-in` hands the
  // active one in, debiting only the items it asked for and paying a story
  // keepsake, never a purse. Both only ever follow a bubble's own committing
  // button -- a tap on a traveler reaches this route not at all.
  z.object({
    action: z.literal("story-meet"),
    traveler: z.enum(TRAVELER_IDS as unknown as [string, ...string[]]),
  }),
  z.object({
    action: z.literal("story-turn-in"),
    traveler: z.enum(TRAVELER_IDS as unknown as [string, ...string[]]),
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
    case "work-land":
      return workStackAcresLand(token, action.obstacleId, now);
    case "upgrade-tool":
      return upgradeStackAcresTool(token, now);
    case "upgrade-axe":
      return upgradeStackAcresAxe(token, action.pay, now);
    case "buy-cutter":
      return buyStackAcresCutter(token, action.cutter, now);
    case "build-greenhouse":
      return buildStackAcresGreenhouse(token, now);
    case "stock":
      return action.tiles && action.tiles.length > 1
        ? stockStackAcresGroup(token, { stock: action.stock, tiles: action.tiles }, now)
        : stockStackAcres(
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
    case "feed-pen":
      return feedStackAcresPen(token, action.zone, now);
    case "water":
      return action.unitIds && action.unitIds.length > 1
        ? waterStackAcresGroup(token, action.unitIds, now)
        : waterStackAcres(token, action.unitId, now);
    case "draw-water":
      return drawStackAcresWater(token, now);
    case "catch-fish":
      return catchStackAcresFish(token, action.bait, now);
    case "eat":
      return eatStackAcresFoodAction(token, action.item, now);
    case "bag-quarry":
      return bagStackAcresQuarry(token, now);
    case "chop-tree":
      return chopStackAcresWoodTree(token, action.nodeId, now);
    case "gather-forage":
      return gatherStackAcresForage(token, action.nodeId, now);
    case "mine-stone":
      return mineStackAcresStoneNode(token, action.nodeId, now);
    case "clear":
      return clearStackAcresUnit(token, action.unitId, now);
    case "buy-feed":
      return buyStackAcresFeed(token, { itemId: action.itemId, quantity: action.quantity }, now);
    case "place-machine":
      return placeStackAcresMachine(token, action.kind, now);
    case "work":
      return workStackAcres(token, now);
    case "sell":
      return sellStackAcresItem(token, { item: action.item, quantity: action.quantity }, now);
    case "process":
      return processStackAcresRecipeAction(token, action.recipe, now);
    case "request-contract":
      return requestStackAcresContract(token, now);
    case "fulfill-contract":
      return fulfillStackAcresTownContract(token, now);
    case "pass-contract":
      return passStackAcresContract(token, now);
    case "seal-vat":
      return sealStackAcresVat(token, now);
    case "collect-vat":
      return collectStackAcresVat(token, now);
    case "seal-cellar":
      return sealStackAcresCellar(token, action.item, now);
    case "collect-cellar":
      return collectStackAcresCellar(token, now);
    case "set-kitchen-order":
      return setStackAcresKitchenOrder(token, action.recipe, now);
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
    case "prestige-reset":
      return prestigeResetStackAcres(token, now);
    case "forge-enchantment":
      return forgeStackAcresToolEnchantment(token, action.itemId, now);
    case "plant-crossbreed":
      return plantStackAcresCrossbreedBed(token, { row: action.row, col: action.col, stock: action.stock }, now);
    case "harvest-crossbreed":
      return harvestStackAcresCrossbreedBed(token, action.plotId, now);
    case "place-soil-tile":
      return placeStackAcresSoilTile(token, { tx: action.tx, ty: action.ty }, now);
    case "remove-soil-tile":
      return removeStackAcresSoilTile(token, { tx: action.tx, ty: action.ty }, now);
    case "place-fence":
      return placeStackAcresFencePiece(token, { tx: action.tx, ty: action.ty }, now);
    case "remove-fence":
      return removeStackAcresFencePiece(token, { tx: action.tx, ty: action.ty }, now);
    case "move-soil-tile-group":
      return moveStackAcresSoilTileGroup(
        token,
        { tx: action.tx, ty: action.ty, toTx: action.toTx, toTy: action.toTy },
        now,
      );
    case "buy-seed":
      return buyStackAcresSeed(token, { crop: action.crop, quantity: action.quantity }, now);
    case "pray":
      return prayAtStackAcresShrine(token, now);
    case "give-gift":
      return giveStackAcresGift(token, action.npc, action.item, now);
    case "story-meet":
      return meetStackAcresTraveler(token, action.traveler, now);
    case "story-turn-in":
      return turnInStackAcresTravelerQuest(token, action.traveler, now);
  }
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  // Every action here moves one purse at most once and the guards make
  // replays idempotent; 60/min covers a fast restocking ritual plus feeding
  // and watering with a wide margin.
  const limited = await enforceRateLimit(request, "stackacres:act", 60, 60 * 1000);
  if (limited) return limited;

  // Access is granted to a PROFILE, so the session cookie is what says who is
  // asking -- and it is read, never minted. A fresh token has no profile
  // behind it, so minting one here would fail the check anyway while handing a
  // prober an identity they never asked for, which is the one thing a refusal
  // must not do. It runs after the limiter above because it costs a database
  // read; see lib/server/stackacres-access.ts.
  //
  // Access and ban are both single-column reads of the SAME `profiles` row,
  // fetched together here rather than as two separate round trips (one
  // before the body is parsed, one after) -- `stackAcresActionGate`'s own
  // header explains why this route in particular gets the combined query.
  const token = readSessionToken(request);
  if (!token) return stackacresLocked();
  const gate = await stackAcresActionGate(token);
  if (!gate.access) return stackacresLocked();

  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a valid action." }, { status: 400 }),
        token,
      );
    }

    // EVERY action is gated on the ban, `collect` and `sell` included. A
    // ready unit stays ready and inventory stays held indefinitely for a
    // suspended account -- nothing here can rot -- so closing off `sell`
    // costs a banned account no progress, only the ability to convert what
    // it already grew into Gold until the ban lifts.
    if (gate.banned) {
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
    // Serialized once so the log can say how big the answer was.
    const payload = JSON.stringify(result);
    console.info("stackacres.action", {
      action: action.action,
      ms: Math.round(performance.now() - startedAt),
      bytes: payload.length,
      attempt: Number(request.headers.get("x-action-attempt")) || 1,
    });
    return withRequestSessionCookie(
      request,
      new NextResponse(payload, { headers: { "Content-Type": "application/json" } }),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toStackAcresErrorResponse(error), token);
  }
}
