import "server-only";
import { NextResponse } from "next/server";
import { adminClient } from "./supabase-admin";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_CROPS,
  STACKACRES_FEED,
  STACKACRES_FEED_SHIPMENTS_PER_PURCHASE,
  STACKACRES_MAX_EXTRA_CAP,
  STACKACRES_MUCK_CHANCE,
  STACKACRES_SEED_BAGS_PER_PURCHASE,
  capFor,
  stackacresCapacityMaterials,
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
  effectiveStackAcresCycle,
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
import { stackacresExchangeDay } from "@/lib/stackacres/exchange";
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
import { stackacresStockOwnableOutright, stackacresStockPrice } from "@/lib/stackacres/market";
import {
  STACKACRES_SECTORS,
  isSectorUnlocked,
  sectorClearCheck,
  sectorLabel,
  unlockedPlotCount,
  unlockedSectors,
  type SectorId,
} from "@/lib/stackacres/sectors";
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
  listStackAcresPipes,
  stackAcresPipeFromBatchRow,
  syncStackAcresPipeNetwork,
  type PipeDbRow,
  type StoredPipe,
} from "./stackacres-pipe-store";
import { readStackAcresBatch } from "./stackacres-read-batch";
import {
  createSoilMap,
  homeStarterSoilTiles,
  isHomePlotTile,
  nextFreeSoilSlot,
  planSoilGroupRelocation,
  soilSlotForTile,
  soilSlotOnTile,
  soilSlotTile,
  soilTileKey,
  soilTileRect,
  type SoilMap,
  type SoilTile,
  type SoilTileCoord,
} from "@/lib/stackacres/soil";
import { SOIL_DEFAULT_TIER } from "@/lib/stackacres/soil-tiers";
import { enrichedGrowthMultiplier, enrichesSoil, isSoilTileEnriched } from "@/lib/stackacres/soil-enrich";
import {
  listStackAcresSoilTiles,
  stackAcresSoilTileFromBatchRow,
  type SoilTileDbRow,
  type StoredSoilTile,
  placeStackAcresSoilTile as placeSoilTileRow,
  removeStackAcresSoilTile as removeSoilTileRow,
  setStackAcresSoilTileEnriched,
  moveStackAcresSoilTiles as moveSoilTileGroupRow,
} from "./stackacres-soil-store";
import {
  adjustStackAcresSeedStock,
  readStackAcresSeedStock,
  stackAcresSeedStockFromBatchRows,
} from "./stackacres-seed-store";
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
import type { StoryEvent } from "@/lib/stackacres/story/events";
import type { StoryItemId } from "@/lib/stackacres/story/items";
import {
  activeQuest,
  applyStoryEvent,
  applyTurnIn,
  meetTraveler,
  storyView,
  type StackAcresStoryView,
  type StoredStory,
} from "@/lib/stackacres/story/state";
import { TRAVELER_CATALOGUE, isTravelerId, type TravelerId } from "@/lib/stackacres/story/travelers";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  abandonStackAcresUnit,
  adjustStackAcresSecretLedger,
  readStackAcresSecretLedgerQty,
  adjustStackAcresCapacity,
  adjustStackAcresFeed,
  eatStackAcresFood as eatStackAcresFoodRow,
  readStackAcresEnergy,
  stackAcresEnergyFromBatchRow,
  writeStackAcresEnergy,
  type StoredStackAcresEnergy,
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
  retireStackAcresUnit,
  waterStackAcresUnit,
  createStackAcresContract,
  createStackAcresMachine,
  createStackAcresWheatPlot,
  createStackAcresVatManifest,
  collectStackAcresMachine,
  writeStackAcresSiloFeeds,
  writeStackAcresFarmKitchen,
  collectStackAcresVatManifest,
  collectStackAcresWheatPlot,
  listStackAcresAgingManifests,
  readStackAcresAgingManifest,
  fulfillStackAcresContract as settleStackAcresContract,
  listStackAcresMachines,
  listStackAcresWheatPlots,
  readStackAcresInfluence,
  readStackAcresInventory,
  readStackAcresOpenContract,
  readStackAcresLastContractPassDay,
  passStackAcresContract as passStoredContract,
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
  readStackAcresStory,
  writeStackAcresStory,
  turnInStackAcresStory,
  stackAcresUnitFromBatchRow,
  stackAcresFeedFromBatchRow,
  stackAcresWaterFromBatchRow,
  stackAcresCapacityFromBatchRows,
  stackAcresSectorsFromBatchRows,
  stackAcresUpkeepFromBatchRow,
  stackAcresMuseumFromBatchRows,
  stackAcresToolTierFromBatchRow,
  stackAcresInventoryFromBatchRows,
  stackAcresOpenContractFromBatchRow,
  stackAcresInfluenceFromBatchRow,
  stackAcresSecretLedgerQtyFromBatchRows,
  stackAcresGreenhouseFromBatchRow,
  stackAcresCropFieldsUnlockedFromBatchRow,
  stackAcresPrestigeFromBatchRow,
  stackAcresCuttersFromBatchRows,
  stackAcresStoryFromBatchRow,
  stackAcresDevotionFromBatchRow,
  stackAcresFriendshipFromBatchRows,
  wheatPlotFromRow,
  machineFromRow,
  vatManifestFromRow,
  getOrCreateStackAcresLandObstacle,
  listStackAcresLandObstacleStates,
  writeStackAcresLandObstacle,
  getOrCreateStackAcresWoodNode,
  writeStackAcresWoodNodeSwing,
  listStackAcresWoodNodeStates,
  getOrCreateStackAcresForageNode,
  writeStackAcresForagePick,
  listStackAcresForageNodeStates,
  type StoredForageNode,
  type StoredWoodNode,
  type StoredStackAcresUnit,
  type StoredContract,
  type StoredWheatPlot,
  type ContractDbRow,
  type UnitDbRow,
  type WheatPlotDbRow,
  type MachineDbRow,
  type VatManifestDbRow,
  type StoredMachine,
  type StoredDevotionRow,
  type StoredFriendshipRow,
  type StoredVatManifest,
  type StoredStoryRow,
} from "./stackacres-store";
import {
  prestigeGoldRemaining,
  type StackAcresPrestigeState,
  type StackAcresPrestigeView,
  type StackAcresPrestigeResetResult,
} from "@/lib/stackacres/prestige";
export type { StackAcresPrestigeView, StackAcresPrestigeResetResult } from "@/lib/stackacres/prestige";
import {
  claimStackAcresIntent,
  completeStackAcresIntent,
  releaseStackAcresIntent,
} from "./stackacres-intent-store";
import { bumpStackAcresRevision, readStackAcresRevision } from "./stackacres-revision-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";
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
import {
  MACHINE_ITEM_CATALOGUE,
  machineItemLabel,
  machineItemNoun,
  type MachineRawItem,
  type MaterialCost,
} from "@/lib/stackacres/machine-items";
import { FISHING_BAIT_ITEM, pickCaughtFish, type FishSpecies } from "@/lib/stackacres/fishing";
import {
  ENERGY_MAX,
  FISHING_CAST_ENERGY,
  FOOD_ENERGY,
  TOO_TIRED_TO_FISH,
  applyEnergyDelta,
  energyAt,
  isFoodItem,
  settleEnergy,
  type FoodItem,
  type StackAcresEnergyAnchor,
} from "@/lib/stackacres/energy";
import { isActiveStock } from "@/lib/stackacres/scope";
import { feedingToast, servingBonusEggs, shelfFeedOrder, type ServingSource } from "@/lib/stackacres/feeding";
import { planSiloFeeding, siloFeedsLeft, siloFeedsUsed } from "@/lib/stackacres/feed-silo";
import { isFarmKitchenRecipe, planFarmKitchen } from "@/lib/stackacres/farm-kitchen";
import { isSeedUnlocked, seedLockedMessage } from "@/lib/stackacres/seed-unlocks";
import { QUARRY_CATALOGUE, pickQuarry, type QuarrySpecies } from "@/lib/stackacres/hunting";
import { WOOD_NODE_IDS, isWoodNodeId, type WoodNodeId } from "@/lib/stackacres/tree-nodes";
import {
  CLEARABLE_SECTORS,
  LAND_OBSTACLES,
  LAND_SWING_ENERGY,
  TOO_TIRED_TO_CLEAR,
  demolishLandObstacle,
  demolitionPrice,
  freshLandObstacleState,
  landClearingProgress,
  landObstacle,
  isClearableSector,
  landObstacleSnapshot,
  swingAtLandObstacle,
  type LandObstacleSnapshot,
} from "@/lib/stackacres/land-clearing";
import { freshWoodNodeState, swingAtWoodNode, woodNodeSnapshot, type WoodNodeSnapshot } from "@/lib/stackacres/wood";
import {
  FORAGE_NODE_IDS,
  forageNodeSnapshot,
  freshForageNodeState,
  isForageNodeId,
  pickForageNode,
  type ForageNodeId,
  type ForageNodeSnapshot,
} from "@/lib/stackacres/forage";
import {
  isStoneNodeId,
  stoneNodeSnapshot,
  type StoneNodeId,
  type StoneNodeSnapshot,
  type SwingQuality,
} from "@/lib/stackacres/stone-nodes";
import { mineStoneNode, readAllStoneNodes } from "./stone-node-store";
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
  AGING_TIERS,
  CELLAR_AGING_TIERS,
  VAT_INPUT_ITEM,
  VAT_INPUT_QUANTITY,
  baseGoldValueForSeal,
  cellarBaseGoldValue,
  cellarSealQuantity,
  firstAgingTier,
  toVatContainer,
  vatTierForElapsed,
  agedGoldValue,
  type AgingTier,
  type CellarItem,
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
  synergyArchetypesFromOwned,
  unlockSynergyPerk,
} from "./stackacres-synergy-service";
import { stackAcresOwnedPerksFromBatchRows } from "./stackacres-synergy-store";
import {
  forgeEnchantment,
  forgeEnchantmentIdsFromOwned,
  forgedToolStatsFor,
  listOwnedForgeEnchantmentIds,
} from "./stackacres-forge-service";
import { stackAcresOwnedEnchantmentsFromBatchRows } from "./stackacres-forge-store";
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
  stackAcresCrossbreedInventoryFromBatchRows,
  stackAcresCrossbreedPlotFromBatchRow,
  type CrossbreedPlotDbRow,
} from "./stackacres-crossbreeding-store";
import {
  isInCrossbreedGrid,
  toCrossbreedPlotView,
  type CrossbreedBedView,
  type CrossbreedPlotView,
} from "@/lib/stackacres/crossbreeding";
import type { CrossbreedItem } from "@/lib/stackacres/crossbreed-items";
import {
  canFulfillContract,
  contractPassSpent,
  drawContract,
  type StackAcresContractRow,
} from "@/lib/stackacres/contracts";
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
  blueprintsViewFromStates,
  contributeToBlueprint,
  startBlueprintForProfile,
  type BlueprintView,
} from "./stackacres-blueprint-service";
import { stackAcresAllBlueprintsFromBatchRows } from "./stackacres-blueprint-store";
import {
  evaluateStackAcresShopLock,
  stackacresShopLockRefusal,
  type StackAcresShopLock,
  type StackAcresShopProgress,
} from "@/lib/stackacres/shop-locks";
import { applyInfluenceDiscount } from "@/lib/stackacres/influence-tiers";

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
 * to pay every collected unit's value directly. That is gone: `harvestStackAcres`
 * now always credits the shared processing inventory (./inventory.ts) -- the
 * same door wheat, flour, milk and wool already used -- and the only ways an
 * item there becomes Gold are `sellStackAcresItem` (any item, any time, at its
 * own sell price) and a fulfilled Town Contract (`fulfillStackAcresTownContract`,
 * a premium price for Flour/Cheese/Cloth specifically).
 *
 * StackAcres HAS NO CAP ON EARNING (2026-09-12, Kayo's call, reversing the flat
 * daily ceiling this comment used to defend). The more you play, the more it
 * pays; there is no daily bucket to fill and nothing here throttles how much
 * Gold a payer credits. See lib/stackacres/exchange.ts's header for the day
 * this changed and why the forage drone's price went up instead of keeping a
 * cap.
 *
 * THE GOLD PATHS:
 *
 *   * NINE SPEND. `expandStackAcresCapacity` buys a slot, `buyStackAcresStock`
 *     buys stock outright, `stockStackAcres` buys a cycle's seed,
 *     `buyStackAcresFeed` buys a shipment, `clearStackAcresUnit` pays a muck
 *     fee, `upgradeStackAcresTool` buys a rung of the equipment ladder,
 *     `buyStackAcresCutter` buys the Mower,
 *     `sowStackAcresWheat` buys wheat seed, `placeStackAcresMachine` buys a
 *     machine outright. All sinks. Land Maintenance (`netUpkeepFromPayout`)
 *     is a tenth, but it never moves Gold on its own -- see its own section
 *     below.
 *   * THREE PAY, uncapped: `sellStackAcresItem`, the baseline door from
 *     inventory to Gold; `fulfillStackAcresTownContract`, which trades
 *     processed goods for a premium in Gold and Town Influence; and
 *     `collectStackAcresVat`, the Fermenting Vat's own aged-Cheese payout
 *     (lib/stackacres/aging.ts). Nothing else here may credit Gold.
 *
 * THE CRITICAL HARVEST and THE PRESTIGE RESET VALVE both used to ride inside
 * the harvest's own Gold payout. Neither pays Gold any more, for the same
 * reason harvest itself does not:
 *
 *   * A crit (`critBonusQuantity`, lib/stackacres/equipment.ts) now adds bonus
 *     UNITS to a settled line, credited into the same inventory line as the
 *     rest of that line's produce -- extra Eggs, not extra Gold.
 *   * The Prestige Reset Valve's permanent multiplier moved to
 *     `sellStackAcresItem`, applied to the Gold a sale yields, before that
 *     Gold is reserved against the ceiling -- see lib/stackacres/prestige.ts's
 *     own header for why that ordering is load-bearing rather than cosmetic.
 *
 * Every refund goes through `refundGold` rather than calling
 * `creditGoldByProfile` directly, so that the credit function has exactly
 * FOUR call sites in this file: the refund helper, and the three payers
 * above. That is not a style preference -- it is what lets a test state the
 * real invariant ("Gold is credited only by a payer") instead of counting
 * call sites that grow with every new refund. A new direct
 * `creditGoldByProfile` outside those four is the change to stop over.
 *
 * LAND MAINTENANCE IS NETTED OFF A PAYOUT NOW (2026-09-12, Kayo's call),
 * not a standalone wallet debit -- it used to be assessed as a side effect of
 * every mutating action regardless of whether that action earned anything,
 * which meant a farm sitting on savings paid rent just for being watered.
 * `netUpkeepFromPayout` (see its own header) is called from inside each of
 * the three payers above, right before the SAME credit call that pays the
 * player -- it skims at most today's still-due fee off the top of THAT
 * credit rather than writing a second wallet debit, so the credit function's
 * four-call-site count above is untouched. A farm that never sells anything
 * simply never pays Land Maintenance; that is the intended trade of taxing
 * income instead of savings, not an oversight. Curve and reasoning for the
 * fee itself are unchanged in lib/stackacres/upkeep.ts.
 *
 * BOUNTIFUL HARVEST (mono-crop/crop-rotation sweep bonuses) IS RETIRED
 * OUTRIGHT, not relocated -- a sweep-composition bonus has no clean meaning
 * against "sum what was gathered into inventory," and re-deriving one for the
 * new model was explicitly out of scope for this pass. `lib/stackacres/bounty.ts`
 * is deleted.
 *
 * A StackAcres unit is a *guaranteed* win -- nothing here can lose your seed,
 * animals go hungry but never die -- with ONE narrow exception: a `spoils`
 * unit (the Hen Coop, see lib/stackacres/catalogue.ts) that is still hungry
 * at its own readyAt voids that one cycle's payout, by design, as the game's
 * one deliberate case of neglect costing more than time (`feedStackAcres`'s
 * own doc comment states the general rule this departs from). The animal
 * itself is never lost and every cycle after it is fed keeps paying in full,
 * so the ordering discipline every staked service restates still applies:
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

/** Refuses a StackAcres request in a way the player can act on. */
export class StackAcresRequestError extends ArcadeRequestError<StackAcresRoundSnapshot> {
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
  /** Energy as of this read, already settled for regen (lib/stackacres/
   *  energy.ts). The client runs `energyAt` on it to tick the HUD. */
  energy: StackAcresEnergyAnchor;
  /** Purchased extra capacity slots, by stock kind. */
  capacity: Partial<Record<StackAcresStock, number>>;
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
  /** Whether this player has ever donated each secret item to Ray -- see
   *  lib/stackacres/secrets.ts's own header for why a secret item is its own
   *  small registry rather than a member of `StackAcresItem`. */
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
  /** Seeds of each crop bought from Ray but not planted yet
   *  (`homestead_seed_stock`). A missing crop and 0 mean the same thing.
   *  Livestock is never a key here -- see SeedStock's own doc comment. */
  seedStock: SeedStock;
  /** The Pixel Pilgrim's devotion: this player's UTC-day prayer streak and
   *  progress up his relic ladder. See lib/stackacres/devotion.ts. */
  devotion: StackAcresDevotionView;
  /** NPC friendship: this player's gift points and claimed keepsake ladder
   *  with every NPC that has one (FRIENDSHIP_NPCS -- Ray, for
   *  now). A SEPARATE mechanic from `devotion` above -- see
   *  lib/stackacres/friendship.ts's own header. */
  friendship: Record<NpcId, StackAcresFriendshipView>;
  /** The Fermenting Vat: null until the player has placed one (see
   *  `machines`, kind `"vat"`), otherwise its current seal (if any) and what
   *  each tier of it is worth. See lib/stackacres/aging.ts. */
  vat: VatContainer | null;
  /** The Preserves Cellar (Chapter 5): null until placed, otherwise the jars
   *  aging inside it, on its own slower ladder. Same shape as `vat`. */
  cellar: VatContainer | null;
  /** The travelers' story (lib/stackacres/story/): every traveler's unlock,
   *  quest and readiness as this server derives it, and the story items
   *  held. The bubble renders straight off this; a tap never asks the
   *  server what to say. */
  story: StackAcresStoryView;
  /** Every choppable tree's current chop state (lib/stackacres/wood.ts,
   *  lib/stackacres/tree-nodes.ts): whether it can be chopped right now, how
   *  many swings are left in this cycle, and (while regrowing) how far along
   *  its respawn clock is. One entry per `WOOD_NODE_IDS`, always present --
   *  the same "every key present" posture `blueprints` above takes for a
   *  structure nobody has started. */
  woodNodes: WoodNodeSnapshot[];
  /** Every Stone boulder's current mine state (lib/stackacres/stone-nodes.ts):
   *  whether it can be mined right now, how many swings are left before it
   *  breaks, and (while regrowing) how far along its respawn clock is. Same
   *  "every key present" posture as `woodNodes` above -- one entry per
   *  `STONE_NODE_IDS`, global rather than per-profile (see
   *  lib/server/stone-node-store.ts's own header). */
  stoneNodes: StoneNodeSnapshot[];
  /** Every forageable bush's current state (lib/stackacres/forage.ts):
   *  whether it can be picked right now, WHICH SEED it is carrying, and
   *  (while regrowing) how far along its clock is. Same "every key present"
   *  posture as `woodNodes` above -- one entry per `FORAGE_NODE_IDS`. The
   *  crop is in the snapshot rather than only in the pick's answer so the
   *  client can name the seed before it is picked. */
  forageNodes: ForageNodeSnapshot[];
  /** What is still standing on the land being cleared
   *  (lib/stackacres/land-clearing.ts). One entry per obstacle on every
   *  sector that is taken by clearing it, down or not, so the map can draw
   *  the field and the sheet can count the job. */
  landObstacles: LandObstacleSnapshot[];
  /** How fresh this snapshot is, per lib/server/stackacres-revision-store.ts:
   *  strictly higher than any response for an action that finished earlier,
   *  regardless of which one this browser's fetch happens to see first. The
   *  client drops a response whose revision is not higher than the one
   *  already applied, so two actions in flight at once can never have the
   *  earlier-finishing one's stale response clobber the later one's. */
  revision: number;
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
 * The whole hydration picture for one farm: which working crops a water source
 * reaches right now. Today the only source is the pipe network.
 *
 * ONE PLACE, called by every site that needs it (`snapshots`, the view
 * builder, the pipe-removal before-shot and `recomputeIrrigation`), so a crop's
 * `isWatered` cannot disagree with itself depending on which action last
 * answered. A second water source is added here and nowhere else.
 */
function irrigationGridFor(
  rows: readonly StoredStackAcresUnit[],
  pipes: Parameters<typeof recalculatePipeConnections>[0]["tiles"],
  soil: SoilMap,
): NetworkGrid {
  return recalculatePipeConnections({ tiles: pipes, crops: irrigableCrops(rows, soil) });
}

/** Which of `rows` a water source reaches right now. Every readiness and
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

/** A crop just sown onto a bed a water source already reaches is
 *  watered from the start, so a null `lastWateredAt` only ever means seed
 *  nobody has watered. */
async function waterIrrigatedCrops(profileId: string, now: Date): Promise<void> {
  const rows = await listStackAcresUnits(profileId);
  await stampIrrigatedCrops(rows, await irrigatedUnitIdsFor(profileId, rows), now);
}

/** The full slot space for one farm: the free Homestead starter beds
 *  (`homeStarterSoilTiles`), never persisted, ahead of every tile it has
 *  bought. Both server callers that need to show the player their soil --
 *  the view's own `soilTiles` field and this function -- go through
 *  `mergedSoilTiles` so the two cannot disagree about what a farm can plant
 *  on. */
function mergedSoilTiles(purchased: readonly SoilTile[]): SoilTile[] {
  return [...homeStarterSoilTiles(), ...purchased];
}

function soilMapFor(purchased: readonly SoilTile[]): SoilMap {
  return createSoilMap(mergedSoilTiles(purchased));
}

function parseUnitId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StackAcresRequestError("Not a real unit.", 400);
  }
  return value;
}

/** What a refusal's `round` carries: the units, plus the revision this farm
 *  is at right now (a plain read -- a refusal changed nothing, so nothing is
 *  bumped here). See stackacres-revision-store.ts's own header for why the
 *  client needs this on a refusal too, not only on a success. */
interface StackAcresRoundSnapshot {
  units: StackAcresUnitSnapshot[];
  revision: number;
}

async function snapshots(profileId: string, now: Date): Promise<StackAcresRoundSnapshot> {
  const rows = await listStackAcresUnits(profileId);
  const [irrigatedUnitIds, revision] = await Promise.all([
    irrigatedUnitIdsFor(profileId, rows),
    readStackAcresRevision(profileId),
  ]);
  return { units: toStackAcresUnitSnapshots(rows, now, irrigatedUnitIds), revision };
}

/** Whether each secret item has ever been donated (see `readStackAcresMuseum`
 *  in stackacres-store.ts's own header for why that table's read/write pair
 *  outlived the produce-discovery feature it was originally built for).
 *  Total over `SecretItemId`, so a legacy or partial row never leaves an
 *  item undefined. */
function secretItemDonations(donated: readonly string[]): Record<SecretItemId, boolean> {
  return Object.fromEntries(
    SECRET_ITEM_IDS.map((itemId) => [itemId, donated.includes(itemId)]),
  ) as Record<SecretItemId, boolean>;
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

/**
 * `revision` is deliberately NOT one more entry in this function's own
 * per-profile fan-out below (see lib/server/stackacres-read-budget.test.ts's
 * own header on why that count is a tripwire, not a style rule) -- almost
 * every call site is one of the ~50 action functions ending `return
 * view(profile, now)`, and `runStackAcresAction` always overwrites whatever
 * this puts here with the real post-write value once the action actually
 * completes (see its own `bumped` helper). Paying for a read here that gets
 * thrown away on every one of those calls would be pure waste. The handful
 * of callers that DO need the true number today (`readStackAcres`'s plain
 * read, and `runStackAcresAction`'s replay/in-flight branches) fetch it
 * themselves, once, alongside this call -- see each of those, and
 * stackacres-revision-store.ts's own header.
 */
/**
 * The ~30-way per-profile fan-out below, batched into one Postgres round
 * trip when Supabase is configured (`stackacres_read_batch`, migration
 * 20260914000000) instead of ~30 separate PostgREST round trips -- see that
 * migration's own header for exactly which reads this covers and which
 * three it deliberately leaves as their own RPC calls. Memory mode has no
 * batch to speak of (there is no network round trip to save there in the
 * first place) and keeps running every one of the original individual reads,
 * unchanged -- this function's whole job is choosing between the two and
 * handing the SAME local variables to the rest of `view()` either way, so
 * everything below this point reads identically regardless of which branch
 * ran.
 */
async function view(profile: PlayerProfile, now: Date, revision = 0): Promise<StackAcresView> {
  const day = stackacresExchangeDay(now);
  const supabase = adminClient();

  // Three reads never come from the batch (they're already their own
  // aggregate/idle-sweep RPCs, not a plain per-table select -- see the
  // migration's header), so they're kicked off up front alongside the batch
  // fetch, and nothing here waits on anything else. Drones ARE in the batch
  // (its own `drones` key) -- the fifth slot below only exists for the
  // memory-mode fallback's own per-table reads (which include their own
  // `listDrones` call, last in that array); when a batch is available this
  // slot does nothing; `listDrones` must never be called a second time here,
  // or every live-Supabase view() pays for a real, wasted extra round trip
  // whose result nothing reads.
  const [
    batch,
    activeSynergies,
    lifetimeGross,
    woodNodeStates,
    stoneNodeRows,
    forageNodeStates,
    landObstacleStates,
    fallback,
  ] = await Promise.all([
    supabase ? readStackAcresBatch(profile.id, day) : Promise.resolve(null),
    listActiveSynergyArchetypes(profile.id),
    readStackAcresLifetimeGross(profile.id),
    // Not part of the big batch RPC (see this file's own header on why the
    // three reads above aren't either) -- a small, fixed-size table read
    // (four rows at most; see WOOD_NODE_IDS) run alongside everything else
    // rather than folded into `read_homestead_batch`, so shipping Wood's
    // first slice never touches that migration.
    listStackAcresWoodNodeStates(profile.id),
    // Same posture for Stone's three GLOBAL boulders (not per-profile; see
    // lib/server/stone-node-store.ts's own header) -- read alongside
    // everything else here rather than folded into the batch RPC.
    readAllStoneNodes(now),
    // And the same again for the four forage bushes: a fixed-size table read
    // (see FORAGE_NODE_IDS) run alongside the rest rather than folded into
    // `read_homestead_batch`.
    listStackAcresForageNodeStates(profile.id),
    // Same again for what is still standing on land being cleared
    // (lib/stackacres/land-clearing.ts): only obstacles this farm has swung
    // at have rows, so a farm that never walked onto the Fold reads none.
    listStackAcresLandObstacleStates(profile.id),
    supabase
      ? Promise.resolve(null)
      : Promise.all([
          listStackAcresUnits(profile.id),
          readStackAcresFeed(profile.id),
          readStackAcresWater(profile.id),
          readStackAcresCapacity(profile.id),
          readStackAcresSectors(profile.id),
          readStackAcresUpkeep(profile.id, day),
          readStackAcresMuseum(profile.id),
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
          readStackAcresGreenhouse(profile.id),
          readStackAcresCropFieldsUnlocked(profile.id),
          blueprintsView(profile.id),
          readStackAcresPrestige(profile.id),
          listOwnedForgeEnchantmentIds(profile.id),
          listStackAcresCrossbreedPlots(profile.id),
          readStackAcresCrossbreedInventory(profile.id),
          listStackAcresPipes(profile.id),
          listStackAcresSoilTiles(profile.id),
          readStackAcresSeedStock(profile.id),
          readStackAcresDevotion(profile.id),
          // Nested Promise.all for the same reason SECRET_ITEM_IDS's own read
          // above is: FRIENDSHIP_NPCS is variable-length, and spreading it into
          // this array literal would widen every sibling element's inferred type.
          Promise.all(FRIENDSHIP_NPCS.map((npc) => readStackAcresFriendship(profile.id, npc))),
          listStackAcresAgingManifests(profile.id),
          readStackAcresCutters(profile.id),
          readStackAcresStory(profile.id),
          readStackAcresEnergy(profile.id),
        ] as const),
  ]);

  let rows: StoredStackAcresUnit[];
  let feed: number;
  let water: number;
  let capacity: Partial<Record<StackAcresStock, number>>;
  let cleared: SectorId[];
  let upkeepPaid: number;
  let donated: string[];
  let tool: StackAcresToolTier;
  let wheatRows: StoredWheatPlot[];
  let machineRows: StoredMachine[];
  let inventory: StackAcresInventory;
  let contract: StoredContract | null;
  let influence: number;
  let boostArmedQty: number;
  let heldQtys: number[];
  let unlockedSynergies: SynergyArchetype[];
  let greenhouseBuilt: boolean;
  let cropFieldsUnlocked: boolean;
  let blueprints: Record<BlueprintId, BlueprintView>;
  let prestige: StackAcresPrestigeState;
  let forgedEnchantments: string[];
  let crossbreedPlots: StoredCrossbreedPlot[];
  let crossbreedInventory: Partial<Record<CrossbreedItem, number>>;
  let pipeRows: StoredPipe[];
  let soilTiles: StoredSoilTile[];
  let seedStock: SeedStock;
  let storedDevotion: StoredDevotionRow;
  let storedFriendships: StoredFriendshipRow[];
  let agingManifests: StoredVatManifest[];
  let cutters: StackAcresCutter[];
  let storedStory: StoredStoryRow;
  let storedEnergy: StoredStackAcresEnergy | null;

  if (batch) {
    rows = (batch.units as unknown as UnitDbRow[]).map(stackAcresUnitFromBatchRow);
    feed = stackAcresFeedFromBatchRow(batch.feed as { servings: number | string } | null);
    water = stackAcresWaterFromBatchRow(batch.water as { level: number | string } | null);
    capacity = stackAcresCapacityFromBatchRows(batch.capacity as { stock: string; extra_slots: number | string }[]);
    cleared = stackAcresSectorsFromBatchRows(batch.sectors as { sector: string }[]);
    upkeepPaid = stackAcresUpkeepFromBatchRow(batch.upkeep as { bushels: number | string } | null);
    donated = stackAcresMuseumFromBatchRows(batch.museum as { item_id: string }[]);
    tool = stackAcresToolTierFromBatchRow(batch.tool as { tier?: unknown } | null);
    wheatRows = (batch.wheat_plots as unknown as WheatPlotDbRow[]).map(wheatPlotFromRow);
    machineRows = (batch.machines as unknown as MachineDbRow[]).map(machineFromRow);
    inventory = stackAcresInventoryFromBatchRows(batch.inventory as { item: string; quantity: number | string }[]);
    contract = stackAcresOpenContractFromBatchRow(batch.contract as ContractDbRow | null);
    influence = stackAcresInfluenceFromBatchRow(batch.influence as { influence: number | string } | null);
    const secretLedgerRows = batch.secret_ledger as { item_id: string; quantity: number | string }[];
    boostArmedQty = stackAcresSecretLedgerQtyFromBatchRows(secretLedgerRows, STACKACRES_DICE_BOOST_ARMED_KEY);
    heldQtys = SECRET_ITEM_IDS.map((itemId) => stackAcresSecretLedgerQtyFromBatchRows(secretLedgerRows, itemId));
    unlockedSynergies = synergyArchetypesFromOwned(
      stackAcresOwnedPerksFromBatchRows(batch.perk_unlocks as { item_id: string; quantity: number | string }[]),
    );
    greenhouseBuilt = stackAcresGreenhouseFromBatchRow(batch.greenhouse);
    cropFieldsUnlocked = stackAcresCropFieldsUnlockedFromBatchRow(batch.crop_fields);
    blueprints = blueprintsViewFromStates(
      stackAcresAllBlueprintsFromBatchRows(
        batch.blueprints as { structure_id: string; current_stage: number | string; status: string; completed_at: string | null }[],
        batch.blueprint_progress as { structure_id: string; stage_index: number | string; item: string; contributed: number | string }[],
      ),
    );
    prestige = stackAcresPrestigeFromBatchRow(
      batch.prestige as { prestige_count: number | string; multiplier: number | string; lifetime_gross_at_reset: number | string } | null,
    );
    forgedEnchantments = forgeEnchantmentIdsFromOwned(
      stackAcresOwnedEnchantmentsFromBatchRows(batch.tool_enchantments as { item_id: string; quantity: number | string }[]),
    );
    crossbreedPlots = (batch.crossbreed_plots as unknown as CrossbreedPlotDbRow[]).map(stackAcresCrossbreedPlotFromBatchRow);
    crossbreedInventory = stackAcresCrossbreedInventoryFromBatchRows(
      batch.crossbreed_inventory as { item: string; quantity: number | string }[],
    );
    pipeRows = (batch.pipes as unknown as PipeDbRow[]).map(stackAcresPipeFromBatchRow);
    soilTiles = (batch.soil_tiles as unknown as SoilTileDbRow[]).map(stackAcresSoilTileFromBatchRow);
    seedStock = stackAcresSeedStockFromBatchRows(batch.seed_stock as { crop: string; quantity: number | string }[]);
    storedDevotion = stackAcresDevotionFromBatchRow(
      batch.devotion as { streak: number | string; last_prayed_day: string | null; claimed_rungs: number[] | null } | null,
    );
    const friendshipRows = batch.friendship as {
      npc: string;
      points: number | string;
      last_gifted_day: string | null;
      claimed_rungs: number[] | null;
    }[];
    storedFriendships = FRIENDSHIP_NPCS.map((npc) => stackAcresFriendshipFromBatchRows(friendshipRows, npc));
    agingManifests = (batch.aging_manifests as unknown as VatManifestDbRow[]).map(vatManifestFromRow);
    cutters = stackAcresCuttersFromBatchRows(batch.cutters as { cutter: unknown }[]);
    storedStory = stackAcresStoryFromBatchRow(batch.story as { story: StoredStory; version: number | string } | null);
    storedEnergy = stackAcresEnergyFromBatchRow(
      (batch.energy ?? null) as { level: number | string; updated_at: string; version: number | string } | null,
    );
  } else {
    [
      rows,
      feed,
      water,
      capacity,
      cleared,
      upkeepPaid,
      donated,
      tool,
      wheatRows,
      machineRows,
      inventory,
      contract,
      influence,
      boostArmedQty,
      heldQtys,
      unlockedSynergies,
      greenhouseBuilt,
      cropFieldsUnlocked,
      blueprints,
      prestige,
      forgedEnchantments,
      crossbreedPlots,
      crossbreedInventory,
      pipeRows,
      soilTiles,
      seedStock,
      storedDevotion,
      storedFriendships,
      agingManifests,
      cutters,
      storedStory,
      storedEnergy,
    ] = fallback as [
      StoredStackAcresUnit[], number, number, Partial<Record<StackAcresStock, number>>, SectorId[], number,
      string[], StackAcresToolTier, StoredWheatPlot[], StoredMachine[], StackAcresInventory, StoredContract | null,
      number, number, number[], SynergyArchetype[], boolean, boolean, Record<BlueprintId, BlueprintView>,
      StackAcresPrestigeState, string[], StoredCrossbreedPlot[], Partial<Record<CrossbreedItem, number>>,
      StoredPipe[], StoredSoilTile[], SeedStock, StoredDevotionRow, StoredFriendshipRow[],
      StoredVatManifest[], StackAcresCutter[], StoredStoryRow,
      StoredStackAcresEnergy | null,
    ];
  }

  const secretDonations = secretItemDonations(donated);
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
  const agingContainer = (kind: "vat" | "cellar", tiers: readonly AgingTier[]): VatContainer | null => {
    const machine = machineRows.find((candidate) => candidate.kind === kind);
    if (!machine) return null;
    const manifest = agingManifests.find((candidate) => candidate.machineId === machine.id) ?? null;
    return toVatContainer(machine, manifest, now, tiers);
  };
  const vat = agingContainer("vat", AGING_TIERS);
  const cellar = agingContainer("cellar", CELLAR_AGING_TIERS);
  const settledEnergy = settleEnergy(storedEnergy, now);
  return {
    units,
    profile,
    feed,
    water,
    energy: settledEnergy,
    capacity,
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
    soilTiles: mergedSoilTiles(soilTiles),
    seedStock,
    devotion: devotionView(storedDevotion, now),
    friendship,
    vat,
    cellar,
    // Off the same derived `sectors`, influence and flags Ray's shop locks
    // read (see readShopProgress), so a traveler's "Requires: ..." and the
    // shelf's can never disagree.
    story: storyView(storedStory.story, { sectors, influence, greenhouseBuilt, cropFieldsUnlocked }, inventory, {
      tool,
      sectorsCleared: cleared.length,
      soilBeds: soilTiles.length,
      enchantments: forgedEnchantments.length,
      crossbreeds: Object.values(crossbreedInventory).reduce((sum, n) => sum + (n ?? 0), 0),
    }),
    woodNodes: WOOD_NODE_IDS.map((id) => woodNodeSnapshot(id, woodNodeStates[id] ?? freshWoodNodeState(), now)),
    stoneNodes: stoneNodeRows.map((row) => stoneNodeSnapshot(row, now)),
    forageNodes: FORAGE_NODE_IDS.map((id) =>
      forageNodeSnapshot(id, forageNodeStates[id] ?? freshForageNodeState(), now),
    ),
    landObstacles: CLEARABLE_SECTORS.flatMap((sector) =>
      LAND_OBSTACLES[sector].map((obstacle) =>
        landObstacleSnapshot(obstacle, landObstacleStates[obstacle.id] ?? freshLandObstacleState(obstacle.kind)),
      ),
    ),
    revision,
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
 * The slot this returns is the chosen bed's own `order` (see `soilSlotTile`
 * in lib/stackacres/soil.ts), which is what makes it mean the same bed on
 * both sides of the wire and go on meaning it after other beds are bought
 * or removed.
 */
async function assignSoilSlot(
  profileId: string,
  stock: StackAcresStock,
  inGreenhouse: boolean,
  tile: SoilTileCoord | null = null,
): Promise<{ slot: number | null; growthMultiplier: number; enriched: boolean }> {
  const plain = { slot: null, growthMultiplier: 1, enriched: false };
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

  const enriched = isSoilTileEnriched(tileRow);
  return {
    slot,
    growthMultiplier: enrichedGrowthMultiplier(enriched),
    enriched,
  };
}

/** The machine kinds this player has built, for the seed locks
 *  (lib/stackacres/seed-unlocks.ts). */
async function builtMachineKinds(profileId: string): Promise<Set<MachineKind>> {
  return new Set((await listStackAcresMachines(profileId)).map((machine) => machine.kind));
}

/** Spends a bed's enrichment once a crop has actually been sown on it.
 *  Never throws: the crop is already planted, and a failed flag write must
 *  not undo that or hand the seed back. At worst the bed stays enriched. */
async function spendSoilEnrichment(profileId: string, slot: number | null, enriched: boolean): Promise<void> {
  if (!enriched || slot === null) return;
  await setStackAcresSoilTileEnriched(profileId, slot, false).catch((error: unknown) => {
    console.error("stackacres.soil_enrich_spend_failed", { profileId, slot, error });
  });
}

/** Marks a bed enriched after a bean harvest. Never throws: the harvest has
 *  already settled and must still be credited if this write fails. */
async function markSoilEnriched(profileId: string, slot: number): Promise<void> {
  await setStackAcresSoilTileEnriched(profileId, slot, true).catch((error: unknown) => {
    console.error("stackacres.soil_enrich_mark_failed", { profileId, slot, error });
  });
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
  /** Set by `workStackAcresLand`/`demolishStackAcresLand` to what THIS blow
   *  did: what it paid, whether the obstacle came down, and whether that was
   *  the last one standing on the sector. Null when the blow found nothing
   *  left to hit. */
  landCleared?: {
    obstacleId: string;
    sector: SectorId;
    item: MachineRawItem | null;
    quantity: number;
    cleared: boolean;
    sectorOpened: boolean;
  } | null;
  /** Set by `catchStackAcresFish` to which fish THIS cast landed -- every
   *  other action leaves this undefined. */
  fishCaught?: { species: FishSpecies };
  /** Set by `feedStackAcres`/`feedStackAcresPen` when a serving earned extra
   *  eggs (Spinach), with the line to show. Absent on a plain feeding. */
  fed?: { toast: string };
  /** Set by `bagStackAcresQuarry` to what THIS stalk brought back -- every
   *  other action leaves this undefined. The scope never learns this until
   *  it lands, which is the whole point: it plays a difficulty, not a prize. */
  quarryBagged?: { species: QuarrySpecies; meat: number; pelt: number };
  /** Set by `chopStackAcresWoodTree` to what THIS swing did -- null when the
   *  swing missed its tree entirely (already felled by a faster request),
   *  every other action leaves this undefined. `felled` is true only on the
   *  swing that actually brought the tree down. */
  woodChopped?: { nodeId: WoodNodeId; quantity: number; felled: boolean } | null;
  /** Set by `mineStackAcresStoneNode` to what THIS swing just did -- every
   *  other action leaves this undefined. `landed: false` means the node was
   *  already broken and had not yet regrown, so nothing was mined. */
  stoneMined?: { landed: boolean; broke: boolean; amount: number };
  /** Set by `gatherStackAcresForage` to what THIS pick took -- null when the
   *  bush was bare (picked by a faster request), and undefined for every
   *  other action. */
  foraged?: { nodeId: ForageNodeId; crop: StackAcresCrop; quantity: number } | null;
  /** Set by `meetStackAcresTraveler`/`turnInStackAcresTravelerQuest` to what
   *  THIS call just did -- never named `story`, which is StackAcresView's
   *  own always-present standing and would collide with it in this
   *  intersection. `granted` names the keepsake only on the turn-in that
   *  finished a traveler's whole line, and only the first time. */
  storyResult?: {
    traveler: TravelerId;
    outcome: "met" | "already-met" | "advanced" | "completed";
    granted: StoryItemId | null;
  };
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
  if (result.prestigeReset !== undefined) delta.prestigeReset = result.prestigeReset;
  if (result.forgeResult !== undefined) delta.forgeResult = result.forgeResult;
  if (result.crossbreedResult !== undefined) delta.crossbreedResult = result.crossbreedResult;
  if (result.prayer !== undefined) delta.prayer = result.prayer;
  if (result.gift !== undefined) delta.gift = result.gift;
  if (result.vatCollected !== undefined) delta.vatCollected = result.vatCollected;
  if (result.fishCaught !== undefined) delta.fishCaught = result.fishCaught;
  if (result.fed !== undefined) delta.fed = result.fed;
  if (result.storyResult !== undefined) delta.storyResult = result.storyResult;
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
  const profile = await ensureProfile(token);

  // Bumped once the write is confirmed, overriding the placeholder `run()`'s
  // own `view()` call left in `result.revision` (view() never reads the real
  // number itself -- see its own header on why). Best-effort: a bump that
  // fails falls back to that placeholder rather than fail an action that
  // already landed -- see stackacres-revision-store.ts's own header. A
  // failure here must never reach the catch below, which would release the
  // intent and let a retry replay a mutation that already succeeded.
  const bumped = async (result: StackAcresActionResult): Promise<StackAcresActionResult> => {
    const revision = await bumpStackAcresRevision(profile.id).catch((error) => {
      console.error("stackacres.revision_bump_failed", { profileId: profile.id, error });
      return result.revision;
    });
    return { ...result, revision };
  };

  if (!key) return bumped(await run());

  const claim = await claimStackAcresIntent(profile.id, key, action, now.getTime());
  if (claim.kind === "replay") {
    // Revision read BEFORE the view, not alongside it in a Promise.all: the
    // twin that actually wrote can bump the counter in the gap between two
    // concurrent reads, and whichever order they land in, `acceptRevision`
    // on the client trusts the number completely. Reading it second could
    // pair a just-bumped (fresher) number with a view snapshot taken a moment
    // earlier -- fresher revision, staler data -- which the client accepts as
    // the new truth and paints, flashing the farm back a step before the
    // real answer (already in flight) catches up. Reading it first can only
    // pair a number with data at least that fresh, never staler.
    const revision = await readStackAcresRevision(profile.id);
    const result = await view(profile, now);
    return { ...result, ...(claim.result ?? {}), revision };
  }
  if (claim.kind === "in-flight") {
    // Same ordering, same reason -- see the "replay" branch just above.
    const revision = await readStackAcresRevision(profile.id);
    const result = await view(profile, now);
    return { ...result, revision };
  }

  try {
    const result = await bumped(await run());
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
  const profile = await ensureProfile(token);
  // Run alongside view()'s own fan-out rather than ahead of it -- one more
  // parallel round trip on the one call site that genuinely needs the true
  // number, not one more link in a chain.
  const [result, revision] = await Promise.all([view(profile, now), readStackAcresRevision(profile.id)]);
  return { ...result, revision };
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
 * IT USED TO CHARGE, and `landGate` then refused to let an unpaid farm grow --
 * that was the Bushel version. StackAcres has been through two designs since:
 * a standalone daily wallet debit (nothing here to gate, since a debit that
 * can't reach the balance just doesn't collect), and now (2026-09-12,
 * `netUpkeepFromPayout` in this file) a fee netted off whichever action next
 * pays the player Gold. Neither of the last two ever needed a gate: a debit
 * or a skim that clamps at zero, rather than going into debt, has nothing for
 * a gate to protect and no arrears to chase.
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
 * Land Maintenance: skims today's still-due fee off a Gold payout, right
 * before the SAME credit that pays the player -- called from inside each of
 * the three payers (`sellStackAcresItem`, `fulfillStackAcresTownContract`,
 * `collectStackAcresVat`), never on its own.
 *
 * CHANGED 2026-09-12 (Kayo's call), from a standalone wallet debit that ran
 * as a side effect of every mutating action, whether or not that action
 * earned anything -- a farm sitting on savings paid rent just for being
 * watered. Now the bill only ever comes out of Gold the player is actively
 * being paid: a farm that never sells anything simply never pays it, which
 * is the intended trade of taxing income rather than savings.
 *
 * Clamped at `grossGold`, never more: a payout can never be taxed into a
 * negative. Whatever today's bill this payout can't cover is not chased
 * from a second wallet write -- it is simply still due, exactly as it would
 * be on a day nothing sold at all. `stackacresUpkeepDue` never carries a
 * shortfall past the UTC day it was billed (lib/stackacres/upkeep.ts's own
 * header), so there is nothing here to carry either.
 *
 * BEST-EFFORT against a race, the same posture `raiseStackAcresUpkeep`
 * always took: if a concurrent payout already raised today's paid total
 * past what this call computed, this one treats the bill as already
 * covered rather than double-charging or retrying.
 *
 * NEVER THROWS. The caller is mid-payout when this runs, and a maintenance
 * hiccup must not turn a payout that already earned its Gold into an error
 * response -- the same posture every other best-effort side-write in this
 * file takes. Falls back to paying the full gross on any failure.
 */
async function netUpkeepFromPayout(profileId: string, now: Date, grossGold: number): Promise<number> {
  if (grossGold <= 0) return grossGold;
  try {
    const day = stackacresUpkeepDay(now);
    const [upkeepPaid, { sectors }, capacity, cropFieldsUnlocked] = await Promise.all([
      readStackAcresUpkeep(profileId, day),
      readLand(profileId),
      readStackAcresCapacity(profileId),
      readStackAcresCropFieldsUnlocked(profileId),
    ]);
    const due = stackacresUpkeepDue(unlockedPlotCount(sectors, capacity, cropFieldsUnlocked), upkeepPaid);
    if (due <= 0) return grossGold;

    const skimmed = Math.min(due, grossGold);
    const raised = await raiseStackAcresUpkeep(profileId, day, upkeepPaid + skimmed);
    return raised ? grossGold - skimmed : grossGold;
  } catch (error) {
    console.error("stackacres.upkeep_net_failed", { profileId, error });
    return grossGold;
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
  // Rule 1: every stake leaves before the slot exists, materials first and
  // Gold second. A pen slot is the ONE repeatable material cost in the game
  // (nine of them across the three kinds), which is what keeps the trees
  // worth chopping after the Mill and the Loom are up -- see
  // STACKACRES_CAPACITY_MATERIALS for why it is timber and never stone.
  const { refund: refundMaterials } = await spendStackAcresMaterials(
    profile.id,
    stackacresCapacityMaterials(stock),
    now,
    (material) =>
      `Another ${def.label} slot needs ${material.quantity.toLocaleString()} ${machineItemNoun(material.item, material.quantity)}.`,
  );

  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    await refundMaterials();
    throw new StackAcresRequestError(`Expanding ${def.label} capacity costs ${price.toLocaleString()} Gold.`, 400);
  }

  const next = await adjustStackAcresCapacity(profile.id, stock, 1);
  if (next === null) {
    // Lost the race against the DB's own 0..3 bound (another tab expanded
    // this same kind between the read above and now): refund.
    await refundGold(profile.id, price);
    await refundMaterials();
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
  await recordStoryEvents(profile.id, [{ kind: "enchantment-forged" }]);
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

  // The zone livestock lives in has to be cleared, and a crop cell still
  // wants the Crop Fields milestone -- which is now "this farm has broken
  // ground out there", not "this farm bought the land".
  const land = await readLand(profile.id);
  requireOpenSector(land.sectors, stockZone(stock), `${def.label}s`);
  if (!isLivestock(stock) && !(await readStackAcresCropFieldsUnlocked(profile.id))) {
    throw new StackAcresRequestError(
      "Break some ground in the Crop Fields before the bed will take a crop.",
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
  if (settled.hybridItem !== null) {
    await recordStoryEvents(profile.id, [{ kind: "crossbreed-harvested", item: settled.hybridItem }]);
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
  if (!stackacresStockOwnableOutright(stock)) {
    throw new StackAcresRequestError(`${def.label} is sown from seed, never bought outright.`, 400);
  }
  const price = stackacresStockPrice(stock);
  const profile = await ensureProfile(token);
  if (isStackAcresCrop(stock)) {
    const built = await builtMachineKinds(profile.id);
    if (!isSeedUnlocked(stock, built)) {
      throw new StackAcresRequestError(seedLockedMessage(stock, built), 409);
    }
  }

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

  await spendSoilEnrichment(profile.id, soilAssignment.slot, soilAssignment.enriched);
  // A water source under the new crop waters it from the start.
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
  // header). There is no second gate behind it any more: the Crop Fields
  // stopped being land you buy and became land you break yourself
  // (`placeStackAcresSoilTile`), so the only thing a crop out there needs is
  // a bed to go in, and a bed out there is itself the proof the ground was
  // cleared.

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
      // `ENRICHED_GROWTH_MULTIPLIER` cannot reach back and change
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

  await spendSoilEnrichment(profile.id, soilAssignment.slot, soilAssignment.enriched);
  // A water source under the new crop waters it from the start.
  await waterIrrigatedCrops(profile.id, now);
  return view(debited, now);
}

/**
 * Sows the same crop across a whole contiguous block of bare, same-tier beds
 * at once instead of one at a time -- the planting equivalent of
 * `waterStackAcresGroup` below. What dropping a Crop Fields gel-dock seed
 * token on a bare bed that's part of a >=2x2 block sends (`plantableTileGroup`,
 * lib/stackacres/soil.ts); a lone bed still goes through `stockStackAcres`
 * above, unchanged.
 *
 * Crops only -- livestock and the Greenhouse have no open bed lattice to
 * group over, and crops are the one stock kind with no cap to race
 * (STACKACRES_BASE_CAP is livestock-only), so this skips both the cap check
 * and the Greenhouse branch `stockStackAcres` still carries.
 *
 * Every named tile is planted only if it is STILL a real, unoccupied bed
 * right now -- same trust posture `waterStackAcresGroup` takes toward its own
 * unit-id list. Unlike a single sow, a tile that lost the race for its own
 * exact slot is skipped rather than retried onto some OTHER free bed
 * elsewhere on the farm: scattering one of a dozen requested crops off to a
 * random tile far outside the block the player just dragged over would read
 * as a bug, not a courtesy. Running out of seed partway stops the batch
 * early (same as the watering can running dry); planting nowhere at all,
 * because every tile in the block filled in the meantime, is the only real
 * refusal.
 */
export async function stockStackAcresGroup(
  token: string,
  input: { stock: string; tiles: readonly SoilTileCoord[] },
  now = new Date(),
): Promise<StackAcresView> {
  if (!isStackAcresStock(input.stock) || !isStackAcresCrop(input.stock)) {
    throw new StackAcresRequestError("Not a real crop.", 400);
  }
  const stock: StackAcresCrop = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const produce = STACKACRES_YIELDS[stock];
  const profile = await ensureProfile(token);

  const land = await readLand(profile.id);
  const zone = stockZone(stock);
  requireOpenSector(land.sectors, zone, `${def.label}s`);
  // No Crop Fields gate here either -- see `stockStackAcres`. A row of beds
  // is a row of ground this farm already broke.

  const [purchased, units] = await Promise.all([
    listStackAcresSoilTiles(profile.id),
    listStackAcresUnits(profile.id),
  ]);
  const soil = soilMapFor(purchased);
  const takenSlots = new Set(
    units.map((unit) => unit.soilSlot).filter((slot): slot is number => slot !== null),
  );

  let plantedCount = 0;
  const seenTiles = new Set<string>();
  for (const tile of input.tiles) {
    // A client sending the same tile twice (or a group larger than what its
    // own flood fill actually found) must not cost two seeds for one bed.
    const tileKey = soilTileKey(tile.tx, tile.ty);
    if (seenTiles.has(tileKey)) continue;
    seenTiles.add(tileKey);

    const slot = soilSlotForTile(soil, tile.tx, tile.ty);
    if (slot === null || takenSlots.has(slot)) continue;

    const heldSeeds = await adjustStackAcresSeedStock(profile.id, stock, -1);
    if (heldSeeds === null) break;

    const tileRow = soilSlotTile(soil, slot);
    const enriched = tileRow ? isSoilTileEnriched(tileRow) : false;
    const growthMultiplier = enrichedGrowthMultiplier(enriched);
    const durationMs = Math.round(def.durationMs * growthMultiplier);

    try {
      await createStackAcresUnit(profile.id, {
        stock,
        stake: def.seedCost,
        yieldQuantity: produce.quantity,
        startedAt: now,
        readyAt: new Date(now.getTime() + durationMs),
        lastFedAt: null,
        lastWateredAt: null,
        permanent: false,
        housedIn: null,
        soilSlot: slot,
      });
      takenSlots.add(slot);
      plantedCount += 1;
      await spendSoilEnrichment(profile.id, slot, enriched);
    } catch (error) {
      await adjustStackAcresSeedStock(profile.id, stock, 1).catch(() => null);
      if (!(error instanceof SoilSlotConflictError)) {
        // An unexpected DB error, not just a lost race for this one bed --
        // stop rather than keep hammering it, but keep whatever already
        // landed (same posture `waterStackAcresGroup` takes on its own
        // mid-batch throw).
        if (plantedCount === 0) throw error;
        break;
      }
      // Lost the race for this exact tile to something else -- move on
      // rather than retry it onto a different bed (see this function's own
      // header on why).
    }
  }

  if (plantedCount === 0) {
    throw new StackAcresRequestError(
      `${def.label}'s bed just filled. Try tapping bare ground again.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  await waterIrrigatedCrops(profile.id, now);
  return view(profile, now);
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
 * Bulk, same as `buyStackAcresSeed`: a `quantity` up to
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

  await recordStoryEvents(profile.id, [{ kind: "feed-bought", servings: item.servings * quantity }]);
  return view(debited, now);
}

/**
 * What feeding a unit right now pushes its readyAt to, and whether that write
 * also needs to catch the row's startedAt up to a fast-forwarded spoil cycle.
 * Shared by `feedStackAcres` and `feedStackAcresPen` so both feeding paths
 * compute this exactly the same way.
 *
 * Seeded from `effectiveStackAcresCycle` rather than the row's raw fields, so
 * a `spoils` unit (the Hen Coop) that spoiled one or more cycles unfed feeds
 * its CURRENT, already-voided-through cycle -- never the stale one -- and
 * `newStartedAt` comes back non-null only when there was a cycle to catch up,
 * which is exactly when the write needs to persist it. For every other row
 * `effectiveStackAcresCycle` is the identity, so this is byte-for-byte the
 * same push it always computed.
 */
function feedPushFor(unit: StoredStackAcresUnit, now: Date): { pushed: Date; newStartedAt: Date | null } {
  const effective = effectiveStackAcresCycle(unit, now);
  const hungryAt = hungryAtFor({ stock: unit.stock, lastFedAt: effective.lastFedAt });
  const hungrySince = hungryAt ? Date.parse(hungryAt) : NaN;
  const starvedMs = Number.isFinite(hungrySince) ? Math.max(0, now.getTime() - hungrySince) : 0;
  const readyAt = Date.parse(effective.readyAt);
  const pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + starvedMs);
  const newStartedAt = effective.startedAt === unit.startedAt ? null : new Date(effective.startedAt);
  return { pushed, newStartedAt };
}

/**
 * Feeds a hungry animal, spending one serving.
 *
 * A hungry unit's clock is frozen, and this is where that is actually made
 * true: ready_at moves forward by however long the animal spent waiting, so
 * the time it was neglected is not silently credited as work. The yield is
 * untouched -- neglect costs you time, never Gold.
 *
 * THE ONE EXCEPTION: a `spoils` unit (the Hen Coop) that is still hungry at
 * its own readyAt voids that cycle instead of freezing it -- see `spoils` in
 * lib/stackacres/catalogue.ts. `feedPushFor` already fast-forwards past any
 * such voided cycles, and this is also where that catch-up gets written back
 * to the row, so the stored clock does not stay stale after the player who
 * fed it moves on.
 */
/**
 * Spends one serving for `stock`: a hen or cattle eats off the shelf first,
 * in its own order (`shelfFeedOrder`: Spinach, Wheat, Lettuce, Cabbage for a
 * hen, Cattle Feed for cattle), and falls back to the bought Feed Sack, so it
 * is always feedable. Everything else eats from the Feed Sack as before. Returns where the serving came from, or null when
 * there was none. See `planServings` in lib/stackacres/feeding.ts, the same
 * rule the client predicts with.
 */
async function spendServing(profileId: string, stock: StackAcresStock): Promise<ServingSource | null> {
  for (const item of shelfFeedOrder(stock)) {
    const left = await adjustStackAcresInventory(profileId, item, -1);
    if (left !== null) return item;
  }
  const feedLeft = await adjustStackAcresFeed(profileId, -1);
  return feedLeft === null ? null : "feed";
}

/** Hands a serving back to wherever `spendServing` took it from. */
async function refundServing(profileId: string, source: ServingSource): Promise<void> {
  if (source === "feed") {
    await adjustStackAcresFeed(profileId, 1).catch(() => null);
  } else {
    await adjustStackAcresInventory(profileId, source, 1).catch(() => null);
  }
}

/**
 * The Feed Silo's lazy settlement: feeds every animal that went hungry, as of
 * the moment it went hungry, from the barn (lib/stackacres/feed-silo.ts).
 * Runs only inside writes (`workStackAcres`, `harvestStackAcres`), never in a
 * read. Returns how many servings it handed out.
 *
 * Today's allowance is claimed on the Silo row first, under its version
 * guard, so two requests cannot both spend it. Each serving then leaves the
 * barn before the unit write that uses it, and a lost unit write refunds its
 * servings. Unused allowance is handed back at the end.
 */
async function runFeedSilo(profileId: string, now: Date): Promise<number> {
  const machines = await listStackAcresMachines(profileId);
  const silo = machines.find((machine) => machine.kind === "feed_silo");
  if (!silo) return 0;
  const day = stackacresExchangeDay(now);
  const budget = siloFeedsLeft(silo, day);
  if (budget === 0) return 0;

  const [units, inventory, feed] = await Promise.all([
    listStackAcresUnits(profileId),
    readStackAcresInventory(profileId),
    readStackAcresFeed(profileId),
  ]);
  const plan = planSiloFeeding(units, inventory, feed, budget, now, new Date(silo.createdAt));
  if (plan.servings === 0) return 0;

  const used = siloFeedsUsed(silo, day);
  const claimed = await writeStackAcresSiloFeeds(silo, day, used + plan.servings);
  if (!claimed) return 0;

  let served = 0;
  for (const feeding of plan.feedings) {
    const unit = units.find((candidate) => candidate.id === feeding.unitId);
    if (!unit) continue;
    const spent: ServingSource[] = [];
    for (const source of feeding.sources) {
      const left =
        source === "feed"
          ? await adjustStackAcresFeed(profileId, -1)
          : await adjustStackAcresInventory(profileId, source, -1);
      if (left === null) break;
      spent.push(source);
    }
    if (spent.length === 0) continue;

    // Fed at its hunger moment and ready_at left alone: no time is lost.
    const fedAt = new Date(feeding.fedAts[spent.length - 1]);
    let written: StoredStackAcresUnit | null = null;
    try {
      written = await feedStackAcresUnit(unit, fedAt, new Date(unit.readyAt), null, 0);
    } catch (error) {
      console.error("stackacres.silo_feed_failed", { profileId, unitId: unit.id, error });
    }
    if (!written) {
      for (const source of spent) await refundServing(profileId, source);
      continue;
    }
    served += spent.length;
  }

  if (served < plan.servings) {
    // A lost race here leaves the allowance claimed, never over the cap.
    await writeStackAcresSiloFeeds(claimed, day, used + served).catch(() => null);
  }
  return served;
}

/** What a feeding tells the player, when a serving earned extra eggs. */
function fedResult(sources: readonly ServingSource[]): Pick<StackAcresActionResult, "fed"> {
  const toast = feedingToast(sources);
  return toast ? { fed: { toast } } : {};
}

export async function feedStackAcres(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "working") {
    throw new StackAcresRequestError("Nothing here eats.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  // Only an animal whose last meal has worn off eats. Without this a full hen
  // could be fed Spinach over and over, each serving adding an egg. Checked
  // on the stored row, not the spoil-adjusted cycle, so a long-unfed hen can
  // still be fed to restart it.
  const hungryAt = hungryAtFor(unit);
  if (hungryAt === null) {
    throw new StackAcresRequestError("Nothing here eats.", 404, {
      round: await snapshots(profile.id, now),
    });
  }
  if (Date.parse(hungryAt) > now.getTime()) {
    throw new StackAcresRequestError("Not hungry yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const { pushed, newStartedAt } = feedPushFor(unit, now);

  // Rule 1 again, in servings rather than Gold: the feed is spent before the
  // write it pays for. Null is "not enough", which reads exactly like a lost
  // race because it is one.
  const source = await spendServing(profile.id, unit.stock);
  if (source === null) {
    throw new StackAcresRequestError("You are out of feed. Buy a shipment first.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const bonus = servingBonusEggs(source);
  let fed: StoredStackAcresUnit | null;
  try {
    fed = await feedStackAcresUnit(unit, now, pushed, newStartedAt, bonus);
    // Same version-guard retry as feedStackAcresPen below, and for the same
    // reason: a miss here almost always means this function's own read at
    // the top went stale for this one unit (irrigation/auto-feed tick, or an
    // overlapping request on the same animal), not a real refusal. Without
    // it, the optimistic patch already showing "fed" on screen gets rolled
    // back a beat later purely because of a read that was a hair too old --
    // the flicker back to hungry the player sees is this exact gap.
    if (!fed) {
      const freshUnit = await getStackAcresUnit(profile.id, unit.id);
      if (freshUnit && freshUnit.status === "working" && isStackAcresUnitHungry(freshUnit, now)) {
        const retryPush = feedPushFor(freshUnit, now);
        fed = await feedStackAcresUnit(freshUnit, now, retryPush.pushed, retryPush.newStartedAt, bonus);
      }
    }
  } catch (error) {
    await refundServing(profile.id, source);
    throw error;
  }
  if (!fed) {
    await refundServing(profile.id, source);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  await recordStoryEvents(profile.id, [{ kind: "fed", count: 1 }]);
  return { ...(await view(profile, now)), ...fedResult([source]) };
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
): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  if (!PEN_ZONE_IDS.includes(zone)) {
    throw new StackAcresRequestError("That is not a pen.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const hungry = (await listStackAcresUnits(profile.id))
    .filter((row) => stockZone(row.stock) === zone && isStackAcresUnitHungry(row, now))
    .sort((a, b) => {
      const ea = effectiveStackAcresCycle(a, now);
      const eb = effectiveStackAcresCycle(b, now);
      const hungryA = hungryAtFor({ stock: a.stock, lastFedAt: ea.lastFedAt }) ?? "";
      const hungryB = hungryAtFor({ stock: b.stock, lastFedAt: eb.lastFedAt }) ?? "";
      return hungryA.localeCompare(hungryB);
    });
  if (hungry.length === 0) {
    throw new StackAcresRequestError("Nobody in this pen is hungry.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  let fedCount = 0;
  const sources: ServingSource[] = [];
  for (const unit of hungry) {
    const source = await spendServing(profile.id, unit.stock);
    if (source === null) break;

    const { pushed, newStartedAt } = feedPushFor(unit, now);
    const bonus = servingBonusEggs(source);

    let fed: StoredStackAcresUnit | null;
    try {
      fed = await feedStackAcresUnit(unit, now, pushed, newStartedAt, bonus);
      // See waterStackAcresGroup's matching retry for why: a version-guard
      // miss here is almost always this same drop's own top-of-function read
      // going stale for one animal in the pen, not a real refusal, and
      // without a retry it is the one that silently flashes back to hungry
      // while the rest of the pen stays fed.
      if (!fed) {
        const freshUnit = await getStackAcresUnit(profile.id, unit.id);
        if (freshUnit && isStackAcresUnitHungry(freshUnit, now)) {
          const retryPush = feedPushFor(freshUnit, now);
          fed = await feedStackAcresUnit(freshUnit, now, retryPush.pushed, retryPush.newStartedAt, bonus);
        }
      }
    } catch (error) {
      await refundServing(profile.id, source);
      // The animals already fed stay fed. Only throw if nothing went through.
      if (fedCount === 0) throw error;
      break;
    }
    if (!fed) {
      await refundServing(profile.id, source);
      continue;
    }
    fedCount += 1;
    sources.push(source);
  }

  if (fedCount === 0) {
    throw new StackAcresRequestError("You are out of feed. Buy a shipment first.", 400, {
      round: await snapshots(profile.id, now),
    });
  }
  await recordStoryEvents(profile.id, [{ kind: "fed", count: fedCount }]);
  return { ...(await view(profile, now)), ...fedResult(sources) };
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
/** How far to push `ready_at` for a dry unit's next water: a seed's first
 *  drink starts its clock from zero (`seedClockOnFirstWater`), anything else
 *  keeps its progress and has the dry spell added on. Shared by
 *  `waterStackAcres` and `waterStackAcresGroup`, including each one's own
 *  version-guard retry, which needs the identical math against a freshly
 *  re-read row. */
function waterPushFor(row: StoredStackAcresUnit, now: Date): { pushed: Date; restartedAt: Date | null } {
  if (isUnwateredSeedRow(row)) {
    const clock = seedClockOnFirstWater(row, now.getTime());
    return { pushed: clock.readyAt, restartedAt: clock.startedAt };
  }
  const thirstyAt = thirstyAtFor(row);
  const driedAt = thirstyAt ? Date.parse(thirstyAt) : NaN;
  const dryMs = Number.isFinite(driedAt) ? Math.max(0, now.getTime() - driedAt) : 0;
  const readyAt = Date.parse(row.readyAt);
  return { pushed: new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + dryMs), restartedAt: null };
}

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

  if (!thirstyAtFor(unit)) {
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
  // farm. No water is spent on this path either. A crop a water source
  // waters is never dry, so watering it is the same no-op.
  const rows = await listStackAcresUnits(profile.id);
  const irrigated = await irrigatedUnitIdsFor(profile.id, rows);
  if (!isStackAcresUnitDry(unit, now, irrigated.has(unit.id))) return view(profile, now);

  const { pushed, restartedAt } = waterPushFor(unit, now);

  const remaining = await adjustStackAcresWater(profile.id, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("Your watering can is empty. Fill it at the well.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  let watered: StoredStackAcresUnit | null;
  try {
    watered = await waterStackAcresUnit(unit, now, pushed, restartedAt);
    // Same version-guard retry as waterStackAcresGroup below, and for the
    // same reason: a miss here almost always means this function's own read
    // at the top went stale for this one unit (irrigation's auto-water tick,
    // or an overlapping request on the same crop), not a real refusal.
    // Without it, the optimistic patch already painted watered on screen
    // gets rolled back a beat later purely because of a read that was a
    // hair too old -- that round trip back to thirsty is the flicker.
    if (!watered) {
      const fresh = await getStackAcresUnit(profile.id, unit.id);
      if (
        fresh &&
        fresh.status === "working" &&
        thirstyAtFor(fresh) !== null &&
        isStackAcresUnitDry(fresh, now, irrigated.has(fresh.id))
      ) {
        const retryPush = waterPushFor(fresh, now);
        watered = await waterStackAcresUnit(fresh, now, retryPush.pushed, retryPush.restartedAt);
      }
    }
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

  await recordStoryEvents(profile.id, [{ kind: "watered", count: 1 }]);
  return view(profile, now);
}

/**
 * Waters every named unit that is still dry at write time, one serving each,
 * stopping early once the can runs dry -- the mirror of `feedStackAcresPen`
 * on the crop track. What dropping the water can on a >=2x2 block of thirsty
 * crops sends; a lone tile still goes through `waterStackAcres` above.
 *
 * The group is never trusted as a shape -- it is only how the client decided
 * to ask. Each named id is watered only if it is still dry right now, same
 * posture `harvestStackAcres`'s named set takes toward its own list. Running
 * out partway, or a few names having moved on, is not an error; watering
 * nobody at all is.
 */
export async function waterStackAcresGroup(
  token: string,
  unitIdsInput: readonly string[],
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const named = new Set(unitIdsInput.map((id) => parseUnitId(id)));

  const rows = await listStackAcresUnits(profile.id);
  const irrigated = await irrigatedUnitIdsFor(profile.id, rows);
  const dry = rows.filter(
    (row) =>
      named.has(row.id) &&
      row.status === "working" &&
      thirstyAtFor(row) !== null &&
      isStackAcresUnitDry(row, now, irrigated.has(row.id)),
  );
  if (dry.length === 0) {
    throw new StackAcresRequestError("Nothing here to water.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  let wateredCount = 0;
  for (const unit of dry) {
    const remaining = await adjustStackAcresWater(profile.id, -1);
    if (remaining === null) break;

    const { pushed, restartedAt } = waterPushFor(unit, now);

    let watered: StoredStackAcresUnit | null;
    try {
      watered = await waterStackAcresUnit(unit, now, pushed, restartedAt);
      // A version-guard miss here almost always means THIS SAME drop's own
      // read at the top of the function is a beat stale for this one unit --
      // a second in-flight action on the same crop (irrigation's own auto-
      // water stamp, or an overlapping tap) landed in the gap between that
      // read and this write. Without a retry the unit is silently dropped
      // from an otherwise-successful group response: the player sees every
      // OTHER tile in the drop stay watered and this one alone flash back to
      // thirsty a moment later, which reads as random and unfixable. One
      // fresh re-read and a second attempt closes that window; if the row
      // has moved on for a real reason (already watered, harvested, etc.)
      // the retry's own dryness check below skips it same as before.
      if (!watered) {
        const fresh = await getStackAcresUnit(profile.id, unit.id);
        if (
          fresh &&
          fresh.status === "working" &&
          thirstyAtFor(fresh) !== null &&
          isStackAcresUnitDry(fresh, now, irrigated.has(fresh.id))
        ) {
          const retryPush = waterPushFor(fresh, now);
          watered = await waterStackAcresUnit(fresh, now, retryPush.pushed, retryPush.restartedAt);
        }
      }
    } catch (error) {
      await adjustStackAcresWater(profile.id, 1).catch(() => null);
      // Whatever already went through stays watered. Only throw if nothing did.
      if (wateredCount === 0) throw error;
      break;
    }
    if (!watered) {
      await adjustStackAcresWater(profile.id, 1).catch(() => null);
      continue;
    }
    wateredCount += 1;
  }

  if (wateredCount === 0) {
    throw new StackAcresRequestError("Your watering can is empty. Fill it at the well.", 400, {
      round: await snapshots(profile.id, now),
    });
  }
  await recordStoryEvents(profile.id, [{ kind: "watered", count: wateredCount }]);
  return view(profile, now);
}

/** Fills the watering can at the well. Free, and a no-op on a full can. */
export async function drawStackAcresWater(token: string, now = new Date()): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  await fillStackAcresWater(profile.id);
  return view(profile, now);
}

/**
 * Moves energy by `delta` with a version-guarded write, retrying a couple of
 * times when another write lands in between. Returns null when a spend
 * would go below zero. Only the extras (fishing) spend energy; farm work
 * never does.
 */
async function moveStackAcresEnergy(
  profileId: string,
  delta: number,
  now: Date,
): Promise<StackAcresEnergyAnchor | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await readStackAcresEnergy(profileId);
    const next = applyEnergyDelta(stored, delta, now);
    if (!next) return null;
    if (await writeStackAcresEnergy(profileId, stored?.version ?? 0, next)) return next;
  }
  throw new StackAcresRequestError("That moved on.", 409);
}

/**
 * A completed cast at the dock. Which fish it lands is decided HERE, never
 * by the client -- the drag-in/wait/drag-out gesture only decides when a
 * cast is complete, same separation `harvestStackAcres` keeps between "the
 * tap happened" and "here is what it was worth".
 *
 * A cast costs FISHING_CAST_ENERGY. The energy is spent before the fish is
 * credited and handed back if that credit fails, the same order Gold keeps.
 * A baited cast spends one Radish the same way, right after the energy, and
 * lands from better odds (`BAIT_FISH_WEIGHTS` in lib/stackacres/fishing.ts).
 */
export async function catchStackAcresFish(
  token: string,
  bait: boolean,
  now = new Date(),
): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  const spent = await moveStackAcresEnergy(profile.id, -FISHING_CAST_ENERGY, now);
  if (!spent) {
    throw new StackAcresRequestError(TOO_TIRED_TO_FISH, 409, {
      round: await snapshots(profile.id, now),
    });
  }
  const refundEnergy = () => moveStackAcresEnergy(profile.id, FISHING_CAST_ENERGY, now).catch(() => null);
  if (bait) {
    let baitLeft: number | null;
    try {
      baitLeft = await adjustStackAcresInventory(profile.id, FISHING_BAIT_ITEM, -1);
    } catch (error) {
      await refundEnergy();
      throw error;
    }
    if (baitLeft === null) {
      await refundEnergy();
      throw new StackAcresRequestError("You have no radishes for bait.", 409, {
        round: await snapshots(profile.id, now),
      });
    }
  }
  const species: FishSpecies = pickCaughtFish(Math.random, bait);
  try {
    await adjustStackAcresInventory(profile.id, species, 1);
  } catch (error) {
    if (bait) await adjustStackAcresInventory(profile.id, FISHING_BAIT_ITEM, 1).catch(() => null);
    await refundEnergy();
    throw error;
  }
  await recordStoryEvents(profile.id, [{ kind: "fish-caught", species }]);
  return { ...(await view(profile, now)), fishCaught: { species } };
}

/**
 * Eats one food (energy.ts's FOOD_ITEMS) from inventory for energy. The food
 * debit and the energy credit are one transaction (`eat_homestead_food`), so
 * neither can land without the other. Refused at full energy; below that,
 * anything past the cap is lost, and the kitchen shows the real gain.
 */
export async function eatStackAcresFoodAction(
  token: string,
  itemInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!isFoodItem(itemInput)) throw new StackAcresRequestError("You can't eat that.", 400);
  const item: FoodItem = itemInput;
  const profile = await ensureProfile(token);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await readStackAcresEnergy(profile.id);
    if (energyAt(stored, now) >= ENERGY_MAX) {
      throw new StackAcresRequestError("You're full of energy already.", 409, {
        round: await snapshots(profile.id, now),
      });
    }
    const next = applyEnergyDelta(stored, FOOD_ENERGY[item], now);
    if (!next) break;
    const eaten = await eatStackAcresFoodRow(profile.id, item, stored?.version ?? 0, next);
    if (eaten === "eaten") return view(profile, now);
    if (eaten === "no-food") {
      throw new StackAcresRequestError(`You don't have any ${MACHINE_ITEM_CATALOGUE[item].label} to eat.`, 409, {
        round: await snapshots(profile.id, now),
      });
    }
  }
  throw new StackAcresRequestError("That moved on.", 409, { round: await snapshots(profile.id, now) });
}

/**
 * A completed stalk in the Oak's brush. Which quarry it was is decided HERE,
 * never by the client -- the scope only reports that the player held a mark
 * steady and took it, exactly the separation `catchStackAcresFish` keeps
 * between "the cast completed" and "here is what it landed".
 *
 * Free, so there is nothing to refund: a stalk costs nothing to attempt, and
 * the two inventory writes below are the only thing it moves. They are
 * deliberately NOT wrapped in a transaction -- `adjustStackAcresInventory` is
 * already a row-locking RPC per item, the two items are independent, and the
 * worst a crash between them can do is credit the meat without the pelt. That
 * is a strictly-in-the-player's-favour partial result on a free action, which
 * is the same trade every other multi-item credit in this file makes.
 */
export async function bagStackAcresQuarry(
  token: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  const species: QuarrySpecies = pickQuarry();
  const { meat, pelt } = QUARRY_CATALOGUE[species];
  await adjustStackAcresInventory(profile.id, "meat", meat);
  await adjustStackAcresInventory(profile.id, "pelt", pelt);
  return { ...(await view(profile, now)), quarryBagged: { species, meat, pelt } };
}

/**
 * One swing at something standing on land being cleared
 * (lib/stackacres/land-clearing.ts).
 *
 * This is how land is taken. There is no purchase: the sector opens by
 * itself the moment its last obstacle comes down, which is what
 * `openIfCleared` below does. The swing pays its materials into the barn the
 * same way a chopped tree does.
 *
 * Energy goes before the swing and comes back if the swing turns out not to
 * land, the same order `catchStackAcresFish` keeps. Version-guarded, so two
 * rapid taps cannot both land the blow that clears the same obstacle.
 */
export async function workStackAcresLand(
  token: string,
  obstacleIdInput: string,
  sweet: boolean,
  now = new Date(),
): Promise<StackAcresActionResult> {
  const obstacle = landObstacle(obstacleIdInput);
  if (!obstacle) throw new StackAcresRequestError("There is nothing there.", 400);
  const profile = await ensureProfile(token);
  await assertLandReachable(profile.id, obstacle.sector, now);

  const spent = await moveStackAcresEnergy(profile.id, -LAND_SWING_ENERGY, now);
  if (!spent) throw new StackAcresRequestError(TOO_TIRED_TO_CLEAR, 400, { round: await snapshots(profile.id, now) });

  const current = await getOrCreateStackAcresLandObstacle(profile.id, obstacle.id);
  const swing = swingAtLandObstacle(obstacle.kind, current, now, sweet);
  const written = swing ? await writeStackAcresLandObstacle(current, swing.nextState) : null;
  if (!swing || !written) {
    // Already down, or another tap got there first. Nothing happened, so the
    // energy goes back.
    await moveStackAcresEnergy(profile.id, LAND_SWING_ENERGY, now);
    return { ...(await view(profile, now)), landCleared: null };
  }

  if (swing.item && swing.quantity > 0) {
    await adjustStackAcresInventory(profile.id, swing.item, swing.quantity);
  }
  const opened = swing.cleared ? await openIfCleared(profile.id, obstacle.sector, now) : false;
  return {
    ...(await view(profile, now)),
    landCleared: {
      obstacleId: obstacle.id,
      sector: obstacle.sector,
      item: swing.item,
      quantity: swing.quantity,
      cleared: swing.cleared,
      sectorOpened: opened,
    },
  };
}

/**
 * Blowing one obstacle instead of working it: the one place Gold leaves on
 * the way to owning land. It pays no materials -- there is nothing left to
 * pick up -- and it is priced per swing still owed, so work already done is
 * never wasted.
 *
 * Rule 1: the Gold leaves before the obstacle does, and comes back if the
 * guarded write finds the obstacle already gone.
 */
export async function demolishStackAcresLand(
  token: string,
  obstacleIdInput: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  const obstacle = landObstacle(obstacleIdInput);
  if (!obstacle) throw new StackAcresRequestError("There is nothing there.", 400);
  const profile = await ensureProfile(token);
  await assertLandReachable(profile.id, obstacle.sector, now);

  const current = await getOrCreateStackAcresLandObstacle(profile.id, obstacle.id);
  const price = demolitionPrice(obstacle.kind, current);
  const next = demolishLandObstacle(current, now);
  if (!next || price <= 0) {
    return { ...(await view(profile, now)), landCleared: null };
  }

  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(`Blowing that costs ${price.toLocaleString()} Gold.`, 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const written = await writeStackAcresLandObstacle(current, next);
  if (!written) {
    await refundGold(profile.id, price);
    return { ...(await view(profile, now)), landCleared: null };
  }

  const opened = await openIfCleared(profile.id, obstacle.sector, now);
  return {
    ...(await view(profile, now)),
    landCleared: {
      obstacleId: obstacle.id,
      sector: obstacle.sector,
      item: null,
      quantity: 0,
      cleared: true,
      sectorOpened: opened,
    },
  };
}

/** The Pasture is reached through the Fold, so its ground cannot be worked
 *  until the Fold is open. The map says the same thing with a fence. */
async function assertLandReachable(profileId: string, sector: SectorId, now: Date): Promise<void> {
  const requires = STACKACRES_SECTORS[sector].requires;
  if (!requires) return;
  const { sectors } = await readLand(profileId);
  if (isSectorUnlocked(requires, sectors)) return;
  throw new StackAcresRequestError(`${sectorLabel(requires)} comes first.`, 409, {
    round: await snapshots(profileId, now),
  });
}

/** Records the sector as cleared once nothing is left standing on it. No
 *  Gold moves: the land was taken by the work, not bought. */
async function openIfCleared(profileId: string, sector: SectorId, now: Date): Promise<boolean> {
  if (!isClearableSector(sector)) return false;
  const states = await listStackAcresLandObstacleStates(profileId);
  const progress = landClearingProgress(
    sector,
    LAND_OBSTACLES[sector].map((obstacle) => ({
      id: obstacle.id,
      cleared: states[obstacle.id]?.clearedAt != null,
    })),
  );
  if (!progress.done) return false;
  const recorded = await recordStackAcresSectorCleared(profileId, sector, now);
  if (recorded) await recordStoryEvents(profileId, [{ kind: "sector-cleared", sector }]);
  return recorded;
}

/**
 * One swing at a tree (lib/stackacres/wood.ts): fills the shelf with Wood,
 * same as a catch or a bagged stalk -- moves no Gold.
 *
 * `sweet` is the chop minigame's own verdict on the swing's timing (see
 * lib/stackacres/chop.ts) -- it never decides whether the swing lands, only
 * how much Wood it pays, the same "client picks a quality flag, server owns
 * the real state" shape `catch-fish`'s `bait` boolean already takes.
 *
 * VERSION-GUARDED, UNLIKE A STALK. A stalk has no persisted world object to
 * race over; a tree does (`StoredWoodNode`), so two rapid taps chopping the
 * same tree race on its row's own version -- see
 * `writeStackAcresWoodNodeSwing`'s own header for why that closes the
 * double-collect window a bare read-then-credit would leave open. A lost
 * race is a quiet no-op here (no Wood, current snapshot back), not an error:
 * the loser's tap simply arrived a beat after the tree was already felled.
 */
export async function chopStackAcresWoodTree(
  token: string,
  nodeIdInput: string,
  sweet: boolean,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!isWoodNodeId(nodeIdInput)) throw new StackAcresRequestError("Not a real tree.", 400);
  const nodeId: WoodNodeId = nodeIdInput;
  const profile = await ensureProfile(token);

  const current: StoredWoodNode = await getOrCreateStackAcresWoodNode(profile.id, nodeId);
  const swing = swingAtWoodNode(current, now, sweet);
  if (!swing) {
    // Standing but out of reach for this attempt only happens if the tree
    // was felled between the client's own tap and this request landing --
    // a quiet no-op, same posture a lost machine-collect race takes.
    return { ...(await view(profile, now)), woodChopped: null };
  }

  const written = await writeStackAcresWoodNodeSwing(current, swing.nextState);
  if (!written) {
    // Lost the race: someone else's swing (or this same tap, retried) wrote
    // first. No Wood for this request -- see this function's own header.
    return { ...(await view(profile, now)), woodChopped: null };
  }

  await adjustStackAcresInventory(profile.id, "wood", swing.woodGained);
  return {
    ...(await view(profile, now)),
    woodChopped: { nodeId, quantity: swing.woodGained, felled: swing.felled },
  };
}

/**
 * One swing at one of the Mine's three Stone nodes.
 *
 * The node itself is GLOBAL, not per-profile (see lib/server/
 * stone-node-store.ts's own header), so this is not a per-player row this
 * function needs to guard against a race the way `harvestStackAcres` guards
 * a unit -- `mineStoneNode` already applies the swing under the node row's
 * own version-guarded update, so a lost race here reads back as a swing
 * that simply did not land, never a double-collection.
 *
 * `quality` is the client's own timing grade -- "sweet" for a tap inside the
 * shared chop/mine popup's sweet zone (lib/stackacres/chop.ts), "hit"
 * otherwise -- and it can ONLY ever change how much Stone a landed swing
 * pays out (see lib/stackacres/stone-nodes.ts's `SWING_YIELD`). It can never
 * make an already-broken node break again or skip a swing: `mineStoneNode`
 * reads the node's real hit count and regrow window off its own stored row,
 * never off anything this call passes.
 *
 * Free like `bagStackAcresQuarry`: a swing costs nothing to attempt, so
 * there is nothing to refund if the node turns out to be down.
 */
export async function mineStackAcresStoneNode(
  token: string,
  nodeIdInput: string,
  qualityInput: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!isStoneNodeId(nodeIdInput)) throw new StackAcresRequestError("There is nothing to mine there.", 400);
  if (qualityInput !== "hit" && qualityInput !== "sweet") {
    throw new StackAcresRequestError("Not a real swing.", 400);
  }
  const nodeId: StoneNodeId = nodeIdInput;
  const quality: SwingQuality = qualityInput;
  const profile = await ensureProfile(token);

  const outcome = await mineStoneNode(nodeId, quality, now);
  if (!outcome.landed) {
    return {
      ...(await view(profile, now)),
      stoneMined: { landed: false, broke: false, amount: 0 },
    };
  }

  await adjustStackAcresInventory(profile.id, "stone", outcome.yield);
  return {
    ...(await view(profile, now)),
    stoneMined: { landed: true, broke: outcome.broke, amount: outcome.yield },
  };
}

/**
 * One pick at one of the Homestead's four forage bushes.
 *
 * WHAT MAKES THIS SAFE TO RETRY is not an intent key but the same
 * version-guarded write a chop uses: `writeStackAcresForagePick` bumps the
 * row's version, so a duplicated request finds nothing to update and pays no
 * seed. It needs no dice of its own either -- which crop a bush carries is a
 * pure function of its stored pick count (lib/stackacres/forage.ts's
 * `forageCrop`), so a replay could only ever have produced the same seed.
 *
 * NO LADDER CHECK, deliberately. `isSeedUnlocked` gates what Ray SELLS; it
 * does not gate what the land gives, which is the whole point of foraging
 * (see lib/stackacres/forage.ts's header). Planting spends off the seed
 * shelf without re-checking the ladder, so a foraged Radish seed goes in the
 * ground with no Kitchen Counter built.
 *
 * Free to attempt, like a chop: there is no Gold in this transaction at all,
 * in either direction, so there is nothing to refund when a bush turns out
 * to be bare. If the seed credit itself fails, the pick is put back rather
 * than spending the bush for nothing.
 */
export async function gatherStackAcresForage(
  token: string,
  nodeIdInput: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!isForageNodeId(nodeIdInput)) {
    throw new StackAcresRequestError("There is nothing to pick there.", 400);
  }
  const nodeId: ForageNodeId = nodeIdInput;
  const profile = await ensureProfile(token);

  const current: StoredForageNode = await getOrCreateStackAcresForageNode(profile.id, nodeId);
  const picked = pickForageNode(nodeId, current, now);
  if (!picked) {
    // Bare right now: the bush was picked between the tap and this request
    // landing. A quiet no-op, the same posture a lost chop race takes.
    return { ...(await view(profile, now)), foraged: null };
  }

  const written = await writeStackAcresForagePick(current, picked.nextState);
  if (!written) {
    // Lost the race: another request (or this one, retried) picked first.
    return { ...(await view(profile, now)), foraged: null };
  }

  const held = await adjustStackAcresSeedStock(profile.id, picked.crop, picked.quantity);
  if (held === null) {
    // A credit cannot go negative, so null means the shelf row moved under
    // us. Put the bush back rather than charging a pick for seed that never
    // arrived -- guarded on the row this call just wrote, so a pick that
    // landed in between is left where it is.
    await writeStackAcresForagePick(written, current).catch(() => null);
    return { ...(await view(profile, now)), foraged: null };
  }

  return {
    ...(await view(profile, now)),
    foraged: { nodeId, crop: picked.crop, quantity: picked.quantity },
  };
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

  // A marked attempt is a spot searched, found or not -- what Miles asks for.
  await recordStoryEvents(profile.id, [{ kind: "secret-zone-tapped", zoneId }]);

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
 * Donates a held secret item to Ray, exactly once per item -- writes through
 * `markStackAcresDonated` at the storage layer (see stackacres-store.ts's own
 * header on why that idempotency-guarded flag still exists). `lucky_poker_dice`
 * is not a `StackAcresItem`, and `markStackAcresDonated` takes a bare string,
 * so this rides it without needing any type of its own.
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
 * Trades a held secret item to Ray for an instant wipe of today's
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
   *  plus any crit bonus folded in. See `critBonus` below for what it
   *  contributed. */
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
 *   5. Credit inventory once per item (base + crit bonus), write the ledger.
 */
export async function harvestStackAcres(
  token: string,
  input: { unitIds?: readonly string[] } = {},
  now = new Date(),
): Promise<StackAcresView & { harvest: StackAcresHarvestResult }> {
  const profile = await ensureProfile(token);
  // The Feed Silo settles first, so an animal it would have fed on time is
  // collected on time rather than refused as hungry.
  await runFeedSilo(profile.id, now);
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
          round: { units: toStackAcresUnitSnapshots(rows, now, irrigated), revision: await readStackAcresRevision(profile.id) },
        });
      }
      if (isStackAcresUnitHungry(row, now)) {
        throw new StackAcresRequestError("Feed them first.", 409, {
          round: { units: toStackAcresUnitSnapshots(rows, now, irrigated), revision: await readStackAcresRevision(profile.id) },
        });
      }
      // The client's clock is decoration; this is the answer that counts, and
      // the store's own ready_at guard backs it even if this check is raced.
      if (!isStackAcresUnitReady(row, now, irrigated.has(row.id))) {
        throw new StackAcresRequestError("Not ready yet.", 409, {
          round: { units: toStackAcresUnitSnapshots(rows, now, irrigated), revision: await readStackAcresRevision(profile.id) },
        });
      }
    }
  }

  const ready = rows.filter(
    (row) => (!named || named.has(row.id)) && isStackAcresUnitReady(row, now, irrigated.has(row.id)),
  );
  if (ready.length === 0) {
    throw new StackAcresRequestError("Nothing is ready yet.", 409, {
      round: { units: toStackAcresUnitSnapshots(rows, now, irrigated), revision: await readStackAcresRevision(profile.id) },
    });
  }

  const candidateOf = (row: StoredStackAcresUnit): HarvestCandidate => ({
    unitId: row.id,
    stock: row.stock,
    // Rule 3: the snapshot taken at stocking, never a re-read of the
    // catalogue, plus whatever this cycle's feeding earned on top.
    yieldQuantity: row.yieldQuantity + row.feedBonus,
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
          // A water source waters the new cycle from its start.
          wateredAt: irrigated.has(row.id) ? now : null,
        }
      : null;
    const done = await collectStackAcresUnit(row, now, muckFee, restart);
    // Rule 2: a lost race did not happen here; whoever won it was credited instead.
    if (!done) continue;
    settled.push(row);
    if (muckFee !== null) mucked += 1;
    if (row.soilSlot !== null && enrichesSoil(row.stock)) {
      await markSoilEnriched(profile.id, row.soilSlot);
    }
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

  // Step 5. Credit inventory once per item -- base plus any crit bonus.
  // Best-effort per item, same posture the old Gold credit took: the
  // settlement above is already durable, and a credit hiccup here must not
  // turn a settled harvest into an error response, only report less than
  // what actually landed in the barn.
  const finalTally = new Map<StackAcresItem, number>();
  for (const { item, quantity } of baseTally) finalTally.set(item, quantity);
  for (const [item, bonus] of critBonusTally) finalTally.set(item, (finalTally.get(item) ?? 0) + bonus);

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

  // Step 7. The travelers' story counts what settled, one event per stock
  // kind, each carrying how many units of it came in -- after the credits
  // above, so a story hiccup can never cost a harvest (see recordStoryEvents).
  const settledByStock = new Map<StackAcresStock, number>();
  for (const row of settled) settledByStock.set(row.stock, (settledByStock.get(row.stock) ?? 0) + 1);
  await recordStoryEvents(
    profile.id,
    [...settledByStock].map(([stock, count]) => ({ kind: "harvested", stock, count })),
  );

  return {
    ...(await view(profile, now)),
    harvest: {
      units: settled.length,
      tally: credited,
      gross: actual.gross,
      mucked,
      crit: critical,
      critBonus: [...critBonusTally].map(([item, quantity]) => ({ item, quantity })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Processing: wheat, machines, Town Contracts                         */
/* ------------------------------------------------------------------ */

/**
 * LEGACY: sows one wheat plot, with Gold. Wheat is a bed crop now, so no route
 * or client reaches this; it stays only so `workStackAcres` keeps a tested path
 * for collecting any plot that was sown before that. Delete it with the
 * `homestead_wheat_plots` table once none are left (there were none in flight
 * on 2026-09-19).
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
/**
 * Spends a purchase's gathered materials, and hands back the undo.
 *
 * ONE HELPER FOR BOTH BUYERS (a machine, a pen slot), so
 * rule 1's refund path is written once. Materials go before Gold everywhere
 * this is used: a handful of Wood is cheaper to put back than a Gold spend
 * that then fails, and `adjustStackAcresInventory` returning null is the
 * authority on "not enough", never a count read beforehand.
 *
 * A short line throws, having already put back whatever left. The returned
 * `refund` is for the caller's own later failures (the Gold spend, the write
 * the spend paid for) and is safe to call once.
 */
async function spendStackAcresMaterials(
  profileId: string,
  materials: readonly MaterialCost[],
  now: Date,
  short: (material: MaterialCost) => string,
): Promise<{ refund: () => Promise<void> }> {
  const taken: MaterialCost[] = [];
  const refund = async (): Promise<void> => {
    for (const material of taken) {
      await adjustStackAcresInventory(profileId, material.item, material.quantity);
    }
  };
  for (const material of materials) {
    const remaining = await adjustStackAcresInventory(profileId, material.item, -material.quantity);
    if (remaining === null) {
      await refund();
      throw new StackAcresRequestError(short(material), 400, { round: await snapshots(profileId, now) });
    }
    taken.push(material);
  }
  return { refund };
}

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

  // Rule 1: every stake leaves before the machine exists. Materials go
  // first (cheaper to refund a handful of Wood or Stone than Gold if the
  // Gold spend then comes up short), Gold second.
  const { refund: refundMaterials } = await spendStackAcresMaterials(
    profile.id,
    def.materials ?? [],
    now,
    (material) =>
      `A ${def.label} needs ${material.quantity.toLocaleString()} ${machineItemNoun(material.item, material.quantity)}.`,
  );

  const debited = await spendGoldByProfile(profile.id, def.placeCost);
  if (!debited) {
    await refundMaterials();
    throw new StackAcresRequestError(`A ${def.label} costs ${def.placeCost.toLocaleString()} Gold.`, 400, {
      round: await snapshots(profile.id, now),
    });
  }

  try {
    await createStackAcresMachine(profile.id, kind, now);
  } catch (error) {
    await refundGold(profile.id, def.placeCost);
    await refundMaterials();
    throw error;
  }

  return view(debited, now);
}

/** The player's own aging machine (the Vat or the Preserves Cellar), or a
 *  404 -- every seal/collect action needs this first. */
async function requireAgingMachine(profileId: string, kind: "vat" | "cellar", now: Date) {
  const machines = await listStackAcresMachines(profileId);
  const machine = machines.find((candidate) => candidate.kind === kind);
  if (!machine) {
    throw new StackAcresRequestError(
      kind === "vat" ? "Place a Fermenting Vat first." : "Build the Preserves Cellar first.",
      404,
      { round: await snapshots(profileId, now) },
    );
  }
  return machine;
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
  const vat = await requireAgingMachine(profile.id, "vat", now);

  const existing = await readStackAcresAgingManifest(profile.id, vat.id);
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

  const sealed = await createStackAcresVatManifest(
    profile.id,
    vat.id,
    VAT_INPUT_ITEM,
    VAT_INPUT_QUANTITY,
    baseGoldValue,
    sealedAt,
    readyAt,
  );
  if (!sealed.ok) {
    throw new StackAcresRequestError(
      sealed.reason === "occupied"
        ? "The vat is already sealed."
        : `Sealing the vat takes ${machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)}.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  return view(profile, now);
}

/**
 * Seals jars of Pickles or Sauerkraut in the Preserves Cellar: every jar of
 * that kind on the shelf, up to CELLAR_CAPACITY, priced once at seal time off
 * what the jars sell for today. Same one-transaction seal as the Vat
 * (`seal_homestead_vat`), keyed on the Cellar's own machine row.
 */
export async function sealStackAcresCellar(
  token: string,
  item: CellarItem,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const cellar = await requireAgingMachine(profile.id, "cellar", now);

  const existing = await readStackAcresAgingManifest(profile.id, cellar.id);
  if (existing) {
    throw new StackAcresRequestError("The cellar already has jars aging.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const inventory = await readStackAcresInventory(profile.id);
  const quantity = cellarSealQuantity(inventoryQuantity(inventory, item));
  if (quantity < 1) {
    throw new StackAcresRequestError(`You have no ${machineItemNoun(item, 2)} to store.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const sealed = await createStackAcresVatManifest(
    profile.id,
    cellar.id,
    item,
    quantity,
    cellarBaseGoldValue(item, quantity),
    now,
    new Date(now.getTime() + firstAgingTier(CELLAR_AGING_TIERS).durationMs),
  );
  if (!sealed.ok) {
    throw new StackAcresRequestError(
      sealed.reason === "occupied"
        ? "The cellar already has jars aging."
        : `Some of those ${machineItemNoun(item, 2)} just went elsewhere. Try again.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  return view(profile, now);
}

/**
 * Collects whatever tier the sealed batch has reached and pays for it.
 *
 * MONEY ORDERING, the same steps `fulfillStackAcresTownContract` runs, in the
 * same order and for the same reason (see its own header): (1) the manifest is
 * deleted under a once-only guard; (2) Gold has today's Land Maintenance
 * netted off the top (`netUpkeepFromPayout`) and is credited only once that
 * delete is confirmed durable.
 */
export async function collectStackAcresVat(
  token: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  return collectStackAcresAging(token, "vat", AGING_TIERS, now);
}

/** The Preserves Cellar's collect: the Vat's, on the Cellar's ladder. */
export async function collectStackAcresCellar(
  token: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  return collectStackAcresAging(token, "cellar", CELLAR_AGING_TIERS, now);
}

async function collectStackAcresAging(
  token: string,
  kind: "vat" | "cellar",
  tiers: readonly AgingTier[],
  now: Date,
): Promise<StackAcresActionResult> {
  const profile = await ensureProfile(token);
  const machine = await requireAgingMachine(profile.id, kind, now);
  const place = kind === "vat" ? "the vat" : "the cellar";

  const manifest = await readStackAcresAgingManifest(profile.id, machine.id);
  if (!manifest) {
    throw new StackAcresRequestError(`Nothing is sealed in ${place}.`, 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const elapsedMs = now.getTime() - Date.parse(manifest.sealedAt);
  const tier = vatTierForElapsed(elapsedMs, tiers);
  if (!tier) {
    throw new StackAcresRequestError(
      `Still aging. Come back once it reaches ${tiers[0].label} quality.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }
  const gold = agedGoldValue(manifest.baseGoldValue, tier);

  // Step 1: settle the manifest itself, exactly once.
  const settled = await collectStackAcresVatManifest(manifest, now);
  if (!settled) {
    throw new StackAcresRequestError("That batch was already collected.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 2: net Land Maintenance off the top, then pay -- only now that
  // step 1 is durable. `vatCollected.gold` below stays the batch's full
  // worth; netUpkeepFromPayout only changes what actually lands in Gold.
  let paid: PlayerProfile | null = null;
  if (gold > 0) {
    const netGold = await netUpkeepFromPayout(profile.id, now, gold);
    try {
      paid = await creditGoldByProfile(profile.id, netGold);
    } catch (error) {
      console.error("stackacres.vat_credit_failed", {
        profileId: profile.id,
        manifestId: manifest.id,
        kind,
        gold: netGold,
        error,
      });
    }
  }

  return {
    ...(await view(paid ?? (await ensureProfile(token)), now)),
    // Named for the Vat, which came first; the Cellar's collect fills the
    // same field.
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
  /** Servings the Feed Silo handed out on this pass. */
  siloServings: number;
  /** What the Farm Kitchen cooked on this pass, or null. */
  kitchenCooked: { item: MachineProcessedItem; quantity: number } | null;
}

export async function workStackAcres(
  token: string,
  now = new Date(),
): Promise<StackAcresView & { work: StackAcresWorkResult }> {
  const profile = await ensureProfile(token);
  const siloServings = await runFeedSilo(profile.id, now);
  const kitchenCooked = await runFarmKitchen(profile.id, now);

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
  // What each collected run made, for the travelers' story (see the end).
  const processedEvents: StoryEvent[] = [];
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
        processedEvents.push({ kind: "processed", recipe: machine.recipeId, count: credited });
      } catch (error) {
        console.error("stackacres.machine_output_credit_failed", {
          profileId: profile.id,
          machineId: machine.id,
          error,
        });
      }
    }
  }

  if (kitchenCooked) {
    processedEvents.push({ kind: "processed", recipe: kitchenCooked.recipe, count: kitchenCooked.quantity });
  }
  await recordStoryEvents(profile.id, processedEvents);
  return {
    ...(await view(profile, now)),
    work: {
      wheatCollected,
      machinesStarted,
      machinesCollected,
      siloServings,
      kitchenCooked: kitchenCooked ? { item: kitchenCooked.item, quantity: kitchenCooked.quantity } : null,
    },
  };
}

/**
 * The Farm Kitchen's lazy settlement: cooks every banked batch of its
 * standing order the shelf can pay for (lib/stackacres/farm-kitchen.ts).
 * Runs only inside `workStackAcres`, never in a read.
 *
 * The batches are claimed on the machine row first, under its version guard,
 * so two requests cannot both cook them. Then every input and the doubled
 * output move in one transaction. A shelf that changed in between hands the
 * claimed batches back.
 */
async function runFarmKitchen(
  profileId: string,
  now: Date,
): Promise<{ recipe: RecipeId; item: MachineProcessedItem; quantity: number } | null> {
  const machines = await listStackAcresMachines(profileId);
  const kitchen = machines.find((machine) => machine.kind === "farm_kitchen");
  if (!kitchen) return null;
  const plan = planFarmKitchen(kitchen, await readStackAcresInventory(profileId), now);
  if (!plan) return null;

  const claimed = await writeStackAcresFarmKitchen(kitchen, plan.recipe, plan.nextSince);
  if (!claimed) return null;

  // The RPC is all-or-nothing, so a shortfall or an error spent nothing:
  // hand the claimed batches back and let the rest of the work pass run.
  let cooked: number | null = null;
  try {
    cooked = await processStackAcresRecipeMulti(profileId, plan.inputs, plan.output);
  } catch (error) {
    console.error("stackacres.farm_kitchen_cook_failed", { profileId, recipe: plan.recipe, error });
  }
  if (cooked === null) {
    await writeStackAcresFarmKitchen(claimed, kitchen.standingRecipe, kitchen.kitchenSince).catch(() => null);
    return null;
  }
  return { recipe: plan.recipe, ...plan.output };
}

/**
 * Sets what the Farm Kitchen cooks. Batches start banking from the first
 * order; changing the order later keeps what is already banked. Moves no
 * Gold and no items.
 */
export async function setStackAcresKitchenOrder(
  token: string,
  recipe: string,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  if (!isFarmKitchenRecipe(recipe)) {
    throw new StackAcresRequestError("The Farm Kitchen can't cook that.", 400, {
      round: await snapshots(profile.id, now),
    });
  }
  const machines = await listStackAcresMachines(profile.id);
  const kitchen = machines.find((machine) => machine.kind === "farm_kitchen");
  if (!kitchen) {
    throw new StackAcresRequestError("Build the Farm Kitchen first.", 404, {
      round: await snapshots(profile.id, now),
    });
  }
  const written = await writeStackAcresFarmKitchen(kitchen, recipe, kitchen.kitchenSince ?? now.toISOString());
  if (!written) {
    throw new StackAcresRequestError("The Farm Kitchen was busy. Try again.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  return view(profile, now);
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
  // An instant recipe is made right here; a queued one is counted when
  // `workStackAcres` collects it, so it is never counted twice.
  if (processed.produced !== null) {
    await recordStoryEvents(profile.id, [
      { kind: "processed", recipe: processed.recipe, count: processed.produced.quantity },
    ]);
  }
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
 * Passes on the open contract and draws another, at most once per UTC day.
 *
 * MOVES NOTHING. No Gold, no goods, no Influence -- a pass is the release
 * valve on a board that is one slot wide and has no cancel (see
 * lib/stackacres/contracts.ts's header), so it is the one contract path with
 * no money ordering to get right.
 *
 * THE DAY LIMIT IS READ OFF THE ROWS, not stored as a counter: the newest
 * passed contract's `resolved_at` is when the last pass was spent. Same
 * "derive it from a permanent fact" posture as the milestone flags, and it
 * means there is no counter to reset at midnight.
 *
 * The status guard on the write is what makes a double-tapped pass spend one
 * day rather than two: the second request finds the row already passed and
 * is refused before it can draw anything.
 */
export async function passStackAcresContract(
  token: string,
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);

  const existing = await readStackAcresOpenContract(profile.id);
  if (!existing) {
    throw new StackAcresRequestError("There is no contract to pass on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const today = stackacresExchangeDay(now);
  if (contractPassSpent(await readStackAcresLastContractPassDay(profile.id), today)) {
    throw new StackAcresRequestError(
      "You have already passed on an order today. The town will hold this one until tomorrow.",
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  const passed = await passStoredContract(existing, now);
  if (!passed) {
    // Another tab resolved it first -- filled or passed. Either way this
    // request must not also spend the day.
    throw new StackAcresRequestError("That contract is already settled.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Draw the replacement the same way `requestStackAcresContract` does, off
  // what this farm can actually make. A farm with no machine left to make
  // anything simply ends up with an empty board, exactly as it would after
  // filling one.
  const machines = await listStackAcresMachines(profile.id);
  const producible = [
    ...new Set(
      machines.flatMap((machine) =>
        recipesForMachine(machine.kind).map((recipe) => RECIPE_CATALOGUE[recipe].output.item),
      ),
    ),
  ];
  const def = drawContract(producible, Math.random);
  if (def) await createStackAcresContract(profile.id, def);

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
 *   2. The contract is marked fulfilled under a guard that can settle it at
 *      most once. Losing that race refunds the goods -- nothing here can pay
 *      out for a contract someone else already collected.
 *   3. Gold has today's Land Maintenance netted off the top
 *      (`netUpkeepFromPayout`), and Gold plus Influence are credited only
 *      once step 2 is durable.
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

  // Step 2: settle the contract itself, exactly once.
  const settled = await settleStackAcresContract(contract);
  if (!settled) {
    await adjustStackAcresInventory(profile.id, contract.item, contract.quantity).catch(() => null);
    throw new StackAcresRequestError("That contract was already settled.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 3: net Land Maintenance off the top, then pay -- only now that
  // step 2 is durable. `contractReward.gold` below stays the contract's
  // full reward; netUpkeepFromPayout only changes what actually lands.
  let paid: PlayerProfile | null = null;
  if (contract.goldReward > 0) {
    const netGold = await netUpkeepFromPayout(profile.id, now, contract.goldReward);
    try {
      paid = await creditGoldByProfile(profile.id, netGold);
    } catch (error) {
      console.error("stackacres.contract_credit_failed", {
        profileId: profile.id,
        contractId: contract.id,
        gold: netGold,
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

  await recordStoryEvents(profile.id, [{ kind: "contract-fulfilled" }]);
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
 *   1. The goods leave inventory first, under `adjustStackAcresInventory`'s
 *      own row lock -- a sale can never leave the player owing more than they
 *      held.
 *   2. Gold, multiplied by the Prestige Reset Valve's permanent multiplier
 *      (see lib/stackacres/prestige.ts's own header for why the multiplier
 *      moved here from harvest), has today's Land Maintenance netted off the
 *      top (`netUpkeepFromPayout`) and is credited.
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

  // Step 2: net Land Maintenance off the top, then credit the Gold,
  // prestige-multiplied. `sold.gold` below stays the sale's sticker price;
  // netUpkeepFromPayout only changes what actually lands in the wallet.
  const basePrice = machineItemSellPrice(item) * input.quantity;
  const prestigeMultiplier = await getPrestigeMultiplier(profile.id);
  // FLOORED, same posture settleHarvest's own prestige step used to take: a
  // multiplier may not invent a Gold piece out of a rounding rule.
  const gold = Math.floor(basePrice * Math.max(1, prestigeMultiplier));
  const netGold = await netUpkeepFromPayout(profile.id, now, gold);
  let paid: PlayerProfile | null = null;
  try {
    paid = await creditGoldByProfile(profile.id, netGold);
  } catch (error) {
    console.error("stackacres.sell_credit_failed", { profileId: profile.id, item, quantity: input.quantity, gold: netGold, error });
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
 * capacity, placed machines, Synergy Tree perks, the donation register and
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
  await syncStackAcresPipeNetwork(profileId, grid);

  await stampIrrigatedCrops(rows, new Set<string>([...grid.irrigatedUnitIds, ...alsoStamp]), now);

  return grid;
}

/**
 * Breaks ground: a brand new one-tile bed on bare ground. Free -- the hoe
 * costs nothing, so nothing is spent and nothing is refunded. See
 * `plantSoilTile` in lib/stackacres/soil.ts, the pure version of this same
 * decision.
 *
 * Bounded to the two places a bed can mean anything -- the Crop Fields
 * (`CROP_FIELD_BEDS`) and the Homestead's two grass paddocks (`HOME_PLOTS`) --
 * never trusting the client's tapped coordinate blindly. That bound is the
 * WHOLE check: neither place is bought, so there is no unlock to refuse
 * against. Breaking the first bed in the Crop Fields is what records that
 * milestone; a bed on the Homestead's grass does not, since it is not Crop
 * Fields ground.
 */
export async function placeStackAcresSoilTile(
  token: string,
  input: { tx: number; ty: number },
  now = new Date(),
): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  const tx = Math.trunc(input.tx);
  const ty = Math.trunc(input.ty);

  const area = CROP_FIELD_BEDS;
  const rect = soilTileRect(tx, ty);
  const inMeadow =
    rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height;
  const inPaddock = isHomePlotTile(tx, ty);
  if (!inMeadow && !inPaddock) {
    throw new StackAcresRequestError(
      "A bed can only be tilled on the grass by the house or in the Crop Fields.",
      400,
    );
  }

  // The slots the crops are holding, so the new bed's order clears them --
  // see `nextSoilOrder` in lib/stackacres/soil.ts. Passed unevaluated: the
  // memory store is the only one that needs the read, and the RPC does the
  // same arithmetic in SQL.
  const outcome = await placeSoilTileRow(profile.id, tx, ty, SOIL_DEFAULT_TIER, async () =>
    (await listStackAcresUnits(profile.id))
      .map((unit) => unit.soilSlot)
      .filter((slot): slot is number => slot !== null),
  );
  if (outcome.kind === "created") {
    // Breaking ground in the Crop Fields IS clearing them -- there is no
    // gate, no price and no modal any more, so the milestone the rest of the
    // game hangs off (travellers arriving, the tool tiers, the crossbreeding
    // shelf) is recorded off the first bed rather than off a purchase. Once
    // set it never unsets, the same as every other permanent row, so lifting
    // that bed again does not take the Crop Fields back. A bed on the
    // Homestead's grass is not Crop Fields ground and records nothing.
    //
    // Run without a read first: the writer is an ignore-duplicates upsert
    // (one round trip, idempotent), where "is it set already?" would cost a
    // read and still race the other tab.
    if (inMeadow) await recordStackAcresCropFieldsUnlocked(profile.id, now);
    await recordStoryEvents(profile.id, [{ kind: "soil-placed", count: 1 }]);
    return view(profile, now);
  }

  // Both remaining outcomes ("occupied" and a lost race for the same bare
  // cell) read as the same thing to the player -- there is already a bed there.
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
 * NEVER remove-then-place. A crop's position is `soilSlot`, which is a bed's
 * `tile_order` (lib/stackacres/soil.ts), not a coordinate -- as long as a
 * tile keeps that order while its tx/ty change, every crop standing on it
 * keeps resolving to the same bed with no unit-row write at all. Removing
 * and reinserting would hand out a NEW order, stranding the bed's crop, and
 * (per `removeStackAcresSoilTile` above) delete the occupant outright.
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

  // No unlock check: a bed can only be here because this farm broke the
  // ground itself, which is what records the flag in the first place.
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
  const cropInput = input.crop;
  if (typeof cropInput !== "string" || !isStackAcresCrop(cropInput)) {
    throw new StackAcresRequestError("Not a real crop.", 400);
  }
  const crop: StackAcresCrop = cropInput;
  if (!isActiveStock(crop)) {
    throw new StackAcresRequestError(`Ray doesn't sell ${STACKACRES_CATALOGUE[crop].label} seed any more.`, 400);
  }
  const profile = await ensureProfile(token);
  const built = await builtMachineKinds(profile.id);
  if (!isSeedUnlocked(crop, built)) {
    throw new StackAcresRequestError(seedLockedMessage(crop, built), 409);
  }
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
 *
 * EVERY OTHER CROP IS LEFT ALONE, and that is the whole point of a slot
 * being a bed's `order` rather than its place in the bed list. Under the
 * old index-into-`orderedSoilTiles` shape this call quietly moved every crop
 * ordered after the removed bed onto its neighbour's bed, so lifting a bed
 * in one corner shuffled a row of lettuce in another (2026-09-14). Nothing
 * here renumbers anything now because there is nothing left to renumber.
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

/* ------------------------------------------------------------------ */
/* The travelers' story                                                */
/* ------------------------------------------------------------------ */

/** How many times a story write is re-read and retried after losing a
 *  version race before giving up. Two farm actions landing in the same
 *  instant is the common case this covers; more than that is a client
 *  hammering the route, which the rate limiter already answers. */
const STORY_WRITE_ATTEMPTS = 3;

/**
 * Advances every open traveler quest by what an action just did, inside
 * that action -- see lib/stackacres/story/state.ts's `applyStoryEvent`.
 *
 * Called AFTER the action's own settlement is durable, and best-effort like
 * every other side effect a harvest folds in: a story hiccup must never turn
 * a settled, credited action into an error response. Version-guarded and
 * retried, so two actions landing together each count; the client replays
 * the same events locally and this server view overwrites its guess.
 */
async function recordStoryEvents(profileId: string, events: readonly StoryEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    for (let attempt = 0; attempt < STORY_WRITE_ATTEMPTS; attempt += 1) {
      const current = await readStackAcresStory(profileId);
      const next = events.reduce(applyStoryEvent, current.story);
      // Same object means no open quest listened to any of these.
      if (next === current.story) return;
      if ((await writeStackAcresStory(profileId, next, current.version)) !== null) return;
    }
    console.error("stackacres.story_event_lost_race", { profileId, events });
  } catch (error) {
    console.error("stackacres.story_event_failed", { profileId, events, error });
  }
}

/**
 * Accepts a traveler's first quest -- what the bubble's "I'll help" sends.
 * Moves no Gold and touches no inventory. The unlock is re-derived here off
 * the same shop progress the store's own locks read (see readShopProgress),
 * so a hand-rolled POST for a locked traveler is refused the same way the
 * greyed-out bubble already is. A second accept is a harmless no-op.
 */
export async function meetStackAcresTraveler(
  token: string,
  travelerInput: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!isTravelerId(travelerInput)) throw new StackAcresRequestError("There is nobody there to talk to.", 400);
  const traveler: TravelerId = travelerInput;
  const name = TRAVELER_CATALOGUE[traveler].name;
  const profile = await ensureProfile(token);

  for (let attempt = 0; attempt < STORY_WRITE_ATTEMPTS; attempt += 1) {
    const [current, progress] = await Promise.all([readStackAcresStory(profile.id), readShopProgress(profile.id)]);
    const result = meetTraveler(current.story, traveler, progress);
    if (result.outcome === "locked") {
      throw new StackAcresRequestError(`${name} is not ready to talk yet.`, 409, {
        round: await snapshots(profile.id, now),
      });
    }
    if (result.outcome === "already-met") {
      return { ...(await view(profile, now)), storyResult: { traveler, outcome: "already-met", granted: null } };
    }
    if ((await writeStackAcresStory(profile.id, result.story, current.version)) !== null) {
      return { ...(await view(profile, now)), storyResult: { traveler, outcome: "met", granted: null } };
    }
  }
  throw new StackAcresRequestError(`${name} was mid-sentence. Try again.`, 409, {
    round: await snapshots(profile.id, now),
  });
}

/**
 * Hands in a traveler's active quest -- what the bubble's turn-in button
 * sends. Refuses before touching anything (not met, already home, an
 * objective still short), and only then debits the quest's deliver items
 * and advances the line in ONE transaction (`turn_in_homestead_story_quest`),
 * so a refused turn-in never costs an item and a lost race costs nothing
 * twice. The last quest of a line grants that traveler's keepsake, a story
 * item inside the same document -- never Gold, and never a machine item:
 * the currency wall below pins Gold to its four sites and this is not one.
 */
export async function turnInStackAcresTravelerQuest(
  token: string,
  travelerInput: string,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!isTravelerId(travelerInput)) throw new StackAcresRequestError("There is nobody there to talk to.", 400);
  const traveler: TravelerId = travelerInput;
  const name = TRAVELER_CATALOGUE[traveler].name;
  const profile = await ensureProfile(token);

  for (let attempt = 0; attempt < STORY_WRITE_ATTEMPTS; attempt += 1) {
    // The durable half of `StoryFacts`: work a player can only do once is
    // read off the farm here rather than counted, so doing it before the
    // quest was accepted still counts. See StoryFacts' own header.
    const [current, inventory, tool, cleared, soilTiles, enchantments, crossbreeds] = await Promise.all([
      readStackAcresStory(profile.id),
      readStackAcresInventory(profile.id),
      readStackAcresToolTier(profile.id),
      readStackAcresSectors(profile.id),
      listStackAcresSoilTiles(profile.id),
      listOwnedForgeEnchantmentIds(profile.id),
      readStackAcresCrossbreedInventory(profile.id),
    ]);
    const result = applyTurnIn(current.story, traveler, inventory, {
      tool,
      sectorsCleared: cleared.length,
      soilBeds: soilTiles.length,
      enchantments: forgeEnchantmentIdsFromOwned(enchantments).length,
      crossbreeds: Object.values(crossbreeds).reduce((sum, n) => sum + (n ?? 0), 0),
    });
    if (result.outcome === "not-met") {
      throw new StackAcresRequestError(`Say hello to ${name} first.`, 409, {
        round: await snapshots(profile.id, now),
      });
    }
    if (result.outcome === "already-done") {
      throw new StackAcresRequestError(`${name} has already gone home.`, 409, {
        round: await snapshots(profile.id, now),
      });
    }
    if (result.outcome === "not-ready") {
      const quest = activeQuest(current.story.travelers[traveler], traveler);
      if (quest === null) throw new Error(`${traveler}: not-ready with no active quest`);
      throw new StackAcresRequestError(`${quest.title} is not finished yet.`, 409, {
        round: await snapshots(profile.id, now),
      });
    }
    const quest = result.quest;
    if (quest === null) throw new Error(`${traveler}: turn-in ${result.outcome} without a quest`);

    const debits = quest.objectives.flatMap((objective) =>
      objective.kind === "deliver" ? [{ item: objective.item, quantity: objective.target }] : [],
    );
    const written = await turnInStackAcresStory(profile.id, result.story, current.version, debits);
    if (written === "insufficient") {
      throw new StackAcresRequestError(`You do not have everything ${name} asked for.`, 409, {
        round: await snapshots(profile.id, now),
      });
    }
    if (written === "ok") {
      return {
        ...(await view(profile, now)),
        storyResult: { traveler, outcome: result.outcome, granted: result.granted },
      };
    }
  }
  throw new StackAcresRequestError(`${name} was mid-sentence. Try again.`, 409, {
    round: await snapshots(profile.id, now),
  });
}

/** Maps a thrown error to the response every StackAcres route sends. */
export function toStackAcresErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That could not be worked.");
}
