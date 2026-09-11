import "server-only";
import { NextResponse } from "next/server";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_CROPS,
  STACKACRES_FEED,
  STACKACRES_FEED_SHIPMENTS_PER_PURCHASE,
  STACKACRES_MAX_EXTRA_CAP,
  STACKACRES_MUCK_CHANCE,
  STACKACRES_SEED_BAGS_PER_PURCHASE,
  capFor,
  stackacresCapacityPrice,
  isLivestock,
  isStackAcresCrop,
  isStackAcresStock,
  type SeedStock,
  type StackAcresCrop,
  type StackAcresLivestock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import {
  hungryAtFor,
  isStackAcresUnitDry,
  isStackAcresUnitHungry,
  isStackAcresUnitReady,
  thirstyAtFor,
  isUnwateredSeedRow,
  seedClockOnFirstWater,
  toStackAcresUnitSnapshots,
  type StackAcresUnitSnapshot,
} from "@/lib/stackacres/units";
import { STACKACRES_YIELDS, type StackAcresItem } from "@/lib/stackacres/items";
import {
  STACKACRES_GOLD_CEILING,
  exchangeState,
  stackacresExchangeDay,
  type StackAcresExchangeState,
} from "@/lib/stackacres/exchange";
import {
  harvestTally,
  settleHarvest,
  type HarvestCandidate,
  type HarvestSettlement,
} from "@/lib/stackacres/harvest";
import {
  stackacresUpkeepDay,
  stackacresUpkeepDue,
  upkeepState,
  type StackAcresUpkeepState,
} from "@/lib/stackacres/upkeep";
import { stackacresStockPrice } from "@/lib/stackacres/market";
import { emptyMuseumRegistry, museumDiscoveryBonusQuantity, type MuseumRegistry } from "@/lib/stackacres/museum";
import {
  STACKACRES_SECTORS,
  isSectorUnlocked,
  sectorClearCheck,
  sectorLabel,
  unlockedPlotCount,
  unlockedSectors,
  type SectorId,
} from "@/lib/stackacres/sectors";
import { CROP_FIELDS_UNLOCK_COST_GOLD, cropFieldsUnlockCheck } from "@/lib/stackacres/crop-fields";
import { PEN_ZONE_IDS, ZONE_IDS, type ZoneId } from "@/lib/stackacres/zones";
import {
  CROP_FIELD_BEDS,
  cropSpot,
  growAreaAt,
  soilTileInCropFieldBeds,
  stockZone,
} from "@/lib/stackacres/world";
import {
  PIPE_PLACE_COST,
  pipeTileCenter,
  recalculatePipeConnections,
  type IrrigableCrop,
  type NetworkGrid,
  type PipeFacing,
  type PipeKind,
  type PipeNode,
} from "@/lib/stackacres/irrigation";
// Re-exported for existing call sites (e.g. stackacres-pipe-service.test.ts)
// that imported the price straight off this file before it moved to
// lib/stackacres/irrigation.ts to be client-safe -- see that file's own
// comment on PIPE_PLACE_COST for why.
export { PIPE_PLACE_COST } from "@/lib/stackacres/irrigation";
import {
  aimStackAcresPipe,
  listStackAcresPipes,
  placeStackAcresPipe,
  removeStackAcresPipe,
  syncStackAcresPipeNetwork,
} from "./stackacres-pipe-store";
import {
  createSoilMap,
  nextFreeSoilSlot,
  planSoilGroupRelocation,
  soilSlotForTile,
  soilSlotOnTile,
  soilSlotTile,
  soilTileAt,
  soilTileKey,
  soilTileRect,
  soilTileTier,
  type SoilMap,
  type SoilTile,
  type SoilTileCoord,
} from "@/lib/stackacres/soil";
import {
  SOIL_BAGS_PER_PURCHASE,
  soilGrowthMultiplier,
  soilSelfHydrates,
  soilTierDef,
  soilTierPrice,
  toSoilTier,
  type SoilTier,
} from "@/lib/stackacres/soil-tiers";
import {
  adjustStackAcresSoilStock,
  listStackAcresSoilTiles,
  readStackAcresSoilStock,
  type SoilStock,
  placeStackAcresSoilTile as placeSoilTileRow,
  removeStackAcresSoilTile as removeSoilTileRow,
  moveStackAcresSoilTiles as moveSoilTileGroupRow,
} from "./stackacres-soil-store";
import { adjustStackAcresSeedStock, readStackAcresSeedStock } from "./stackacres-seed-store";
import {
  GREENHOUSE_SLOT_CAP,
  greenhouseBuildCheck,
  greenhouseDurationMs,
  isGreenhouseStock,
} from "@/lib/stackacres/greenhouse";
import {
  HIDDEN_ZONES,
  SECRET_ITEM_CATALOGUE,
  SECRET_ITEM_IDS,
  STACKACRES_DICE_BOOST_ARMED_KEY,
  effectiveCritChance,
  isHiddenZoneId,
  isSecretItemId,
  nextUpkeepPaidAfterDiceTrade,
  rollSecretDiscovery,
  secretZoneAttemptKey,
  type HiddenZoneId,
  type SecretItemId,
} from "@/lib/stackacres/secrets";
import {
  DEVOTION_LADDER,
  DEVOTION_RUNG_THRESHOLDS,
  devotionView,
  previousUtcDay,
  type RelicId,
  type StackAcresDevotionView,
} from "@/lib/stackacres/devotion";
import {
  FRIENDSHIP_LADDER,
  FRIENDSHIP_NPCS,
  FRIENDSHIP_RUNG_THRESHOLDS,
  friendshipView,
  giftPoints,
  isNpcId,
  type KeepsakeId,
  type NpcId,
  type StackAcresFriendshipView,
} from "@/lib/stackacres/friendship";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  abandonStackAcresUnit,
  adjustStackAcresSecretLedger,
  readStackAcresSecretLedgerQty,
  adjustStackAcresCapacity,
  adjustStackAcresFeed,
  clearStackAcresMuck,
  readStackAcresToolTier,
  upgradeStackAcresToolTier,
  readStackAcresCutters,
  recordStackAcresCutter,
  collectStackAcresUnit,
  countOccupiedStackAcresUnits,
  createStackAcresUnit,
  SoilSlotConflictError,
  feedStackAcresUnit,
  getStackAcresUnit,
  listStackAcresUnits,
  markStackAcresDonated,
  readStackAcresCapacity,
  readStackAcresExchanged,
  readStackAcresFeed,
  readStackAcresWater,
  adjustStackAcresWater,
  fillStackAcresWater,
  readStackAcresMuseum,
  raiseStackAcresUpkeep,
  readStackAcresSectors,
  readStackAcresUpkeep,
  recordStackAcresHarvest,
  recordStackAcresSectorCleared,
  releaseStackAcresExchange,
  reserveStackAcresExchange,
  retireStackAcresUnit,
  waterStackAcresUnit,
  createStackAcresContract,
  createStackAcresMachine,
  createStackAcresWheatPlot,
  createStackAcresVatManifest,
  collectStackAcresMachine,
  collectStackAcresVatManifest,
  collectStackAcresWheatPlot,
  readStackAcresVatManifest,
  fulfillStackAcresContract as settleStackAcresContract,
  listStackAcresMachines,
  listStackAcresWheatPlots,
  readStackAcresInfluence,
  readStackAcresInventory,
  readStackAcresMuseumSecrets,
  markStackAcresMuseumSecret,
  readStackAcresOpenContract,
  adjustStackAcresInfluence,
  adjustStackAcresInventory,
  startStackAcresMachine,
  processStackAcresRecipe,
  processStackAcresRecipeMulti,
  readStackAcresGreenhouse,
  buildStackAcresGreenhouseRow,
  readStackAcresCropFieldsUnlocked,
  recordStackAcresCropFieldsUnlocked,
  countGreenhouseStackAcresUnits,
  readStackAcresPrestige,
  readStackAcresLifetimeGross,
  resetStackAcresPrestige,
  readStackAcresDevotion,
  prayAtStackAcresShrine as prayAtStackAcresShrine_store,
  readStackAcresFriendship,
  giveStackAcresGift as giveStackAcresGift_store,
  type StoredStackAcresUnit,
  type StoredContract,
  type StoredWheatPlot,
} from "./stackacres-store";
import {
  prestigeGoldRemaining,
  type StackAcresPrestigeView,
  type StackAcresPrestigeResetResult,
} from "@/lib/stackacres/prestige";
export type { StackAcresPrestigeView, StackAcresPrestigeResetResult } from "@/lib/stackacres/prestige";
import {
  claimStackAcresIntent,
  completeStackAcresIntent,
  releaseStackAcresIntent,
} from "./stackacres-intent-store";
import { creditGoldByProfile, ensureProfile, getProfileById, spendGoldByProfile } from "./profile-store";
import {
  readMidnightMerchantVisit,
  redeemMidnightMerchantItem,
  spawnMidnightMerchantVisit,
} from "./midnight-merchant-store";
import {
  MIDNIGHT_MERCHANT_WINDOW_MS,
  isMidnightMerchantItemId,
  shouldSpawnMidnightMerchantOnCriticalHarvest,
  type MidnightMerchantItemId,
  type MidnightMerchantSnapshot,
} from "@/lib/stackacres/midnight-merchant";
import {
  critBonusQuantity,
  nextToolTier,
  rollHarvestCrit,
  stackacresToolTierDef,
  toolUpgradePrice,
  type StackAcresToolTier,
} from "@/lib/stackacres/equipment";
import {
  isStackAcresBuyableCutter,
  stackacresCutterDef,
  type StackAcresBuyableCutter,
  type StackAcresCutter,
} from "@/lib/stackacres/cutters";
import { machineItemLabel } from "@/lib/stackacres/machine-items";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import {
  WHEAT_DURATION_MS,
  WHEAT_PLOT_CAP,
  WHEAT_SEED_COST,
  WHEAT_YIELD_QUANTITY,
  toWheatPlotSnapshot,
  type StackAcresWheatPlotSnapshot,
} from "@/lib/stackacres/wheat-plot";
import {
  MACHINE_CAP,
  MACHINE_CATALOGUE,
  canStartMachine,
  isMachineDone,
  isMachineKind,
  rollMillDoubleOutput,
  toMachineSnapshot,
  type MachineKind,
  type StackAcresMachineSnapshot,
} from "@/lib/stackacres/machines";
import {
  VAT_INPUT_ITEM,
  VAT_INPUT_QUANTITY,
  baseGoldValueForSeal,
  firstAgingTier,
  toVatContainer,
  vatTierForElapsed,
  agedGoldValue,
  type VatContainer,
} from "@/lib/stackacres/aging";
import {
  SYNERGY_PERKS,
  applySynergyEffects,
  isSynergyArchetype,
  type SynergyArchetype,
} from "@/lib/stackacres/synergy-perks";
import {
  activateSynergyPerk,
  applySynergyBuffs,
  listActiveSynergyArchetypes,
  listUnlockedSynergyArchetypes,
  unlockSynergyPerk,
} from "./stackacres-synergy-service";
import {
  forgeEnchantment,
  forgedToolStatsFor,
  listOwnedForgeEnchantmentIds,
} from "./stackacres-forge-service";
import { FORGE_ENCHANTMENTS, isForgeEnchantmentId } from "@/lib/stackacres/forge";
import {
  harvestCrossbreedBed,
  plantCrossbreedBed,
  type CrossbreedHarvestSettlement,
  type StoredCrossbreedPlot,
} from "./stackacres-crossbreeding-service";
import {
  listStackAcresCrossbreedPlots,
  readStackAcresCrossbreedInventory,
} from "./stackacres-crossbreeding-store";
import {
  isInCrossbreedGrid,
  toCrossbreedPlotView,
  type CrossbreedBedView,
  type CrossbreedPlotView,
} from "@/lib/stackacres/crossbreeding";
import { canFulfillContract, drawContract, type StackAcresContractRow } from "@/lib/stackacres/contracts";
import {
  emptySecretMuseumRegistry,
  rollSecretArtifact,
  secretHiddenSetComplete,
  type SecretMuseumItemId,
  type SecretMuseumRegistry,
} from "@/lib/stackacres/museum-secrets";
import { applyAchievementEvent } from "./achievement-store";
import {
  RECIPE_CATALOGUE,
  isInstantRecipe,
  isRecipeId,
  recipesForMachine,
  type RecipeId,
} from "@/lib/stackacres/recipes";
import {
  isMachineItem,
  machineItemSellPrice,
  type MachineItemId,
  type MachineProcessedItem,
} from "@/lib/stackacres/machine-items";
import type { BlueprintId } from "@/lib/stackacres/blueprints";
import {
  blueprintsView,
  contributeToBlueprint,
  startBlueprintForProfile,
  type BlueprintView,
} from "./stackacres-blueprint-service";
import {
  evaluateStackAcresShopLock,
  stackacresShopLockRefusal,
  type StackAcresShopLock,
  type StackAcresShopProgress,
} from "@/lib/stackacres/shop-locks";
import { applyInfluenceDiscount } from "@/lib/stackacres/influence-tiers";
import { DRONE_DEPLOY_COST_GOLD } from "@/lib/stackacres/drone";
import {
  collectDroneForage,
  deployDrone,
  isDroneHangarUnlocked,
  listDrones,
} from "./stackacres-drone-service";
import type { StoredDrone } from "./stackacres-drone-store";

/**
 * Everything between a StackAcres request and the player's purse.
 *
 * ONE CURRENCY NOW. This used to run on two: Bushels inside the farm, Gold
 * outside it, joined by a daily exchange window. A harvest is valued and paid
 * in Gold in one step, so Bushels had nothing left to denominate and are gone,
 * along with the barn and the store shelf that stood between a crop and its
 * money.
 *
 * A HARVEST NO LONGER PAYS GOLD, TO ANYONE, FOR ANY ITEM (2026-09-10). It used
 * to pay every collected unit's value directly, under a flat daily ceiling.
 * That is gone: `harvestStackAcres` now always credits the shared processing
 * inventory (./inventory.ts) -- the same door wheat, flour, milk and wool
 * already used -- and the only ways an item there becomes Gold are the new
 * `sellStackAcresItem` (any item, any time, at its own sell price) and a
 * fulfilled Town Contract (`fulfillStackAcresTownContract`, a premium price
 * for Flour/Cheese/Cloth specifically). This did not remove the safety
 * property, it relocated it: **the flat daily ceiling on how much Gold one
 * player may take out of the farm** is unchanged, mirrored as a hard limit
 * inside `reserve_homestead_exchange`, and now gates Sell and a Contract
 * instead of a harvest. Not a percentage, not scaled by stock owned. See
 * lib/stackacres/exchange.ts.
 *
 * THE GOLD PATHS, and the asymmetry that is the whole safety story:
 *
 *   * NINE SPEND. `expandStackAcresCapacity` buys a slot, `buyStackAcresStock`
 *     buys stock outright, `stockStackAcres` buys a cycle's seed,
 *     `buyStackAcresFeed` buys a shipment, `clearStackAcresUnit` pays a muck
 *     fee, `upgradeStackAcresTool` buys a rung of the equipment ladder,
 *     `buyStackAcresCutter` buys the Mower,
 *     `sowStackAcresWheat` buys wheat seed, `placeStackAcresMachine` buys a
 *     machine outright. All sinks. Land Maintenance (`assessStackAcresUpkeep`)
 *     is a tenth, standalone one -- see its own section below.
 *   * THREE PAY, and all three are gated by `STACKACRES_GOLD_CEILING`, the
 *     SAME flat daily reservation, through the SAME `reserveStackAcresExchange`/
 *     `releaseStackAcresExchange` pair: `sellStackAcresItem`, the new baseline
 *     door from inventory to Gold; `fulfillStackAcresTownContract`, which
 *     trades processed goods for a premium in Gold and Town Influence; and
 *     `collectStackAcresVat`, the Fermenting Vat's own aged-Cheese payout
 *     (lib/stackacres/aging.ts). Nothing else here may credit Gold. A fourth
 *     payer is exactly the kind of change this comment exists to make a
 *     reviewer stop over -- see lib/stackacres/contracts.ts's own header for
 *     why routing a new payer through the SAME ceiling, rather than inventing
 *     a second one, is what keeps it safe.
 *
 * THE CRITICAL HARVEST, RAY'S MUSEUM'S DISCOVERY BONUS and THE PRESTIGE RESET
 * VALVE all used to ride inside the harvest's own Gold payout. None of them
 * pay Gold any more, for the same reason harvest itself does not:
 *
 *   * A crit (`critBonusQuantity`, lib/stackacres/equipment.ts) now adds bonus
 *     UNITS to a settled line, credited into the same inventory line as the
 *     rest of that line's produce -- extra Eggs, not extra Gold.
 *   * Ray's Museum's first-ever-discovery bonus (`museumDiscoveryBonusQuantity`,
 *     lib/stackacres/museum.ts) is the identical shape: bonus units of the
 *     item just discovered, folded into the same credit.
 *   * The Prestige Reset Valve's permanent multiplier moved to
 *     `sellStackAcresItem`, applied to the Gold a sale yields, before that
 *     Gold is reserved against the ceiling -- see lib/stackacres/prestige.ts's
 *     own header for why that ordering is load-bearing rather than cosmetic.
 *
 * Every refund goes through `refundGold` rather than calling
 * `creditGoldByProfile` directly, so that the credit function has exactly
 * FOUR call sites in this file: the refund helper, and the three payers
 * above. That is not a style preference -- it is what lets a test state the
 * real invariant ("Gold is credited only by a payer that reserves against the
 * ceiling first") instead of counting call sites that grow with every new
 * refund. A new direct `creditGoldByProfile` that does NOT reserve first is
 * the change to stop over.
 *
 * LAND MAINTENANCE is a standalone daily wallet debit now
 * (`assessStackAcresUpkeep`), not something netted out of a harvest payout --
 * a harvest produces no payout left to net it from. It runs as a best-effort
 * side effect of `runStackAcresAction`, on every MUTATING action (never a
 * bare read -- see readStackAcres and CLAUDE.md's "keep game reads
 * write-free" rule), clamped at the wallet's own current balance so it can
 * never go negative. Curve and reasoning unchanged in lib/stackacres/upkeep.ts.
 *
 * BOUNTIFUL HARVEST (mono-crop/crop-rotation sweep bonuses) IS RETIRED
 * OUTRIGHT, not relocated -- a sweep-composition bonus has no clean meaning
 * against "sum what was gathered into inventory," and re-deriving one for the
 * new model was explicitly out of scope for this pass. `lib/stackacres/bounty.ts`
 * is deleted.
 *
 * A StackAcres unit is a *guaranteed* win -- nothing here can lose your seed,
 * animals go hungry but never die -- so the ordering discipline every staked
 * service restates still applies:
 *
 *   1. **The money leaves the purse before the thing it pays for exists.**
 *      Buying capacity, stock, seed or feed debits Gold before the write
 *      lands. Either write failing refunds. Selling reverses the direction
 *      but keeps the same shape: the GOODS leave inventory before the Gold
 *      they are worth is reserved.
 *   2. **Payment lands only after the version-guarded settlement write is
 *      confirmed.** collectStackAcresUnit returns null on a lost race, a stale
 *      version, or a not-actually-ready row, and null must never pay: the
 *      writer that wins the race is the one that is paid.
 *   3. **Settlement credits the yield snapshotted at stocking, never a
 *      re-read of the catalogue.** A retune between stocking and harvest
 *      gives the player what they agreed to. The per-item VALUE is read live,
 *      because that is the price of produce at the moment it is sold and no
 *      agreement was made about it.
 *
 * There is no rule 4 (escrow released exactly once): no second party.
 *
 * THE MUCK ROLL is the one thing here that is not a pure function of
 * timestamps, and it lives in exactly one place: rollMuck, called once per
 * unit inside the harvest, after the guarded write has confirmed which rows
 * settled. Rolling it anywhere a read can reach would let a player reroll it
 * by pulling to refresh. Bought stock is not rolled at all.
 *
 * THERE IS NO PLOT ANY MORE (see 2026-09-03's CLAUDE.md entry -- "districts
 * hold stock, not plots"). Every action here takes a `unitId` instead of a
 * `plotIndex`, buying a plot is gone, and buying capacity replaces it as the
 * Gold sink that bounds how much of one kind a player can run at once.
 */

/**
 * Reasons a StackAcres refusal is ordinary play rather than a fault.
 *
 * `day-capped` is the farm hitting its flat daily Gold ceiling: nothing is
 * wrong, the crops keep, and the client should say so plainly rather than
 * repaint in silence (see the ceiling throw in `harvestStackAcres`).
 */
export type StackAcresRefusalReason = "day-capped";

/** Refuses a StackAcres request in a way the player can act on. */
export class StackAcresRequestError extends ArcadeRequestError<
  StackAcresUnitSnapshot[],
  StackAcresRefusalReason
> {
  readonly name = "StackAcresRequestError";
}

/**
 * The Synergy Tree, as the client renders it. See
 * lib/server/stackacres-synergy-service.ts's own header for the ownership
 * vs. loadout split -- `unlocked` is "ever bought", `active` is "slotted for
 * this session", and an id can be in the first without being in the second.
 */
export interface StackAcresSynergyView {
  unlocked: SynergyArchetype[];
  active: SynergyArchetype[];
  /**
   * The multiplier the client applies to its own FARMHAND_SPEED constant.
   * Computed here against a base of 1 rather than sent as an absolute speed
   * -- the farmhand's walk is presentation-only and lives entirely
   * client-side (lib/stackacres/farmhand-path.ts), so this is the one number
   * that seam actually needs. 1 when `automated_logistics` is not active.
   */
  farmhandSpeedMultiplier: number;
}

export interface StackAcresView {
  units: StackAcresUnitSnapshot[];
  profile: PlayerProfile;
  feed: number;
  /** Water left in the watering can (lib/stackacres/water-can.ts). */
  water: number;
  /** Purchased extra capacity slots, by stock kind. */
  capacity: Partial<Record<StackAcresStock, number>>;
  /** Today's allowance: the flat ceiling, and what is left of it. */
  exchange: StackAcresExchangeState;
  /** Ray's Museum: which produce items this player has ever donated. Total
   *  over every item, never partial -- see emptyMuseumRegistry. */
  museum: MuseumRegistry;
  /** Ray's Museum, secret wing: which hidden finds this player has ever
   *  turned up (see lib/stackacres/museum-secrets.ts). Total over every
   *  item, same "never partial" contract `museum` above carries. */
  museumSecrets: SecretMuseumRegistry;
  /**
   * Land the player may work. DERIVED, not just the stored clear list -- see
   * `unlockedSectors` in lib/stackacres/sectors.ts, which also counts any
   * district they already keep stock in. The client draws everything else as
   * wild ground.
   */
  sectors: SectorId[];
  /** Today's Land Maintenance: what it is charged on, what is owed, and what
   *  the next harvest will be docked. */
  upkeep: StackAcresUpkeepState;
  /** The equipment rung this player holds. Never null -- a player who has
   *  bought nothing holds the free starting Trowel. */
  tool: StackAcresToolTier;
  /** Grass cutters owned, Scythe first. Which one is in hand is the client's
   *  choice; see lib/stackacres/cutters.ts. */
  cutters: StackAcresCutter[];
  /** Wheat growing toward a Mill. See lib/stackacres/wheat-plot.ts's header
   *  for why this is not part of `units`. */
  wheatPlots: StackAcresWheatPlotSnapshot[];
  /** Processing buildings placed on the farm. */
  machines: (StackAcresMachineSnapshot & { canStart: boolean })[];
  /** What a wheat plot's harvest and a Mill's output sit as. */
  inventory: StackAcresInventory;
  /** The town's one open request, or null when there is not one. */
  contract: StackAcresContractRow | null;
  /** Town Influence earned to date, total. */
  influence: number;
  /** Hidden secrets: how many of each secret item this player currently
   *  holds, and whether a Lucky Poker Dice crit boost is armed for their
   *  very next harvest. A missing key in `held` means 0, same convention
   *  `capacity` already uses for a stock kind nobody has bought a slot for. */
  secrets: { held: Partial<Record<SecretItemId, number>>; boostArmed: boolean };
  /** Whether this player has ever donated each secret item to Ray's Museum --
   *  a small, separate registry from `museum` above (that one is total over
   *  `StackAcresItem`, and a secret item is deliberately not a member of that
   *  enum; see lib/stackacres/secrets.ts's own header). */
  secretDonations: Record<SecretItemId, boolean>;
  /** The Synergy Tree: which archetypes are unlocked/active, and what that
   *  currently does to the farmhand's presentation-only walk speed. */
  synergy: StackAcresSynergyView;
  /** Whether this player has built the Greenhouse (lib/stackacres/greenhouse.ts).
   *  Permanent once true; gates the `inGreenhouse` option on `stock`. */
  greenhouseBuilt: boolean;
  /** Whether this player has unlocked the Crop Fields
   *  (lib/stackacres/crop-fields.ts). Permanent once true; gates sowing any
   *  crop and placing any soil bed. Used to be a `SectorId` ("meadow") in
   *  `sectors` above -- see that module's own header on the 2026-09-08
   *  district merge that made this a standalone flag instead. */
  cropFieldsUnlocked: boolean;
  /** Ray's Mythic Blueprints: one entry per structure in the catalogue,
   *  present whether or not the player has started it (see
   *  lib/server/stackacres-blueprint-service.ts's `blueprintsView`) --
   *  the same "every key present, missing means never started" posture
   *  `secretDonations` above already takes for a never-donated item. */
  blueprints: Record<BlueprintId, BlueprintView>;
  /** The Midnight Merchant's current visit, or null when the NPC is not on
   *  the lot right now. See lib/stackacres/midnight-merchant.ts -- this is
   *  the ENTIRE surface the client's own render manager is allowed to trust;
   *  a snapshot here is server-confirmed, never a local guess. */
  midnightMerchant: MidnightMerchantSnapshot | null;
  /** The Prestige Reset Valve's permanent state: how many times it has been
   *  pulled, the live harvest multiplier it bought, and how much further
   *  gross production is needed before it can be pulled again. See
   *  lib/stackacres/prestige.ts's own header for what "gross" means here and
   *  why it is immune to the daily Gold ceiling. */
  prestige: StackAcresPrestigeView;
  /** The Sunlight Forge: catalogue ids (FORGE_ENCHANTMENTS keys, not the
   *  versioned `enchant_..._v1` wrapper) this player has permanently
   *  forged. Applies to whichever equipment tier `tool` above currently
   *  holds -- there is no per-tool-instance row, see lib/stackacres/
   *  forge.ts's own header for why that is deliberate. */
  forge: readonly string[];
  /** The Crossbreeding Bed: every planted cell on its own fixed 4x4 grid,
   *  readiness already derived by this server's clock, and the hybrids bred
   *  so far. See lib/stackacres/crossbreeding.ts's own header for why this
   *  is its own grid and not a revival of the dead plot grid. */
  crossbreed: CrossbreedBedView;
  /** The irrigation pipe network: every placed tile with its recomputed
   *  connector frame and hydration (lib/stackacres/irrigation.ts). The scene
   *  renders straight off this; a crop a hydrated pipe waters is already
   *  reflected in `units` (its `isWatered`/`state`), not re-derived here. */
  irrigation: PipeNode[];
  /** This profile's soil beds on the Crop Fields' own lattice
   *  (lib/stackacres/soil.ts) -- every one of it, since the free starter
   *  grant was removed (see that file's own "starter kit" section). */
  soilTiles: SoilTile[];
  /** Bags of each soil tier bought from Ray but not laid down yet
   *  (`homestead_soil_stock`). A missing tier and 0 mean the same thing. */
  soilStock: SoilStock;
  /** Seeds of each crop bought from Ray but not planted yet
   *  (`homestead_seed_stock`). A missing crop and 0 mean the same thing.
   *  Livestock is never a key here -- see SeedStock's own doc comment. */
  seedStock: SeedStock;
  /** The Pixel Pilgrim's devotion: this player's UTC-day prayer streak and
   *  progress up his relic ladder. See lib/stackacres/devotion.ts. */
  devotion: StackAcresDevotionView;
  /** NPC friendship: this player's gift points and claimed keepsake ladder
   *  with every NPC that has one (FRIENDSHIP_NPCS -- Grandfather Ray, for
   *  now). A SEPARATE mechanic from `devotion` above -- see
   *  lib/stackacres/friendship.ts's own header. */
  friendship: Record<NpcId, StackAcresFriendshipView>;
  /** The Fermenting Vat: null until the player has placed one (see
   *  `machines`, kind `"vat"`), otherwise its current seal (if any) and what
   *  each tier of it is worth. See lib/stackacres/aging.ts. */
  vat: VatContainer | null;
  /** The Mechanical Forage Drone hangar: whether it is unlocked (derived
   *  from Ray's Museum donations, see `isDroneHangarUnlocked`) and every
   *  drone this profile owns. A drone's own live tile/patrol/charge is
   *  NEVER in this snapshot -- that is client-side, ephemeral state owned
   *  entirely by lib/stackacres/drone.ts, the same split `units` takes with
   *  a critter's own wander position. This is ownership only: what the
   *  scene needs to know to decide how many drones to spawn and where. */
  droneHangar: {
    unlocked: boolean;
    drones: { droneId: string; deployedAt: string }[];
  };
}

/**
 * The working crops the irrigation recompute cares about, each at the world
 * point it is actually DRAWN at -- the pure module never touches world
 * geometry beyond the tile size, so this resolves it here.
 *
 * THE SOIL MAP IS REQUIRED, and passing it fixes a real mismatch rather than
 * only serving the tiers. This used to call `cropSpot(zone, row.id)` with no
 * placement, which is the hash-SCATTER fallback -- while the scene draws the
 * same crop through `cropSpot(..., { soil, slot })`, i.e. on a bed. The two
 * disagreed, so a pipe's `PIPE_MAX_REACH` was measured from where the crop
 * ISN'T: a player could run a pipe right up to a plant and have it stay
 * thirsty, or water one nowhere near the network. Resolving the spot the same
 * way the renderer does is what makes reach mean what the player sees.
 *
 * `row.soilSlot` alone decides it now (2026-09-10) -- no rank-hash fallback
 * to keep in step with the scene's own any more, since the scene does not
 * have one either. A crop with no slot scatters on both sides identically,
 * by the same per-id hash `cropSpot` always falls back to, so the two still
 * never disagree.
 */
function irrigableCrops(
  rows: readonly StoredStackAcresUnit[],
  soil: SoilMap,
): IrrigableCrop[] {
  const working = rows.filter(
    (row) => row.status === "working" && STACKACRES_CATALOGUE[row.stock].thirstMs !== null,
  );
  const crops: IrrigableCrop[] = [];
  for (const row of working) {
    // Livestock is already excluded above: thirstMs === null means the
    // recompute would never mark it irrigated anyway, so skip the work.
    const spot = cropSpot(stockZone(row.stock), row.id, { soil, slot: row.soilSlot });
    crops.push({ unitId: row.id, worldX: spot.x, worldY: spot.y });
  }
  return crops;
}

/**
 * The whole hydration picture for one farm: the pipe network, plus the crops
 * standing on a self-watering bed.
 *
 * ONE PLACE, called by every site that needs it (`snapshots`, the view
 * builder, the pipe-removal before-shot and `recomputeIrrigation`). Those four
 * used to each call `recalculatePipeConnections` themselves, which was fine
 * while pipes were the only water source and is exactly the kind of thing
 * that rots the moment a second one exists -- miss one site and a crop's
 * `isWatered` disagrees with itself depending on which action last answered.
 */
function irrigationGridFor(
  rows: readonly StoredStackAcresUnit[],
  pipes: Parameters<typeof recalculatePipeConnections>[0]["tiles"],
  soil: SoilMap,
): NetworkGrid {
  const crops = irrigableCrops(rows, soil);
  const grid = recalculatePipeConnections({ tiles: pipes, crops });

  const selfWatered = new Set<string>();
  for (const crop of crops) {
    const { tx, ty } = soilTileAt(crop.worldX, crop.worldY);
    const tile = soil.get(soilTileKey(tx, ty));
    if (tile && soilSelfHydrates(soilTileTier(tile))) selfWatered.add(crop.unitId);
  }
  if (selfWatered.size === 0) return grid;

  return {
    ...grid,
    irrigatedUnitIds: new Set<string>([...grid.irrigatedUnitIds, ...selfWatered]),
  };
}

/** Which of `rows` a pipe or hydro bed waters right now. Every readiness and
 *  dryness check on the server has to be given this, or a piped crop reads as
 *  dry: its `lastWateredAt` only moves on a layout change. */
async function irrigatedUnitIdsFor(
  profileId: string,
  rows: readonly StoredStackAcresUnit[],
): Promise<ReadonlySet<string>> {
  const [pipes, purchasedSoil] = await Promise.all([
    listStackAcresPipes(profileId),
    listStackAcresSoilTiles(profileId),
  ]);
  return irrigationGridFor(rows, pipes, soilMapFor(purchasedSoil)).irrigatedUnitIds;
}

/**
 * Marks watered, as of `now`, every working crop in `stampIds` whose soil
 * reads dry, so pulling the water later starts the drought from here rather
 * than retroactively. `ready_at` does not move: the water cost it no growing
 * time. Seed that was never watered starts its growing clock here instead
 * (`seedClockOnFirstWater`), so time it sat unwatered is never counted as
 * growth. A lost version race is harmless: the next stamp settles it.
 */
async function stampIrrigatedCrops(
  rows: readonly StoredStackAcresUnit[],
  stampIds: ReadonlySet<string>,
  now: Date,
): Promise<void> {
  await Promise.all(
    rows
      .filter((row) => row.status === "working" && stampIds.has(row.id) && isStackAcresUnitDry(row, now, false))
      .map((row) => {
        if (!isUnwateredSeedRow(row)) return waterStackAcresUnit(row, now, new Date(row.readyAt));
        const clock = seedClockOnFirstWater(row, now.getTime());
        return waterStackAcresUnit(row, now, clock.readyAt, clock.startedAt);
      }),
  );
}

/** A crop just sown onto a bed a pipe or hydro soil already reaches is
 *  watered from the start, so a null `lastWateredAt` only ever means seed
 *  nobody has watered. */
async function waterIrrigatedCrops(profileId: string, now: Date): Promise<void> {
  const rows = await listStackAcresUnits(profileId);
  await stampIrrigatedCrops(rows, await irrigatedUnitIdsFor(profileId, rows), now);
}

/** The full slot space for one farm: every tile it has bought. USED TO also
 *  merge in a free starter pair (`mergeSoilTiles`, since deleted along with
 *  the starter grant -- see lib/stackacres/soil.ts's own "starter kit"
 *  section) -- a farm's placed soil is now simply what it purchased. */
function soilMapFor(purchased: readonly SoilTile[]): SoilMap {
  return createSoilMap(purchased);
}

function parseUnitId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StackAcresRequestError("Not a real unit.", 400);
  }
  return value;
}

async function snapshots(profileId: string, now: Date): Promise<StackAcresUnitSnapshot[]> {
  const rows = await listStackAcresUnits(profileId);
  return toStackAcresUnitSnapshots(rows, now, await irrigatedUnitIdsFor(profileId, rows));
}

/** Every donation flag for a player, split into the two registries that ride
 *  the same underlying `homestead_museum_donations` rows: `museum`, total
 *  over `StackAcresItem`, and `secretDonations`, total over `SecretItemId` --
 *  a secret item is deliberately not a member of the former enum, so one
 *  donated id can only ever land in exactly one of the two. Both overlaid
 *  onto a fresh registry so a legacy or partial row never leaves an item
 *  undefined. */
function splitMuseumDonations(
  donated: readonly string[],
): { museum: MuseumRegistry; secretDonations: Record<SecretItemId, boolean> } {
  const registry = { ...emptyMuseumRegistry() } as Record<string, boolean>;
  for (const itemId of donated) {
    if (itemId in registry) registry[itemId] = true;
  }
  const secretDonations = Object.fromEntries(
    SECRET_ITEM_IDS.map((itemId) => [itemId, donated.includes(itemId)]),
  ) as Record<SecretItemId, boolean>;
  return { museum: registry as MuseumRegistry, secretDonations };
}

/** The secret wing's own version of `museumView`, same overlay contract. */
async function museumSecretsView(profileId: string): Promise<SecretMuseumRegistry> {
  const found = await readStackAcresMuseumSecrets(profileId);
  const registry = { ...emptySecretMuseumRegistry() } as Record<string, boolean>;
  for (const itemId of found) {
    if (itemId in registry) registry[itemId] = true;
  }
  return registry as SecretMuseumRegistry;
}

/** Strips the profile id off a stored contract row -- the client-safe shape
 *  every other view already follows (StoredStackAcresUnit -> StackAcresUnitSnapshot
 *  does the same thing). */
function toContractView(contract: StoredContract): StackAcresContractRow {
  return {
    id: contract.id,
    item: contract.item,
    quantity: contract.quantity,
    goldReward: contract.goldReward,
    influenceReward: contract.influenceReward,
    status: contract.status,
    createdAt: contract.createdAt,
  };
}

async function view(profile: PlayerProfile, now: Date): Promise<StackAcresView> {
  const day = stackacresExchangeDay(now);
  const [
    rows,
    feed,
    water,
    capacity,
    exchanged,
    cleared,
    upkeepPaid,
    donated,
    museumSecrets,
    tool,
    wheatRows,
    machineRows,
    inventory,
    contract,
    influence,
    boostArmedQty,
    heldQtys,
    unlockedSynergies,
    activeSynergies,
    greenhouseBuilt,
    cropFieldsUnlocked,
    blueprints,
    midnightMerchant,
    prestige,
    lifetimeGross,
    forgedEnchantments,
    crossbreedPlots,
    crossbreedInventory,
    pipeRows,
    soilTiles,
    soilStock,
    seedStock,
    storedDevotion,
    storedFriendships,
    vatManifest,
    cutters,
  ] = await Promise.all([
    listStackAcresUnits(profile.id),
    readStackAcresFeed(profile.id),
    readStackAcresWater(profile.id),
    readStackAcresCapacity(profile.id),
    readStackAcresExchanged(profile.id, day),
    readStackAcresSectors(profile.id),
    readStackAcresUpkeep(profile.id, day),
    readStackAcresMuseum(profile.id),
    museumSecretsView(profile.id),
    readStackAcresToolTier(profile.id),
    listStackAcresWheatPlots(profile.id),
    listStackAcresMachines(profile.id),
    readStackAcresInventory(profile.id),
    readStackAcresOpenContract(profile.id),
    readStackAcresInfluence(profile.id),
    readStackAcresSecretLedgerQty(profile.id, STACKACRES_DICE_BOOST_ARMED_KEY),
    // One nested Promise.all rather than spreading SECRET_ITEM_IDS.map(...)
    // into this array literal: a spread of a variable-length array would
    // widen every sibling element's inferred type too, since Promise.all's
    // tuple overload needs a fixed-length literal to keep each position's own
    // type. Nesting keeps this array a fixed-length literal.
    Promise.all(SECRET_ITEM_IDS.map((itemId) => readStackAcresSecretLedgerQty(profile.id, itemId))),
    listUnlockedSynergyArchetypes(profile.id),
    listActiveSynergyArchetypes(profile.id),
    readStackAcresGreenhouse(profile.id),
    readStackAcresCropFieldsUnlocked(profile.id),
    blueprintsView(profile.id),
    readMidnightMerchantVisit(profile.id, now),
    readStackAcresPrestige(profile.id),
    readStackAcresLifetimeGross(profile.id),
    listOwnedForgeEnchantmentIds(profile.id),
    listStackAcresCrossbreedPlots(profile.id),
    readStackAcresCrossbreedInventory(profile.id),
    listStackAcresPipes(profile.id),
    listStackAcresSoilTiles(profile.id),
    readStackAcresSoilStock(profile.id),
    readStackAcresSeedStock(profile.id),
    readStackAcresDevotion(profile.id),
    // Nested Promise.all for the same reason SECRET_ITEM_IDS's own read
    // above is: FRIENDSHIP_NPCS is variable-length, and spreading it into
    // this array literal would widen every sibling element's inferred type.
    Promise.all(FRIENDSHIP_NPCS.map((npc) => readStackAcresFriendship(profile.id, npc))),
    readStackAcresVatManifest(profile.id),
    readStackAcresCutters(profile.id),
  ]);

  const { museum, secretDonations } = splitMuseumDonations(donated);
  const held: Partial<Record<SecretItemId, number>> = {};
  SECRET_ITEM_IDS.forEach((itemId, index) => {
    if (heldQtys[index] > 0) held[itemId] = heldQtys[index];
  });

  const irrigationGrid = irrigationGridFor(rows, pipeRows, soilMapFor(soilTiles));
  const friendship = {} as Record<NpcId, StackAcresFriendshipView>;
  FRIENDSHIP_NPCS.forEach((npc, index) => {
    friendship[npc] = friendshipView(storedFriendships[index], now);
  });
  const units = toStackAcresUnitSnapshots(rows, now, irrigationGrid.irrigatedUnitIds);
  const sectors = unlockedSectors(cleared, units);
  const vatMachine = machineRows.find((machine) => machine.kind === "vat") ?? null;
  const vat = vatMachine ? toVatContainer(vatMachine, vatManifest, now) : null;
  // A separate pair of reads rather than folded into the big Promise.all
  // above: that array is a fixed-length tuple on purpose (see its own
  // comment on why a variable-length spread would widen every sibling
  // element's type), and this pair has nothing to do with land/economy --
  // it is read-only hangar ownership, exactly the same "narrow, no Gold
  // opinion" posture `readShopProgress` takes for Ray's shop locks.
  const [droneHangarUnlocked, droneRows] = await Promise.all([
    isDroneHangarUnlocked(profile.id),
    listDrones(profile.id),
  ]);
  return {
    units,
    profile,
    feed,
    water,
    capacity,
    exchange: exchangeState(exchanged, now),
    museum,
    museumSecrets,
    sectors,
    // Reported, never charged, from here: a read must not move a purse. The
    // charge happens inside a harvest, netted out of what it pays.
    upkeep: upkeepState(unlockedPlotCount(sectors, capacity, cropFieldsUnlocked), upkeepPaid),
    tool,
    cutters,
    wheatPlots: wheatRows.map((row) => toWheatPlotSnapshot(row, now)),
    machines: machineRows.map((row) => ({
      ...toMachineSnapshot(row, now),
      canStart: row.status === "idle" && canStartMachine(inventory, row.kind),
    })),
    inventory,
    contract: contract ? toContractView(contract) : null,
    influence,
    secrets: { held, boostArmed: boostArmedQty >= 1 },
    secretDonations,
    synergy: {
      unlocked: unlockedSynergies,
      active: activeSynergies,
      // Base 1, not the real FARMHAND_SPEED constant: farmhand.ts owns that
      // number and lives client-side, so the multiplier is what actually
      // crosses the wire -- see StackAcresSynergyView's own comment.
      farmhandSpeedMultiplier: applySynergyEffects(
        { harvestCritChance: 0, farmhandSpeed: 1, millDoubleOutputChance: 0 },
        activeSynergies,
      ).farmhandSpeed,
    },
    greenhouseBuilt,
    cropFieldsUnlocked,
    blueprints,
    midnightMerchant,
    prestige: {
      prestigeCount: prestige.prestigeCount,
      multiplier: prestige.multiplier,
      goldToNextPrestige: prestigeGoldRemaining(prestige, lifetimeGross),
    },
    forge: forgedEnchantments,
    crossbreed: {
      plots: crossbreedPlots.map((row) => toCrossbreedPlotView(row, now.getTime())),
      inventory: crossbreedInventory,
    },
    irrigation: [...irrigationGrid.nodes],
    soilTiles,
    soilStock,
    seedStock,
    devotion: devotionView(storedDevotion, now),
    friendship,
    vat,
    droneHangar: {
      unlocked: droneHangarUnlocked,
      drones: droneRows.map((drone) => ({ droneId: drone.droneId, deployedAt: drone.deployedAt })),
    },
  };
}

/**
 * The Prestige Reset Valve's calculation hook: loads a profile's stored
 * permanent multiplier and hands back the bare number `settleHarvest` needs.
 *
 * Nothing here reaches into harvest logic itself -- see harvest.ts's own
 * header for why the multiplier is a PARAMETER to that pure function rather
 * than something it fetches for itself. This is the one function that closes
 * the loop: it is the only place `readStackAcresPrestige` is called with the
 * express purpose of pricing a harvest, as opposed to rendering the farm view
 * (`view()`, above) or reporting a reset's own result
 * (`prestigeResetStackAcres`, below).
 *
 * Defaults to STACKACRES_PRESTIGE_BASE_MULTIPLIER (1) for a profile that has
 * never reset, which is exactly what `readStackAcresPrestige` already
 * returns for a missing row -- this function adds no second fallback on top
 * of that one.
 */
export async function getPrestigeMultiplier(profileId: string): Promise<number> {
  const state = await readStackAcresPrestige(profileId);
  return state.multiplier;
}

/**
 * Hands back Gold that was just taken for something that then did not happen.
 *
 * THE ONLY REASON THIS EXISTS as a function rather than several inline calls:
 * it keeps `creditGoldByProfile` down to four call sites in this file -- this
 * refund helper, `sellStackAcresItem`, `fulfillStackAcresTownContract` and
 * `collectStackAcresVat` -- so "Gold is credited only by a payer that
 * reserves against the ceiling first" is a claim a test can hold by reading
 * the source, instead of a count that has to be edited every time a refund is
 * added. See the header.
 *
 * Never throws. A refund is already the failure path; turning it into a
 * second failure would leave the player short AND looking at a different
 * error than the one that actually happened.
 */
async function refundGold(profileId: string, gold: number): Promise<void> {
  if (gold <= 0) return;
  await creditGoldByProfile(profileId, gold).catch(() => null);
}

/**
 * Picks the bed a crop about to be sown will stand in, and reports what that
 * bed does to its cycle.
 *
 * READ-ONLY: it moves nothing and can only make the sow slower to answer,
 * never wrong. A crop with nowhere to stand gets `slot: null` and the plain
 * multiplier -- and, since 2026-09-09, `stockStackAcres` treats that as a
 * refusal for an open-air crop rather than sowing onto the rank-hash
 * fallback (see its own comment at the call). The null answer itself is
 * kept rather than thrown here so the Greenhouse and livestock cases, which
 * are ALWAYS null and always fine, stay one plain return.
 *
 * `tile`, when given, is the bed the player actually tapped to open the
 * seed menu -- honoured exactly when it names a real, unoccupied bed, so a
 * planting lands where the player was looking rather than on whatever the
 * lowest free slot happens to be. A stale tap (the bed filled a beat
 * earlier, or names ground with no bed at all) falls straight through to
 * the same "lowest free slot" pick every other sow uses, never a refusal.
 *
 * The full slot space is every tile this profile has bought, in the SAME
 * order (`soilMapFor`) the shell hands the scene, which is what makes the
 * slot index this returns mean the same bed on both sides.
 */
async function assignSoilSlot(
  profileId: string,
  stock: StackAcresStock,
  inGreenhouse: boolean,
  tile: SoilTileCoord | null = null,
): Promise<{ slot: number | null; growthMultiplier: number }> {
  const plain = { slot: null, growthMultiplier: 1 };
  if (inGreenhouse) return plain;
  if (!(STACKACRES_CROPS as readonly string[]).includes(stock)) return plain;

  const [purchased, units] = await Promise.all([
    listStackAcresSoilTiles(profileId),
    listStackAcresUnits(profileId),
  ]);
  const soil = soilMapFor(purchased);
  const taken = units
    .map((unit) => unit.soilSlot)
    .filter((slot): slot is number => slot !== null);

  let slot: number | null = null;
  if (tile) {
    const tapped = soilSlotForTile(soil, tile.tx, tile.ty);
    if (tapped !== null && !taken.includes(tapped)) slot = tapped;
  }
  if (slot === null) slot = nextFreeSoilSlot(soil, taken);
  if (slot === null) return plain;
  const tileRow = soilSlotTile(soil, slot);
  if (!tileRow) return plain;

  return { slot, growthMultiplier: soilGrowthMultiplier(soilTileTier(tileRow)) };
}

/**
 * Everything any action can add to the view. Two actions return anything
 * beyond the farm itself now -- a harvest, which has to say what it brought
 * in and what it paid, and a prestige reset, which has to say what it just
 * bought -- which is why a replayed intent only has to remember this much
 * (see `replayDelta`).
 */
export type StackAcresActionResult = StackAcresView & {
  harvest?: unknown;
  /** Set (to an item id or null) by `tapStackAcresSecretZone`; every other
   *  action leaves this undefined. */
  discovery?: unknown;
  /** Set by `unlockStackAcresSynergyPerk`/`activateStackAcresSynergyPerk`;
   *  every other action leaves these undefined. `synergy` on the view itself
   *  already carries the resulting state, so these are only the "what did
   *  this specific call just do" confirmation a toast reads off of. */
  synergyUnlock?: unknown;
  synergyActivate?: unknown;
  /** Set by `buyFromMidnightMerchant` on a successful purchase; every other
   *  action leaves this undefined. */
  midnightMerchantPurchase?: {
    itemId: string;
    pricePaid: number;
    purchaseStreak: number;
    remaining: number;
  };
  /** Set by `prestigeResetStackAcres` to what THIS reset just bought -- never
   *  named `prestige`, which is StackAcresView's own always-present current
   *  standing and would collide with it in this intersection. */
  prestigeReset?: unknown;
  /** Set by `forgeStackAcresToolEnchantment` to what THIS forge just bought
   *  -- never named `forge`, which is StackAcresView's own always-present
   *  owned-list and would collide with it in this intersection. */
  forgeResult?: unknown;
  /** Set by `plantStackAcresCrossbreedBed`/`harvestStackAcresCrossbreedBed`
   *  to what THIS call just did -- never named `crossbreed`, which is
   *  StackAcresView's own always-present bed and would collide with it in
   *  this intersection. */
  crossbreedResult?: unknown;
  /** Set by `prayAtStackAcresShrine` to what THIS prayer just did -- never
   *  named `devotion`, which is StackAcresView's own always-present current
   *  standing and would collide with it in this intersection. */
  prayer?: {
    streak: number;
    alreadyPrayedToday: boolean;
    grantedRelic: RelicId | null;
  };
  /** Set by `giveStackAcresGift` to what THIS gift just did -- never named
   *  `friendship`, which is StackAcresView's own always-present current
   *  standing and would collide with it in this intersection. */
  gift?: {
    npc: NpcId;
    points: number;
    outcome: "gifted" | "already-gifted-today" | "insufficient-item";
    grantedKeepsake: KeepsakeId | null;
  };
  /** Set by `collectStackAcresVat` to what THIS collection just paid --
   *  never named `vat`, which is StackAcresView's own always-present current
   *  standing and would collide with it in this intersection. */
  vatCollected?: {
    quantity: number;
    tier: 1 | 2 | 3;
    stars: 1 | 2 | 3;
    multiplier: number;
    gold: number;
  };
  /** Set by `deployStackAcresDrone` on a successful deploy; every other
   *  action leaves this undefined. */
  droneDeploy?: { droneId: string };
  /** Set by `collectStackAcresDroneForage` on a successful claim; every
   *  other action leaves this undefined. */
  droneForage?: { droneId: string; reward: number };
};

/**
 * The part of a result a duplicate has to be told a second time.
 *
 * Never the view: a replay is answered with a freshly read one, so a duplicate
 * can only ever hand back numbers at least as current as the original did.
 * Storing the view instead would mean a request replayed ten minutes later
 * repainted the farm as it looked ten minutes ago.
 */
function replayDelta(result: StackAcresActionResult): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {};
  if (result.harvest !== undefined) delta.harvest = result.harvest;
  if (result.discovery !== undefined) delta.discovery = result.discovery;
  if (result.synergyUnlock !== undefined) delta.synergyUnlock = result.synergyUnlock;
  if (result.synergyActivate !== undefined) delta.synergyActivate = result.synergyActivate;
  if (result.midnightMerchantPurchase !== undefined) {
    delta.midnightMerchantPurchase = result.midnightMerchantPurchase;
  }
  if (result.prestigeReset !== undefined) delta.prestigeReset = result.prestigeReset;
  if (result.forgeResult !== undefined) delta.forgeResult = result.forgeResult;
  if (result.crossbreedResult !== undefined) delta.crossbreedResult = result.crossbreedResult;
  if (result.prayer !== undefined) delta.prayer = result.prayer;
  if (result.gift !== undefined) delta.gift = result.gift;
  if (result.vatCollected !== undefined) delta.vatCollected = result.vatCollected;
  return Object.keys(delta).length > 0 ? delta : null;
}

/**
 * Runs one action at most once per intent.
 *
 * `key` is the client's own name for what it is trying to do, and this is the
 * only thing standing between a duplicated request and a double spend for the
 * four actions that CREATE something -- `stock`, `buy-stock`, `buy-feed` and
 * `expand-capacity` have no row to version-guard, so nothing else can tell a
 * duplicate from a second deliberate purchase. See
 * ./stackacres-intent-store.ts for why the other six were already safe.
 *
 * `key` is optional, and a request without one runs exactly as it always did.
 * That is deliberate: the guard belongs to callers who can name their intent,
 * and an older client (or a phone that reloaded mid-deploy) must not start
 * failing because it does not send one.
 *
 * Three outcomes, and NONE of them is a refusal -- a duplicate that sounds
 * like a denial is the bug this exists to avoid:
 *
 *   * **fresh** -- nobody has claimed this intent. Run it, then record the
 *     small delta a twin would need. A throw releases the claim, because a
 *     refusal did not happen and the player's next press must be a real
 *     attempt.
 *   * **replay** -- the twin already finished. Answer with a fresh view plus
 *     the delta it recorded, so the duplicate reads exactly like the original
 *     succeeding.
 *   * **in-flight** -- the twin is still running. Answer with the farm as it
 *     stands; the client's own clock re-reads a second later and picks up
 *     whatever the twin lands.
 */
export async function runStackAcresAction(
  token: string,
  key: string | null,
  action: string,
  run: () => Promise<StackAcresActionResult>,
  now = new Date(),
): Promise<StackAcresActionResult> {
  // Land Maintenance is assessed here, once per mutating action -- see
  // assessStackAcresUpkeep's own header. Never runs off a bare read:
  // readStackAcres calls view() directly and never reaches this function, so
  // CLAUDE.md's "keep game reads write-free" rule holds. assessStackAcresUpkeep
  // never throws, so this never turns the action riding on it into an error.
  const profile = await ensureProfile(token);
  await assessStackAcresUpkeep(profile.id, now);

  if (!key) return run();

  const claim = await claimStackAcresIntent(profile.id, key, action, now.getTime());
  if (claim.kind === "replay") return { ...(await view(profile, now)), ...(claim.result ?? {}) };
  if (claim.kind === "in-flight") return view(profile, now);

  try {
    const result = await run();
    await completeStackAcresIntent(profile.id, key, replayDelta(result));
    return result;
  } catch (error) {
    await releaseStackAcresIntent(profile.id, key);
    throw error;
  }
}

/**
 * The whole farm, as the client renders it.
 *
 * THERE IS NO STARTING GRANT ANY MORE. There used to be one -- 150 Bushels,
 * handed over on the first read -- because a farm with no Bushels could not
 * stock anything and so could not begin. Seed is bought with Gold now, and
 * every player already has Gold from the daily grant, the streak and the
 * backstop, so the farm needs no faucet of its own to get started. Deleting it
 * removes a credit path rather than converting one, which is the direction
 * this file's header says to prefer.
 */
export async function readStackAcres(token: string, now = new Date()): Promise<StackAcresView> {
  return view(await ensureProfile(token), now);
}

/** How many of `stock` this player may OCCUPY a slot with at once right now
 *  (working or mucked -- see `countOccupiedStackAcresUnits`'s own comment
 *  for why mucked still counts). Crops have no ceiling any more (catalogue.ts
 *  STACKACRES_BASE_CAP's header) -- only livestock still runs a bounded pen. */
async function capacityFor(profileId: string, stock: StackAcresStock): Promise<number> {
  if (!isLivestock(stock)) return Number.POSITIVE_INFINITY;
  const capacity = await readStackAcresCapacity(profileId);
  return capFor(capacity[stock] ?? 0);
}

/* ------------------------------------------------------------------ */
/* Land: what is cleared, and what keeping it costs                    */
/* ------------------------------------------------------------------ */

/**
 * Reads the land a player may work and what they own on it. A PURE READ:
 * nothing here moves a purse.
 *
 * IT USED TO CHARGE. The Bushel version settled the day's fee here, off every
 * mutating action, and `landGate` then refused to let an unpaid farm grow.
 * Both are gone with the second currency, and the reason is worth writing
 * down rather than rediscovering:
 *
 *   * **The fee is netted out of a harvest now** (see lib/stackacres/harvest.ts
 *     and lib/stackacres/upkeep.ts), clamped at what that harvest is worth. It
 *     cannot reach a balance, so there is nothing for a gate to protect
 *     against and no arrears to chase.
 *   * **Gating growth on an unpaid bill achieved nothing once that was true.**
 *     The gate existed because a Bushel debit could go unpaid while the farm
 *     kept earning through other paths. A farm nobody is harvesting produces
 *     no Gold at all, so there is nothing to sink and nobody to press -- and
 *     dropping it removes the one shape this fee must never have, a debt a
 *     player cannot work their way out of.
 *
 * The sectors and units are handed back together rather than read separately,
 * and that is not premature tidiness: every caller needs both a line later
 * (which land is open, how much stock is going), and re-reading them made the
 * hot stocking path do four queries where two will do.
 */
async function readLand(
  profileId: string,
): Promise<{ sectors: SectorId[]; units: StoredStackAcresUnit[] }> {
  const [cleared, units] = await Promise.all([
    readStackAcresSectors(profileId),
    listStackAcresUnits(profileId),
  ]);
  return { sectors: unlockedSectors(cleared, units), units };
}

/**
 * Land Maintenance: charges what is due, lazily, as a best-effort side
 * effect of the next mutating farm action -- see `runStackAcresAction`, the
 * one place this is called from, and lib/stackacres/upkeep.ts's own header
 * for why this is a standalone wallet debit now rather than something netted
 * out of a harvest payout (a harvest produces no payout left to net it from).
 *
 * Clamped at the wallet's own current balance, never more: tries the full
 * bill first, and only falls back to "whatever the wallet holds" once that
 * is refused, so a player who CAN afford it is never short-changed by a
 * stale balance read. An unpaid remainder is not carried as debt --
 * `stackacresUpkeepDue` (unchanged) simply re-reads the same still-due
 * amount next time.
 *
 * NEVER THROWS. The caller rides this alongside whatever action it is
 * assessing upkeep for, and a maintenance hiccup must not turn that action
 * into an error response -- the same posture every other best-effort
 * side-write in this file takes.
 */
export async function assessStackAcresUpkeep(profileId: string, now: Date): Promise<void> {
  try {
    const day = stackacresUpkeepDay(now);
    const [upkeepPaid, { sectors }, capacity, cropFieldsUnlocked] = await Promise.all([
      readStackAcresUpkeep(profileId, day),
      readLand(profileId),
      readStackAcresCapacity(profileId),
      readStackAcresCropFieldsUnlocked(profileId),
    ]);
    const due = stackacresUpkeepDue(unlockedPlotCount(sectors, capacity, cropFieldsUnlocked), upkeepPaid);
    if (due <= 0) return;

    let charged = (await spendGoldByProfile(profileId, due)) ? due : 0;
    if (charged === 0) {
      const profile = await getProfileById(profileId);
      const balance = profile?.goldBalance ?? 0;
      if (balance > 0) {
        charged = (await spendGoldByProfile(profileId, balance)) ? balance : 0;
      }
    }
    if (charged > 0) {
      await raiseStackAcresUpkeep(profileId, day, upkeepPaid + charged);
    }
  } catch (error) {
    console.error("stackacres.upkeep_assess_failed", { profileId, error });
  }
}

/**
 * What Ray's shop is allowed to know about this farm before it sells
 * anything -- see lib/stackacres/shop-locks.ts.
 *
 * Three reads, in parallel, rather than the whole `view()`: a gate check runs
 * BEFORE the Gold moves and `view()` runs after it, so building the entire
 * farm twice per purchase to answer one boolean would double the cost of
 * every shelf button on the screen. Deliberately narrow for a second reason
 * too -- a progress struct that cannot see the purse cannot accidentally
 * become a second place that decides whether somebody can afford something.
 *
 * Land comes through `readLand` above rather than by unioning the cleared
 * rows and the units here. That is the whole point: a second, subtly
 * different idea of which land is yours is the one bug this gate cannot
 * afford, so there is exactly one place that derivation is written.
 */
async function readShopProgress(profileId: string): Promise<StackAcresShopProgress> {
  const [{ sectors }, influence, greenhouseBuilt, cropFieldsUnlocked] = await Promise.all([
    readLand(profileId),
    readStackAcresInfluence(profileId),
    readStackAcresGreenhouse(profileId),
    readStackAcresCropFieldsUnlocked(profileId),
  ]);
  return { sectors, influence, greenhouseBuilt, cropFieldsUnlocked };
}

/**
 * Refuses a purchase the farm has not unlocked yet, before a piece of Gold
 * moves.
 *
 * THIS IS THE SECURITY BOUNDARY, not the greyed-out card. The shelf disables
 * a locked row, but the shelf is a browser: a hand-rolled POST, a tab left
 * open across a prestige reset, or a replayed request all arrive here with a
 * perfectly well-formed body naming a real item. So the check sits on the
 * near side of `spendGoldByProfile` in every gated path -- refusing after the
 * debit would mean a refund, and a refund is a second money path where a
 * plain "no" will do.
 *
 * Costs nothing on an ungated row, and nothing extra on a row that passes:
 * the reads are skipped outright when the entry carries no lock, and the
 * refusal's snapshot is only built once there is actually a refusal to send.
 * Most of Ray's shelf is ungated and must not pay for this.
 */
async function requireUnlockedShopEntry(
  entry: StackAcresShopLock & { label: string },
  profileId: string,
  now: Date,
): Promise<void> {
  if (!entry.requiredQuestFlag && !entry.minimumMilestone) return;
  const state = evaluateStackAcresShopLock(entry, await readShopProgress(profileId));
  if (state.isUnlocked) return;
  throw new StackAcresRequestError(stackacresShopLockRefusal(entry.label, state), 409, {
    round: await snapshots(profileId, now),
  });
}

/** Refuses an action aimed at land nobody has cleared yet. The client hides
 *  these controls entirely (a locked sector paints no pens to tap), so this
 *  is the guard against a hand-rolled request rather than a UI state. */
function requireOpenSector(sectors: readonly SectorId[], zone: ZoneId, what: string): void {
  if (isSectorUnlocked(zone, sectors)) return;
  throw new StackAcresRequestError(
    `${sectorLabel(zone)} is still under wild growth. Clear the land before you keep ${what} there.`,
    409,
  );
}

/**
 * Clears a sector: the one-off Gold price of turning wild ground into land
 * you can farm.
 *
 * A pure Gold SINK, permanent, and never refunded once the row lands -- the
 * same category as `expandStackAcresCapacity`, and the reason the asymmetry
 * note at the top of this file is untouched by it.
 *
 * Rule 1 the whole way down: the requirements are checked before a piece of
 * Gold moves, the Gold leaves before the land is recorded, and every failure
 * after the debit refunds. The permanent thing here is a single row with the
 * (profile, sector) primary key as its idempotency guard, so two tabs
 * clearing the same land together pay for it once and the loser is refunded.
 */
export async function clearStackAcresSector(
  token: string,
  sectorInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!(ZONE_IDS as readonly string[]).includes(sectorInput)) {
    throw new StackAcresRequestError("There is no such place.", 400);
  }
  const sector = sectorInput as SectorId;
  const def = STACKACRES_SECTORS[sector];
  const profile = await ensureProfile(token);

  // Owing rent on the land you have is a reason not to be sold more of it,
  // and this settles the bill on the way past -- and hands over the two
  // answers the requirement check is about to ask for.
  const { sectors, units } = await readLand(profile.id);
  const check = sectorClearCheck(sector, { unlocked: sectors, unitCount: units.length });
  if (check.wild) {
    // Ground the 2026-09-07 map re-lay reserved with no system under it yet
    // (see ./lib/stackacres/sectors.ts's `SectorState`). Refused here as well
    // as in the modal so a hand-rolled POST cannot buy an empty field, and so
    // the two can never word it differently -- both read `sectorClearCheck`.
    throw new StackAcresRequestError(
      `There is nothing to clear at ${sectorLabel(sector)} yet.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }
  if (check.alreadyOpen) {
    throw new StackAcresRequestError(`${sectorLabel(sector)} is already yours.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!check.ok) {
    // The first thing still missing, worded exactly as the modal's own
    // checklist words it -- both read the same `sectorClearCheck`.
    const missing = check.requirements.find((requirement) => !requirement.met);
    throw new StackAcresRequestError(missing?.label ?? "Not yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, def.clearCost);
  if (!debited) {
    throw new StackAcresRequestError(
      `Clearing ${sectorLabel(sector)} costs ${def.clearCost.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let recorded: boolean;
  try {
    recorded = await recordStackAcresSectorCleared(profile.id, sector, now);
  } catch (error) {
    await refundGold(profile.id, def.clearCost);
    throw error;
  }
  if (!recorded) {
    // Another tab cleared it between the check above and now. The land is
    // theirs either way; this request must not have been charged for it.
    await refundGold(profile.id, def.clearCost);
    throw new StackAcresRequestError(`${sectorLabel(sector)} is already yours.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/**
 * Unlocks the Crop Fields, exactly once: the same shape as
 * `clearStackAcresSector` immediately above (Gold leaves first, the
 * permanent row is recorded, a lost race refunds), but against
 * lib/stackacres/crop-fields.ts's standalone flag rather than a sector --
 * see that module's own header on why the Crop Fields could not stay a
 * `homestead_sectors` row once they merged into the Farmstead district.
 */
export async function unlockStackAcresCropFields(
  token: string,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);

  const [unlocked, units] = await Promise.all([
    readStackAcresCropFieldsUnlocked(profile.id),
    listStackAcresUnits(profile.id),
  ]);
  const check = cropFieldsUnlockCheck({ unlocked, unitCount: units.length });
  if (check.alreadyOpen) {
    throw new StackAcresRequestError("The Crop Fields are already yours.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!check.ok) {
    // The first thing still missing, worded exactly as the modal's own
    // checklist words it -- both read the same `cropFieldsUnlockCheck`.
    const missing = check.requirements.find((requirement) => !requirement.met);
    throw new StackAcresRequestError(missing?.label ?? "Not yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, CROP_FIELDS_UNLOCK_COST_GOLD);
  if (!debited) {
    throw new StackAcresRequestError(
      `Unlocking the Crop Fields costs ${CROP_FIELDS_UNLOCK_COST_GOLD.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let recorded: boolean;
  try {
    recorded = await recordStackAcresCropFieldsUnlocked(profile.id, now);
  } catch (error) {
    await refundGold(profile.id, CROP_FIELDS_UNLOCK_COST_GOLD);
    throw error;
  }
  if (!recorded) {
    // Another tab unlocked it between the check above and now. The Crop
    // Fields are theirs either way; this request must not have been charged
    // for it.
    await refundGold(profile.id, CROP_FIELDS_UNLOCK_COST_GOLD);
    throw new StackAcresRequestError("The Crop Fields are already yours.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/**
 * Builds the Greenhouse, exactly once: debits `GREENHOUSE_BUILD_COST`
 * (lib/stackacres/greenhouse.ts) out of the processing-track inventory and
 * records the permanent row, both inside `buildStackAcresGreenhouseRow`'s own
 * database transaction -- see the migration for why this is one atomic,
 * row-locked RPC rather than a check-then-debit-then-write done here.
 *
 * NOT A GOLD PATH. This spends processing-track goods (Flour, Cloth), the
 * same currency `fulfillStackAcresTownContract`'s inputs and a Mill recipe's
 * inputs already move in -- there is nothing here for the file header's Gold
 * asymmetry note to answer, since no Gold changes hands either way.
 */
export async function buildStackAcresGreenhouse(
  token: string,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);

  // Checked here for a clean 400/409 ahead of the database's own row-locked
  // RPC, the same "checked here, enforced for real there" split every other
  // action in this file already takes.
  const [inventory, alreadyBuilt] = await Promise.all([
    readStackAcresInventory(profile.id),
    readStackAcresGreenhouse(profile.id),
  ]);
  const check = greenhouseBuildCheck(inventory, alreadyBuilt);
  if (check.alreadyBuilt) {
    throw new StackAcresRequestError("The Greenhouse already stands.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!check.ok) {
    const short = check.lines.find((line) => !line.met);
    throw new StackAcresRequestError(
      short
        ? `Building the Greenhouse needs ${short.needed.toLocaleString()} ${short.item} (you have ${short.held.toLocaleString()}).`
        : "Not yet.",
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  const built = await buildStackAcresGreenhouseRow(profile.id);
  if (!built) {
    // Another tab either built it, or beat this one to the same materials,
    // between the check above and now. Nothing was spent by this call
    // either way -- the RPC's own transaction guarantees that -- so there is
    // nothing to refund.
    throw new StackAcresRequestError(
      "That didn't go through -- check your materials and try again.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  return view(profile, now);
}

/**
 * Buys one extra capacity slot for a kind, at the flat per-kind price, IN ANY
 * ORDER -- there is nothing to unlock first, the same reasoning that
 * flattened the old plot ladder. Replaces `buyStackAcresPlot`.
 *
 * LIVESTOCK ONLY: a crop has no cap to raise (catalogue.ts's
 * STACKACRES_BASE_CAP header), so there is nothing this can sell it. Rejected
 * up front rather than silently charging Gold for a no-op.
 */
export async function expandStackAcresCapacity(
  token: string,
  stockInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!isStackAcresStock(stockInput)) throw new StackAcresRequestError("Not a real stock.", 400);
  if (!isLivestock(stockInput)) {
    throw new StackAcresRequestError("Crops have no capacity to expand -- there is no ceiling to raise.", 400);
  }
  const stock: StackAcresLivestock = stockInput;
  const def = STACKACRES_CATALOGUE[stock];
  const profile = await ensureProfile(token);

  // Buying room is taking on more land, so both land rules apply: the ground
  // has to be cleared, and the fee on what is already kept has to be settled.
  const land = await readLand(profile.id);
  requireOpenSector(land.sectors, stockZone(stock), `${def.label}s`);

  const capacity = await readStackAcresCapacity(profile.id);
  const extraSlots = capacity[stock] ?? 0;
  if (extraSlots >= STACKACRES_MAX_EXTRA_CAP) {
    throw new StackAcresRequestError(`Every ${def.label} slot is already expanded.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const price = stackacresCapacityPrice(stock);
  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(`Expanding ${def.label} capacity costs ${price.toLocaleString()} Gold.`, 400);
  }

  const next = await adjustStackAcresCapacity(profile.id, stock, 1);
  if (next === null) {
    // Lost the race against the DB's own 0..3 bound (another tab expanded
    // this same kind between the read above and now): refund.
    await refundGold(profile.id, price);
    throw new StackAcresRequestError(`Every ${def.label} slot is already expanded.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/**
 * Buys the next rung of the equipment ladder, with Gold.
 *
 * A SINK, like every other Gold path in this file bar the exchange window --
 * see the header. Nothing is refunded, nothing is sold back, and a rung once
 * bought is a permanent fact about the account.
 *
 * Rule 1 throughout: the Gold is debited before the rung is written, and a
 * write that loses its race refunds. The store's write is guarded on the rung
 * the caller was last seen holding, which is what makes a double-tapped
 * upgrade charge exactly once -- two racing requests both debit, exactly one
 * matches, and the loser is refunded here.
 *
 * Takes no argument beyond the token on purpose. The client does not name the
 * rung it wants: the ladder is walked one step at a time from whatever the
 * SERVER says is currently held, so a stale or hand-edited request cannot
 * skip a rung or re-buy one.
 */
export async function upgradeStackAcresTool(
  token: string,
  now = new Date(),
): Promise<StackAcresView & { upgraded: { from: StackAcresToolTier; to: StackAcresToolTier } }> {
  const profile = await ensureProfile(token);

  const current = await readStackAcresToolTier(profile.id);
  const next = nextToolTier(current);
  const listPrice = toolUpgradePrice(current);
  if (!next || listPrice === null) {
    throw new StackAcresRequestError("You already hold the finest tool on the farm.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Before the money, not after it. The rung the ladder offers next is the
  // only one this request can name (see the doc comment above), so the gate
  // has exactly one entry to evaluate and no index off the wire to trust.
  await requireUnlockedShopEntry(stackacresToolTierDef(next), profile.id, now);

  // Town Favor: a permanent discount off the list price, keyed to cumulative
  // Influence -- see lib/stackacres/influence-tiers.ts. Read once, right
  // before the price is fixed, so the amount refunded on any failure below
  // matches exactly what was charged.
  const price = applyInfluenceDiscount(listPrice, await readStackAcresInfluence(profile.id));

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(
      `A ${stackacresToolTierDef(next).label} costs ${price.toLocaleString()} Gold.`,
      400,
    );
  }

  let settled: StackAcresToolTier | null;
  try {
    settled = await upgradeStackAcresToolTier(profile.id, current, next);
  } catch (error) {
    // Through refundGold, never creditGoldByProfile directly: that is what
    // keeps the credit function down to two call sites and lets the currency
    // wall assert "there is one payout" rather than count refunds.
    await refundGold(profile.id, price);
    throw error;
  }
  if (!settled) {
    // Lost the race against another tab buying the same rung. A lost race did
    // not happen, so it must not be paid for.
    await refundGold(profile.id, price);
    throw new StackAcresRequestError("That was already bought.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return { ...(await view(debited, now)), upgraded: { from: current, to: settled } };
}

/**
 * Buys a cutter (the Mower), with Gold. Same order as the spade ladder above:
 * the shop gate, then the debit, then a write guarded on the row not existing
 * yet, refunding if it finds the cutter was already bought.
 */
export async function buyStackAcresCutter(
  token: string,
  cutterInput: string,
  now = new Date(),
): Promise<StackAcresView & { boughtCutter: StackAcresBuyableCutter }> {
  if (!isStackAcresBuyableCutter(cutterInput)) {
    throw new StackAcresRequestError("Ray doesn't sell that.", 400);
  }
  const cutter = cutterInput;
  const def = stackacresCutterDef(cutter);
  const listPrice = def.price;
  if (listPrice === null) throw new StackAcresRequestError("Ray doesn't sell that.", 400);
  const profile = await ensureProfile(token);

  if ((await readStackAcresCutters(profile.id)).includes(cutter)) {
    throw new StackAcresRequestError(`You already own the ${def.label}.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }
  await requireUnlockedShopEntry(def, profile.id, now);

  // Town Favor applies here like every other Ray's-shop price.
  const price = applyInfluenceDiscount(listPrice, await readStackAcresInfluence(profile.id));

  // Rule 1: the Gold leaves first.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(`The ${def.label} costs ${price.toLocaleString()} Gold.`, 400);
  }

  let recorded: boolean;
  try {
    recorded = await recordStackAcresCutter(profile.id, cutter);
  } catch (error) {
    await refundGold(profile.id, price);
    throw error;
  }
  if (!recorded) {
    // Another tab bought it between the read above and the write.
    await refundGold(profile.id, price);
    throw new StackAcresRequestError("That was already bought.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return { ...(await view(debited, now)), boughtCutter: cutter };
}

/**
 * Permanently unlocks a Synergy Tree archetype, with Gold. The debit and the
 * grant are one atomic step server-side -- `unlockSynergyPerk` (which this
 * wraps) delegates whole to `unlock_stackacres_perk`, so there is no second
 * "rule 1: debit first" to restate here the way every other Gold sink in
 * this file has to: that ordering is the RPC's job, not this function's.
 */
export async function unlockStackAcresSynergyPerk(
  token: string,
  archetypeInput: string,
  now = new Date(),
): Promise<StackAcresView & { synergyUnlock: { archetype: SynergyArchetype; success: boolean } }> {
  if (!isSynergyArchetype(archetypeInput)) {
    throw new StackAcresRequestError("Not a real archetype.", 400);
  }
  const archetype = archetypeInput;
  const profile = await ensureProfile(token);
  const { outcome } = await unlockSynergyPerk(profile.id, archetype);
  if (!outcome.success) {
    const label = SYNERGY_PERKS[archetype].label;
    const message =
      outcome.reason === "already_owned"
        ? `You already own ${label}.`
        : `${label} costs ${SYNERGY_PERKS[archetype].unlockCostGold.toLocaleString()} Gold.`;
    throw new StackAcresRequestError(message, outcome.reason === "already_owned" ? 409 : 400, {
      round: await snapshots(profile.id, now),
    });
  }
  return { ...(await view(profile, now)), synergyUnlock: { archetype, success: true } };
}

/**
 * Slots an already-unlocked archetype into the current session's loadout.
 * Moves no Gold -- ownership was already paid for by `unlockStackAcresSynergyPerk`,
 * this only changes which owned perks are actively contributing.
 */
export async function activateStackAcresSynergyPerk(
  token: string,
  archetypeInput: string,
  slot: number,
  now = new Date(),
): Promise<StackAcresView & { synergyActivate: { archetype: SynergyArchetype; success: boolean } }> {
  if (!isSynergyArchetype(archetypeInput)) {
    throw new StackAcresRequestError("Not a real archetype.", 400);
  }
  const archetype = archetypeInput;
  const profile = await ensureProfile(token);
  const outcome = await activateSynergyPerk(profile.id, archetype, slot);
  if (!outcome.success) {
    const message =
      outcome.reason === "invalid_slot" ? "That is not a real loadout slot." : "You have not unlocked that yet.";
    throw new StackAcresRequestError(message, 400, { round: await snapshots(profile.id, now) });
  }
  return { ...(await view(profile, now)), synergyActivate: { archetype, success: true } };
}

/**
 * Permanently forges one Sunlight Forge enchantment, spending Gold and a
 * processing-track material in one call -- see `forgeEnchantment`'s own
 * header for why this needs a single atomic RPC rather than two ordered
 * spends. `enchantmentId` is the bare catalogue key (FORGE_ENCHANTMENTS'
 * own keys), matching every other client-facing id in this file (a Synergy
 * archetype, a secret item id) rather than the versioned wrapper the store
 * persists.
 */
export async function forgeStackAcresToolEnchantment(
  token: string,
  enchantmentId: string,
  now = new Date(),
): Promise<StackAcresView & { forgeResult: { enchantmentId: string; success: true } }> {
  if (!isForgeEnchantmentId(enchantmentId)) {
    throw new StackAcresRequestError("Not a real enchantment.", 400);
  }
  const profile = await ensureProfile(token);
  const outcome = await forgeEnchantment(profile.id, enchantmentId);
  if (!outcome.success) {
    const def = FORGE_ENCHANTMENTS[enchantmentId];
    const message =
      outcome.reason === "already_owned"
        ? `You already forged ${def.label}.`
        : outcome.reason === "insufficient_material"
          ? `Needs ${def.materialQuantity.toLocaleString()} ${machineItemLabel(def.materialItem, def.materialQuantity)}.`
          : `${def.label} costs ${def.goldCost.toLocaleString()} Gold.`;
    throw new StackAcresRequestError(message, outcome.reason === "already_owned" ? 409 : 400, {
      round: await snapshots(profile.id, now),
    });
  }
  return {
    ...(await view(profile, now)),
    forgeResult: { enchantmentId: outcome.enchantmentId, success: true },
  };
}

/** Puts back whatever `plantStackAcresCrossbreedBed` took for `stock` (the
 *  seed for a crop, the Gold for livestock) when the cell it paid for never
 *  came to exist. Same split, same two calls, as stockStackAcres's own
 *  refund branch. */
async function refundCrossbreedStake(profileId: string, stock: StackAcresStock): Promise<void> {
  if (isLivestock(stock)) {
    await refundGold(profileId, STACKACRES_CATALOGUE[stock].seedCost);
  } else {
    await adjustStackAcresSeedStock(profileId, stock, 1).catch(() => null);
  }
}

/**
 * Plants one cell of the Crossbreeding Bed (lib/stackacres/crossbreeding.ts).
 *
 * Pays exactly the way `stockStackAcres` does, for the same reason: a crop
 * spends one seed off Ray's shelf (its Gold already left at the shop), and
 * livestock spends its seed cost in Gold since there is no "hen seed". Rule 1
 * either way -- paid before the row exists, refunded if the cell turns out
 * taken or the insert refuses. The bed has no capacity row of its own: the
 * (profile, row, col) unique index IS the cap, so "already planted" is the
 * store's own null here, never a count read ahead of the insert.
 */
export async function plantStackAcresCrossbreedBed(
  token: string,
  input: { row: number; col: number; stock: string },
  now = new Date(),
): Promise<StackAcresView & { crossbreedResult: { planted: CrossbreedPlotView } }> {
  if (!isStackAcresStock(input.stock)) throw new StackAcresRequestError("Not a real stock.", 400);
  if (!isInCrossbreedGrid(input.row, input.col)) {
    throw new StackAcresRequestError("That cell is not on the bed.", 400);
  }
  const stock: StackAcresStock = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const profile = await ensureProfile(token);

  // The same land gates an open-air sow passes: the zone livestock lives in
  // has to be cleared, and a crop needs the Crop Fields unlocked.
  const land = await readLand(profile.id);
  requireOpenSector(land.sectors, stockZone(stock), `${def.label}s`);
  if (!isLivestock(stock) && !(await readStackAcresCropFieldsUnlocked(profile.id))) {
    throw new StackAcresRequestError(
      "The Crop Fields are still under wild growth. Unlock them before you sow anything there.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  let debited: PlayerProfile;
  if (isLivestock(stock)) {
    const paid = await spendGoldByProfile(profile.id, def.seedCost);
    if (!paid) {
      throw new StackAcresRequestError(
        `${def.label} seed costs ${def.seedCost.toLocaleString()} Gold.`,
        400,
        { round: await snapshots(profile.id, now) },
      );
    }
    debited = paid;
  } else {
    const heldSeeds = await adjustStackAcresSeedStock(profile.id, stock, -1);
    if (heldSeeds === null) {
      throw new StackAcresRequestError(
        `You have no ${def.label} seeds. Buy some from Ray's shop first.`,
        400,
        { round: await snapshots(profile.id, now) },
      );
    }
    debited = profile;
  }

  let planted: StoredCrossbreedPlot | null;
  try {
    planted = await plantCrossbreedBed(profile.id, input.row, input.col, stock, now);
  } catch (error) {
    await refundCrossbreedStake(profile.id, stock);
    throw error;
  }
  if (!planted) {
    await refundCrossbreedStake(profile.id, stock);
    throw new StackAcresRequestError("That cell is already planted.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  return {
    ...(await view(debited, now)),
    crossbreedResult: { planted: toCrossbreedPlotView(planted, now.getTime()) },
  };
}

/**
 * Brings in one ripe cell of the Crossbreeding Bed. Moves no Gold: a plain
 * harvest clears the row and yields nothing, a cross clears both rows and
 * credits the one hybrid -- see harvestCrossbreedBed for the evaluate, roll,
 * commit sequence and the RPC's own migration comment for the race it
 * guards. A null settlement is a lost race or a not-yet-ripe tap, never
 * "produced nothing".
 */
export async function harvestStackAcresCrossbreedBed(
  token: string,
  plotId: string,
  now = new Date(),
): Promise<StackAcresView & { crossbreedResult: CrossbreedHarvestSettlement }> {
  const profile = await ensureProfile(token);
  const settled = await harvestCrossbreedBed(profile.id, plotId, now);
  if (!settled) {
    throw new StackAcresRequestError("That row is not ripe yet, or was already brought in.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  return { ...(await view(profile, now)), crossbreedResult: settled };
}

/**
 * Buys an animal or a crop OUTRIGHT, with Gold.
 *
 * The difference from stockStackAcres, and the reason both exist: a sowing
 * buys ONE CYCLE and is consumed by its own harvest, so it is gone once
 * collected and you buy another. Bought stock is permanent and re-sows itself
 * forever -- you own the cow, you do not own one cow-cycle. That is what makes
 * 60,000 Gold and 1,200 Gold honest prices for the same animal: they are not
 * the same thing. With one currency the gap between them is finally legible on
 * the shelf, which it never was while one price was in Bushels.
 *
 * Cash on the counter. Nothing here is financed, there is no balance and no
 * credit -- the Gold either leaves the purse now or the sale does not happen.
 *
 * Rule 1 throughout: the Gold is debited before the unit exists, and every
 * failure path after that refunds it. A cap violation is caught before the
 * debit ever happens; the database's own trigger is the real guard against a
 * race.
 */
export async function buyStackAcresStock(
  token: string,
  input: { stock: string },
  now = new Date(),
): Promise<StackAcresView> {
  if (!isStackAcresStock(input.stock)) throw new StackAcresRequestError("Not a real stock.", 400);
  const stock: StackAcresStock = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const price = stackacresStockPrice(stock);
  const profile = await ensureProfile(token);

  const land = await readLand(profile.id);
  requireOpenSector(land.sectors, stockZone(stock), `${def.label}s`);

  const [occupied, cap] = await Promise.all([
    countOccupiedStackAcresUnits(profile.id, stock),
    capacityFor(profile.id, stock),
  ]);
  if (occupied >= cap) {
    throw new StackAcresRequestError(
      `You already have ${cap} ${def.label}${cap === 1 ? "" : "s"} going. Retire or clear one first, or expand capacity.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(`A ${def.label} costs ${price.toLocaleString()} Gold.`, 400, {
      round: await snapshots(profile.id, now),
    });
  }

  // Buying a crop outright puts a plant in the ground exactly like sowing
  // one does, so it needs a bed the same way (`stockStackAcres`'s own gate).
  // Without this the Buy outright button was the way around it: it never
  // asked for a slot, so a crop bought on an untilled farm stood in the
  // grass on the rank-hash fallback. Livestock has no bed to need.
  let soilAssignment = await assignSoilSlot(profile.id, stock, false, null);
  if (isStackAcresCrop(stock) && soilAssignment.slot === null) {
    await refundGold(profile.id, price);
    throw new StackAcresRequestError(
      `${def.label} needs a bed to go into. Till some soil in the Crop Fields first.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  const produce = STACKACRES_YIELDS[stock];
  try {
    // Same race the sow path runs: the slot was only read, so a concurrent
    // sow can take it before this insert lands and the partial unique index
    // catches it. Two re-picks, then stand on the fallback rather than fail
    // a purchase over contention -- the farm did have a free bed.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await createStackAcresUnit(profile.id, {
          stock,
          // The one-cycle seed cost is what lands in `stake`, notionally: nothing
          // was paid at that price here. The column is required for a working row
          // and carries `check (stake > 0)`, so writing the catalogue's own figure
          // keeps the ledger describing what is standing there, and `permanent`
          // below is what tells a dashboard the difference. The outright price is
          // deliberately NOT stored: it is spent, gone, and re-derivable from the
          // stock whenever it is needed.
          stake: def.seedCost,
          yieldQuantity: produce.quantity,
          startedAt: now,
          // Snapshotted here for good, the same as the sow path: the bed's
          // growth multiplier is baked into `ready_at` once and never
          // re-derived at collection.
          readyAt: new Date(
            now.getTime() + Math.round(def.durationMs * soilAssignment.growthMultiplier),
          ),
          lastFedAt: def.hungerMs === null ? null : now,
          // Dry seed until watered, same as the sow path.
          lastWateredAt: null,
          permanent: true,
          soilSlot: soilAssignment.slot,
        });
        break;
      } catch (error) {
        if (!(error instanceof SoilSlotConflictError)) throw error;
        if (attempt >= 2) {
          // Three straight losses to a racing sow, not "nothing tilled" --
          // the gate above already confirmed a free bed existed. Refusing
          // here, instead of falling onto the wrapping rank-hash fallback,
          // is what keeps a crop from ever landing on a tile another one
          // already owns.
          throw new StackAcresRequestError(
            `${def.label}'s bed was just taken by another purchase. Try again.`,
            409,
            { round: await snapshots(profile.id, now) },
          );
        }
        soilAssignment = await assignSoilSlot(profile.id, stock, false, null);
      }
    }
  } catch (error) {
    // The database refused (the trigger's own cap/ceiling race) or threw for
    // any other reason, and nothing came into existence, so the player must
    // not have paid for it.
    await refundGold(profile.id, price);
    throw error;
  }

  // A pipe or hydro bed under the new crop waters it from the start.
  await waterIrrigatedCrops(profile.id, now);
  return view(debited, now);
}

/**
 * Sows one cycle of a crop or an animal, with Gold.
 *
 * A SINK, and the cheapest way into the farm: the seed price is a fiftieth of
 * what the same tier costs outright (see STACKACRES_SEED_MULTIPLE_TO_OWN),
 * and it buys exactly one harvest rather than an animal that keeps going.
 *
 * The yield and readiness written here are snapshots (rule 3): the catalogue
 * is read exactly once, now, and never again for this unit.
 */
export async function stockStackAcres(
  token: string,
  input: { stock: string; inGreenhouse?: boolean; tile?: SoilTileCoord | null },
  now = new Date(),
): Promise<StackAcresView> {
  if (!isStackAcresStock(input.stock)) throw new StackAcresRequestError("Not a real stock.", 400);
  const stock: StackAcresStock = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const profile = await ensureProfile(token);
  const inGreenhouse = input.inGreenhouse === true;
  const tile = input.tile ?? null;

  const land = await readLand(profile.id);
  const zone = stockZone(stock);
  requireOpenSector(land.sectors, zone, `${def.label}s`);
  // The Farmstead itself is a HOME sector -- always open -- so
  // `requireOpenSector` above passes trivially for every crop (they are all
  // zoned there since the 2026-09-08 district merge; see stockZone's own
  // header). Their real gate is the standalone Crop Fields unlock
  // (lib/stackacres/crop-fields.ts), checked here instead -- except inside
  // the Greenhouse, which is its own separate, separately-gated growing
  // space (`greenhouseBuilt`, checked below) that never touches
  // `CROP_FIELD_BEDS` at all.
  if (zone === "farmstead" && !inGreenhouse && !(await readStackAcresCropFieldsUnlocked(profile.id))) {
    throw new StackAcresRequestError(
      "The Crop Fields are still under wild growth. Unlock them before you sow anything there.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  if (inGreenhouse && !isGreenhouseStock(stock)) {
    throw new StackAcresRequestError("The Greenhouse only houses crops.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  // The caps are what bound this faucet; see lib/stackacres/catalogue.ts.
  // Checked here for a clean 409, enforced for real by the advisory-locked
  // trigger in the migration, which two racing requests cannot squeeze past.
  const [occupied, cap, greenhouseBuilt, greenhouseOccupied] = await Promise.all([
    countOccupiedStackAcresUnits(profile.id, stock),
    capacityFor(profile.id, stock),
    inGreenhouse ? readStackAcresGreenhouse(profile.id) : Promise.resolve(true),
    inGreenhouse ? countGreenhouseStackAcresUnits(profile.id) : Promise.resolve(0),
  ]);
  if (occupied >= cap) {
    throw new StackAcresRequestError(
      `You already have ${cap} ${def.label}${cap === 1 ? "" : "s"} going. Collect from or clear one first, or expand capacity.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }
  if (inGreenhouse && !greenhouseBuilt) {
    throw new StackAcresRequestError("Build the Greenhouse first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (inGreenhouse && greenhouseOccupied >= GREENHOUSE_SLOT_CAP) {
    throw new StackAcresRequestError(
      `The Greenhouse is full: ${greenhouseOccupied} of ${GREENHOUSE_SLOT_CAP} slots already growing.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the seed is paid for first -- but crops and livestock pay in two
  // different currencies now. Livestock still spends Gold straight out of
  // the purse, unchanged: there is no "hen seed" bought ahead of time. A crop
  // spends one seed off the shelf instead -- the Gold for it already left at
  // Ray's shop (buyStackAcresSeed), so charging Gold again here would be a
  // second debit for the same seed. Either way a null/refusal here means
  // nothing was sown.
  const produce = STACKACRES_YIELDS[stock];
  let debited: PlayerProfile | null;
  if (isLivestock(stock)) {
    debited = await spendGoldByProfile(profile.id, def.seedCost);
    if (!debited) {
      throw new StackAcresRequestError(
        `${def.label} seed costs ${def.seedCost.toLocaleString()} Gold.`,
        400,
        { round: await snapshots(profile.id, now) },
      );
    }
  } else {
    const heldSeeds = await adjustStackAcresSeedStock(profile.id, stock, -1);
    if (heldSeeds === null) {
      throw new StackAcresRequestError(
        `You have no ${def.label} seeds. Buy some from Ray's shop first.`,
        400,
        { round: await snapshots(profile.id, now) },
      );
    }
    debited = profile;
  }

  // Which bed this crop is going into, and what that bed does for it.
  //
  // OPEN-AIR CROPS ONLY. Livestock never stands on a bed (`cropSpot` never
  // ran for one), and a Greenhouse crop stands on the glasshouse's own
  // sub-grid instead, so both keep a null slot and the plain multiplier. The
  // two effects do not stack for the additional reason that they would
  // otherwise multiply into a cycle far shorter than either was tuned for.
  let soilAssignment = await assignSoilSlot(profile.id, stock, inGreenhouse, tile);

  // A crop needs a bed under it (2026-09-09). `assignSoilSlot` answers
  // `slot: null` for "this farm has no free bed anywhere" -- it used to sow
  // regardless, onto the hash-scatter fallback, which put vegetables in the
  // grass with nothing tilled. That is a refusal now, not a fallback: the
  // seed already spent above comes back, exactly as the insert failing
  // below would return it. OPEN-AIR CROPS ONLY, same as the assignment
  // itself -- a Greenhouse crop stands on the glasshouse's own sub-grid and
  // `assignSoilSlot` always says null for it, so gating on that alone would
  // refuse every Greenhouse sow; livestock never has a bed to need.
  if (!inGreenhouse && isStackAcresCrop(stock) && soilAssignment.slot === null) {
    await adjustStackAcresSeedStock(profile.id, stock, 1).catch(() => null);
    throw new StackAcresRequestError(
      `${def.label} needs a bed to go into. Till some soil in the Crop Fields first.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  try {
    // `assignSoilSlot` only reads; a second sow can read the same free slot
    // before this insert lands, and the database's own partial unique index
    // on (profile_id, soil_slot) is what actually catches that -- surfaced
    // here as `SoilSlotConflictError`. Re-picking a slot and trying again a
    // couple of times resolves an honest race; past that, the third loss
    // still sows onto the wrapping rank-hash path (slot: null) rather than
    // fail a purchase over pure contention -- the farm demonstrably HAD a
    // free bed (the gate above passed), it just lost it to a racing sow, and
    // that is not the "nothing tilled" case the gate refuses.
    for (let attempt = 0; ; attempt += 1) {
      // Snapshotted at stocking, never re-derived at collection -- the same
      // rule `yieldQuantity`/`stake` already follow. Outside the Greenhouse
      // (or for a stock kind it does not accept) the greenhouse term is
      // exactly `def.durationMs`, unchanged.
      //
      // The soil term is snapshotted by the same act of writing `ready_at`:
      // once the row carries an absolute instant, retuning
      // `SOIL_TIER_DEFS[...].growthMultiplier` cannot reach back and change
      // what an already-growing crop returns -- the rule the Ante Up wager
      // ladders and `GREENHOUSE_GROWTH_MULTIPLIER` both state for themselves.
      // Rounded once, at the end, so the two multipliers cannot each round.
      const durationMs = Math.round(
        greenhouseDurationMs(stock, def.durationMs, inGreenhouse) * soilAssignment.growthMultiplier,
      );
      try {
        await createStackAcresUnit(profile.id, {
          stock,
          stake: def.seedCost,
          yieldQuantity: produce.quantity,
          startedAt: now,
          readyAt: new Date(now.getTime() + durationMs),
          // An animal counts as fed the moment it arrives; a crop never eats.
          lastFedAt: def.hungerMs === null ? null : now,
          // A crop goes in as dry seed and starts growing once it is watered.
          lastWateredAt: null,
          permanent: false,
          housedIn: inGreenhouse ? "greenhouse" : null,
          soilSlot: soilAssignment.slot,
        });
        break;
      } catch (error) {
        if (!(error instanceof SoilSlotConflictError)) throw error;
        if (attempt >= 2) {
          // Same refusal `buyStackAcresStock` makes on the identical race:
          // three losses in a row means another sow keeps taking the free
          // bed out from under this one, not that there was never a bed.
          // Refusing here is what keeps this crop from ever sharing a tile
          // with the one that won it.
          throw new StackAcresRequestError(
            `${def.label}'s bed was just taken by another sow. Try again.`,
            409,
            { round: await snapshots(profile.id, now) },
          );
        }
        soilAssignment = await assignSoilSlot(profile.id, stock, inGreenhouse, tile);
      }
    }
  } catch (error) {
    // The database refused outright -- the trigger raising on a cap race or a
    // ceiling desync arrives HERE as a throw -- and nothing came into
    // existence, so the player must not have paid for it. Refund whichever
    // currency was actually spent above.
    if (isLivestock(stock)) {
      await refundGold(profile.id, def.seedCost);
    } else {
      await adjustStackAcresSeedStock(profile.id, stock, 1).catch(() => null);
    }
    throw error;
  }

  // A pipe or hydro bed under the new crop waters it from the start.
  await waterIrrigatedCrops(profile.id, now);
  return view(debited, now);
}

/**
 * Sends bought stock away. NO REFUND, and the UI has to say so before it asks
 * -- see STACKACRES_RETIRE_REFUND.
 *
 * This is not an undo. It exists because permanent stock holds its slot
 * forever and three permanent cattle fill the cattle cap: without a way out,
 * buying three would lock a player out of ever keeping anything else and the
 * prize would be a trap. Refunding would make owning stock somewhere to park
 * Gold and take it back out again, which is the one shape this subsystem is
 * built not to have.
 */
export async function retireStackAcresStock(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || !unit.permanent) {
    throw new StackAcresRequestError("There is nothing here to retire.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const retired = await retireStackAcresUnit(unit);
  if (!retired) {
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/** Buys shipments of feed. Pure sink: Gold out, servings in.
 *
 * Bulk, same as `buyStackAcresSoil`/`buyStackAcresSeed`: a `quantity` up to
 * STACKACRES_FEED_SHIPMENTS_PER_PURCHASE moves in one request instead of one
 * shipment per click, so a player mashing Buy no longer races the server's
 * own round trip and gets back fewer shipments than presses. */
export async function buyStackAcresFeed(
  token: string,
  input: { itemId?: unknown; quantity?: unknown },
  now = new Date(),
): Promise<StackAcresView> {
  const itemId = typeof input.itemId === "string" ? input.itemId : "";
  const item = STACKACRES_FEED[itemId];
  if (!item) throw new StackAcresRequestError("No such shipment.", 400);
  const profile = await ensureProfile(token);

  const quantity = Math.trunc(typeof input.quantity === "number" ? input.quantity : 1);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > STACKACRES_FEED_SHIPMENTS_PER_PURCHASE) {
    throw new StackAcresRequestError(
      `Buy between 1 and ${STACKACRES_FEED_SHIPMENTS_PER_PURCHASE} shipments at a time.`,
      400,
    );
  }

  // The shelf greys this row out, and that is presentation; this is the
  // check. `itemId` came off the wire, so a request naming the Bulk Shipment
  // from a farm that has never seen the Fold reaches exactly here and stops.
  await requireUnlockedShopEntry(item, profile.id, now);

  // Town Favor discount -- see upgradeStackAcresTool's identical comment
  // and lib/stackacres/influence-tiers.ts.
  const unitPrice = applyInfluenceDiscount(item.cost, await readStackAcresInfluence(profile.id));
  const price = unitPrice * quantity;

  // Rule 1: the Gold leaves before the servings land.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(
      `${quantity} x ${item.label} costs ${price.toLocaleString()} Gold.`,
      400,
    );
  }

  try {
    await adjustStackAcresFeed(profile.id, item.servings * quantity);
  } catch (error) {
    await refundGold(profile.id, price);
    throw error;
  }

  return view(debited, now);
}

/**
 * Buys one unit of `itemId` from the caller's currently-active Midnight
 * Merchant visit, at whatever price the visit's own purchase streak dictates
 * (see lib/stackacres/midnight-merchant.ts's `priceForNextPurchase`).
 *
 * UNLIKE `buyStackAcresFeed` just above, this is not a debit-then-create pair
 * needing its own refund-on-failure: `redeemMidnightMerchantItem` reaches a
 * SINGLE RPC (`redeem_midnight_merchant_item`) that locks the visit, prices
 * the purchase, spends the Gold, and decrements stock all inside one Postgres
 * transaction. There is nothing here for a thrown error between two writes to
 * leave half-applied, so this function has no `refundGold` call to make --
 * that is a property of the RPC's own design, not a shortcut being taken.
 *
 * Every refusal reason the RPC can return becomes a distinct, specific
 * message rather than one generic "could not buy that" -- a player who reads
 * "sold out" and one who reads "too expensive" need different next actions,
 * and folding them into one string would cost the storefront the ability to
 * tell them apart.
 */
export async function buyFromMidnightMerchant(
  token: string,
  itemId: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!isMidnightMerchantItemId(itemId)) {
    throw new StackAcresRequestError("The Midnight Merchant doesn't carry that.", 400);
  }
  const profile = await ensureProfile(token);

  const result = await redeemMidnightMerchantItem(
    profile.id,
    itemId as MidnightMerchantItemId,
    spendGoldByProfile,
    now,
  );

  if (!result.success) {
    const round = await snapshots(profile.id, now);
    if (result.reason === "no_merchant") {
      throw new StackAcresRequestError("The Midnight Merchant has already moved on.", 409, { round });
    }
    if (result.reason === "sold_out") {
      throw new StackAcresRequestError("That's the last one -- already sold.", 409, { round });
    }
    throw new StackAcresRequestError(
      `That costs ${(result.pricePaid ?? 0).toLocaleString()} Gold.`,
      400,
      { round },
    );
  }

  return {
    ...(await view(await ensureProfile(token), now)),
    midnightMerchantPurchase: {
      itemId,
      pricePaid: result.pricePaid ?? 0,
      purchaseStreak: result.purchaseStreak,
      remaining: result.remaining,
    },
  };
}

/**
 * Feeds a hungry animal, spending one serving.
 *
 * A hungry unit's clock is frozen, and this is where that is actually made
 * true: ready_at moves forward by however long the animal spent waiting, so
 * the time it was neglected is not silently credited as work. The yield is
 * untouched -- neglect costs you time, never Gold.
 */
export async function feedStackAcres(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "working") {
    throw new StackAcresRequestError("Nothing here eats.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const hungryAt = hungryAtFor(unit);
  const hungrySince = hungryAt ? Date.parse(hungryAt) : NaN;
  const starvedMs = Number.isFinite(hungrySince) ? Math.max(0, now.getTime() - hungrySince) : 0;

  // Rule 1 again, in servings rather than Gold: the feed is spent before the
  // write it pays for. Null is "not enough", which reads exactly like a lost
  // race because it is one.
  const remaining = await adjustStackAcresFeed(profile.id, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("You are out of feed. Buy a shipment first.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const readyAt = Date.parse(unit.readyAt);
  const pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + starvedMs);

  let fed: StoredStackAcresUnit | null;
  try {
    fed = await feedStackAcresUnit(unit, now, pushed);
  } catch (error) {
    await adjustStackAcresFeed(profile.id, 1).catch(() => null);
    throw error;
  }
  if (!fed) {
    await adjustStackAcresFeed(profile.id, 1).catch(() => null);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/**
 * Feeds the hungry animals in one pen, one serving each, soonest-hungry
 * first, until the pen is fed or the feed runs out. What dropping the feed
 * scoop on a pen's trough sends.
 *
 * Each serving is spent before the write it pays for and handed back if that
 * one write fails, the same order `feedStackAcres` keeps, so one animal that
 * moved on never costs the others their meal. Running out partway is not an
 * error. Only feeding nobody at all is refused.
 */
export async function feedStackAcresPen(
  token: string,
  zone: ZoneId,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  if (!PEN_ZONE_IDS.includes(zone)) {
    throw new StackAcresRequestError("That is not a pen.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const hungry = (await listStackAcresUnits(profile.id))
    .filter((row) => stockZone(row.stock) === zone && isStackAcresUnitHungry(row, now))
    .sort((a, b) => (hungryAtFor(a) ?? "").localeCompare(hungryAtFor(b) ?? ""));
  if (hungry.length === 0) {
    throw new StackAcresRequestError("Nobody in this pen is hungry.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  let fedCount = 0;
  for (const unit of hungry) {
    const remaining = await adjustStackAcresFeed(profile.id, -1);
    if (remaining === null) break;

    const hungryAt = hungryAtFor(unit);
    const hungrySince = hungryAt ? Date.parse(hungryAt) : NaN;
    const starvedMs = Number.isFinite(hungrySince) ? Math.max(0, now.getTime() - hungrySince) : 0;
    const readyAt = Date.parse(unit.readyAt);
    const pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + starvedMs);

    let fed: StoredStackAcresUnit | null;
    try {
      fed = await feedStackAcresUnit(unit, now, pushed);
    } catch (error) {
      await adjustStackAcresFeed(profile.id, 1).catch(() => null);
      // The animals already fed stay fed. Only throw if nothing went through.
      if (fedCount === 0) throw error;
      break;
    }
    if (!fed) {
      await adjustStackAcresFeed(profile.id, 1).catch(() => null);
      continue;
    }
    fedCount += 1;
  }

  if (fedCount === 0) {
    throw new StackAcresRequestError("You are out of feed. Buy a shipment first.", 400, {
      round: await snapshots(profile.id, now),
    });
  }
  return view(profile, now);
}

/**
 * Waters a dry crop, spending one unit from the watering can.
 *
 * The mirror of `feedStackAcres` on the crop track, and the same guarantee:
 * ready_at moves forward by however long the soil stood dry, so neglected
 * time is never credited as work, and the yield is untouched.
 *
 * The water is tipped out before the write it pays for and poured back if
 * that write fails, the same order feed keeps. Pipes water for free and
 * never come through here.
 *
 * Watering a crop that is not dry is refused rather than treated as a
 * top-up. Allowing it would let a player push ready_at forward by zero all
 * day, which does nothing, and reset the thirst clock for free, which is the
 * whole tending loop -- so a drink only counts once the ground actually
 * needs it.
 */
export async function waterStackAcres(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "working") {
    throw new StackAcresRequestError("Nothing here to water.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const thirstyAt = thirstyAtFor(unit);
  if (!thirstyAt) {
    throw new StackAcresRequestError("That does not grow in soil.", 400, {
      round: await snapshots(profile.id, now),
    });
  }
  // Wet ground is a NO-OP, not a refusal, and the distinction matters on a
  // phone. `withLocalClock` decides dryness from the device's own clock, so a
  // handset running a few minutes fast paints a faded crop with a Water button
  // over ground the server still calls wet -- and an error banner for pressing
  // the button the app just drew is a bug the player cannot act on.
  //
  // Returning early rather than watering is what keeps the guard: nothing is
  // written, so the thirst clock is not reset and there is no free top-up to
  // farm. No water is spent on this path either. A crop a pipe or hydro bed
  // waters is never dry, so watering it is the same no-op.
  const rows = await listStackAcresUnits(profile.id);
  const irrigated = await irrigatedUnitIdsFor(profile.id, rows);
  if (!isStackAcresUnitDry(unit, now, irrigated.has(unit.id))) return view(profile, now);

  let pushed: Date;
  let restartedAt: Date | null = null;
  if (isUnwateredSeedRow(unit)) {
    // Seed's first water starts its clock from zero.
    const clock = seedClockOnFirstWater(unit, now.getTime());
    pushed = clock.readyAt;
    restartedAt = clock.startedAt;
  } else {
    // Any other dry crop keeps its progress and has the dry spell added to
    // ready_at.
    const driedAt = Date.parse(thirstyAt);
    const dryMs = Number.isFinite(driedAt) ? Math.max(0, now.getTime() - driedAt) : 0;
    const readyAt = Date.parse(unit.readyAt);
    pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + dryMs);
  }

  const remaining = await adjustStackAcresWater(profile.id, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("Your watering can is empty. Fill it at the well.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  let watered: StoredStackAcresUnit | null;
  try {
    watered = await waterStackAcresUnit(unit, now, pushed, restartedAt);
  } catch (error) {
    await adjustStackAcresWater(profile.id, 1).catch(() => null);
    throw error;
  }
  if (!watered) {
    await adjustStackAcresWater(profile.id, 1).catch(() => null);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/** Fills the watering can at the well. Free, and a no-op on a full can. */
export async function drawStackAcresWater(token: string, now = new Date()): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  await fillStackAcresWater(profile.id);
  return view(profile, now);
}

/** Pays the maintenance fee on a mucked unit, clearing it -- see
 *  clearStackAcresMuck in the store for why this removes the row. */
export async function clearStackAcresUnit(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "mucked" || unit.muckFee === null) {
    throw new StackAcresRequestError("Nothing to clear here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const fee = unit.muckFee;
  const debited = await spendGoldByProfile(profile.id, fee);
  if (!debited) {
    throw new StackAcresRequestError(
      `Clearing this costs ${fee.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let cleared: StoredStackAcresUnit | null;
  try {
    cleared = await clearStackAcresMuck(unit);
  } catch (error) {
    await refundGold(profile.id, fee);
    throw error;
  }
  if (!cleared) {
    await refundGold(profile.id, fee);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/* ------------------------------------------------------------------ */
/* Hidden secrets: three small discovery spots, one collectible          */
/* ------------------------------------------------------------------ */

/**
 * Taps one hidden zone, rolling that zone's own once-a-day chance to turn up
 * a secret item.
 *
 * MOVES NO GOLD AT ALL, and needs no ceiling reservation -- this is a pure
 * item-ledger mutation, riding this feature's own `homestead_secret_ledger`
 * table (see lib/server/stackacres-store.ts's `adjustStackAcresSecretLedger`).
 *
 * The daily gate, not the odds, is the real throttle (see
 * lib/stackacres/secrets.ts's own header on `discoveryChance`), and it is
 * enforced the same way a version guard enforces "settle at most once"
 * elsewhere in this file: the attempt is MARKED FIRST, before the roll, so a
 * crash between marking and rolling can never be replayed into a second try
 * at today's odds -- the worst a crash here costs the player is a wasted tap,
 * never a free extra roll.
 *
 * Already-attempted-today is a NO-OP WITH THE CURRENT STATE, not a refusal --
 * the same "a growing crop stays silent rather than erroring" posture the
 * 2026-09-04 sound pass gave client-side refusals. The zone really was
 * tapped; it simply has nothing more to give until tomorrow.
 */
export async function tapStackAcresSecretZone(
  token: string,
  zoneIdInput: string,
  now = new Date(),
): Promise<StackAcresView & { discovery: SecretItemId | null }> {
  if (!isHiddenZoneId(zoneIdInput)) {
    throw new StackAcresRequestError("There is nothing to find there.", 400);
  }
  const zoneId: HiddenZoneId = zoneIdInput;
  const zone = HIDDEN_ZONES.find((candidate) => candidate.id === zoneId);
  if (!zone) throw new StackAcresRequestError("There is nothing to find there.", 400);
  const profile = await ensureProfile(token);

  const day = stackacresExchangeDay(now);
  const attemptKey = secretZoneAttemptKey(zoneId, day);

  const already = await readStackAcresSecretLedgerQty(profile.id, attemptKey);
  if (already >= 1) {
    return { ...(await view(profile, now)), discovery: null };
  }

  // Marks the attempt BEFORE rolling -- see the header above.
  const marked = await adjustStackAcresSecretLedger(profile.id, attemptKey, 1);
  if (marked === null) {
    // Could not even record the attempt; refuse the roll rather than risk one
    // that never gets marked and so could be replayed.
    return { ...(await view(profile, now)), discovery: null };
  }

  const found = rollSecretDiscovery(zone, Math.random);
  let discovery: SecretItemId | null = null;
  if (found) {
    const credited = await adjustStackAcresSecretLedger(profile.id, found, 1);
    if (credited !== null) {
      discovery = found;
    } else {
      console.error("stackacres.secret_discovery_credit_failed", {
        profileId: profile.id,
        zoneId,
        item: found,
      });
    }
  }

  return { ...(await view(profile, now)), discovery };
}

/**
 * Donates a held secret item to Ray's Museum, exactly once per item -- reuses
 * `markStackAcresDonated`, the same idempotency-guarded flag a harvest's own
 * first-time produce discovery already writes to (see the museum section
 * above), directly rather than duplicating it. `lucky_poker_dice` is not a
 * `StackAcresItem` and is never added to it (see lib/stackacres/museum.ts's
 * total-over-the-enum invariant) -- `markStackAcresDonated` takes a bare
 * string at the storage layer, so this rides it without touching that file.
 *
 * Rule 1's shape, applied to an item instead of Gold: the item leaves the
 * ledger before the donation is recorded, and a failure recording it refunds
 * the item.
 */
export async function donateStackAcresSecretItem(
  token: string,
  itemIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!isSecretItemId(itemIdInput)) throw new StackAcresRequestError("Not a real secret.", 400);
  const itemId: SecretItemId = itemIdInput;
  const profile = await ensureProfile(token);

  const held = await readStackAcresSecretLedgerQty(profile.id, itemId);
  if (held < 1) {
    throw new StackAcresRequestError(
      `You have no ${SECRET_ITEM_CATALOGUE[itemId].label} to donate.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  const remaining = await adjustStackAcresSecretLedger(profile.id, itemId, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  try {
    // Whether this returns true (a genuine first donation) or false (already
    // in the register) is not this function's concern -- either way the item
    // is spent on the ritual. Only a THROW here means the donation did not
    // actually land, which is what earns a refund.
    await markStackAcresDonated(profile.id, itemId);
  } catch (error) {
    // Best-effort: a real failure here must surface as the donation's own
    // error, not get replaced by a second failure from the refund attempt.
    await adjustStackAcresSecretLedger(profile.id, itemId, 1).catch(() => null);
    throw error;
  }

  return view(profile, now);
}

/**
 * Consumes a held secret item to arm a one-shot crit-chance boost for the
 * player's very next harvest -- see lib/stackacres/secrets.ts's
 * `effectiveCritChance`, which `harvestStackAcres` reads this same ledger key
 * through.
 *
 * REFUSED OUTRIGHT, with no mutation, if a boost is already armed:
 * `effectiveCritChance` only ever reads a boolean "armed" state, not a count,
 * so a second armed boost stacked on the first would be invisible -- a player
 * must not be able to burn a second dice for nothing.
 */
export async function consumeStackAcresSecretItem(
  token: string,
  itemIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!isSecretItemId(itemIdInput)) throw new StackAcresRequestError("Not a real secret.", 400);
  const itemId: SecretItemId = itemIdInput;
  const profile = await ensureProfile(token);

  const alreadyArmed = await readStackAcresSecretLedgerQty(profile.id, STACKACRES_DICE_BOOST_ARMED_KEY);
  if (alreadyArmed >= 1) {
    throw new StackAcresRequestError(
      "You already have a lucky boost armed for your next harvest.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  const held = await readStackAcresSecretLedgerQty(profile.id, itemId);
  if (held < 1) {
    throw new StackAcresRequestError(`You have no ${SECRET_ITEM_CATALOGUE[itemId].label} to use.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const remaining = await adjustStackAcresSecretLedger(profile.id, itemId, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  let armed: number | null;
  try {
    armed = await adjustStackAcresSecretLedger(profile.id, STACKACRES_DICE_BOOST_ARMED_KEY, 1);
  } catch (error) {
    // Best-effort: a real failure here must surface as the arming attempt's
    // own error, not get replaced by a second failure from the refund.
    await adjustStackAcresSecretLedger(profile.id, itemId, 1).catch(() => null);
    throw error;
  }
  if (armed === null) {
    await adjustStackAcresSecretLedger(profile.id, itemId, 1).catch(() => null);
    throw new StackAcresRequestError("Could not arm that boost.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/**
 * Trades a held secret item to Grandfather Ray for an instant wipe of today's
 * remaining Land Maintenance -- see lib/stackacres/secrets.ts's
 * `nextUpkeepPaidAfterDiceTrade`, which raises today's paid-toward-upkeep
 * total the exact same raise-to/clamped-at-the-fee way a harvest's own
 * maintenance charge does.
 *
 * NEVER CALLS creditGoldByProfile: this only reshapes a target that
 * `raiseStackAcresUpkeep` (already reserved against nothing -- it moves no
 * Gold either, only reduces a future deduction) accepts or refuses. Refused
 * up front, before the item is even spent, when there is nothing left to
 * wipe today -- the same "check before the debit" shape every capacity/cap
 * ceiling in this file already uses.
 */
export async function tradeStackAcresSecretItemToRay(
  token: string,
  itemIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!isSecretItemId(itemIdInput)) throw new StackAcresRequestError("Not a real secret.", 400);
  const itemId: SecretItemId = itemIdInput;
  const profile = await ensureProfile(token);

  const held = await readStackAcresSecretLedgerQty(profile.id, itemId);
  if (held < 1) {
    throw new StackAcresRequestError(`You have no ${SECRET_ITEM_CATALOGUE[itemId].label} to trade.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const day = stackacresExchangeDay(now);
  const [land, capacity, upkeepPaid, cropFieldsUnlocked] = await Promise.all([
    readLand(profile.id),
    readStackAcresCapacity(profile.id),
    readStackAcresUpkeep(profile.id, day),
    readStackAcresCropFieldsUnlocked(profile.id),
  ]);
  const fee = upkeepState(unlockedPlotCount(land.sectors, capacity, cropFieldsUnlocked), upkeepPaid).fee;
  const target = nextUpkeepPaidAfterDiceTrade(upkeepPaid, fee);
  if (target <= upkeepPaid) {
    throw new StackAcresRequestError("There is no Land Maintenance owed today to wipe.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const remaining = await adjustStackAcresSecretLedger(profile.id, itemId, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  let raised: boolean;
  try {
    raised = await raiseStackAcresUpkeep(profile.id, day, target);
  } catch (error) {
    // Best-effort: a real failure here must surface as the upkeep write's
    // own error, not get replaced by a second failure from the refund.
    await adjustStackAcresSecretLedger(profile.id, itemId, 1).catch(() => null);
    throw error;
  }
  if (!raised) {
    // Another tab settled today's bill (or raised it further) between the
    // read above and now -- the trade did not happen, so it must not be
    // spent for.
    await adjustStackAcresSecretLedger(profile.id, itemId, 1).catch(() => null);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/**
 * Decides whether a settled unit needs maintenance. The only randomness in
 * the feature, deliberately reachable from exactly one call site, and only
 * after a guarded write has confirmed a settlement actually happened.
 */
function rollMuck(stock: StackAcresStock): number | null {
  return Math.random() < STACKACRES_MUCK_CHANCE ? STACKACRES_CATALOGUE[stock].muckFee : null;
}

/** What one harvest brought in, as the client renders the toast. */
export interface StackAcresHarvestResult {
  /** How many fields and pens were brought in together. */
  units: number;
  /** Produce actually credited to inventory, summed per item -- base yield
   *  plus any crit bonus plus any Ray's Museum discovery bonus folded in.
   *  See `critBonus`/`discoveries` below for what each contributed. */
  tally: { item: StackAcresItem; quantity: number }[];
  /** Every settled unit's yield valued at today's sell price, before any
   *  bonus -- a production figure for the ledger and Prestige eligibility,
   *  not Gold paid (a harvest pays none) and not what landed in inventory
   *  (see `tally` for that). */
  gross: number;
  /** How many of the settled units came up weather-worn. */
  mucked: number;
  /** Whether this sweep rolled a critical harvest. */
  crit: boolean;
  /** Bonus units a crit added, summed per item. Empty when the roll missed. */
  critBonus: { item: StackAcresItem; quantity: number }[];
  /** Items donated to Ray's Museum for the very first time in this sweep,
   *  and the bonus UNITS each discovery added. Empty when nothing here was
   *  new -- most harvests. */
  discoveries: { item: StackAcresItem; bonusQuantity: number }[];
  /** Ray's Museum, secret wing: what this sweep's one roll turned up, or
   *  null on the overwhelming majority of harvests. Pays no Gold -- see
   *  lib/stackacres/museum-secrets.ts's own header. */
  secretFind: SecretMuseumItemId | null;
  /** True only on the harvest whose find carried the core hidden set from
   *  incomplete to complete for the first time ever. The client reads this
   *  to fire its own local unlock celebration -- see stackacres-scene.ts's
   *  `setFarmhandSecretUnlock`. */
  secretSetJustCompleted: boolean;
}

/**
 * Brings in every ready field and pen at once and credits the lot to
 * inventory. Pays no Gold at all -- see this file's own header.
 *
 * THIS IS THE WHOLE HARVEST LOOP NOW, and it is a single credit rather than a
 * priced payout. What a sweep brought in is tallied by `settleHarvest` in
 * lib/stackacres/harvest.ts, which is pure and where the arithmetic is
 * tested; this function's own job is the guarded settlement and the bonuses
 * that ride on top of it.
 *
 * ALLOWED WHILE BANNED, same posture as resigning a duel: it only returns
 * produce already grown, and stranding a crop inside a suspended account's
 * farm forever is a punishment nobody designed.
 *
 * THE ORDER:
 *
 *   1. Tally the sweep (no Gold, no reservation -- there is nothing left to
 *      reserve against a ceiling that harvest no longer touches).
 *   2. Settle each unit under its own version guard. A unit that loses its
 *      race is simply not in the sweep -- null never credits.
 *   3. Roll the crit ONCE for the sweep, alongside the muck roll and for the
 *      same reason: after the guarded writes, so a refetch cannot re-roll
 *      it. A crit adds bonus UNITS to each settled line (`critBonusQuantity`,
 *      lib/stackacres/equipment.ts), not Gold.
 *   4. Re-tally against what actually settled.
 *   5. Ray's Museum: fold in any first-ever discovery's bonus units, off the
 *      BASE tally (never the crit-inflated one) -- the same rate the old
 *      Gold-denominated bonus paid, just in kind.
 *   6. Credit inventory once per item (base + crit bonus + museum bonus),
 *      write the ledger.
 */
export async function harvestStackAcres(
  token: string,
  input: { unitIds?: readonly string[] } = {},
  now = new Date(),
): Promise<StackAcresView & { harvest: StackAcresHarvestResult }> {
  const profile = await ensureProfile(token);
  const rows = await listStackAcresUnits(profile.id);
  // A piped crop is never dry, so it ripens on its own clock; without this it
  // read as dry and could not be brought in.
  const irrigated = await irrigatedUnitIdsFor(profile.id, rows);

  // A named set is the single-tap path; no set at all is "bring in everything
  // that is ready". Naming a unit that is not ready is answered with the
  // specific reason, because that tap was aimed at that unit and "nothing is
  // ready" would be a lie about it.
  const named = input.unitIds && input.unitIds.length > 0 ? new Set(input.unitIds) : null;
  if (named) {
    for (const unitId of named) {
      const row = rows.find((candidate) => candidate.id === unitId);
      if (!row || row.status !== "working") {
        throw new StackAcresRequestError("Nothing to collect here.", 404, {
          round: toStackAcresUnitSnapshots(rows, now, irrigated),
        });
      }
      if (isStackAcresUnitHungry(row, now)) {
        throw new StackAcresRequestError("Feed them first.", 409, {
          round: toStackAcresUnitSnapshots(rows, now, irrigated),
        });
      }
      // The client's clock is decoration; this is the answer that counts, and
      // the store's own ready_at guard backs it even if this check is raced.
      if (!isStackAcresUnitReady(row, now, irrigated.has(row.id))) {
        throw new StackAcresRequestError("Not ready yet.", 409, {
          round: toStackAcresUnitSnapshots(rows, now, irrigated),
        });
      }
    }
  }

  const ready = rows.filter(
    (row) => (!named || named.has(row.id)) && isStackAcresUnitReady(row, now, irrigated.has(row.id)),
  );
  if (ready.length === 0) {
    throw new StackAcresRequestError("Nothing is ready yet.", 409, {
      round: toStackAcresUnitSnapshots(rows, now, irrigated),
    });
  }

  const candidateOf = (row: StoredStackAcresUnit): HarvestCandidate => ({
    unitId: row.id,
    stock: row.stock,
    // Rule 3: the snapshot taken at stocking, never a re-read of the catalogue.
    yieldQuantity: row.yieldQuantity,
  });

  const planned = settleHarvest(ready.map(candidateOf));

  // Crit odds, read up front for the roll below. A crit pays bonus inventory
  // now, not Gold, so there is no reservation to size ahead of it any more --
  // see lib/stackacres/equipment.ts's own header.
  const tool = await readStackAcresToolTier(profile.id);
  // The Sunlight Forge's own permanent enchantments (lib/stackacres/forge.ts)
  // -- computed BEFORE the Synergy Tree's session buffs below, per that
  // file's own header: forged stats are what "the tool's own odds" means
  // from here on, and the Synergy layer composes on top of them, not
  // instead of them.
  const forgedStats = await forgedToolStatsFor(profile.id, stackacresToolTierDef(tool));
  // A consumed Lucky Poker Dice (lib/stackacres/secrets.ts) arms a one-shot
  // crit-CHANCE boost for the very next harvest -- it widens the odds, never
  // the bonus itself.
  const diceBoostArmed =
    (await readStackAcresSecretLedgerQty(profile.id, STACKACRES_DICE_BOOST_ARMED_KEY)) >= 1;
  // The Synergy Tree's `sunlight_harvester` perk (lib/stackacres/synergy-perks.ts)
  // is the same shape of boost as the dice: it widens the odds, never the
  // bonus, so it layers on top here -- same reasoning as the dice comment
  // above, and additive with it for the same reason two flat bonuses always
  // are.
  const critChance = (
    await applySynergyBuffs(
      {
        harvestCritChance: effectiveCritChance(forgedStats.critChance, diceBoostArmed),
        farmhandSpeed: 1,
        millDoubleOutputChance: 0,
      },
      profile.id,
    )
  ).harvestCritChance;

  // Step 2. Bought stock never mucks and never leaves: the animal stays and
  // starts its next cycle the moment you take what it made. Muck is the cost
  // of turning ground over between sowings, and there is no gap between
  // sowings here to charge for.
  const settled: StoredStackAcresUnit[] = [];
  let mucked = 0;
  for (const row of ready) {
    const muckFee = row.permanent ? null : rollMuck(row.stock);
    const restart = row.permanent
      ? {
          readyAt: new Date(now.getTime() + STACKACRES_CATALOGUE[row.stock].durationMs),
          // A pipe or hydro bed waters the new cycle from its start.
          wateredAt: irrigated.has(row.id) ? now : null,
        }
      : null;
    const done = await collectStackAcresUnit(row, now, muckFee, restart);
    // Rule 2: a lost race did not happen here; whoever won it was credited instead.
    if (!done) continue;
    settled.push(row);
    if (muckFee !== null) mucked += 1;
  }

  if (settled.length === 0) {
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 3. The crit, rolled ONCE for the sweep and only now -- after the
  // guarded writes, beside the muck roll, for the identical reason: anything
  // reachable from a read can be re-rolled by pulling to refresh. Rolled at
  // `critChance`, not the tool's own base chance, so an armed dice boost
  // actually applies.
  const critical = rollHarvestCrit(tool, Math.random, critChance);

  // Step 3b. The Midnight Merchant: a second, independent roll riding the
  // SAME critical the secret-find roll (step 5b, below) piggybacks on --
  // never a second guarded write, and never gold- or streak-affecting on its
  // own (`spawnMidnightMerchantVisit` only ever seeds a fresh stock list at
  // zero purchases; it cannot pay out or spend anything by itself). Best-
  // effort and swallowed on failure for the same reason the dice-boost
  // disarm below is: the harvest itself is already settled and credited, and
  // an NPC failing to show up must not turn that into an error response.
  // Idempotent against a visit already in progress (`spawnMidnightMerchantVisit`
  // returns false rather than resetting one), so a player who is mid-visit
  // when a second critical lands simply keeps the visit they have.
  if (critical && shouldSpawnMidnightMerchantOnCriticalHarvest(Math.random)) {
    try {
      await spawnMidnightMerchantVisit(profile.id, "critical_harvest", MIDNIGHT_MERCHANT_WINDOW_MS, now);
    } catch (error) {
      console.error("stackacres.midnight_merchant_spawn_failed", { profileId: profile.id, error });
    }
  }

  if (diceBoostArmed) {
    // Disarmed unconditionally, whether or not the roll above actually
    // crit -- the boost is spent by being LIVE for this harvest, not
    // refunded on a miss, the same "you paid for a chance, not a guarantee"
    // rule every other crit-chance rung on the tool ladder already lives by.
    // Best-effort: the sweep is already durable by this point in the
    // function, and a failure here must not turn a settled, credited harvest
    // into an error response.
    const disarmed = await adjustStackAcresSecretLedger(
      profile.id,
      STACKACRES_DICE_BOOST_ARMED_KEY,
      -1,
    ).catch(() => null);
    if (disarmed === null) {
      console.error("stackacres.dice_boost_disarm_failed", { profileId: profile.id });
    }
  }

  // Step 4. Re-tally against what actually settled.
  const actual: HarvestSettlement =
    settled.length === ready.length ? planned : settleHarvest(settled.map(candidateOf));

  // Bonus units from a crit, one line at a time -- extra of whatever that
  // line already brought in, credited into the same tally position as the
  // rest of it. Valued off what actually settled, so a unit that lost its
  // race gets no crit bonus either.
  const critBonusTally = new Map<StackAcresItem, number>();
  if (critical) {
    for (const line of actual.lines) {
      const bonus = critBonusQuantity(line.quantity, tool, forgedStats.critBonus);
      if (bonus > 0) critBonusTally.set(line.item, (critBonusTally.get(line.item) ?? 0) + bonus);
    }
  }

  const baseTally = harvestTally(actual);

  // Step 5. Ray's Museum: a first-ever donation is automatic, not a player
  // action, and folds bonus UNITS of the item just discovered into the same
  // inventory credit -- there is no second credit path here, only a bigger
  // one. markStackAcresDonated is the idempotency guard (the (profile, item)
  // pair is a primary key), and only the call that actually donates an item
  // for the first time ever adds the bonus; a later harvest of that same
  // item, by this player or a replayed request, reports false and adds
  // nothing. `quantity` is the item's total across the WHOLE sweep, since a
  // sweep can bring several units of a freshly-discovered item home
  // together. Off the BASE tally, not the crit-inflated one -- same rate the
  // old Gold-denominated bonus paid it off, just in kind. Best-effort like
  // the credit step below: the harvest itself is already settled, and a
  // museum hiccup must not turn that into an error response.
  const discoveries: { item: StackAcresItem; bonusQuantity: number }[] = [];
  const museumBonusTally = new Map<StackAcresItem, number>();
  for (const { item, quantity } of baseTally) {
    try {
      const firstDiscovery = await markStackAcresDonated(profile.id, item);
      if (!firstDiscovery) continue;
      const bonusQuantity = museumDiscoveryBonusQuantity(quantity);
      if (bonusQuantity > 0) {
        museumBonusTally.set(item, (museumBonusTally.get(item) ?? 0) + bonusQuantity);
      }
      discoveries.push({ item, bonusQuantity });
    } catch (error) {
      console.error("stackacres.museum_donation_failed", { profileId: profile.id, item, quantity, error });
    }
  }

  // Step 5b. Ray's Museum, secret wing: one roll for the sweep, off the SAME
  // crit that already decided in step 3 -- a secret find piggybacks on a
  // critical harvest rather than adding a second dice roll to the guarded
  // write. Pays no Gold and no inventory at all (see rollSecretArtifact's own
  // header).
  const secretFind = rollSecretArtifact(tool, critical, Math.random);
  let secretSetJustCompleted = false;
  if (secretFind) {
    try {
      // Read BEFORE the write on purpose: once the core set is complete, a
      // later joke-pool find (or a re-roll of something already on the
      // shelf) must never re-fire the completion event and re-play the
      // client's unlock celebration. Only the write that carries the set
      // from incomplete to complete may set `secretSetJustCompleted`.
      const wasCompleteBefore = secretHiddenSetComplete(await museumSecretsView(profile.id));
      const firstFind = await markStackAcresMuseumSecret(profile.id, secretFind);
      if (firstFind && !wasCompleteBefore && secretHiddenSetComplete(await museumSecretsView(profile.id))) {
        secretSetJustCompleted = true;
        await applyAchievementEvent(profile.id, { kind: "museum_secret_set_completed" });
      }
    } catch (error) {
      console.error("stackacres.museum_secret_failed", { profileId: profile.id, secretFind, error });
    }
  }

  // Step 6. Credit inventory once per item -- base plus any crit bonus plus
  // any museum bonus. Best-effort per item, same posture the old Gold credit
  // took: the settlement above is already durable, and a credit hiccup here
  // must not turn a settled harvest into an error response, only report less
  // than what actually landed in the barn.
  const finalTally = new Map<StackAcresItem, number>();
  for (const { item, quantity } of baseTally) finalTally.set(item, quantity);
  for (const [item, bonus] of critBonusTally) finalTally.set(item, (finalTally.get(item) ?? 0) + bonus);
  for (const [item, bonus] of museumBonusTally) finalTally.set(item, (finalTally.get(item) ?? 0) + bonus);

  const credited: { item: StackAcresItem; quantity: number }[] = [];
  for (const [item, quantity] of finalTally) {
    try {
      await adjustStackAcresInventory(profile.id, item, quantity);
      credited.push({ item, quantity });
    } catch (error) {
      console.error("stackacres.harvest_credit_failed", { profileId: profile.id, item, quantity, error });
    }
  }

  for (const line of actual.lines) {
    const row = settled.find((candidate) => candidate.id === line.unitId);
    if (!row) continue;
    await recordStackAcresHarvest({
      profileId: profile.id,
      unitId: line.unitId,
      stock: line.stock,
      stake: row.stake,
      // The line's own value at today's sell price -- a production figure,
      // not Gold paid (a harvest pays none). See lib/stackacres/harvest.ts's
      // own header on why `homestead_harvests.payout` still reads this way.
      payout: line.gold,
      startedAt: row.startedAt,
      collectedAt: now.toISOString(),
      // Bought stock spends nothing per cycle, so `stake` above is notional
      // for these rows. The flag is what lets a dashboard tell the difference
      // rather than counting a seed price nobody paid.
      permanent: row.permanent,
    });
  }

  return {
    ...(await view(profile, now)),
    harvest: {
      units: settled.length,
      tally: credited,
      gross: actual.gross,
      mucked,
      crit: critical,
      critBonus: [...critBonusTally].map(([item, quantity]) => ({ item, quantity })),
      discoveries,
      secretFind,
      secretSetJustCompleted,
    },
  };
}

/**
 * Hands back allowance a sweep reserved and then did not use. Best-effort by
 * construction -- the player has already been paid correctly either way, and
 * the only casualty of a failure is reaching today's ceiling sooner than they
 * should have.
 */
async function releaseReservation(profileId: string, day: string, gold: number): Promise<void> {
  if (gold <= 0) return;
  await releaseStackAcresExchange(profileId, day, gold).catch((error) => {
    console.error("stackacres.allowance_release_failed", { profileId, day, gold, error });
    return null;
  });
}

/* ------------------------------------------------------------------ */
/* Processing: wheat, machines, Town Contracts                         */
/* ------------------------------------------------------------------ */

/**
 * Sows one wheat plot, with Gold. A pure sink, same category as
 * `stockStackAcres`'s seed -- see lib/stackacres/wheat-plot.ts's header for
 * why this cannot simply be a sixth `StackAcresStock`.
 */
export async function sowStackAcresWheat(token: string, now = new Date()): Promise<StackAcresView> {
  const profile = await ensureProfile(token);

  const plots = await listStackAcresWheatPlots(profile.id);
  if (plots.length >= WHEAT_PLOT_CAP) {
    throw new StackAcresRequestError(
      `You already have ${WHEAT_PLOT_CAP} Wheat plots growing. Wait for one to ripen.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the Gold leaves first.
  const debited = await spendGoldByProfile(profile.id, WHEAT_SEED_COST);
  if (!debited) {
    throw new StackAcresRequestError(
      `Wheat seed costs ${WHEAT_SEED_COST.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  try {
    await createStackAcresWheatPlot(profile.id, {
      startedAt: now,
      readyAt: new Date(now.getTime() + WHEAT_DURATION_MS),
    });
  } catch (error) {
    await refundGold(profile.id, WHEAT_SEED_COST);
    throw error;
  }

  return view(debited, now);
}

/** Places a machine outright, with Gold. A pure sink, never sold back --
 *  same category as `expandStackAcresCapacity`. */
export async function placeStackAcresMachine(
  token: string,
  kindInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!isMachineKind(kindInput)) throw new StackAcresRequestError("Not a real machine.", 400);
  const kind: MachineKind = kindInput;
  const def = MACHINE_CATALOGUE[kind];
  const profile = await ensureProfile(token);

  const machines = await listStackAcresMachines(profile.id);
  // One of each kind, checked here for a clean 409; the database's own
  // `homestead_machines_one_per_kind` index is the guard a race cannot get
  // past, and `createStackAcresMachine` treats its 23505 like a lost race.
  if (machines.some((machine) => machine.kind === kind)) {
    throw new StackAcresRequestError(`You already have a ${def.label}.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (machines.length >= MACHINE_CAP) {
    throw new StackAcresRequestError(
      `You already have ${MACHINE_CAP} machines placed. That is all the room there is for now.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the Gold leaves first.
  const debited = await spendGoldByProfile(profile.id, def.placeCost);
  if (!debited) {
    throw new StackAcresRequestError(`A ${def.label} costs ${def.placeCost.toLocaleString()} Gold.`, 400, {
      round: await snapshots(profile.id, now),
    });
  }

  try {
    await createStackAcresMachine(profile.id, kind);
  } catch (error) {
    await refundGold(profile.id, def.placeCost);
    throw error;
  }

  return view(debited, now);
}

/** The player's own Fermenting Vat, or a 404 -- every seal/collect action
 *  needs this first, and the message is the same whichever one asked. */
async function requireVatMachine(profileId: string, now: Date) {
  const machines = await listStackAcresMachines(profileId);
  const vat = machines.find((machine) => machine.kind === "vat");
  if (!vat) {
    throw new StackAcresRequestError("Place a Fermenting Vat first.", 404, {
      round: await snapshots(profileId, now),
    });
  }
  return vat;
}

/**
 * Seals a fresh batch inside the player's vat: `VAT_INPUT_QUANTITY` Cheese
 * leaves inventory and is locked inside a new `AgingManifest`, both in one
 * database transaction (`seal_homestead_vat`) -- see that migration's own
 * header for why this cannot be a debit followed by a separate insert.
 *
 * ONE SEAL AT A TIME, same posture as Town Contracts' one-open-contract rule:
 * the database's own `homestead_vat_manifests_one_per_machine` unique index
 * is the real guard against two racing calls both sealing the same vat, and
 * this function checks ahead of the debit only for a clean 409 -- the same
 * "check first for a nice error, guarded write is the real gate" shape
 * `placeStackAcresMachine` takes above.
 *
 * `baseGoldValueForSeal` prices the batch OFF THE LIVE RECIPE TABLE, but only
 * ONCE, right here -- the value it returns is written straight into the
 * manifest and never re-read at collection. See aging.ts's header for why
 * that snapshot is load-bearing.
 */
export async function sealStackAcresVat(token: string, now = new Date()): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const vat = await requireVatMachine(profile.id, now);

  const existing = await readStackAcresVatManifest(profile.id);
  if (existing) {
    throw new StackAcresRequestError("The vat is already sealed.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const baseGoldValue = baseGoldValueForSeal();
  if (baseGoldValue === null) {
    // Cannot happen for cheese today (milk always prices on the Gold track),
    // but the vat must refuse to seal a batch it cannot value rather than
    // seal one worth nothing -- see aging.ts's own comment on this return.
    throw new StackAcresRequestError("The vat cannot price that right now.", 500, {
      round: await snapshots(profile.id, now),
    });
  }

  const sealedAt = now;
  const readyAt = new Date(now.getTime() + firstAgingTier().durationMs);

  const manifest = await createStackAcresVatManifest(
    profile.id,
    vat.id,
    VAT_INPUT_ITEM,
    VAT_INPUT_QUANTITY,
    baseGoldValue,
    sealedAt,
    readyAt,
  );
  if (manifest === null) {
    throw new StackAcresRequestError(
      `Sealing the vat takes ${machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)}.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  return view(profile, now);
}

/**
 * Collects whatever tier the sealed batch has reached and pays for it.
 *
 * MONEY ORDERING, the same four steps `fulfillStackAcresTownContract` runs,
 * in the same order and for the same reason (see its own header): (1) the
 * value is computed and reserved against the SAME flat daily
 * `STACKACRES_GOLD_CEILING` a harvest and a contract both respect -- BEFORE
 * the manifest is settled, so a full day refuses while the batch is still
 * sealed rather than after it is gone; (2) the manifest is deleted under a
 * once-only guard; (3) Gold is credited only once that delete is confirmed
 * durable; any refusal along the way releases the reservation it took.
 */
export async function collectStackAcresVat(
  token: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  await requireVatMachine(profile.id, now);

  const manifest = await readStackAcresVatManifest(profile.id);
  if (!manifest) {
    throw new StackAcresRequestError("Nothing is sealed in the vat.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const elapsedMs = now.getTime() - Date.parse(manifest.sealedAt);
  const tier = vatTierForElapsed(elapsedMs);
  if (!tier) {
    throw new StackAcresRequestError(
      "Still aging. Come back once it reaches Aged quality.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }
  const gold = agedGoldValue(manifest.baseGoldValue, tier);

  // Step 1: reserve against the harvest's own ceiling, before the manifest
  // is settled.
  const day = stackacresExchangeDay(now);
  let reserved = 0;
  if (gold > 0) {
    const taken = await reserveStackAcresExchange(profile.id, day, gold, STACKACRES_GOLD_CEILING);
    if (taken === null) {
      const state = exchangeState(await readStackAcresExchanged(profile.id, day), now);
      throw new StackAcresRequestError(
        state.remaining > 0
          ? `The town can pay out ${state.remaining.toLocaleString()} more Gold today, and this batch is worth ${gold.toLocaleString()}. Come back after midnight UTC.`
          : "This farm has sent out all the Gold it can today. The vat keeps until midnight UTC.",
        409,
        { round: await snapshots(profile.id, now) },
      );
    }
    reserved = gold;
  }

  // Step 2: settle the manifest itself, exactly once.
  const settled = await collectStackAcresVatManifest(manifest, now);
  if (!settled) {
    await releaseStackAcresExchange(profile.id, day, reserved).catch(() => null);
    throw new StackAcresRequestError("That batch was already collected.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 3: pay, only now that step 2 is durable.
  let paid: PlayerProfile | null = null;
  if (gold > 0) {
    try {
      paid = await creditGoldByProfile(profile.id, gold);
    } catch (error) {
      console.error("stackacres.vat_credit_failed", {
        profileId: profile.id,
        manifestId: manifest.id,
        gold,
        error,
      });
    }
  }

  return {
    ...(await view(paid ?? (await ensureProfile(token)), now)),
    vatCollected: {
      quantity: manifest.quantity,
      tier: tier.tier,
      stars: tier.stars,
      multiplier: tier.multiplier,
      gold,
    },
  };
}

/**
 * The idle-worker pass: brings in every ripe wheat plot, starts every idle
 * machine that now has enough input, and collects every machine that has
 * finished. NO GOLD MOVES HERE AT ALL -- everything below is inventory only.
 *
 * THIS IS THE WORKER'S WHOLE "TASK QUEUE" for now, and the shape is
 * deliberate. StackAcres has never run a background job -- every clock in it
 * (a crop's growth, an animal's hunger, a Mill's own countdown) is a pure
 * function of `now`, settled lazily by whichever request happens to touch it
 * next; see ./units.ts's header. A literal ticking queue that assigns a
 * worker to a task and waits on it would be the first exception to that in
 * the whole feature. So instead: the client calls this action periodically
 * (a short poll, the same shape the PvP duel and cribbage shells already run
 * as a Realtime backup), and each call does every piece of work that has
 * become possible since the last one, all at once, all idempotent. A second
 * call a moment later simply finds nothing left to do.
 *
 * A walking NPC once answered this call on the client, as pure presentation
 * over an already-settled write; he was scrapped 2026-09-04. The property he
 * relied on still holds and is worth stating for whatever replaces him: this
 * function settles the work and says what it settled, so anything animating
 * the result reads that afterwards and never gates it.
 *
 * Every step here is its own guarded, at-most-once settlement, and a step
 * failing (a lost race to a second tab, most likely) never blocks the steps
 * after it -- there is no reservation to release and no Gold to refund,
 * since nothing here spends any.
 */
export interface StackAcresWorkResult {
  wheatCollected: number;
  machinesStarted: number;
  machinesCollected: number;
}

export async function workStackAcres(
  token: string,
  now = new Date(),
): Promise<StackAcresView & { work: StackAcresWorkResult }> {
  const profile = await ensureProfile(token);

  let wheatCollected = 0;
  const wheatPlots = await listStackAcresWheatPlots(profile.id);
  for (const plot of wheatPlots) {
    if (!isWheatPlotReadyRow(plot, now)) continue;
    const settled = await collectStackAcresWheatPlot(plot, now);
    if (!settled) continue; // Lost race to a concurrent call; nothing to credit.
    try {
      await adjustStackAcresInventory(profile.id, "wheat", WHEAT_YIELD_QUANTITY);
      wheatCollected += 1;
    } catch (error) {
      console.error("stackacres.wheat_credit_failed", { profileId: profile.id, plotId: plot.id, error });
    }
  }

  let machinesStarted = 0;
  let machinesCollected = 0;
  const machines = await listStackAcresMachines(profile.id);
  // Read once for the whole pass rather than per machine -- a loadout does
  // not change mid-request, and this moves no Gold either way (see the
  // header above), so there is no reservation this needs to line up with.
  const { millDoubleOutputChance } = await applySynergyBuffs(
    { harvestCritChance: 0, farmhandSpeed: 1, millDoubleOutputChance: 0 },
    profile.id,
  );
  for (const machine of machines) {
    if (machine.status === "idle") {
      // INSTANT recipes are never auto-started here. They have no run to
      // collect, so starting one on the player's behalf would silently spend
      // their milk the moment a poll came round -- a Dairy is a choice
      // (`processRecipe`), a Mill is a queue. Only queued recipes belong to
      // the worker pass.
      const recipe = recipesForMachine(machine.kind).find((id) => !isInstantRecipe(id));
      if (!recipe) continue;
      const def = RECIPE_CATALOGUE[recipe];
      // Rule 1: every input leaves inventory before the run that consumes it
      // exists. `adjustStackAcresInventory` is the real, atomic guard -- a
      // prior read of the inventory (in `view`) can be stale, but this call
      // cannot be. Looped rather than a single call: every queued recipe
      // today (only the Mill's Flour) has exactly one input, but this works
      // unchanged if a queued recipe ever needs more than one.
      const debited: { item: MachineItemId; quantity: number }[] = [];
      let short = false;
      for (const input of def.inputs) {
        const afterDebit = await adjustStackAcresInventory(profile.id, input.item, -input.quantity);
        if (afterDebit === null) {
          short = true;
          break;
        }
        debited.push(input);
      }
      if (short) {
        // Not enough on hand for every input; give back whatever already
        // left before trying the next machine.
        for (const input of debited) {
          await adjustStackAcresInventory(profile.id, input.item, input.quantity).catch(() => null);
        }
        continue;
      }
      const started = await startStackAcresMachine(
        machine,
        now,
        new Date(now.getTime() + def.processingMs),
        recipe,
        def.output.quantity,
      );
      if (!started) {
        // Lost the race to start this exact machine (a concurrent call got
        // there first): give every input back, exactly like `feedStackAcres`
        // refunds a spent serving on a lost race.
        for (const input of def.inputs) {
          await adjustStackAcresInventory(profile.id, input.item, input.quantity).catch(() => null);
        }
        continue;
      }
      machinesStarted += 1;
    } else if (isMachineDone(machine, now)) {
      // Read off the ROW, not off RECIPE_CATALOGUE: what this batch pays was
      // snapshotted when it started, so a retune landing mid-run cannot
      // change it. A row with no snapshot predates the migration that added
      // the column and is skipped rather than guessed at -- it collects on
      // the next pass once someone repairs it, and guessing would be the one
      // way to credit an output the player never started.
      const settled = await collectStackAcresMachine(machine, now);
      if (!settled) continue; // Lost race; nothing to credit.
      if (!machine.recipeId || machine.unitsProcessing <= 0) {
        console.error("stackacres.machine_run_missing_recipe", {
          profileId: profile.id,
          machineId: machine.id,
        });
        continue;
      }
      const output = RECIPE_CATALOGUE[machine.recipeId].output.item;
      // Rolled AFTER the guarded collect above has already landed, the same
      // discipline `rollHarvestCrit` is held to and for the same reason:
      // anything reachable from a read can be re-rolled by pulling to
      // refresh. `high_yield_processing` (lib/stackacres/synergy-perks.ts).
      const doubled =
        millDoubleOutputChance > 0 && rollMillDoubleOutput(millDoubleOutputChance, Math.random);
      const credited = doubled ? machine.unitsProcessing * 2 : machine.unitsProcessing;
      try {
        await adjustStackAcresInventory(profile.id, output, credited);
        machinesCollected += 1;
      } catch (error) {
        console.error("stackacres.machine_output_credit_failed", {
          profileId: profile.id,
          machineId: machine.id,
          error,
        });
      }
    }
  }

  return {
    ...(await view(profile, now)),
    work: { wheatCollected, machinesStarted, machinesCollected },
  };
}

/** ./wheat-plot.ts's own `isWheatPlotReady`, restated under a name that does
 *  not collide with the store's row type in this file's import list. */
function isWheatPlotReadyRow(row: Pick<StoredWheatPlot, "readyAt">, now: Date): boolean {
  return Date.parse(row.readyAt) <= now.getTime();
}

/**
 * Runs one batch of a recipe for this player.
 *
 * TAKES A PROFILE ID, NOT A SESSION TOKEN, unlike every other exported action
 * in this file. That is deliberate: this is the piece the atomicity argument
 * lives in, and keeping authentication out of it means a test can drive the
 * money-shaped path directly without minting a session.
 * `processStackAcresRecipe` below is the token-taking wrapper the route uses,
 * and it is the only caller that should exist.
 *
 * TWO PACINGS, one entry point (see lib/stackacres/recipes.ts's header):
 *
 *   - An INSTANT recipe (Dairy, Loom) settles in `process_homestead_recipe`:
 *     the input debit and the output credit are one transaction, so there is
 *     no window where the milk is gone and the cheese never arrived. No queue
 *     row is written at all.
 *   - A QUEUED recipe (Mill) debits the input, then starts the machine under
 *     its version guard, snapshotting `recipe_id`/`units_processing` onto the
 *     row. A lost start refunds the input, exactly as `workStackAcres` does.
 *
 * NO GOLD MOVES HERE, in either branch. Every input and output is inventory.
 *
 * `null` from the store is a REFUSAL, never a partial write -- it means the
 * player did not have enough, checked under a row lock. That is answered as a
 * 409 so the client can tell it apart from an ambiguous failure and roll its
 * optimistic update back; see lib/stackacres/optimistic-recipe.ts.
 */
export interface ProcessRecipeResult {
  recipe: RecipeId;
  /** Set for an instant recipe: the byproduct is already in the inventory.
   *  Null for a queued one, which has only just started. */
  produced: { item: MachineProcessedItem; quantity: number } | null;
  /** Set for a queued recipe: when `workStackAcres` will be able to collect
   *  it. Null for an instant one, which has nothing to collect. */
  readyAt: string | null;
}

export async function processRecipe(
  profileId: string,
  recipeId: RecipeId,
  now = new Date(),
): Promise<ProcessRecipeResult> {
  const def = RECIPE_CATALOGUE[recipeId];

  const machines = await listStackAcresMachines(profileId);
  const machine = machines.find(
    (candidate) => candidate.kind === def.machine && candidate.status === "idle",
  );
  if (!machine) {
    const owned = machines.some((candidate) => candidate.kind === def.machine);
    throw new StackAcresRequestError(
      owned
        ? `Your ${MACHINE_CATALOGUE[def.machine].label} is already running.`
        : `You need a ${MACHINE_CATALOGUE[def.machine].label} for that.`,
      409,
    );
  }

  const shortfall = () =>
    new StackAcresRequestError(
      `Not enough. One batch takes ${def.inputs
        .map((input) => machineItemLabel(input.item, input.quantity))
        .join(" + ")}.`,
      409,
    );

  if (isInstantRecipe(recipeId)) {
    // One transaction: every input's negative delta under its own row lock,
    // then the positive delta on the byproduct. Null means the lock-guarded
    // check refused some input and NOTHING was written. Flour/Cheese/Cloth
    // have exactly one input and use the single-input RPC; Cake has three
    // and needs the multi one -- see lib/stackacres/recipes.ts's header.
    const produced =
      def.inputs.length === 1
        ? await processStackAcresRecipe(profileId, def.inputs[0], def.output)
        : await processStackAcresRecipeMulti(profileId, def.inputs, def.output);
    if (produced === null) throw shortfall();
    return { recipe: recipeId, produced: { ...def.output }, readyAt: null };
  }

  // Rule 1: every input leaves inventory before the run that consumes it
  // exists. Every queued recipe today has exactly one input (see
  // workStackAcres's own comment on why this is looped anyway).
  const debited: { item: MachineItemId; quantity: number }[] = [];
  let short = false;
  for (const input of def.inputs) {
    const afterDebit = await adjustStackAcresInventory(profileId, input.item, -input.quantity);
    if (afterDebit === null) {
      short = true;
      break;
    }
    debited.push(input);
  }
  if (short) {
    for (const input of debited) {
      await adjustStackAcresInventory(profileId, input.item, input.quantity).catch(() => null);
    }
    throw shortfall();
  }

  const readyAt = new Date(now.getTime() + def.processingMs);
  const started = await startStackAcresMachine(
    machine,
    now,
    readyAt,
    recipeId,
    def.output.quantity,
  );
  if (!started) {
    // Lost the race to start this exact machine; give every input back.
    for (const input of def.inputs) {
      await adjustStackAcresInventory(profileId, input.item, input.quantity).catch(() => null);
    }
    throw new StackAcresRequestError("That machine just started something else.", 409);
  }

  return { recipe: recipeId, produced: null, readyAt: readyAt.toISOString() };
}

/** The route's entry point: resolves the session, then runs `processRecipe`
 *  and returns the refreshed view alongside what it made. */
export async function processStackAcresRecipeAction(
  token: string,
  recipeInput: string,
  now = new Date(),
): Promise<StackAcresView & { processed: ProcessRecipeResult }> {
  if (!isRecipeId(recipeInput)) throw new StackAcresRequestError("Not a real recipe.", 400);
  const profile = await ensureProfile(token);
  const processed = await processRecipe(profile.id, recipeInput, now);
  return { ...(await view(profile, now)), processed };
}

/** Posts a new open Town Contract, if this player does not already have one.
 *  Spends and moves nothing -- see lib/stackacres/contracts.ts's header for
 *  why there is ever only one. */
export async function requestStackAcresContract(
  token: string,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);

  const existing = await readStackAcresOpenContract(profile.id);
  if (existing) {
    throw new StackAcresRequestError("The town already has a contract open for you.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Only ever ask for goods this farm has a machine for. With one open
  // contract at a time and no way to cancel one, an unfulfillable contract is
  // not a bad draw -- it is a permanent block on every future one. See
  // lib/stackacres/contracts.ts's header.
  const machines = await listStackAcresMachines(profile.id);
  const producible = [
    ...new Set(
      machines.flatMap((machine) =>
        recipesForMachine(machine.kind).map((recipe) => RECIPE_CATALOGUE[recipe].output.item),
      ),
    ),
  ];
  const def = drawContract(producible, Math.random);
  if (!def) {
    throw new StackAcresRequestError(
      "The town has nothing to ask for yet. Place a machine first.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }
  // A null here means a concurrent tab posted one first -- not an error, the
  // view below simply shows whichever one won.
  await createStackAcresContract(profile.id, def);

  return view(profile, now);
}

/**
 * Trades a fulfilled contract's processed goods for Gold and Town Influence.
 * THE SECOND (and only other) GOLD PAYER IN THIS FILE -- see the module
 * header. Ordered the same way as every other spend-then-settle action here:
 *
 *   1. The goods leave inventory first (rule 1, applied to items instead of
 *      Gold, exactly as `harvestStackAcres` applies it to Gold before the
 *      write it pays for).
 *   2. Gold is reserved against the SAME flat daily ceiling a harvest
 *      reserves against, before the contract is marked settled -- so a full
 *      day refuses before the goods are gone, not after. A refusal here
 *      refunds the goods.
 *   3. The contract is marked fulfilled under a guard that can settle it at
 *      most once. Losing that race refunds both the goods and the
 *      reservation -- nothing here can pay out for a contract someone else
 *      already collected.
 *   4. Gold and Influence are credited only once step 3 is durable.
 */
export async function fulfillStackAcresTownContract(
  token: string,
  now = new Date(),
): Promise<StackAcresView & { contractReward: { gold: number; influence: number } }> {
  const profile = await ensureProfile(token);

  const contract = await readStackAcresOpenContract(profile.id);
  if (!contract) {
    throw new StackAcresRequestError("There is no contract open right now.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const inventory = await readStackAcresInventory(profile.id);
  if (!canFulfillContract(inventoryQuantity(inventory, contract.item), contract)) {
    throw new StackAcresRequestError(
      `This contract needs ${machineItemLabel(contract.item, contract.quantity)}.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Step 1: the goods leave first.
  const afterDeduct = await adjustStackAcresInventory(profile.id, contract.item, -contract.quantity);
  if (afterDeduct === null) {
    throw new StackAcresRequestError("Not enough on hand.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 2: reserve against the harvest's own ceiling, before the contract
  // is marked settled.
  const day = stackacresExchangeDay(now);
  let reserved = 0;
  if (contract.goldReward > 0) {
    const taken = await reserveStackAcresExchange(
      profile.id,
      day,
      contract.goldReward,
      STACKACRES_GOLD_CEILING,
    );
    if (taken === null) {
      await adjustStackAcresInventory(profile.id, contract.item, contract.quantity).catch(() => null);
      const state = exchangeState(await readStackAcresExchanged(profile.id, day), now);
      throw new StackAcresRequestError(
        state.remaining > 0
          ? `The town can pay out ${state.remaining.toLocaleString()} more Gold today, and this contract pays ${contract.goldReward.toLocaleString()}. Come back after midnight UTC.`
          : "This farm has sent out all the Gold it can today. This contract keeps until midnight UTC.",
        409,
        { round: await snapshots(profile.id, now) },
      );
    }
    reserved = contract.goldReward;
  }

  // Step 3: settle the contract itself, exactly once.
  const settled = await settleStackAcresContract(contract);
  if (!settled) {
    await releaseReservation(profile.id, day, reserved);
    await adjustStackAcresInventory(profile.id, contract.item, contract.quantity).catch(() => null);
    throw new StackAcresRequestError("That contract was already settled.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 4: pay, only now that step 3 is durable.
  let paid: PlayerProfile | null = null;
  if (contract.goldReward > 0) {
    try {
      paid = await creditGoldByProfile(profile.id, contract.goldReward);
    } catch (error) {
      console.error("stackacres.contract_credit_failed", {
        profileId: profile.id,
        contractId: contract.id,
        gold: contract.goldReward,
        error,
      });
    }
  }

  if (contract.influenceReward > 0) {
    await adjustStackAcresInfluence(profile.id, contract.influenceReward).catch((error) => {
      console.error("stackacres.contract_influence_failed", {
        profileId: profile.id,
        contractId: contract.id,
        error,
      });
    });
  }

  return {
    ...(await view(paid ?? (await ensureProfile(token)), now)),
    contractReward: { gold: contract.goldReward, influence: contract.influenceReward },
  };
}

/**
 * Sells inventory for Gold, at any time, at that item's own sell price. The
 * new baseline income path -- see this file's own header for why this,
 * `fulfillStackAcresTownContract` and `collectStackAcresVat` are the only
 * three functions here that may ever credit Gold.
 *
 * Ordered the same way `fulfillStackAcresTownContract` is, with the direction
 * of rule 1 reversed (goods leave before Gold is reserved, rather than Gold
 * leaving before goods exist):
 *
 *   1. The goods leave inventory first, under `adjustStackAcresInventory`'s
 *      own row lock -- a sale can never leave the player owing more than they
 *      held.
 *   2. Gold, multiplied by the Prestige Reset Valve's permanent multiplier
 *      (see lib/stackacres/prestige.ts's own header for why the multiplier
 *      moved here from harvest), is reserved against the SAME flat daily
 *      ceiling every other Gold-in path reserves against. A refusal here
 *      refunds the goods -- Sell straddles two separate guarded writes (the
 *      inventory RPC and the exchange-reservation RPC) that cannot share one
 *      database transaction the way an instant recipe's debit-and-credit can,
 *      so this is a compensating refund rather than a rollback.
 *   3. Gold is credited only once step 2 is durable.
 */
export async function sellStackAcresItem(
  token: string,
  input: { item: string; quantity: number },
  now = new Date(),
): Promise<StackAcresView & { sold: { item: MachineItemId; quantity: number; gold: number } }> {
  const profile = await ensureProfile(token);

  if (!isMachineItem(input.item)) {
    throw new StackAcresRequestError("That is not something you can sell.", 400, {
      round: await snapshots(profile.id, now),
    });
  }
  const item: MachineItemId = input.item;
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new StackAcresRequestError("Sell a positive amount.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 1: the goods leave first.
  const afterDebit = await adjustStackAcresInventory(profile.id, item, -input.quantity);
  if (afterDebit === null) {
    throw new StackAcresRequestError("Not enough on hand.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 2: reserve the Gold, prestige-multiplied, against the daily ceiling.
  const day = stackacresExchangeDay(now);
  const basePrice = machineItemSellPrice(item) * input.quantity;
  const prestigeMultiplier = await getPrestigeMultiplier(profile.id);
  // FLOORED, same posture settleHarvest's own prestige step used to take: a
  // multiplier may not invent a Gold piece out of a rounding rule.
  const gold = Math.floor(basePrice * Math.max(1, prestigeMultiplier));
  const reserved = await reserveStackAcresExchange(profile.id, day, gold, STACKACRES_GOLD_CEILING);
  if (reserved === null) {
    await adjustStackAcresInventory(profile.id, item, input.quantity).catch((error) => {
      console.error("stackacres.sell_refund_failed", { profileId: profile.id, item, quantity: input.quantity, error });
    });
    const state = exchangeState(await readStackAcresExchanged(profile.id, day), now);
    throw new StackAcresRequestError(
      state.remaining > 0
        ? `This farm can send out ${state.remaining.toLocaleString()} more Gold today, and that sale is worth ${gold.toLocaleString()}. Sell less, or come back after midnight UTC.`
        : "This farm has sent out all the Gold it can today. Everything keeps until midnight UTC.",
      409,
      { reason: "day-capped", round: await snapshots(profile.id, now) },
    );
  }

  // Step 3: credit, only now that the reservation above is durable.
  let paid: PlayerProfile | null = null;
  try {
    paid = await creditGoldByProfile(profile.id, gold);
  } catch (error) {
    console.error("stackacres.sell_credit_failed", { profileId: profile.id, item, quantity: input.quantity, gold, error });
  }

  return {
    ...(await view(paid ?? (await ensureProfile(token)), now)),
    sold: { item, quantity: input.quantity, gold },
  };
}

/**
 * Ray's Mythic Blueprints. MOVES NO GOLD -- see
 * lib/server/stackacres-blueprint-service.ts's own header for why this
 * feature carries none of the daily Gold ceiling's risk and needs no
 * reservation step the way `fulfillStackAcresTownContract` above does.
 *
 * Both resolve the profile exactly once and hand the profileId straight to
 * the profileId-taking core (`startBlueprintForProfile`,
 * `contributeToBlueprint`) rather than through their own token-resolving
 * wrappers, so composing the full farm view below never pays a second
 * profile lookup for one action -- see `startBlueprintForProfile`'s own
 * comment on why that redundant-resolve shape is worth avoiding on purpose.
 */
export async function startStackAcresMythicBlueprint(
  token: string,
  structureId: string,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  await startBlueprintForProfile(profile.id, structureId);
  return view(profile, now);
}

export async function contributeToStackAcresMythicBlueprint(
  token: string,
  structureId: string,
  itemId: string,
  amount: number,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  await contributeToBlueprint(profile.id, structureId, itemId, amount);
  return view(profile, now);
}

/* -------------------------------------------------------------------- */
/* Prestige Reset Valve                                                  */
/* -------------------------------------------------------------------- */

/**
 * Pulls the Prestige Reset Valve for the caller's own farm.
 *
 * MOVES NO GOLD AT ALL -- this action joins neither list in the module
 * header's payer/spender inventory. What it moves is irreversible instead:
 * on success, every unit, wheat plot, inventory line, feed serving, today's
 * Land Maintenance total and any open Town Contract are gone. See
 * `reset_stackacres_prestige`'s own migration comment
 * (20260905140000_stackacres_prestige_reset.sql) for the exact table list
 * and, as importantly, for what survives it -- land cleared, purchased
 * capacity, placed machines, Synergy Tree perks, Ray's Museum registries and
 * Town Influence are all untouched.
 *
 * A refusal (not enough gross production since the last reset) is an
 * ordinary outcome, not a database failure -- same posture every other
 * Gold-gated refusal in this file takes -- so it surfaces as a
 * StackAcresRequestError (409) with the current farm still intact, never as
 * a thrown database error.
 *
 * Takes no argument beyond the token, on purpose, the same reason
 * `upgradeStackAcresTool` does: there is nothing for the client to name. The
 * server alone decides whether the valve turns, from what it already knows
 * about this profile's own history.
 */
export async function prestigeResetStackAcres(
  token: string,
  now = new Date(),
): Promise<StackAcresView & { prestigeReset: StackAcresPrestigeResetResult }> {
  const profile = await ensureProfile(token);
  const gain = await resetStackAcresPrestige(profile.id);

  if (!gain.eligible) {
    throw new StackAcresRequestError(
      `This farm needs to gross ${gain.eligibleGross.toLocaleString()} more Gold since your last reset before the valve will turn -- ${(
        gain.nextMultiplier - gain.gainedMultiplier
      ).toFixed(4)}x stays where it is.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Read AFTER the reset commits, same pattern harvestStackAcres and
  // fulfillStackAcresTownContract already use for their own post-write view:
  // a fresh read is guaranteed to reflect the write that just happened,
  // where reusing a value computed before it would not be.
  const freshView = await view(profile, now);
  return {
    ...freshView,
    prestigeReset: {
      prestigeCount: freshView.prestige.prestigeCount,
      multiplier: freshView.prestige.multiplier,
      gainedMultiplier: gain.gainedMultiplier,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Irrigation pipe network                                             */
/* ------------------------------------------------------------------ */

/**
 * Recomputes the network after a layout change, writes the derived
 * framing/hydration back, and keeps `last_watered_at` honest for the crops
 * it touches.
 *
 * The stamp rolls `last_watered_at` forward with ZERO excluded time --
 * `ready_at` is passed through unchanged. Irrigation cost the crop no
 * growing time (`isStackAcresUnitDry` returns false for an irrigated crop,
 * so it never froze), so moving `ready_at` would be charging for time that
 * was not lost. What the stamp buys is that pulling the pipe later starts
 * the drought from that moment rather than retroactively from whenever the
 * soil first ran dry. `alsoStamp` carries the crops that a just-removed
 * tile had been watering, so they get the same fresh start.
 *
 * A lost version race on a stamp is harmless: the next layout change, or a
 * manual Water, settles it.
 */
async function recomputeIrrigation(
  profileId: string,
  now: Date,
  alsoStamp: ReadonlySet<string> = new Set<string>(),
): Promise<NetworkGrid> {
  const [rows, pipes, purchasedSoil] = await Promise.all([
    listStackAcresUnits(profileId),
    listStackAcresPipes(profileId),
    listStackAcresSoilTiles(profileId),
  ]);
  const grid = irrigationGridFor(rows, pipes, soilMapFor(purchasedSoil));
  // Only the PIPE topology is persisted -- `grid.irrigatedUnitIds` may now
  // also hold crops a hydro bed waters, which is not a fact about any pipe.
  // Syncing the whole grid is still right: the sync writes connector frames
  // and hydration onto pipe rows, and a hydro-watered crop adds no pipe row
  // for it to touch.
  await syncStackAcresPipeNetwork(profileId, grid);

  await stampIrrigatedCrops(rows, new Set<string>([...grid.irrigatedUnitIds, ...alsoStamp]), now);

  return grid;
}

/**
 * Places one irrigation tile (a well or a length of pipe) on the
 * STACKACRES_TILE lattice, spending Gold. Rule 1: the Gold leaves first; a
 * placement that cannot land -- layout full, the one well slot already
 * taken, or a lost race -- refunds it.
 */
export async function placeStackAcresPipeTile(
  token: string,
  input: { tx: number; ty: number; kind: PipeKind },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tx = Math.trunc(input.tx);
  const ty = Math.trunc(input.ty);
  const cost = PIPE_PLACE_COST[input.kind];

  // No pipe or well inside a pen -- Henhaven, Oxfields and Wallow are
  // GROW_AREA entries the same as any other district, but irrigation
  // belongs to the Crop Fields and the open farm, not inside a hen/ox/hog
  // enclosure. The client already keeps a drag or a tap from reaching this
  // far (stackacres-scene.ts's `pipeLayableWorldTile`, and the radial menu's
  // own `pipeExtraActions`), so this is the authoritative backstop -- a
  // forged or replayed request had nothing else stopping it, since this
  // function otherwise never checked geography at all. Runs before the Gold
  // debit below, unlike the cap/well checks further down: those need a
  // store round trip and so debit-then-refund, but pen membership is a pure
  // function of `tx`/`ty` with no race to guard against.
  //
  // `tx`/`ty` are pipe TILE indices, not world units -- `pipeTileCenter`
  // converts back, the same way `soilTileRect` does for soil's own
  // geography check just below.
  const tileCentre = pipeTileCenter(tx, ty);
  const zone = growAreaAt(tileCentre.x, tileCentre.y);
  if (zone && PEN_ZONE_IDS.includes(zone)) {
    throw new StackAcresRequestError(
      `${input.kind === "well" ? "A well" : "Pipe"} cannot be laid inside a pen.`,
      400,
    );
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error.
  const debited = await spendGoldByProfile(profile.id, cost);
  if (!debited) {
    throw new StackAcresRequestError(
      `${input.kind === "well" ? "A well" : "A length of pipe"} costs ${cost.toLocaleString()} Gold.`,
      400,
    );
  }

  let placed: Awaited<ReturnType<typeof placeStackAcresPipe>>;
  try {
    placed = await placeStackAcresPipe(profile.id, tx, ty, input.kind);
  } catch (error) {
    await refundGold(profile.id, cost);
    throw error;
  }
  if (!placed) {
    await refundGold(profile.id, cost);
    throw new StackAcresRequestError(
      input.kind === "well"
        ? "This farm already has a well."
        : "That pipe could not be placed.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  await recomputeIrrigation(profile.id, now);
  return view(debited, now);
}

/**
 * Removes one irrigation tile. Not a payout and not refunded -- a placed
 * tile is a spent sink. The recompute afterwards freezes any crop that was
 * only growing because this tile watered it, from now rather than
 * retroactively.
 */
export async function removeStackAcresPipeTile(
  token: string,
  input: { tx: number; ty: number },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tx = Math.trunc(input.tx);
  const ty = Math.trunc(input.ty);

  const [unitsBefore, pipesBefore, soilBefore] = await Promise.all([
    listStackAcresUnits(profile.id),
    listStackAcresPipes(profile.id),
    listStackAcresSoilTiles(profile.id),
  ]);
  const before = irrigationGridFor(unitsBefore, pipesBefore, soilMapFor(soilBefore));

  await removeStackAcresPipe(profile.id, tx, ty);
  await recomputeIrrigation(profile.id, now, before.irrigatedUnitIds);
  return view(profile, now);
}

/**
 * Points one lone pipe stub -- lib/stackacres/irrigation.ts's `PipeFacing`,
 * cosmetic only. No Gold moves and no recompute runs: the aim is not part
 * of the network (`mask`/`hydrated`/`distance` never read it), so there is
 * nothing for `recomputeIrrigation` to settle. Refuses a coordinate with no
 * pipe on it (or the well) rather than silently doing nothing, so a stale
 * tap gets told; a tile already aimed that way is a plain no-op success,
 * since asking twice is not a mistake.
 */
export async function aimStackAcresPipeTile(
  token: string,
  input: { tx: number; ty: number; facing: PipeFacing },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tx = Math.trunc(input.tx);
  const ty = Math.trunc(input.ty);

  const touched = await aimStackAcresPipe(profile.id, tx, ty, input.facing);
  if (!touched) {
    const pipes = await listStackAcresPipes(profile.id);
    const existing = pipes.find((pipe) => pipe.tx === tx && pipe.ty === ty);
    if (!existing || existing.kind !== "pipe") {
      throw new StackAcresRequestError("There is no pipe there to aim.", 409, {
        round: await snapshots(profile.id, now),
      });
    }
  }
  return view(profile, now);
}

/**
 * Spends one bag on the Crop Fields' own lattice: a brand new one-tile bed
 * on bare ground. Rule 1, in bags: the bag leaves before the outcome is
 * known, and anything that stops the bed landing -- it is already occupied,
 * or (rarely) a race for a bare cell -- refunds it. See `plantSoilTile` in
 * lib/stackacres/soil.ts, the pure version of this same decision.
 *
 * THE TIER SETS THE PRICE, and it is read from the tier table rather than
 * from the request: the client sends WHICH bag it is spending, never what
 * that bag costs. `toSoilTier` degrades an unknown id to the cheapest tier,
 * so a malformed or hostile body can only ever under-buy, never get an
 * expensive square for a cheap one. Gold itself never moves here -- it left
 * at the shelf (`buyStackAcresSoil`), which is why every refusal below only
 * ever refunds a bag, never Gold.
 *
 * A tier is no longer purely cosmetic -- Enriched shortens a crop's cycle and
 * Hydro waters its own tile -- but BOTH effects are applied elsewhere and
 * neither is read here: growth is baked into `ready_at` at sow
 * (`stockStackAcres`), and hydration is resolved by `recomputeIrrigation`.
 * That split is why this function still moves nothing but a bag and one row.
 *
 * Bounded to the Crop Fields' own ground (`CROP_FIELD_BEDS`) -- never trust
 * the client's tapped coordinate blindly, the same posture `place-pipe`'s
 * tile-lattice bounds take one layer up (there the bound is a generous
 * rectangle around the whole map; here it is the one patch of ground a bed
 * can ever mean anything in). Also refused while the Crop Fields themselves
 * are not yet unlocked (lib/stackacres/crop-fields.ts) -- the field's own
 * ground sits inside the Farmstead now (a HOME sector, always walkable), so
 * the bounds check alone can no longer be the whole gate the way it could
 * when `meadow` was still its own locked sector.
 */
export async function placeStackAcresSoilTile(
  token: string,
  input: { tx: number; ty: number; tier?: unknown },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tx = Math.trunc(input.tx);
  const ty = Math.trunc(input.ty);
  const tier = toSoilTier(input.tier);

  const cropFieldsUnlocked = await readStackAcresCropFieldsUnlocked(profile.id);
  if (!cropFieldsUnlocked) {
    throw new StackAcresRequestError("Unlock the Crop Fields first.", 400);
  }

  const area = CROP_FIELD_BEDS;
  const rect = soilTileRect(tx, ty);
  const inMeadow =
    rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height;
  if (!inMeadow) {
    throw new StackAcresRequestError("A bed can only be tilled in the Crop Fields.", 400);
  }

  // Rule 1, in bags rather than Gold: the thing being spent leaves before the
  // bed exists, and anything that stops the bed existing puts it back. No Gold
  // moves here at all -- it left at the shop (`buyStackAcresSoil`).
  const remaining = await adjustStackAcresSoilStock(profile.id, tier, -1);
  if (remaining === null) {
    throw new StackAcresRequestError(
      `No ${soilTierDef(tier).label} left. Buy a bag from Ray's supply store first.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  let outcome: Awaited<ReturnType<typeof placeSoilTileRow>>;
  try {
    outcome = await placeSoilTileRow(profile.id, tx, ty, tier);
  } catch (error) {
    await refundSoilBag(profile.id, tier);
    throw error;
  }
  if (outcome.kind === "created") {
    return view(profile, now);
  }

  // Every other outcome spent nothing: refund the bag. Both remaining
  // outcomes ("occupied" and a lost race for the same bare cell) read as
  // the same thing to the player -- there is already a bed there.
  await refundSoilBag(profile.id, tier);
  throw new StackAcresRequestError("There is already a bed there.", 409, {
    round: await snapshots(profile.id, now),
  });
}

/**
 * Slides an already-placed bed -- and every bed touching it, one contiguous
 * group -- to a new spot on the same lattice, whatever crop stands on it
 * carried along for free. Hold-tap lift, tap-to-drop on the client
 * (stackacres-scene.ts); nothing is spent and nothing is refunded, since
 * this only ever moves ground the player already bought.
 *
 * NEVER remove-then-place. A crop's position is `soilSlot`, an index into
 * `orderedSoilTiles` (lib/stackacres/soil.ts), not a coordinate -- as long
 * as a tile keeps its own `tile_order` while its tx/ty change, every crop
 * standing on it keeps resolving to the same bed with no unit-row write at
 * all. Removing and reinserting would hand out a NEW order, reshuffle every
 * later tile's slot index, and (per `removeStackAcresSoilTile` above) delete
 * the bed's own occupant outright.
 *
 * The group and its legality are recomputed HERE from a fresh read, never
 * trusted from the client: `planSoilGroupRelocation` is the identical pure
 * function the client's own optimistic guess runs, so the two only disagree
 * when the client's guess is stale -- which the store's own exists-check
 * (ST005) catches, same posture `place_homestead_soil_tile`'s exists-check
 * takes for a fresh placement.
 */
export async function moveStackAcresSoilTileGroup(
  token: string,
  input: { tx: number; ty: number; toTx: number; toTy: number },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tx = Math.trunc(input.tx);
  const ty = Math.trunc(input.ty);
  const toTx = Math.trunc(input.toTx);
  const toTy = Math.trunc(input.toTy);

  const cropFieldsUnlocked = await readStackAcresCropFieldsUnlocked(profile.id);
  if (!cropFieldsUnlocked) {
    throw new StackAcresRequestError("Unlock the Crop Fields first.", 400);
  }

  const purchased = await listStackAcresSoilTiles(profile.id);
  const soil = soilMapFor(purchased);
  const plan = planSoilGroupRelocation(soil, tx, ty, toTx, toTy, soilTileInCropFieldBeds);

  if (plan.kind === "empty") {
    throw new StackAcresRequestError("There is no bed there to move.", 400);
  }
  if (plan.kind === "no-op") {
    throw new StackAcresRequestError("Pick a different spot to move it to.", 400);
  }
  if (plan.kind === "out-of-bounds") {
    throw new StackAcresRequestError("A bed can only be moved within the Crop Fields.", 400);
  }
  if (plan.kind === "blocked") {
    throw new StackAcresRequestError("There is already a bed there.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const outcome = await moveSoilTileGroupRow(profile.id, plan.moves);
  if (outcome.kind === "stale") {
    throw new StackAcresRequestError("That layout just changed -- try again.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (outcome.kind === "blocked") {
    throw new StackAcresRequestError("There is already a bed there.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/**
 * Buys bags of one soil tier at Ray's supply store. Rule 1: the Gold leaves
 * before the bags exist, and a failed credit refunds it.
 *
 * THE SHOP NEVER TOUCHES THE MAP. It sells a bag; `placeStackAcresSoilTile`
 * decides where one goes and spends it. That split is why this function has no
 * coordinate and no district check, and why a bought bag is never lost by
 * tapping the wrong ground -- a refused placement returns the bag to the shelf.
 *
 * The price is read from `SOIL_TIER_DEFS`, never from the request. An unknown
 * tier degrades to the cheapest via `toSoilTier`, so a hostile body can only
 * ever under-buy.
 */
export async function buyStackAcresSoil(
  token: string,
  input: { tier?: unknown; quantity?: unknown },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tier = toSoilTier(input.tier);
  const quantity = Math.trunc(typeof input.quantity === "number" ? input.quantity : 1);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > SOIL_BAGS_PER_PURCHASE) {
    throw new StackAcresRequestError(
      `Buy between 1 and ${SOIL_BAGS_PER_PURCHASE} bags at a time.`,
      400,
    );
  }
  const cost = soilTierPrice(tier) * quantity;

  const debited = await spendGoldByProfile(profile.id, cost);
  if (!debited) {
    throw new StackAcresRequestError(
      `${quantity} x ${soilTierDef(tier).label} costs ${cost.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  try {
    const held = await adjustStackAcresSoilStock(profile.id, tier, quantity);
    // A credit cannot go negative, so null here means the row moved under us
    // rather than "not enough" -- either way no bags landed, so the Gold goes
    // back.
    if (held === null) throw new Error("Could not shelve that soil.");
  } catch (error) {
    await refundGold(profile.id, cost);
    throw error;
  }

  return view(debited, now);
}

/** Puts one bag back after a placement that could not land. Never throws, for
 *  the same reason `refundGold` never does: this IS the failure path, and a
 *  second failure here would hide the first. */
async function refundSoilBag(profileId: string, tier: SoilTier): Promise<void> {
  await adjustStackAcresSoilStock(profileId, tier, 1).catch(() => null);
}

/**
 * Buys seeds of one crop at Ray's supply store. Rule 1: the Gold leaves
 * before the seeds exist, and a failed credit refunds it.
 *
 * THE SHOP NEVER PLANTS ANYTHING. It sells a seed; `stockStackAcres` decides
 * where and when one gets planted and spends it. That split is why this
 * function has no district/capacity check of its own -- those are enforced
 * at planting, same as they always were.
 *
 * The price is read from `STACKACRES_CATALOGUE[crop].seedCost`, never from
 * the request -- the same per-tier price a crop always cost to plant, now
 * paid up front instead of at stocking time. `isStackAcresCrop` refuses an
 * unknown or livestock id outright rather than degrading, unlike soil's
 * tier degradation: there is no "cheapest crop" a hostile body should be
 * allowed to fall back onto.
 */
export async function buyStackAcresSeed(
  token: string,
  input: { crop?: unknown; quantity?: unknown },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const cropInput = input.crop;
  if (typeof cropInput !== "string" || !isStackAcresCrop(cropInput)) {
    throw new StackAcresRequestError("Not a real crop.", 400);
  }
  const crop: StackAcresCrop = cropInput;
  const quantity = Math.trunc(typeof input.quantity === "number" ? input.quantity : 1);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > STACKACRES_SEED_BAGS_PER_PURCHASE) {
    throw new StackAcresRequestError(
      `Buy between 1 and ${STACKACRES_SEED_BAGS_PER_PURCHASE} seeds at a time.`,
      400,
    );
  }
  const def = STACKACRES_CATALOGUE[crop];
  const cost = def.seedCost * quantity;

  const debited = await spendGoldByProfile(profile.id, cost);
  if (!debited) {
    throw new StackAcresRequestError(
      `${quantity} x ${def.label} seed costs ${cost.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  try {
    const held = await adjustStackAcresSeedStock(profile.id, crop, quantity);
    // A credit cannot go negative, so null here means the row moved under us
    // rather than "not enough" -- either way no seeds landed, so the Gold
    // goes back.
    if (held === null) throw new Error("Could not shelve that seed.");
  } catch (error) {
    await refundGold(profile.id, cost);
    throw error;
  }

  return view(debited, now);
}

/**
 * Removes one purchased soil tile. No refund -- a placed bed is a spent
 * sink, matching every other retire/clear convention here (see
 * `removeStackAcresPipeTile`, `retireStackAcresStock`). Refuses for a
 * starter tile or a missing coordinate; the store's own `origin = 'purchased'`
 * guard is what makes that refusal unconditional rather than trusted from the
 * client's own idea of which tile it tapped.
 *
 * A crop standing on the bed goes with it. The client warns and makes the
 * player confirm before this ever fires (stackacres-farm.tsx's remove-bed
 * ring item), but that is a courtesy, not the authority -- this resolves the
 * same `soilSlotOnTile` question itself and deletes the occupant
 * (`abandonStackAcresUnit`) once the bed is actually gone, with no refund of
 * whatever seed money already went into it. Occupancy is read BEFORE the
 * removal, while the tile this crop's slot names still exists to be found;
 * a lost race on the abandon (the crop was harvested or cleared a moment
 * earlier) is left alone rather than retried -- there is nothing left to
 * take.
 */
export async function removeStackAcresSoilTile(
  token: string,
  input: { tx: number; ty: number },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tx = Math.trunc(input.tx);
  const ty = Math.trunc(input.ty);

  const [purchased, units] = await Promise.all([
    listStackAcresSoilTiles(profile.id),
    listStackAcresUnits(profile.id),
  ]);
  const soil = soilMapFor(purchased);
  const occupant = units.find(
    (unit) => unit.soilSlot !== null && soilSlotOnTile(soil, unit.soilSlot, tx, ty),
  );

  const removed = await removeSoilTileRow(profile.id, tx, ty);
  if (!removed) {
    throw new StackAcresRequestError("That bed cannot be removed.", 400);
  }

  if (occupant) {
    await abandonStackAcresUnit(occupant);
  }

  return view(profile, now);
}

/**
 * Prays with the Pixel Pilgrim -- the only write his shrine makes. No spend,
 * no version guard on a row: the RPC's own row-locking upsert
 * (`pray_at_homestead_shrine`) is the whole idempotency story for a UTC day,
 * and `runStackAcresAction`'s intent-key wrapper (see the route) covers a
 * duplicated request the same way every other action here is covered.
 *
 * Called only from the dialogue's own "yes" -- stackacres-farm.tsx never
 * sends this action from the tap itself, so a decline costs the player
 * nothing and touches no state at all.
 *
 * A null back from the store means the write could not be recorded (a lost
 * race): reported as no advance and no relic, never as a successful prayer,
 * same rule every other ledger write in this file follows.
 */
export async function prayAtStackAcresShrine(token: string, now = new Date()): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  const today = stackacresExchangeDay(now);
  const yesterday = previousUtcDay(today);

  const result = await prayAtStackAcresShrine_store(profile.id, today, yesterday, DEVOTION_RUNG_THRESHOLDS);
  if (result === null) {
    const current = await readStackAcresDevotion(profile.id);
    return {
      ...(await view(profile, now)),
      prayer: { streak: current.streak, alreadyPrayedToday: false, grantedRelic: null },
    };
  }

  const grantedRelic = result.grantedRung === null ? null : DEVOTION_LADDER[result.grantedRung].relic;
  return {
    ...(await view(profile, now)),
    prayer: { streak: result.streak, alreadyPrayedToday: result.alreadyPrayedToday, grantedRelic },
  };
}

/**
 * Gives one unit of a processing-track item to an NPC as a gift, advancing
 * friendship with them for the UTC day. No spend against Gold or the daily
 * ceiling either way -- see lib/stackacres/friendship.ts's own header for
 * why a ladder rung pays a keepsake, never Gold: this file's own "currency
 * wall" test pins `creditGoldByProfile` to exactly three call sites, and a
 * friendship reward is not a fourth.
 *
 * Re-validates `npc`/`item` independently of the route's own zod schema,
 * same posture `donateStackAcresSecretItem` already takes: this is the
 * function of record, and the route is only its first caller.
 *
 * The store's own RPC (`give_homestead_gift`) is the whole idempotency
 * story here -- it checks the day gate BEFORE touching inventory, so a
 * refused gift never costs the player the item they tried to give, and
 * `runStackAcresAction`'s intent-key wrapper (see the route) covers a
 * duplicated request the same way every other action here is covered.
 */
export async function giveStackAcresGift(
  token: string,
  npcInput: string,
  itemInput: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!isNpcId(npcInput)) throw new StackAcresRequestError("There is nobody there to give that to.", 400);
  if (!isMachineItem(itemInput)) throw new StackAcresRequestError("That is not something you can give.", 400);
  const npc: NpcId = npcInput;
  const item: MachineItemId = itemInput;
  const profile = await ensureProfile(token);
  const today = stackacresExchangeDay(now);

  const result = await giveStackAcresGift_store(profile.id, npc, item, giftPoints(npc, item), today, FRIENDSHIP_RUNG_THRESHOLDS);
  const grantedKeepsake = result.grantedRung === null ? null : FRIENDSHIP_LADDER[result.grantedRung].keepsake;
  return {
    ...(await view(profile, now)),
    gift: { npc, points: result.points, outcome: result.outcome, grantedKeepsake },
  };
}

/**
 * Deploys one Mechanical Forage Drone for the caller, at
 * `DRONE_DEPLOY_COST_GOLD` flat. Both progression invariants live in
 * `deployDrone` (./stackacres-drone-service.ts): the hangar's derived,
 * museum-donation unlock gate is checked before any Gold moves, and the
 * debit + ownership row are one atomic RPC, mirroring
 * `unlockStackAcresSynergyPerk`'s own shape just above.
 */
export async function deployStackAcresDrone(token: string, now = new Date()): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  const result = await deployDrone(profile.id, now);
  if (!result.success) {
    const message =
      result.reason === "hangar_locked"
        ? "Ray's Museum hasn't turned up the drone hangar blueprint yet -- keep donating finds."
        : `A drone costs ${DRONE_DEPLOY_COST_GOLD.toLocaleString()} Gold.`;
    throw new StackAcresRequestError(message, result.reason === "hangar_locked" ? 409 : 400, {
      round: await snapshots(profile.id, now),
    });
  }
  return { ...(await view(profile, now)), droneDeploy: { droneId: result.droneId } };
}

/** Every drone the caller currently owns, and whether the hangar itself is
 *  unlocked -- read-only, no Gold moves, safe to poll from the shelf the
 *  same way `readShopProgress` is. */
export async function listStackAcresDrones(
  token: string,
): Promise<{ hangarUnlocked: boolean; drones: StoredDrone[] }> {
  const profile = await ensureProfile(token);
  const [hangarUnlocked, drones] = await Promise.all([
    isDroneHangarUnlocked(profile.id),
    listDrones(profile.id),
  ]);
  return { hangarUnlocked, drones };
}

/**
 * Claims one forage pickup swept up by an already-deployed drone. See
 * `collectDroneForage`'s own doc comment for the full picture: local-
 * optimistic on the client, re-verified (ownership, cooldown, the daily
 * Gold ceiling) inside one locked transaction on the server before a single
 * Gold piece moves.
 */
export async function collectStackAcresDroneForage(
  token: string,
  droneId: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  const result = await collectDroneForage(profile.id, droneId, now);
  if (!result.success) {
    const message =
      result.reason === "cooling_down"
        ? "That drone is still recharging its magnets."
        : result.reason === "day-capped"
          ? "This farm has sent out all the Gold it can today. Everything keeps until midnight UTC."
          : "There is no such drone here.";
    throw new StackAcresRequestError(message, result.reason === "no_such_drone" ? 404 : 409, {
      // Tagged so the client can park the whole fleet's drops until the day
      // rolls over (`holdDroneForage`). A capped farm refuses every claim,
      // and a drone that keeps flying to gold it cannot be paid for asks
      // again every few seconds for the rest of the day. `cooling_down` is
      // deliberately left untagged: it is one drone briefly out of step, not
      // a reason to stop.
      ...(result.reason === "day-capped" ? { reason: "day-capped" as const } : {}),
      round: await snapshots(profile.id, now),
    });
  }
  return { ...(await view(profile, now)), droneForage: { droneId, reward: result.reward } };
}

/** Maps a thrown error to the response every StackAcres route sends. */
export function toStackAcresErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That could not be worked.");
}
