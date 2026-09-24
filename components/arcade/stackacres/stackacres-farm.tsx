"use client";

import { fenceKey, type FencePiece } from "@/lib/stackacres/fences";
import { soilToMapTile } from "@/lib/stackacres/hoeable";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type ReactNode,
} from "react";
import clsx from "clsx";
import {
  Dna,
  Lock,
  Moon,
  Sparkles,
  Sun,
  Wand2,
  X,
} from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import { useMinHoldFade } from "@/components/loading/use-min-hold-fade";
import { useLandscape } from "@/components/use-landscape";
import { useTightLandscape } from "@/components/use-tight-landscape";
import { useAppShell } from "@/components/shell/app-shell";
import {
  setAmbienceAwake,
  setAmbienceHerd,
  setAmbiencePlace,
  setAmbienceRiverUnlocked,
  setFarmSfxMuted,
  startAmbience,
  stopAmbience,
} from "@/lib/audio/stackacres-ambience";
import { timeOfDay } from "@/lib/audio/stackacres-music";
import {
  buySound,
  collectSound,
  expandSound,
  feedSound,
  forageSound,
  goldSound,
  hoeSound,
  journalSound,
  mapSound,
  muckSound,
  panelSound,
  questStepSound,
  refusedSound,
  sellSound,
  sowSound,
  toolSound,
  townFavorSound,
  travelSound,
  waterSound,
} from "@/lib/audio/stackacres-sfx";
import { HOE_STRIKE_MS } from "@/lib/stackacres-td/hoe";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_CROPS,
  STACKACRES_FEED,
  STACKACRES_FEED_SHIPMENTS_PER_PURCHASE,
  STACKACRES_LIVESTOCK,
  STACKACRES_SEED_BAGS_PER_PURCHASE,
  type SeedStock,
  type StackAcresCrop,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import { buyOptionsForZone, lockedLivestock, type BuyOption } from "@/lib/stackacres/district-panel";
import {
  STACKACRES_ITEM_CATALOGUE,
  STACKACRES_ITEMS,
  STACKACRES_YIELDS,
  itemLabel,
  itemSellPrice,
  type StackAcresItem,
} from "@/lib/stackacres/items";
import {
  SECRET_ITEM_CATALOGUE,
  SECRET_ITEM_IDS,
  type HiddenZoneId,
  type SecretItemId,
} from "@/lib/stackacres/secrets";
import {
  HOME_SECTOR,
  isSectorUnlocked,
  sectorClearCheck,
  sectorLabel,
  type SectorId,
} from "@/lib/stackacres/sectors";
import { upkeepState, type StackAcresUpkeepState } from "@/lib/stackacres/upkeep";
import { withLocalClockUnit, type StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import type { StackAcresTool } from "@/lib/stackacres/tools";
import { findCascadeTargets } from "@/lib/stackacres/harvest-cascade";
import {
  HUD_VIEW_EXPANSION,
  stockZone,
} from "@/lib/stackacres/world";
import {
  createSoilMap,
  hasSoilTile,
  type SoilTile,
} from "@/lib/stackacres/soil";

import type { StackAcresContractRow } from "@/lib/stackacres/contracts";
import { emptyInventory, inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import type { MachineKind, StackAcresMachineSnapshot } from "@/lib/stackacres/machines";
import type { StackAcresWheatPlotSnapshot } from "@/lib/stackacres/wheat-plot";
import type { CellarItem, VatContainer } from "@/lib/stackacres/aging";
import type { RecipeId } from "@/lib/stackacres/recipes";
import {
  RELIC_CATALOGUE,
  devotionView,
  freshDevotion,
  type RelicId,
  type StackAcresDevotionView,
} from "@/lib/stackacres/devotion";
import {
  FRIENDSHIP_NPCS,
  KEEPSAKE_CATALOGUE,
  NPC_GIFT_CATALOGUE,
  freshFriendship,
  friendshipView,
  type GiftOutcome,
  type KeepsakeId,
  type NpcId,
  type StackAcresFriendshipView,
} from "@/lib/stackacres/friendship";
import { machineItemLabel, machineItemNoun, type MachineItemId, type MachineProcessedItem } from "@/lib/stackacres/machine-items";
import { FISHING_BAIT_ITEM, castTier, type FishSpecies } from "@/lib/stackacres/fishing";
import { rollGaugeDifficulty } from "@/lib/stackacres/fishing-gauge";
import { rollQuarryDifficulty } from "@/lib/stackacres/hunt-proximity";
import { QUARRY_CATALOGUE, bestWeapon, type QuarrySpecies } from "@/lib/stackacres/hunting";
import type { WoodNodeSnapshot } from "@/lib/stackacres/wood";
import type { StoneNodeSnapshot } from "@/lib/stackacres/stone-nodes";
import type { ForageNodeSnapshot } from "@/lib/stackacres/forage";
import {
  ACTION_BATCH_WINDOW_MS,
  actionForUnits,
  batchWindowRemainingMs,
  coalesceActionTap,
  reopenActionBatch,
  type ActionBatchWindow,
  type BatchableAction,
} from "@/lib/stackacres/action-batch";
import { SYNERGY_PERKS, type SynergyArchetype } from "@/lib/stackacres/synergy-perks";
import {
  STACKACRES_PRESTIGE_BASE_MULTIPLIER,
  STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS,
  type StackAcresPrestigeResetResult,
  type StackAcresPrestigeView,
} from "@/lib/stackacres/prestige";
import { FORGE_ENCHANTMENTS } from "@/lib/stackacres/forge";
import { PEN_ZONE_IDS, type ZoneId } from "@/lib/stackacres/zones";
import type { PlayerProfile } from "@/lib/profile/types";
import { useOnboardingTour } from "@/lib/onboarding/use-onboarding-tour";
import { STACKACRES_TOUR_STEPS } from "@/lib/onboarding/tour-steps";
import type { PainterName } from "./stackacres-art";
import { StackAcresBuySection } from "./stackacres-district-panel";
import { StackAcresIcon } from "./stackacres-icon";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";
import { StackAcresGreenhousePanel } from "./stackacres-greenhouse-panel";
import { TownContractsModal, type ContractActionResult } from "./TownContractsModal";
import { WorkshopModal, type WorkshopActionResult } from "./WorkshopModal";
import { FermentingVatModal, type VatActionResult } from "./FermentingVatModal";
import {
  MythicBlueprintDashboard,
  type BlueprintActionResult,
  type BlueprintCardView,
} from "./mythic-blueprint-dashboard";
import type { BlueprintId } from "@/lib/stackacres/blueprints";
import {
  StackAcresPrestigeResetModal,
  type StackAcresPrestigeActionResult,
} from "./prestige-reset-modal";
import { SunlightForgeTable, type ForgeActionResult } from "./SunlightForgeTable";
import {
  CrossbreedBedSheet,
  type CrossbreedActionResult,
  type CrossbreedHarvestActionResult,
} from "./crossbreed-bed-sheet";
import {
  emptyCrossbreedBedView,
  type CrossbreedBedView,
  type CrossbreedHarvestSettlement,
} from "@/lib/stackacres/crossbreeding";
import { SynergyBadge, SynergyOverlay } from "./SynergyOverlay";
import { StackAcresHudOverflow } from "./stackacres-hud-overflow";
import { StackAcresMusicToggle } from "./stackacres-music-toggle";
import { StackAcresPlayScreen } from "./stackacres-play-screen";
import { STOCK_ICON } from "./stock-icon";
import { StackAcresMonkDialogue } from "./stackacres-monk-dialogue";
import { StackAcresSleepDialogue } from "./stackacres-sleep-dialogue";
import { StackAcresFriendshipDialogue } from "./stackacres-friendship-dialogue";
import { StackAcresSectorModal } from "./stackacres-sector-modal";
import { StackAcresRayWelcome } from "./stackacres-ray-welcome";
import { StackAcresStoryDialogue } from "./stackacres-story-dialogue";
import { useStackAcresStory, type StackAcresStoryController } from "@/lib/stackacres/story/use-stackacres-story";
import { storyEventsForAction } from "@/lib/stackacres/story/predict";
import type { StackAcresStoryView } from "@/lib/stackacres/story/state";
import type { StoryIntent } from "@/lib/stackacres/story/dialogue";
import { TRAVELER_CATALOGUE, WILD_AREA_TRAVELER, type TravelerId } from "@/lib/stackacres/story/travelers";
import { type MapPlaceId } from "@/lib/stackacres/map-places";
import { StackAcresMapSheet, mapPlaceStates } from "./stackacres-map-sheet";
import { STORY_ITEM_CATALOGUE, isStoryItemId } from "@/lib/stackacres/story/items";
import type { StackAcresWorldApi, TapPoint, TravelerUnlocks } from "./world-contract";
import { StackAcresToolbelt } from "./stackacres-toolbelt";
import { StackAcresSeedWheel, type SeedWheelItem } from "./stackacres-seed-wheel";
import {
  BELT_TOOL_DEFS,
  beltAnimation,
  resolveBeltAction,
  type BeltTool,
} from "@/lib/stackacres/toolbelt";
import type { UseSquare } from "./world-contract";
import { WATER_CAPACITY } from "@/lib/stackacres/water-can";
import {
  ENERGY_MAX,
  ENERGY_REGEN_CAP,
  ENERGY_START,
  FISHING_CAST_ENERGY,
  TOO_TIRED_TO_FISH,
  energyAt,
  type FoodItem,
  type StackAcresEnergyAnchor,
} from "@/lib/stackacres/energy";
import { NOT_SLEEPY, canSleepAt, clockLabel, gameHourAt, isNightHour, offsetAfterSleep } from "@/lib/stackacres/clock";
import { AXE_SWING_ENERGY, TOO_TIRED_TO_CHOP, type AxeLevel, type AxePayment } from "@/lib/stackacres/axe";
import { shelfFeedFor } from "@/lib/stackacres/feeding";
import { StackAcresHouse } from "./stackacres-house";
import { isActiveStock } from "@/lib/stackacres/scope";
import { isSeedUnlocked, seedLockLine } from "@/lib/stackacres/seed-unlocks";
import { chapterFinishedBy, chapterViews, currentChapter, type Chapter } from "@/lib/stackacres/chapters";
import { StackAcresChapterCard } from "./stackacres-chapters";
import { StackAcresJournalChip, StackAcresJournalSheet } from "./stackacres-journal";
import {
  isClearableSector,
  landClearingProgress,
  type ClearingGround,
  type LandObstacleSnapshot,
} from "@/lib/stackacres/land-clearing";
import { journalView } from "@/lib/stackacres/journal";
import { wantedForLine } from "@/lib/stackacres/recipe-uses";
import { useStackAcresMusic } from "./use-stackacres-music";
import { StackAcresTopdownWorld } from "../stackacres-td/topdown-world";
import {
  STACKACRES_STARTING_TIER,
  nextToolTier,
  stackacresToolTierDef,
  toStackAcresToolTier,
  toolUpgradePrice,
  type StackAcresToolTier,
} from "@/lib/stackacres/equipment";
import {
  STACKACRES_CUTTERS,
  STACKACRES_STARTING_CUTTER,
  heldStackAcresCutter,
  isStackAcresBuyableCutter,
  isStackAcresCutter,
  ownedStackAcresCutters,
  stackacresCutterDef,
  type StackAcresBuyableCutter,
  type StackAcresCutter,
} from "@/lib/stackacres/cutters";
import { isUnbuiltCutter } from "@/lib/stackacres/unbuilt";
import {
  evaluateStackAcresShopLock,
  type StackAcresShopProgress,
} from "@/lib/stackacres/shop-locks";
import {
  applyInfluenceDiscount,
  influenceTier,
  nextInfluenceTier,
} from "@/lib/stackacres/influence-tiers";
import { type Action, intentOf, newIntentKey, purchaseCueText, unitsBeingCollected } from "@/lib/stackacres/farm-actions";
import {
  createsStackAcresUnit,
  isOptimisticUnitId,
  predictStackAcresAction,
  unitIdsIn,
  withResolvedUnitIds,
  type FarmPredictContext,
  type MachineView,
} from "@/lib/stackacres/optimistic-actions";
import { sendActionWithRetry } from "@/lib/stackacres/action-retry";
import {
  GuessClaims,
  guessClaims,
  isClaimOnUnit,
  layFarmField,
  sameOrNext,
  takesNext,
  type ClaimKey,
  type FarmFields,
  type GuessField,
  type LayMode,
} from "@/lib/stackacres/pending-guesses";

/** A promise and the handle that settles it, for a gate another call has to
 *  be able to wait on -- see `pendingUnitCreates`. */
function settleable(): { promise: Promise<void>; settle: () => void } {
  let settle = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** How many rounds of waiting a provisional target gets before the tap is
 *  refused. One is the real case (the create that made it); the extra
 *  passes only cover a create that started while we were already waiting,
 *  and the bound is what stops a busy farm holding a tap open forever. */
/** The fence key of the map square under a soil square: the belt works soil squares, fences stand on map squares. */
function soilSquareFenceKey(tile: { tx: number; ty: number }): string {
  const { mx, my } = soilToMapTile(tile.tx, tile.ty);
  return fenceKey(mx, my);
}

const PROVISIONAL_WAIT_PASSES = 3;

/**
 * StackAcres: a farm of staked crops and livestock, drawn as a place you look
 * around in.
 *
 * THERE IS NO PLOT GRID (see 2026-09-03's CLAUDE.md entry -- "districts hold
 * stock, not plots"), but THE FARM ITSELF IS THE CONTROLS. A tap that lands
 * on a unit's own picture collects, feeds or clears it where it stands; a
 * tap on a district's empty fenced ground drops ./stackacres-radial-menu.tsx
 * beside the finger to seed something there. Nothing opens, nothing has to be
 * travelled to first, and `place` follows the finger rather than the other
 * way round. lib/stackacres/tap-action.ts is what decides which of those a
 * given tap is, off `unitRowAction`, which is the one place that decides
 * what a unit affords.
 *
 * The sidebar that used to hold the deep end is gone. Buying outright and
 * expanding capacity moved to the Supply Store's Livestock shelf. Travelling
 * flies the
 * camera and nothing else -- so the old tap-district / wait / find-the-row /
 * press-Collect loop is gone. Its unit rows STAY, and are not redundant:
 * they remain the only keyboard and screen-reader path to everything a tap
 * on the canvas does, and the canvas is `aria-hidden` by design.
 *
 * The DATABASE is the one thing that did not move: `homestead_plots` (left
 * in place, inert), `homestead_units`, `homestead_capacity`,
 * `homestead_inventory`, `homestead_harvests`, `homestead_feed`,
 * `homestead_exchanges`, `profiles.homestead_access` keep their names --
 * live objects in a production schema, renaming them is a data migration to
 * fix a caption.
 *
 * No poll. Progress is a pure function of the timestamps the server already
 * sent, so a one-second local clock re-derives it and the only refetches are
 * mount and tab-return. The one thing that is NOT derivable is muck, which
 * the server rolls once at settlement -- so a collection response is
 * authoritative about it and the client never guesses.
 */

const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** How long a refusal stays on screen before it fades out. */
const NOTICE_MS = 3200;

/** How many extra windows a batched flush may wait for its own intent to
 *  clear before sending anyway and letting `act` answer. Bounded so a stuck
 *  request can never hold a player's taps forever -- see `flushBatch`. */
const BATCH_FLUSH_ATTEMPTS = 3;

/**
 * The Pixel Pilgrim's own opening lines -- formal, devout, and clear that he
 * is a visitor here ("not from this world"), never the same one twice in a
 * row where it can be helped. One is picked at random each time his
 * dialogue opens; the prompt itself ("Will you pray with me?") is fixed and
 * lives in StackAcresMonkDialogue, not here, since it is a question rather
 * than flavor.
 */
const PIXEL_PILGRIM_LINES: readonly string[] = [
  "Peace be with you. I am not of this world -- I came from the pixel realm, and StackAcres has been my home since.",
  "You keep good ground here. Where I am from, land like this is a rarer thing than gold.",
  "Every day I keep my devotions, whether or not a soul stops to share them with me.",
  "I ask nothing of you that I do not also ask of myself.",
];

/** Ray's own opening lines, in the same drawl the welcome
 *  modal already uses. One is picked at random
 *  each time his gift dialogue opens; the prompt itself lives in
 *  StackAcresFriendshipDialogue, not here, for the same reason
 *  PIXEL_PILGRIM_LINES keeps its own prompt out of this array. */
const RAY_GIFT_LINES: readonly string[] = [
  "Well now, what've you got for me?",
  "You didn't have to bring me anything, but I won't say no.",
  "This old farm's given me plenty over the years. Nice to see a bit of it come back around.",
  "Whatever you've got, I expect I'll find a use for it.",
];

/** The processing track as this component holds it. The full machine
 *  snapshot (with the server's `canStart`), not the farmhand planner's
 *  narrower Pick: the Workshop sheet draws timers and ids off these rows. */
interface FarmProcessing {
  contract: StackAcresContractRow | null;
  inventory: StackAcresInventory;
  machines: MachineView[];
  wheatPlots: StackAcresWheatPlotSnapshot[];
}


interface StackAcresResponse {
  units: StackAcresUnitSnapshot[];
  /** How fresh this response is (lib/server/stackacres-revision-store.ts):
   *  strictly higher than any response for an action that finished earlier,
   *  regardless of which one this browser's fetch happens to see first.
   *  Absent only from a response old enough to predate the guard, which
   *  `applyResponse` reads as "apply it, same as always" rather than drop it
   *  -- see that function's own header. */
  revision?: number;
  /** Null for a cookie-less first visit: the read route never mints a session. */
  profile: PlayerProfile | null;
  feed: number;
  /** Water in the can. Absent from a response older than the can. */
  water?: number;
  /** The energy anchor (lib/stackacres/energy.ts). Absent from a response
   *  older than Chapter 1. */
  energy?: StackAcresEnergyAnchor;
  /** The farm clock (lib/stackacres/clock.ts): this farm's offset and the
   *  server's own now for the read. */
  clock?: { offsetMs: number; serverNowMs: number };
  capacity: Partial<Record<StackAcresStock, number>>;
  /** Land the player may work. Everything else is drawn as wild growth. */
  sectors: SectorId[];
  upkeep: StackAcresUpkeepState;
  /** The equipment rung held. Absent only from a response old enough to
   *  predate the ladder, which `toStackAcresToolTier` reads as the Trowel. */
  tool?: StackAcresToolTier;
  /** The axe held (lib/stackacres/axe.ts). Absent from a response older than it. */
  axe?: AxeLevel;
  /** Grass cutters owned, Scythe first. Absent from a response older than
   *  cutters, which leaves the Scythe alone in hand. */
  cutters?: StackAcresCutter[];
  boughtCutter?: StackAcresBuyableCutter;
  collected?: { stock: StackAcresStock; item: StackAcresItem; quantity: number; mucked: boolean };
  harvest?: {
    units: number;
    /** Produce actually credited to inventory -- base yield plus any crit
     *  bonus. Pays no Gold at all; see lib/server/stackacres-service.ts's own
     *  header. */
    tally: { item: StackAcresItem; quantity: number }[];
    /** Every settled unit's yield at today's sell price, before any bonus --
     *  a production figure, not Gold paid (a harvest pays none). */
    gross: number;
    mucked: number;
    /** Whether this sweep rolled a critical harvest. */
    crit: boolean;
    /** Bonus units a crit added, summed per item. Empty when the roll missed. */
    critBonus: { item: StackAcresItem; quantity: number }[];
  };
  upgraded?: { from: StackAcresToolTier; to: StackAcresToolTier };
  /* The processing track -- wheat, mills, stores, and the one open Town
   * Contract. Deliberately NOT folded into `units`: none of it is a
   * `homestead_units` row, and the harvest sweep that pays Gold must never be
   * able to reach it (lib/stackacres/machine-items.ts). All four are optional
   * so a phone holding a bundle older than this feature keeps working. */
  wheatPlots?: StackAcresWheatPlotSnapshot[];
  machines?: (StackAcresMachineSnapshot & { canStart: boolean })[];
  inventory?: StackAcresInventory;
  contract?: StackAcresContractRow | null;
  /** Standing earned to date, for the town board's own header. Optional on the
   *  same terms as the four above. */
  influence?: number;
  /** Only on a settled `fulfill-contract`, and only the amounts -- the purse
   *  itself comes back on `profile` like every other payer's does. */
  contractReward?: { gold: number; influence: number };
  /** The Fermenting Vat's standing: null until one is placed. On every full
   *  view, so `undefined` means an old bundle or an optimistic patch, never
   *  "no vat". */
  vat?: VatContainer | null;
  cellar?: VatContainer | null;
  /** What one Workshop call just did, each set only by its own action's
   *  answer: `work` by the idle-worker pass, `processed` by `process`,
   *  `sold` by `sell`, `vatCollected` by `collect-vat`. The view itself
   *  already carries the resulting state; these are the sheet's own
   *  "here is what that press did" line. */
  work?: {
    wheatCollected: number;
    machinesStarted: number;
    machinesCollected: number;
    siloServings: number;
    kitchenCooked?: { item: MachineItemId; quantity: number } | null;
  };
  processed?: {
    recipe: RecipeId;
    produced: { item: MachineProcessedItem; quantity: number } | null;
    readyAt: string | null;
  };
  sold?: { item: MachineItemId; quantity: number; gold: number };
  vatCollected?: { quantity: number; tier: 1 | 2 | 3; stars: 1 | 2 | 3; multiplier: number; gold: number };
  /** Set by a successful `catch-fish` response; every other action's answer
   *  leaves this undefined. Which fish is the server's own dice roll --
   *  `inventory` above already carries the resulting count, this is only
   *  the cast's own "here is what you landed" line. */
  fishCaught?: { species: FishSpecies };
  /** Set by a `feed`/`feed-pen` whose serving earned extra eggs (Spinach). */
  fed?: { toast: string };
  quarryBagged?: { species: QuarrySpecies; meat: number; pelt: number };
  /** Set by a `chop-tree` response to what THIS swing did; null when the
   *  swing missed (the tree was already felled by a faster request). Every
   *  other action's answer leaves this undefined. */
  woodChopped?: { nodeId: string; quantity: number; felled: boolean } | null;
  /** Every choppable tree's current chop state, always present -- see
   *  lib/stackacres/wood.ts's `WoodNodeSnapshot`. */
  woodNodes?: WoodNodeSnapshot[];
  /** Set by a `mine-stone` response to what THIS swing did. `landed: false`
   *  means the node was already broken and had not yet regrown. Every other
   *  action's answer leaves this undefined. */
  stoneMined?: { landed: boolean; broke: boolean; amount: number };
  /** What one swing at (or one blast on) something standing on unclaimed
   *  land did -- see lib/server/stackacres-service.ts's `workStackAcresLand`.
   *  Null when nothing landed, the same "a lost race says nothing" posture
   *  `woodChopped` takes. */
  landCleared?: {
    obstacleId: string;
    ground: ClearingGround;
    item: MachineItemId | null;
    quantity: number;
    cleared: boolean;
    sectorOpened: boolean;
  } | null;
  /** Every Stone boulder's current mine state, always present -- see
   *  lib/stackacres/stone-nodes.ts's `StoneNodeSnapshot`. */
  stoneNodes?: StoneNodeSnapshot[];
  /** Set by a `gather-forage` response to what THIS pick took. Null means
   *  the bush was already bare. Every other action's answer leaves this
   *  undefined. */
  foraged?: { nodeId: string; crop: StackAcresCrop; quantity: number } | null;
  /** Every forage bush's current state, always present -- see
   *  lib/stackacres/forage.ts's `ForageNodeSnapshot`. */
  forageNodes?: ForageNodeSnapshot[];
  landObstacles?: LandObstacleSnapshot[];
  /** Every fence piece this farm has put up, by Homestead map square. */
  fences?: FencePiece[];
  /** Set (to an item id or null) by a `tap-secret-zone` response only --
   *  absent from every other action's answer. */
  discovery?: SecretItemId | null;
  /** Hidden secrets: what is held, and whether a crit boost is armed. Absent
   *  only from a response old enough to predate the feature. */
  secrets?: { held: Partial<Record<SecretItemId, number>>; boostArmed: boolean };
  secretDonations?: Record<SecretItemId, boolean>;
  /** The Synergy Tree: unlocked/active archetypes, and what
   *  `automated_logistics` currently does to the farmhand's walk speed.
   *  Absent only from a response old enough to predate the feature -- the
   *  farmhand state defaults to speed 1, same as no active perk. */
  synergy?: { unlocked: SynergyArchetype[]; active: SynergyArchetype[]; farmhandSpeedMultiplier: number };
  /** Set only by `unlock-synergy-perk`/`activate-synergy-perk`; every other
   *  action's answer leaves these undefined. `synergy` above already carries
   *  the resulting state -- these are only the toast's own confirmation. */
  synergyUnlock?: { archetype: SynergyArchetype; success: boolean };
  synergyActivate?: { archetype: SynergyArchetype; success: boolean };
  /** Whether the Greenhouse (lib/stackacres/greenhouse.ts) has been built.
   *  Absent only from a response old enough to predate the feature, which
   *  `applyResponse` reads as "not yet". */
  greenhouseBuilt?: boolean;
  /** Whether the Crop Fields (lib/stackacres/crop-fields.ts) have been
   *  unlocked. Same "absent means not yet" posture as `greenhouseBuilt`. */
  cropFieldsUnlocked?: boolean;
  /** Purchased soil beds (lib/stackacres/soil.ts). Absent only from a
   *  response old enough to predate the feature, which `applyResponse` reads
   *  as "no purchased tiles yet" -- starter tiles are never carried here, see
   *  `StackAcresView.soilTiles`'s own doc comment. */
  soilTiles?: SoilTile[];
  /** Unplanted crop seeds per crop id. Absent on a response predating Ray's
   *  seed shelf, which reads as an empty shelf. */
  seedStock?: SeedStock;
  error?: string;
  /** A refusal's own view of the units, plus how fresh it is. Absent only
   *  from a response old enough to predate the revision guard (`applyResponse`
   *  then applies it unconditionally, same as before). */
  round?: { units: StackAcresUnitSnapshot[]; revision?: number };
  /** The Pixel Pilgrim's devotion: this player's current UTC-day streak and
   *  progress up his relic ladder. Absent only from a response old enough
   *  to predate the feature. See lib/stackacres/devotion.ts. */
  devotion?: StackAcresDevotionView;
  /** Set only by a `pray` response; every other action's answer leaves this
   *  undefined. `devotion` above already carries the resulting state --
   *  this is only the dialogue's own confirmation (and, on a fresh rung,
   *  which relic to celebrate). */
  prayer?: { streak: number; alreadyPrayedToday: boolean; grantedRelic: RelicId | null };
  /** NPC friendship: this player's current gift points and keepsake ladder
   *  progress with every NPC that has one. Absent only from a response old
   *  enough to predate the feature. See lib/stackacres/friendship.ts. */
  friendship?: Record<NpcId, StackAcresFriendshipView>;
  /** Set only by a `give-gift` response; every other action's answer leaves
   *  this undefined. `friendship` above already carries the resulting
   *  state -- this is only the dialogue's own confirmation. */
  gift?: {
    npc: NpcId;
    points: number;
    outcome: GiftOutcome | "insufficient-item";
    grantedKeepsake: KeepsakeId | null;
  };
  /** The Prestige Reset Valve's own standing: how many times pulled, the
   *  live multiplier, and gross production still needed before the next
   *  pull. Always present on a current server, same as `upkeep` above --
   *  optional only so a bundle old enough to predate the feature keeps
   *  working. See lib/stackacres/prestige.ts. */
  prestige?: StackAcresPrestigeView;
  /** Set only by a successful `prestige-reset` response; every other
   *  action's answer leaves this undefined. `prestige` above already
   *  carries the resulting standing -- this is only what THIS reset just
   *  bought, for the modal's own confirmation line. */
  prestigeReset?: StackAcresPrestigeResetResult;
  /** The Sunlight Forge: catalogue ids (not the versioned wrapper) this
   *  player has permanently forged. Always present on a current server,
   *  same as `prestige` above -- optional only so a bundle old enough to
   *  predate the feature keeps working. See lib/stackacres/forge.ts. */
  forge?: readonly string[];
  /** The Crossbreeding Bed, straight off `StackAcresView.crossbreed`. Always
   *  present on a current server, same as `forge` above -- optional only so a
   *  bundle old enough to predate the feature keeps working, which
   *  `applyResponse` reads as "nothing planted". See
   *  lib/stackacres/crossbreeding.ts. */
  crossbreed?: CrossbreedBedView;
  /** Set only by a `plant-crossbreed`/`harvest-crossbreed` response; every
   *  other action's answer leaves this undefined. `crossbreed` above already
   *  carries the resulting bed -- the harvest shape is the one the sheet
   *  reads back for its own "what did this breed" line, the plant shape is
   *  never read (the bed repainting IS its confirmation). */
  crossbreedResult?: CrossbreedHarvestSettlement | { planted: unknown };
  /** Ray's Mythic Blueprints: one entry per structure in the catalogue,
   *  present whether or not the player has started it, shaped identically to
   *  `BlueprintCardView` (mythic-blueprint-dashboard.tsx's own client-local
   *  type -- see that file's header for why this reads it structurally
   *  rather than importing the server's `BlueprintView`). Always present on
   *  a current server, optional only so a bundle old enough to predate the
   *  feature keeps working. */
  blueprints?: Record<BlueprintId, BlueprintCardView>;
  /** The travelers' story, straight off `StackAcresView.story`. Always
   *  present on a current server, same as `forge`/`prestige` above --
   *  optional only so a bundle old enough to predate the feature keeps
   *  working, which leaves every traveler's bubble unreachable rather than
   *  wrong. See lib/stackacres/story/. */
  story?: StackAcresStoryView;
  /** Set only by a `story-meet`/`story-turn-in` response; every other
   *  action's answer leaves this undefined. `story` above already carries
   *  the resulting standing -- this is only what THIS call just did, so the
   *  dialogue's own "hello" -> "progress" or "done" -> "home" switch can
   *  fire off the same response that produced it rather than waiting for
   *  the next node derivation. */
  storyResult?: { traveler: TravelerId; outcome: "met" | "already-met" | "advanced" | "completed"; granted: string | null };
}

/**
 * A shelf in Ray's store, named and given the painted badge of what is on it.
 *
 * The three shelves shipped as three uppercase kickers with nothing to tell
 * them apart, so the whole sheet read as one wall of body copy and a player
 * scrolling for the exchange window had to read their way to it. The badge is
 * the same vector painter the icon beside a barn row uses, at a size a thumb
 * can find while moving -- the shelves are now told apart by picture first and
 * by wording second.
 */
function StoreShelf({ icon, children }: { icon: PainterName; children: ReactNode }) {
  return (
    <p className="sa-group-label sa-shelf">
      <span className="sa-shelf-badge" aria-hidden="true">
        <StackAcresIcon name={icon} size={22} />
      </span>
      {children}
    </p>
  );
}

/**
 * The Supply Store's own seven shelves. Each is a full screen of the store
 * rather than a stop on one long scroll -- a player who wants soil taps
 * "Soil" and sees only soil, the same "one thing at a time" shape the
 * seed/soil/feed radial menus already use out on the map. Seeds is the one
 * shelf that still scrolls (it is Ray's whole catalogue), and that is fine:
 * a player who opened it already knows it is nothing but seeds.
 *
 * Livestock reuses the `buyOptionsForZone`/`StackAcresBuySection` pair the
 * deleted signpost drawer used, fed every livestock zone that's currently
 * unlocked rather than only whichever one you're standing in -- hens/pigs/
 * cattle used to be buyable only by travelling to their own district (Hen
 * Haven, the Fold, Ox Fields).
 *
 * "Sell" is the odd one out: every other tab spends Gold, this one is the
 * only place in the whole store that pays it. It reuses `onSell` wholesale
 * (lib/stackacres/farm-actions.ts's generic "sell" action, already wired to
 * WorkshopModal's shelf for the five processing-track items) rather than a
 * second sell path -- the backend already accepts any `StackAcresItem`, the
 * Workshop shelf just never listed the sixteen crops or the three raw
 * animal goods. This tab is that missing listing, not a new mechanic.
 */
type StoreTab = "seeds" | "livestock" | "feed" | "equipment" | "sell";

const STORE_TABS: { id: StoreTab; label: string; icon: PainterName }[] = [
  { id: "seeds", label: "Seeds", icon: "ico-carrot" },
  { id: "livestock", label: "Livestock", icon: "ico-egg" },
  { id: "feed", label: "Feed", icon: "ico-feed" },
  { id: "equipment", label: "Tools", icon: "ico-scythe" },
  { id: "sell", label: "Sell", icon: "ico-gold" },
];

/** A bag/serving/seed price, spelled out unambiguously as Gold rather than
 *  a bare "1,234g" -- a number with a lowercase-letter unit reads as
 *  anything (grams, generic currency) until you already know the game's
 *  shorthand. The coin badge is the same one the header's own balance
 *  uses, so it never needs a second look. */
function StoreCost({ amount }: { amount: number }) {
  return (
    <span className="sa-store-cost">
      <StackAcresPixelIcon name="coin" />
      {amount.toLocaleString()}
    </span>
  );
}

// One request for the whole count: repeated single buys get dropped by the in-flight guard in `act`.
function BuyQuantityControls({
  unitPrice,
  maxQuantity,
  gold,
  pending,
  onBuy,
}: {
  unitPrice: number;
  /** The server's per-request ceiling for this shelf. */
  maxQuantity: number;
  gold: number;
  pending: boolean;
  onBuy: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const clamped = Math.min(Math.max(1, quantity), maxQuantity);
  const cost = unitPrice * clamped;
  const maxAffordable = unitPrice > 0 ? Math.max(0, Math.min(maxQuantity, Math.floor(gold / unitPrice))) : maxQuantity;
  return (
    <div className="sa-buy-qty-row">
      <div className="sa-qty-stepper" role="group" aria-label="Quantity">
        <button
          type="button"
          className="sa-qty-btn"
          disabled={pending || clamped <= 1}
          aria-label="Decrease quantity"
          onClick={() => setQuantity((q) => Math.max(1, Math.min(maxQuantity, q) - 1))}
        >
          −
        </button>
        <span className="sa-qty-value" aria-live="polite">{clamped}</span>
        <button
          type="button"
          className="sa-qty-btn"
          disabled={pending || clamped >= maxQuantity}
          aria-label="Increase quantity"
          onClick={() => setQuantity((q) => Math.min(maxQuantity, Math.max(1, q) + 1))}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="sa-cta"
        disabled={pending || gold < cost}
        aria-label={`Buy ${clamped}, ${cost.toLocaleString()} Gold`}
        onClick={() => onBuy(clamped)}
      >
        <span>Buy {clamped}x</span>
        <StoreCost amount={cost} />
      </button>
      <button
        type="button"
        className="sa-cta is-ghost"
        disabled={pending || maxAffordable === 0}
        aria-label={`Buy max, ${maxAffordable} for ${(maxAffordable * unitPrice).toLocaleString()} Gold`}
        onClick={() => onBuy(maxAffordable)}
      >
        <span>Buy Max</span>
        <span className="sa-store-cost">{maxAffordable}x</span>
      </button>
    </div>
  );
}

/** Re-derives readiness, hunger and dry soil locally so a unit flips without a
 *  network trip. See `withLocalClockUnit`. */
function withLocalClock(units: StackAcresUnitSnapshot[], nowMs: number): StackAcresUnitSnapshot[] {
  return units.map((unit) => withLocalClockUnit(unit, nowMs));
}

const NO_CLAIMS: ReadonlySet<ClaimKey> = new Set();

/** The part of an answer a guess can touch, in the shape the farm holds it. */
function farmFieldsOf(data: Partial<StackAcresResponse>): Partial<FarmFields> {
  const fields: Partial<FarmFields> = {};
  if (data.units) fields.units = data.units;
  if (data.profile) fields.profile = data.profile;
  if (typeof data.feed === "number") fields.feed = data.feed;
  if (typeof data.water === "number") fields.water = data.water;
  if (data.energy) fields.energy = data.energy;
  if (data.capacity) fields.capacity = data.capacity;
  if (data.seedStock) fields.seedStock = data.seedStock;
  if (data.sectors) fields.sectors = data.sectors;
  if (data.upkeep) fields.upkeep = data.upkeep;
  // Through toStackAcresToolTier rather than a cast, for the same reason the
  // store reads it that way: an unknown rung must degrade to a playable one.
  if (data.tool) fields.tool = toStackAcresToolTier(data.tool);
  if (data.cutters) fields.cutters = ownedStackAcresCutters(data.cutters);
  if (typeof data.influence === "number") fields.influence = data.influence;
  if (typeof data.greenhouseBuilt === "boolean") fields.greenhouseBuilt = data.greenhouseBuilt;
  if (typeof data.cropFieldsUnlocked === "boolean") fields.cropFieldsUnlocked = data.cropFieldsUnlocked;
  if (data.soilTiles) fields.soilTiles = data.soilTiles;
  if (data.forageNodes) fields.forageNodes = data.forageNodes;
  if (data.landObstacles) fields.landObstacles = data.landObstacles;
  if (data.fences) fields.fences = data.fences;
  if (data.secrets) fields.secrets = data.secrets;
  if (data.secretDonations) fields.secretDonations = data.secretDonations;
  if (data.synergy) fields.synergy = data.synergy;
  // All four move together or not at all: a response either carries the
  // processing track or predates it, and a half-applied one would show a
  // contract next to inventory numbers from a different moment.
  if (data.inventory && data.wheatPlots && data.machines) {
    fields.contract = data.contract ?? null;
    fields.inventory = data.inventory;
    fields.machines = data.machines;
    fields.wheatPlots = data.wheatPlots;
  }
  return fields;
}

/** The farm shell, over the top-down world (components/arcade/stackacres-td/). */
export function StackAcresFarm() {
  const [units, setUnits] = useState<StackAcresUnitSnapshot[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [feed, setFeed] = useState(0);
  const [water, setWater] = useState(WATER_CAPACITY);
  const [energy, setEnergy] = useState<StackAcresEnergyAnchor>(() => ({
    level: ENERGY_START,
    updatedAt: new Date().toISOString(),
  }));
  /**
   * The farm clock (lib/stackacres/clock.ts): this farm's offset, and how far
   * the server's clock is ahead of this device's. A ref, because the map reads
   * it every frame through `gameHourNow`.
   */
  const clockRef = useRef({ offsetMs: 0, skewMs: 0 });
  /** While a sleep is on its way, the offset it replaced. A response that
   *  still carries that one was read before the sleep landed. */
  const sleepingFrom = useRef<number | null>(null);
  const gameHourNow = useCallback(
    () => gameHourAt(Date.now() + clockRef.current.skewMs, clockRef.current.offsetMs),
    [],
  );
  /** The hour the HUD clock shows, re-read every couple of seconds. */
  const [clockHour, setClockHour] = useState(() => gameHourAt(Date.now(), 0));
  useEffect(() => {
    const timer = window.setInterval(() => setClockHour(gameHourNow()), 2000);
    return () => window.clearInterval(timer);
  }, [gameHourNow]);
  /** The bed's "Go to sleep?" card, where the bed was tapped, or null. */
  const [sleepDialog, setSleepDialog] = useState<TapPoint | null>(null);
  /** The map's own box, so a drag tool can be kept inside it. */
  const fieldRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState<Partial<Record<StackAcresStock, number>>>({});
  const [toolTier, setToolTier] = useState<StackAcresToolTier>(STACKACRES_STARTING_TIER);
  const [axe, setAxe] = useState<AxeLevel>(1);
  // Grass cutters owned, and the one last picked on this device. `cutter` is
  // what is actually in hand: the pick while it is still owned, else the best.
  const [cutters, setCutters] = useState<StackAcresCutter[]>([STACKACRES_STARTING_CUTTER]);
  const [pickedCutter, setPickedCutter] = useState<StackAcresCutter | null>(null);
  const cutter = heldStackAcresCutter(pickedCutter, cutters);
  const visibleCutters = useMemo(
    () =>
      STACKACRES_CUTTERS.filter(
        (id) =>
          !isUnbuiltCutter(id) || (id !== STACKACRES_STARTING_CUTTER && cutters.includes(id)),
      ),
    [cutters],
  );
  useEffect(() => {
    // Deferred a tick, same as Ray's hello below: react-hooks/set-state-in-effect
    // rejects a synchronous setState in the effect body.
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem("sa-cutter");
        if (isStackAcresCutter(stored)) setPickedCutter(stored);
      } catch {
        // Blocked storage: the best cutter owned stays in hand.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  // The Synergy Tree. Seeded to "nothing unlocked, nothing active, speed 1"
  // -- the same state a brand-new farm's own first read answers with.
  const [synergyUnlocked, setSynergyUnlocked] = useState<SynergyArchetype[]>([]);
  const [synergyActive, setSynergyActive] = useState<SynergyArchetype[]>([]);
  const [farmhandSpeedMultiplier, setFarmhandSpeedMultiplier] = useState(1);
  // The Pixel Pilgrim's devotion. Seeded to a fresh player's own answer --
  // the same state a brand-new farm's own first read comes back with.
  const [devotion, setDevotion] = useState<StackAcresDevotionView>(() =>
    devotionView(freshDevotion(), new Date()),
  );
  // The Prestige Reset Valve. Seeded to a profile that has never pulled it --
  // the same standing a brand-new farm's own first read comes back with.
  const [prestige, setPrestige] = useState<StackAcresPrestigeView>({
    prestigeCount: 0,
    multiplier: STACKACRES_PRESTIGE_BASE_MULTIPLIER,
    goldToNextPrestige: STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS,
  });
  const [showPrestige, setShowPrestige] = useState(false);
  // What the last successful `prestige-reset` bought, read once by the modal
  // through `onPrestigeReset`'s own return value: `act`'s return type is the
  // fixed `ContractActionResult` shared by every action, and this is the one
  // extra field a reset's own answer carries beyond it.
  const lastPrestigeReset = useRef<StackAcresPrestigeResetResult | null>(null);
  // The Sunlight Forge. Seeded to "nothing forged yet" -- the same standing
  // a brand-new farm's own first read comes back with.
  const [forge, setForge] = useState<readonly string[]>([]);
  const [showForge, setShowForge] = useState(false);
  const [showSynergy, setShowSynergy] = useState(false);
  // The Crossbreeding Bed. Seeded empty -- the same standing a brand-new
  // farm's own first read comes back with. `lastCrossbreedHarvest` is the
  // same sidecar-ref shape `lastPrestigeReset` uses, for the same reason:
  // `act`'s fixed return type has no room for what a harvest just bred.
  const [crossbreed, setCrossbreed] = useState<CrossbreedBedView>(emptyCrossbreedBedView);
  const [showCrossbreed, setShowCrossbreed] = useState(false);
  const lastCrossbreedHarvest = useRef<CrossbreedHarvestSettlement | null>(null);
  // Ray's Mythic Blueprints. Seeded empty -- the dashboard only ever opens
  // from a player press well after mount, by which point the first poll has
  // long since landed, the same posture `forge` above takes.
  const [blueprints, setBlueprints] = useState<Record<BlueprintId, BlueprintCardView>>(
    {} as Record<BlueprintId, BlueprintCardView>,
  );
  const [showBlueprints, setShowBlueprints] = useState(false);
  /**
   * His dialogue: opened by `onWorldMonkTap` (the "greeting" phase, a line
   * plus the "will you pray with me?" prompt), closed by "no", by the next
   * world tap (`onViewMoved`, below), or replaced by the "result" phase once
   * a "yes" answers. `at` is where to anchor it -- the tap point the scene
   * handed back, same convention `radial`'s own screen anchor uses.
   *
   * Deliberately holds no server state beyond one action's own answer:
   * `devotion` above is the ongoing source of truth (streak, today's status,
   * relics held); `result` is only this ONE prayer's own confirmation (so a
   * fresh relic grant can be named), read once out of `act`'s response.
   */
  type MonkDialogueState =
    | { phase: "greeting"; at: TapPoint; line: string }
    | {
        phase: "result";
        at: TapPoint;
        streak: number;
        alreadyPrayedToday: boolean;
        grantedRelic: RelicId | null;
      };
  const [monkDialogue, setMonkDialogue] = useState<MonkDialogueState | null>(null);
  // NPC friendship. Seeded to a fresh player's own answer for every NPC that
  // has one -- the same "fresh player" seed devotion above uses -- rather
  // than an empty object, so a render before the first read lands never has
  // to guard a missing key.
  const [friendship, setFriendship] = useState<Record<NpcId, StackAcresFriendshipView>>(() => {
    const initial = {} as Record<NpcId, StackAcresFriendshipView>;
    FRIENDSHIP_NPCS.forEach((npc) => {
      initial[npc] = friendshipView(freshFriendship(), new Date());
    });
    return initial;
  });
  /**
   * A gift dialogue, one NPC at a time -- opened by `onWorldRayTap` (the
   * "greeting" phase, a line plus his own item picker), closed by the next
   * world tap (`onViewMoved`) or its own close button, or replaced by the
   * "result" phase once a gift answers. Same shape as `MonkDialogueState`;
   * kept a separate type (not a union with it) since a gift result also
   * needs to say WHICH NPC it was for.
   */
  type GiftDialogueState =
    | { phase: "greeting"; npc: NpcId; at: TapPoint; line: string }
    | {
        phase: "result";
        npc: NpcId;
        at: TapPoint;
        outcome: GiftOutcome | "insufficient-item";
        points: number;
        grantedKeepsake: KeepsakeId | null;
      };
  const [giftDialogue, setGiftDialogue] = useState<GiftDialogueState | null>(null);
  /**
   * The travelers' story: the server's own view (Ray plus the ten travelers,
   * lib/stackacres/story/). Fed by every response's `story` field, same
   * "full state, not a diff" posture every other server-owned slice here
   * takes -- `useStackAcresStory` (below) is what turns this into the open
   * bubble and its optimistic tick.
   */
  const [storyView, setStoryView] = useState<StackAcresStoryView | null>(null);
  /**
   * Land the player may work, and what keeping it costs today.
   *
   * Seeded to home-only rather than to everything, the same posture the scene
   * takes with its own `locked` default: until the first read lands, drawing
   * a farm on land that might not be cleared is the wrong way to be wrong.
   */
  const [sectors, setSectors] = useState<SectorId[]>([HOME_SECTOR]);
  /** This profile's placed soil beds -- every one of it, since the free
   *  starter grant was removed (see lib/stackacres/soil.ts's own "starter
   *  kit" section). */
  const [soilTiles, setSoilTiles] = useState<SoilTile[]>([]);
  /** Crop seeds bought from Ray but not planted yet -- the ownership filter
   *  that keeps the gel dock from ever offering a crop the player isn't
   *  carrying, see `cropFieldGelItems`. */
  const [seedStock, setSeedStock] = useState<SeedStock>({});
  const [upkeep, setUpkeep] = useState<StackAcresUpkeepState>(() => upkeepState(0, 0));
  /**
   * The processing track (wheat, mills, the one open Town Contract), held as
   * one object rather than four pieces of state: it arrives as a whole in
   * every response, and the panels that read it (contractPosted, the
   * Greenhouse/Mill inventory rows) want it consistent within one render
   * rather than four separately-updated fields that could briefly disagree.
   * Used to also feed the scene's own automated farmhand -- that wiring is
   * gone along with his walk (see MonkNode's own doc comment in
   * stackacres-scene.ts); this state stays for the UI's own sake.
   */
  const [processing, setProcessing] = useState<FarmProcessing>(() => ({
    contract: null,
    inventory: emptyInventory(),
    machines: [],
    wheatPlots: [],
  }));
  /** The Fermenting Vat, or null until one is placed. Its own atom rather
   *  than a fifth field on `processing`: no predictor moves it (the vat's
   *  sheet awaits the server), so it never needs to ride the snapshot. */
  const [vat, setVat] = useState<VatContainer | null>(null);
  const [cellar, setCellar] = useState<VatContainer | null>(null);
  /** The wild district a finger just landed on, if the clearing modal is up. */
  const [clearing, setClearing] = useState<SectorId | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  /**
   * The intents with a request in the air right now, mirrored into render so
   * a button can grey out ITS OWN action while it settles -- and only its
   * own. This replaced a single global `busy` flag that disabled every
   * control on the screen for the whole round trip: with the optimistic
   * layer applying each guess synchronously (see `act`), an unrelated button
   * has no reason to wait. The authoritative copy is the `inFlight` ref
   * below; this is the render-visible shadow of it.
   */
  const [pendingIntents, setPendingIntents] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [error]);
  // Nothing on the map reads a held StackAcresTool any more; the belt replaced it
  // (lib/stackacres/toolbelt.ts). Kept only to satisfy the world contract's own prop.
  const tool: StackAcresTool = "inspect";
  /**
   * The tool belt (lib/stackacres/toolbelt.ts). What is held decides what the
   * Use key and a tap on a square do, which is what replaced tapping a thing
   * and then dragging a token onto it.
   */
  const [belt, setBelt] = useState<BeltTool>("hand");
  /** The crop the seed pouch sows, and whether its wheel is open. */
  const [seed, setSeed] = useState<StackAcresCrop | null>(null);
  const [seedWheelOpen, setSeedWheelOpen] = useState(false);
  /** The one bed the hoe has asked about lifting. Cleared by anything else the player does. */
  const [armedLift, setArmedLift] = useState<{ tx: number; ty: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** Hidden secrets: what is held, and whether a crit boost is armed. Empty
   *  and unarmed until the first read lands. */
  const [secrets, setSecrets] = useState<{
    held: Partial<Record<SecretItemId, number>>;
    boostArmed: boolean;
  }>({ held: {}, boostArmed: false });
  const [secretDonations, setSecretDonations] = useState<Record<SecretItemId, boolean>>(
    () => Object.fromEntries(SECRET_ITEM_IDS.map((id) => [id, false])) as Record<SecretItemId, boolean>,
  );
  const [showMap, setShowMap] = useState(false);
  const [showGoals, setShowGoals] = useState(false);
  /** The chapter Ray is congratulating the player on, or null. */
  const [chapterCard, setChapterCard] = useState<Chapter | null>(null);
  /** Where the farmer stood when the map was opened, for its "you are here". */
  const [mapHere, setMapHere] = useState<MapPlaceId>("farmstead");
  const [showStore, setShowStore] = useState(false);
  // Escape closes the store, same as every sheet that uses useModalDismiss.
  // The store lives inline in this component rather than in its own file, so
  // it carries its own listener instead of that hook.
  useEffect(() => {
    if (!showStore) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowStore(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showStore]);
  /** Which shelf of the Supply Store is showing. One category on screen at
   *  a time instead of every shelf stacked in one long scroll -- see the
   *  store's own render block below for why. */
  const [storeTab, setStoreTab] = useState<StoreTab>("seeds");
  /**
   * The store's own splash-ring taps (the close key, each shelf tab) -- see
   * `.sa-store-card`'s own CSS comment for why this is a real, if brief,
   * piece of state instead of a CSS `:active` rule: a ring keyed to `:active`
   * reverts the instant a finger lifts, which cuts the animation off rather
   * than letting it fade, and reads as a pop rather than a splash.
   *
   * One shared array rather than one `useState` per splashable button --
   * `STORE_TABS` renders in a `.map()`, and a hook cannot live inside one.
   * Each entry is tagged with which button it belongs to (`key`) so a
   * button only ever renders its own splashes, never another one's.
   */
  const [storeSplashes, setStoreSplashes] = useState<
    { id: number; key: string; x: number; y: number }[]
  >([]);
  const nextStoreSplashId = useRef(0);
  const addStoreSplash = useCallback(
    (key: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const id = nextStoreSplashId.current++;
      setStoreSplashes((prev) => [
        ...prev,
        { id, key, x: event.clientX - rect.left, y: event.clientY - rect.top },
      ]);
      // Matches sa-splash-ring's 520ms duration -- the DOM node's whole job
      // is done once that animation finishes, so it is removed rather than
      // left to accumulate.
      window.setTimeout(() => {
        setStoreSplashes((prev) => prev.filter((splash) => splash.id !== id));
      }, 520);
    },
    [],
  );
  const [showContracts, setShowContracts] = useState(false);
  const [showWorkshop, setShowWorkshop] = useState(false);
  /** The vat's own sheet, opened from inside the Workshop. */
  const [showVat, setShowVat] = useState(false);
  const [showGreenhouse, setShowGreenhouse] = useState(false);
  /** The player's house panel (./stackacres-house.tsx): the kitchen. */
  const [showHouse, setShowHouse] = useState(false);
  const [greenhouseBuilt, setGreenhouseBuilt] = useState(false);
  const [cropFieldsUnlocked, setCropFieldsUnlocked] = useState(false);
  /** Every choppable tree's current chop state -- see lib/stackacres/wood.ts.
   *  Empty until the first response lands, same "fresh player" posture
   *  every other server-derived list on this screen starts from. */
  const [woodNodes, setWoodNodes] = useState<WoodNodeSnapshot[]>([]);
  /** Every Stone boulder's current mine state -- see lib/stackacres/
   *  stone-nodes.ts. Same "fresh player" empty-until-first-response posture
   *  as `woodNodes` above. */
  const [stoneNodes, setStoneNodes] = useState<StoneNodeSnapshot[]>([]);
  /** The forage bushes' ready/crop/respawn state, same "state lives in the
   *  snapshot, never in the component" posture as `woodNodes` above. */
  const [forageNodes, setForageNodes] = useState<ForageNodeSnapshot[]>([]);
  /** What is still standing on land being cleared, same posture again
   *  (lib/stackacres/land-clearing.ts). */
  const [landObstacles, setLandObstacles] = useState<LandObstacleSnapshot[]>([]);
  const [fences, setFences] = useState<FencePiece[]>([]);
  /** Which map squares hold a piece, for the belt's "is there a fence here". */
  const fencedSquares = useMemo(() => new Set(fences.map((piece) => fenceKey(piece.tx, piece.ty))), [fences]);
  /** Same sidecar for the Workshop and the vat: what the last processing
   *  call's answer said it did. `takeProcessingDelta` reads and clears it. */
  const lastProcessing = useRef<Pick<StackAcresResponse, "work" | "processed" | "sold" | "vatCollected"> | null>(null);
  const takeProcessingDelta = useCallback(() => {
    const delta = lastProcessing.current;
    lastProcessing.current = null;
    return delta;
  }, []);
  /** Standing earned to date. Its own state rather than a fifth field on
   *  `processing`: nothing plans against it, it is a number the town board
   *  displays, and adding it there would widen an object whose whole point is
   *  that its four parts move together. */
  const [influence, setInfluence] = useState(0);
  const [celebrate, setCelebrate] = useState<{ unitId: string; nonce: number } | null>(null);
  const [lastCollect, setLastCollect] = useState<{ text: string; nonce: number } | null>(null);
  // Gates a tap-to-play splash: nothing plays until the player has made a
  // real gesture, which also doubles as the autoplay-policy unlock every
  // browser requires before it will let audio start on its own.
  const [hasStarted, setHasStarted] = useState(false);
  // Ray's one-time hello, first visit only -- a plain localStorage
  // flag rather than a profile field, since this is a hello, not a fact about
  // the farm. Read only once `hasStarted` flips true, so it never flashes
  // behind the tap-to-play splash.
  const [showWelcome, setShowWelcome] = useState(false);
  // True once the localStorage check below has actually run, whichever way it
  // came out. Needed as its own flag rather than trusting "!showWelcome" alone:
  // showWelcome starts false and is only set true a tick later (see the effect
  // below), so a naive "!showWelcome" reads as "no welcome needed" for that one
  // tick even on a fresh profile, which raced the spotlight tour onto the
  // screen underneath Ray's own card the first time this shipped.
  const [rayCheckDone, setRayCheckDone] = useState(false);
  useEffect(() => {
    if (!hasStarted) return;
    // Deferred a tick, same reason install-prompt.tsx defers its own
    // localStorage read -- react-hooks/set-state-in-effect rejects a
    // synchronous setState in the effect body.
    const timer = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem("sa-ray-welcomed")) setShowWelcome(true);
      } catch {
        // Private browsing or blocked storage: skip the intro rather than error.
      }
      setRayCheckDone(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasStarted]);
  const dismissWelcome = useCallback(() => {
    panelSound();
    setShowWelcome(false);
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Nothing to persist if storage is blocked; it just re-offers next visit.
    }
  }, []);

  // The spotlight tour, same mechanism as the lobby and table halves
  // (lib/onboarding/use-onboarding-tour.ts): fires once per profile, server
  // side, across all three screens. Gated on the world actually being loaded
  // and Ray's hello either dismissed or never owed, so it never races either
  // splash for the player's attention.
  useOnboardingTour(profile, STACKACRES_TOUR_STEPS, hasStarted && loaded && rayCheckDone && !showWelcome);

  useStackAcresMusic(hasStarted, gameHourNow);

  /**
   * The ambient soundscape, started by the same gesture the music is.
   *
   * It cannot start any earlier: an AudioContext built before a user gesture
   * comes back suspended, and every cue scheduled against it would queue up
   * and then fire at once the moment it resumed. The tap-to-play splash is
   * that gesture -- it exists for the music for exactly this reason, and the
   * ambience rides on the same one rather than inventing a second prompt.
   */
  useEffect(() => {
    if (!hasStarted) return;
    startAmbience();
    return () => stopAmbience();
  }, [hasStarted]);

  // A farm making noise in a background tab is a battery bug, not atmosphere.
  // Suspends the whole graph rather than muting it, so the scheduler stops
  // doing work too.
  useEffect(() => {
    if (!hasStarted) return;
    const onVisible = () => setAmbienceAwake(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hasStarted]);

  const { setImmersive, soundEnabled } = useAppShell();
  useEffect(() => {
    setImmersive(hasStarted);
  }, [hasStarted, setImmersive]);

  /**
   * The farm's action sounds follow the APP-wide mute, not the farm's own
   * background-sound toggle. Two different promises: the HUD speaker means
   * "stop the noise this place makes", the app mute means "stop telling me my
   * taps landed", and silencing button feedback because someone wanted the
   * birds off would be the wrong reading of either.
   */
  useEffect(() => {
    setFarmSfxMuted(!soundEnabled);
  }, [soundEnabled]);

  // Landscape-only, same posture and same hook as the poker table (see
  // poker-table.tsx) rather than a second orientation check invented here.
  const landscape = useLandscape();
  // A short landscape phone collapses the signpost rail into the compass
  // quick-nav (stackacres-destinations.tsx) and hands the map the screen it
  // used to cover (`viewExpansion`). Also doubles as the HUD's own overflow
  // trigger below -- see that comment for why a width breakpoint doesn't
  // work here.
  const compactNav = useTightLandscape();
  /**
   * No `useArcadeSound` here any more.
   *
   * It was called with `gameSounds: true`, which eagerly fetches the POKER
   * table's cue set (deal, chips, win) -- around 450KB -- on a route that
   * never plays any of them. It was there because two actions used to answer
   * with `play("ui")`. Nothing on this screen answers with a chrome cue any
   * more: every press here is either an action on the farm (its own voice in
   * lib/audio/stackacres-sfx.ts) or a panel moving (`panelSound`), so there
   * is no `tapSound` left to import. The app-wide mute is applied by the
   * shell, which is always mounted, so nothing is left for the hook to do.
   */
  const mounted = useRef(true);
  const world = useRef<StackAcresWorldApi | null>(null);
  /**
   * The district the camera was last SENT to, which is not the same as the
   * one it is currently over: the map is unbounded and the player can pan
   * anywhere, so tracking the camera's true position would have this
   * flickering as they crossed the woods. It marks where they chose to go,
   * and it is also the sidebar's whole selection state now -- there is no
   * second "which plot is selected" any more.
   */
  const [place, setPlace] = useState<ZoneId>("farmstead");
  /**
   * Where the finger that started the request in flight landed, so the reward
   * floats out of the thing that was tapped rather than out of the middle of
   * the screen. A ref, not state: nothing renders from it, and it must not be
   * a frame behind the response that reads it.
   */
  const tapAnchor = useRef<TapPoint | null>(null);
  /** The player's "Use radish bait" toggle. Only offered while they hold a
   *  Radish, and only sent as bait while they still do. */
  const [useBait, setUseBait] = useState(false);
  const baitOnHook = useRef(false);
  /** The fish `catch-fish` just landed, kept until the gauge is off the
   *  screen and the map can show it jumping out (see `onWorldFishHooked`). */
  const landedFish = useRef<FishSpecies | null>(null);
  /**
   * Critical Harvest Cascade: what each SOLO collect's response said, keyed
   * by the crop it picked, for `triggerCascade` to read once `act`'s own
   * promise has resolved.
   *
   * A ref, not a return value threaded through `act`: `act`'s declared return
   * type is `ContractActionResult`, owned by TownContractsModal.tsx and about
   * contract settlement, not harvests -- widening it to carry this feature's
   * own payload would be a layering violation for every other caller that
   * already ignores what `act` returns. Keyed by crop because two solo
   * harvests can be in the air at once, and one answer must never be read as
   * the other's. Set only for a one-unit sweep (a tap, never the Harvest-All
   * button) and taken exactly once by `triggerCascade`.
   */
  const lastHarvests = useRef(new Map<string, { crit: boolean; units: StackAcresUnitSnapshot[] }>());
  /**
   * The idempotency key for each action whose fate this browser does not know.
   *
   * Keyed by what the player asked for (`collect:<unitId>`, `stock:hen`), and
   * held ONLY while an attempt at it ended without an answer -- a dropped
   * connection, a request that never came back. That is the one case where
   * pressing again is a retry rather than a second request, and reusing the
   * key is what stops the retry buying a second animal when the first one
   * actually landed.
   *
   * Cleared the moment the server answers at all, success or refusal, because
   * from then on the player pressing again means it: two taps on Seed really
   * are two Sprout Rows, and a key held across them would silently swallow
   * the second.
   */
  const pendingKeys = useRef(new Map<string, string>());
  /**
   * Intents with a request already out for them.
   *
   * The one place every entry point funnels through, so a duplicate press is
   * dropped whether it came from the map, the sidebar or the seed menu -- all
   * three used to lean on the `busy` STATE, which only turns true a render
   * after the request starts and so lets two presses in the same frame both
   * through. Per intent rather than global: two presses at the same hen are
   * one intent pressed twice, feeding one hen and collecting another are not.
   */
  const inFlight = useRef(new Set<string>());

  /**
   * Add / remove one intent from both the ref (synchronous, what the
   * duplicate guard reads) and the render mirror (what a button reads).
   * Called from `act` and from `send`.
   */
  const markInFlight = useCallback((intent: string) => {
    inFlight.current.add(intent);
    setPendingIntents((prev) => {
      if (prev.has(intent)) return prev;
      const next = new Set(prev);
      next.add(intent);
      return next;
    });
  }, []);
  const clearInFlight = useCallback((intent: string) => {
    inFlight.current.delete(intent);
    setPendingIntents((prev) => {
      if (!prev.has(intent)) return prev;
      const next = new Set(prev);
      next.delete(intent);
      return next;
    });
  }, []);
  /**
   * One tile's outstanding `place-soil-tile` request, keyed by `tx,ty`.
   *
   * `onRadialSeed` awaits this before naming the same tile in a `stock`
   * request -- a fast till-then-plant on one bed used to fire both at once,
   * and when the plant's read of the soil table landed before the till's
   * insert did, the server could not find the bed it was told to plant in.
   * It never refuses over that (a stale tap falls through to the lowest
   * free slot, deliberately -- see `assignSoilSlot`'s own header), so the
   * crop grew on a different or absent bed while the till's own, slower
   * response then overwrote the screen with the truth: the tapped tile's
   * bed with nothing planted on it, and an orphaned crop with nowhere
   * pinned. Waiting here makes the plant request always see the till's
   * outcome, win or lose, before it asks.
   */
  const pendingSoilPlacements = useRef(new Map<string, Promise<ContractActionResult>>());
  /**
   * Every unit-creating request still in the air (`stock`, `buy-stock`).
   *
   * While one is out, the crop or animal it made is on screen under an id
   * this browser invented (`sa-optimistic-N`), and a finger is perfectly
   * capable of watering that sprout before the response naming its real row
   * has landed. Sent as-is, that id reached Postgres as a uuid and came back
   * as "invalid input syntax for type uuid", which the player saw as "Could
   * not load that unit" on a crop standing right in front of them.
   * `settleProvisionalTargets` below waits these out and re-points the
   * action at the row the server actually made.
   */
  const pendingUnitCreates = useRef(new Set<Promise<unknown>>());
  /**
   * What every guess still in the air is holding: one crop, one bed, one
   * seed count, the can. An answer paints everything except these, so an
   * answer read before a sibling's write never takes that sibling's guess
   * off the screen. See lib/stackacres/pending-guesses.ts.
   */
  const heldGuesses = useRef(new GuessClaims());
  /**
   * The farm as the last accepted answer had it. A guess that lets go puts
   * what it held back to this, which is right whether its own answer landed,
   * was refused, or lost the race to a newer one.
   */
  const confirmedFarm = useRef<Partial<FarmFields>>({});
  useEffect(() => () => { mounted.current = false; }, []);

  /**
   * The purse every price on this screen is read against. One currency now, so
   * this is simply the player's Gold -- the same balance the poker tables and
   * the Collection spend.
   *
   * An admin account with unlimited Gold can afford anything: the server is
   * the authority on the spend either way, and a button greyed out against a
   * balance that is not real would be a lie.
   */
  const gold = profile?.unlimitedGold
    ? Number.MAX_SAFE_INTEGER
    : (profile?.goldBalance ?? 0);

  /** Whether a given action is mid-flight -- what a button greys itself out
   *  on now, in place of the old screen-wide `busy`. */
  const isPending = useCallback(
    (intent: string) => pendingIntents.has(intent),
    [pendingIntents],
  );
  /** Whether any in-flight intent is `prefix` or `prefix:...` -- for a modal
   *  or menu that fires a family of intents (every synergy archetype, say)
   *  and greys the whole surface while one is settling, while the rest of
   *  the screen stays live. */
  const pendingByPrefix = useCallback(
    (prefix: string) => {
      for (const intent of pendingIntents) {
        if (intent === prefix || intent.startsWith(`${prefix}:`)) return true;
      }
      return false;
    },
    [pendingIntents],
  );
  /**
   * The unit list as of right now, for `act` to read when a response lands.
   *
   * A ref rather than a dependency: `act` is depended on by every handler on
   * the page, so putting `units` in its dependency array would rebuild all of
   * them on every clock tick of every growing unit. The one thing `act` needs
   * from the list is which stock a collected unit was, and that unit is
   * usually DELETED by the time the response arrives (a clean collect removes
   * the row), so the response itself cannot answer it.
   */
  const unitsRef = useRef(units);
  useEffect(() => {
    unitsRef.current = units;
  }, [units]);

  /**
   * The unit list off the last unit-creating response to land, which is what
   * a provisional id has to be matched against. Deliberately not `unitsRef`:
   * that one is synced by an effect, so it still holds the pre-response list
   * for as long as it takes React to commit the setState the response just
   * made, and the wait below finishes well inside that window.
   */
  const unitsFromLastCreate = useRef<StackAcresUnitSnapshot[] | null>(null);

  /**
   * `body` with any provisional unit id replaced by the real one, or null
   * when a target this browser only guessed at cannot be matched to a row
   * the server made.
   *
   * The optimistic units themselves are gone by the time the create lands
   * (the response replaces the whole list), so what they were has to be read
   * off BEFORE the wait and matched afterwards: same stock kind, and the same
   * bed where the guess named one. A livestock pen, which stands on no bed,
   * matches on kind alone -- and only ever against units that were not
   * already on the farm before the wait started. A create that was refused
   * leaves nothing to match and the tap is refused with it, which is right:
   * the crop it was aimed at never existed.
   */
  const settleProvisionalTargets = useCallback(async (body: Action): Promise<Action | null> => {
    const provisional = unitIdsIn(body).filter(isOptimisticUnitId);
    if (provisional.length === 0) return body;
    const guesses = new Map(
      provisional.map((id) => [id, unitsRef.current.find((unit) => unit.id === id)] as const),
    );
    const knownBefore = new Set(
      unitsRef.current.filter((unit) => !isOptimisticUnitId(unit.id)).map((unit) => unit.id),
    );
    for (let pass = 0; pass < PROVISIONAL_WAIT_PASSES && pendingUnitCreates.current.size > 0; pass += 1) {
      await Promise.allSettled([...pendingUnitCreates.current]);
    }
    if (!mounted.current) return null;
    const landed = unitsFromLastCreate.current;
    if (!landed) return null;
    const arrived = landed.filter((unit) => !knownBefore.has(unit.id));
    const claimed = new Set<string>();
    const real = new Map<string, string>();
    for (const [id, guess] of guesses) {
      if (!guess) continue;
      const onSameBed =
        guess.soilSlot === null
          ? undefined
          : arrived.find(
              (unit) =>
                !claimed.has(unit.id) && unit.stock === guess.stock && unit.soilSlot === guess.soilSlot,
            );
      const match =
        onSameBed ?? arrived.find((unit) => !claimed.has(unit.id) && unit.stock === guess.stock);
      if (!match) continue;
      claimed.add(match.id);
      real.set(id, match.id);
    }
    return withResolvedUnitIds(body, (id) => (isOptimisticUnitId(id) ? real.get(id) ?? null : id));
  }, []);

  /**
   * How fresh the farm on screen is right now, per each response's own
   * `revision` (lib/server/stackacres-revision-store.ts). Two actions can be
   * in flight at once (water a crop, feed a hen), and their full-farm
   * responses can land in an order that does not match which one actually
   * finished last -- without this, whichever response arrived most recently
   * won, so a slower response for an action that finished FIRST could
   * overwrite a faster response for one that finished SECOND, flashing the
   * farm back to the older state until the truly latest response caught up
   * a moment later. `acceptRevision` is what every place that applies a
   * server snapshot calls first: a response with no revision at all predates
   * this guard and is trusted unconditionally, same as before it existed.
   */
  const revisionRef = useRef(-1);
  const acceptRevision = useCallback((revision: number | undefined): boolean => {
    if (revision === undefined) return true;
    if (revision <= revisionRef.current) return false;
    revisionRef.current = revision;
    return true;
  }, []);
  /**
   * The held equipment rung, read the same way `unitsRef` is and for the same
   * reason: `act` needs it to name the multiple a crit just paid ("CRIT! x2"),
   * and it is the only plain VALUE that callback wants. Held in a ref rather
   * than added to its dependency list so buying an upgrade does not give the
   * dispatch a new identity -- every other entry in that list is a stable
   * callback, and this is the file's own convention for a value `act` reads
   * without depending on.
   */
  const toolTierRef = useRef(toolTier);
  useEffect(() => {
    toolTierRef.current = toolTier;
  }, [toolTier]);

  /**
   * Lays `fields` over what is on screen, one setter per field, each through
   * `layFarmField` (see its header for the two modes). Every write to the part
   * of the farm a guess can touch goes through here: an answer, a guess, and a
   * guess letting go.
   */
  const layFarm = useCallback((fields: Partial<FarmFields>, mode: LayMode) => {
    const lay = <F extends GuessField>(field: F, set: Dispatch<SetStateAction<FarmFields[F]>>) => {
      const next = fields[field];
      if (next === undefined) return;
      set((prev) => layFarmField(field, prev, next as FarmFields[F], mode));
    };
    lay("units", setUnits);
    lay("profile", setProfile);
    lay("feed", setFeed);
    lay("water", setWater);
    lay("energy", setEnergy);
    lay("capacity", setCapacity);
    lay("seedStock", setSeedStock);
    lay("sectors", setSectors);
    lay("upkeep", setUpkeep);
    lay("tool", setToolTier);
    lay("cutters", setCutters);
    lay("influence", setInfluence);
    lay("greenhouseBuilt", setGreenhouseBuilt);
    lay("cropFieldsUnlocked", setCropFieldsUnlocked);
    lay("soilTiles", setSoilTiles);
    lay("forageNodes", setForageNodes);
    lay("landObstacles", setLandObstacles);
    lay("fences", setFences);
    lay("secrets", setSecrets);
    lay("secretDonations", setSecretDonations);
    // Three atoms here, one field in a guess.
    const { synergy } = fields;
    if (synergy && takesNext("synergy", mode)) {
      setSynergyUnlocked(synergy.unlocked);
      setSynergyActive(synergy.active);
      setFarmhandSpeedMultiplier(synergy.farmhandSpeedMultiplier);
    }
    // Four fields in one atom.
    const { contract, inventory, machines, wheatPlots } = fields;
    if (contract !== undefined || inventory || machines || wheatPlots) {
      setProcessing((prev) => {
        const next: FarmProcessing = {
          contract: contract === undefined ? prev.contract : layFarmField("contract", prev.contract, contract, mode),
          inventory: inventory ? layFarmField("inventory", prev.inventory, inventory, mode) : prev.inventory,
          machines: machines ? layFarmField("machines", prev.machines, machines, mode) : prev.machines,
          wheatPlots: wheatPlots ? layFarmField("wheatPlots", prev.wheatPlots, wheatPlots, mode) : prev.wheatPlots,
        };
        const same =
          next.contract === prev.contract &&
          next.inventory === prev.inventory &&
          next.machines === prev.machines &&
          next.wheatPlots === prev.wheatPlots;
        return same ? prev : next;
      });
    }
  }, []);

  /** A guess letting go: whatever it held that nobody else still holds goes
   *  back to the last accepted answer. */
  const settleGuess = useCallback(
    (keys: Iterable<ClaimKey>) => {
      const freed = heldGuesses.current.release(keys);
      if (freed.size > 0) layFarm(confirmedFarm.current, { base: "prev", keys: freed });
    },
    [layFarm],
  );

  /**
   * Paints a server answer. `own` is what the answering action's own guess
   * holds, which this answer is the truth for; anything held by a guess
   * still in the air keeps that guess.
   */
  const applyResponse = useCallback((data: Partial<StackAcresResponse>, own: ReadonlySet<ClaimKey> = NO_CLAIMS) => {
    // A response that lost the race to a fresher one already on screen is
    // dropped whole rather than merged field by field -- every field here
    // comes off the SAME snapshot read, so a "fresher" `units` next to a
    // stale `profile` from the same response is not a state this farm was
    // ever actually in.
    if (!acceptRevision(data.revision)) return;
    const fields = farmFieldsOf(data);
    confirmedFarm.current = { ...confirmedFarm.current, ...fields };
    layFarm(fields, { base: "next", keys: heldGuesses.current.heldBesides(own) });
    if (data.clock) {
      const { offsetMs, serverNowMs } = data.clock;
      // Keep a sleep's own guess over a response read before it landed.
      const stale = sleepingFrom.current !== null && offsetMs === sleepingFrom.current;
      clockRef.current = { offsetMs: stale ? clockRef.current.offsetMs : offsetMs, skewMs: serverNowMs - Date.now() };
      setClockHour(gameHourNow());
    }
    if (data.axe) setAxe(data.axe);
    if (data.devotion) setDevotion(data.devotion);
    if (data.friendship) setFriendship(data.friendship);
    // Fresh arrays on every answer; keeping the old one when nothing moved
    // saves the map a redraw.
    if (data.woodNodes) {
      const next = data.woodNodes;
      setWoodNodes((prev) => sameOrNext(prev, next));
    }
    if (data.stoneNodes) {
      const next = data.stoneNodes;
      setStoneNodes((prev) => sameOrNext(prev, next));
    }
    // `!== undefined` rather than a truthiness check: null is the real
    // "no vat placed" answer.
    if (data.vat !== undefined) setVat(data.vat);
    if (data.cellar !== undefined) setCellar(data.cellar);
    if (data.work || data.processed || data.sold || data.vatCollected) {
      lastProcessing.current = {
        work: data.work,
        processed: data.processed,
        sold: data.sold,
        vatCollected: data.vatCollected,
      };
    }
    if (data.prestige) setPrestige(data.prestige);
    if (data.prestigeReset) lastPrestigeReset.current = data.prestigeReset;
    if (data.forge) setForge(data.forge);
    if (data.crossbreed) setCrossbreed(data.crossbreed);
    if (data.crossbreedResult && "hybridItem" in data.crossbreedResult) {
      lastCrossbreedHarvest.current = data.crossbreedResult;
    }
    if (data.blueprints) setBlueprints(data.blueprints);
    if (data.story) setStoryView(data.story);
  }, [acceptRevision, layFarm, gameHourNow]);

  /**
   * Everything an optimistic prediction reads, gathered off live state. A
   * plain object rebuilt on demand rather than a memo -- it is only ever
   * read once, synchronously, inside `act` before a fetch.
   */
  const buildPredictContext = useCallback(
    (): FarmPredictContext => ({
      profile,
      goldBalance: profile?.goldBalance ?? 0,
      unlimitedGold: profile?.unlimitedGold ?? false,
      units,
      feed,
      water,
      energy,
      capacity,
      seedStock,
      toolTier,
      axe,
      cutters,
      sectors,
      upkeep,
      influence,
      contract: processing.contract,
      synergyUnlocked,
      synergyActive,
      farmhandSpeedMultiplier,
      secrets,
      secretDonations,
      greenhouseBuilt,
      cropFieldsUnlocked,
      // This profile's placed soil.
      soilTiles,
      // The bushes, so a pick can name the seed it is about to take and turn
      // the bush picked-over without waiting on the round trip.
      forageNodes,
      // What is still standing on land being cleared, so a swing counts down
      // under the finger.
      landObstacles,
      fences,
      inventory: processing.inventory,
      wheatPlots: processing.wheatPlots,
      machines: processing.machines,
      nowMs: Date.now(),
    }),
    [
      profile,
      units,
      feed,
      water,
      energy,
      capacity,
      seedStock,
      forageNodes,
      landObstacles,
      fences,
      toolTier,
      axe,
      cutters,
      sectors,
      upkeep,
      influence,
      processing,
      synergyUnlocked,
      synergyActive,
      farmhandSpeedMultiplier,
      secrets,
      secretDonations,
      greenhouseBuilt,
      cropFieldsUnlocked,
      soilTiles,
    ],
  );

  // Safe with taps in the air: an answer never paints over what a guess still
  // holds (see heldGuesses), so there is nothing to hold a refresh off for.
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/stackacres", { cache: "no-store" });
      if (response.status === 429) return;
      // The pass was rotated or expired under us. Reload so the server
      // component answers with the gate rather than leaving a farm on screen
      // whose every button will now fail.
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as Partial<StackAcresResponse>;
      if (!mounted.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped read is not worth a banner; the farm just stays as it was.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Tab-return is the one moment the server may know something this client
  // does not (another device stocked, a pen the phone slept through).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const liveUnits = useMemo(() => withLocalClock(units, nowMs), [units, nowMs]);

  /** Kept as its own name -- readers below (`radialSoilTile`, the scene push)
   *  don't need to change -- even though there is no longer a starter grant
   *  to merge in. USED TO be `[...starterSoilTiles(CROP_FIELD_BEDS),
   *  ...soilTiles]`; a farm's placed soil is now simply `soilTiles` itself. */
  const mergedSoilTiles = soilTiles;

  const soilMapForTiles = useMemo(() => createSoilMap(mergedSoilTiles), [mergedSoilTiles]);

  const anyWorking = units.some(
    (unit) =>
      unit.state === "working" ||
      unit.state === "hungry" ||
      unit.state === "dry" ||
      unit.state === "ready",
  ) ||
    energy.level < ENERGY_REGEN_CAP || // energy is still refilling
    (cellar !== null && cellar.status !== "empty") || // jars aging in the cellar
    processing.machines.some((machine) => machine.standingRecipe !== null); // the Farm Kitchen banking
  useEffect(() => {
    if (!anyWorking) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyWorking]);

  // The bed actually standing at the tap, if any -- the one thing that
  // decides both what the ring/strip offers (a crop needs an empty bed to
  // land on; bare ground only ever offers to till one) and, via
  // `onRadialSeed`, which tile a planting names. Null on bare ground, same
  // as it is outside the Crop Fields entirely.
  /**
   * The travelers' story controller, reached from inside `act` before the
   * hook that owns it exists -- `useStackAcresStory`'s own `submit` prop is
   * a function that calls `act`, and `act`'s own body calls the
   * controller's `noteEvent`, so one of the two has to go through a ref
   * rather than a closure. Kept current by a plain assignment right after
   * the hook call below (no effect needed: this only ever matters inside a
   * later event handler, never during the render that sets it).
   */
  const storyRef = useRef<StackAcresStoryController | null>(null);

  /**
   * Answers what became of one action, for the callers that have to undo
   * something of their own when it did not land -- today that is the town
   * board, whose optimistic debit has to go back on the shelf on any refusal
   * (see TownContractsModal's `handleSettleContract`).
   *
   * Every existing caller ignores it and is unaffected: they call `void
   * act(...)` and let the response repaint the farm, which is still the only
   * thing that makes a change real here.
   */
  const act = useCallback(
    async (requested: Action, options?: { after?: Promise<unknown> }): Promise<ContractActionResult> => {
      // Everything the press changes on screen happens before the first await
      // below. Two things can hold the REQUEST back: a crop tapped the instant
      // it was sown still has an id this browser made up, so the request waits
      // for the sowing to name the real row (`settleProvisionalTargets`), and a
      // seed dropped on a bed hoed a moment ago waits for that bed to exist
      // (`options.after`). Neither is a reason for the crop to wait, so the
      // guess is painted now and only the request is held.
      const provisional = unitIdsIn(requested).some(isOptimisticUnitId);
      const waits = provisional || options?.after !== undefined;
      // A second press at something already being asked about is a duplicate,
      // not a second request. Dropped here rather than sent and deduplicated
      // server-side: the cheapest duplicate is the one that never leaves.
      const pressIntent = intentOf(requested);
      if (inFlight.current.has(pressIntent)) {
        return { ok: false, message: "That is already on its way." };
      }
      markInFlight(pressIntent);
      setError(null);
      // Assume the server says yes. `predictStackAcresAction` returns the
      // patch a success would produce (or null when the outcome is a dice
      // roll we won't fake). It paints only what it changed, and holds that
      // until this action lets go in `finally`, so no other answer can paint
      // over it meanwhile (see heldGuesses). Letting go also undoes it when
      // the server said no or never answered.
      const guessedFrom = buildPredictContext();
      const patch = predictStackAcresAction(requested, guessedFrom);
      const optimisticApplied = patch !== null;
      const guessed = patch ? guessClaims(guessedFrom, patch) : [];
      // A made-up crop is already held by its own sowing until that lands, so
      // a guess on one does not hold it too; it is carried onto the real row
      // further down. Holding it here would leave the made-up crop standing
      // beside the real one once the sowing answered.
      const ownClaims = new Set(
        createsStackAcresUnit(requested) ? guessed : guessed.filter((key) => !isClaimOnUnit(key, isOptimisticUnitId)),
      );
      heldGuesses.current.claim(ownClaims);
      if (patch) layFarm(patch, { base: "prev", keys: new Set(guessed) });
      // Every shop purchase without its own call-site toast gets one here --
      // see `purchaseCueText`'s own header for why this is the one place to
      // do it and which actions it deliberately skips.
      const purchaseCue = purchaseCueText(requested);
      if (purchaseCue) setLastCollect({ text: purchaseCue, nonce: Date.now() });
      // A create has to be waitable: a tap on the crop it is making needs to
      // know when its real id exists. Registered as the crop appears, not when
      // the request leaves, so a seed still waiting on its bed can already be
      // watered, and settled in `finally`, whatever the outcome.
      const createGate = createsStackAcresUnit(requested) ? settleable() : null;
      if (createGate) pendingUnitCreates.current.add(createGate.promise);
      let body: Action = requested;
      let intent = pressIntent;
      // False only when the real target turned out to be another request's,
      // whose in-flight mark this one must not clear.
      let ownsIntent = true;
      // Set the moment this browser knows what became of the request. While it
      // is false the key survives, so the next press at the same thing is a
      // retry; once it is true the key is dropped and the next press is a new
      // intent. Deliberately NOT set merely because `fetch` resolved: a body
      // that fails to parse leaves the outcome just as unknown as a dropped
      // connection does.
      let answered = false;
      try {
        if (options?.after) await Promise.allSettled([options.after]);
        if (provisional) {
          const resolved = await settleProvisionalTargets(requested);
          if (!resolved) {
            // The crop it was aimed at never went in. The guess goes back in
            // `finally`; re-read too, for anything the sowing left behind.
            if (optimisticApplied) window.setTimeout(() => void refresh(), 0);
            const notYet = "That one is not in the ground yet. Give it a second.";
            if (mounted.current) setError(notYet);
            return { ok: false, message: notYet };
          }
          body = resolved;
          clearInFlight(pressIntent);
          intent = intentOf(body);
          if (inFlight.current.has(intent)) {
            ownsIntent = false;
            return { ok: false, message: "That is already on its way." };
          }
          markInFlight(intent);
          // The sowing's answer just swapped the made-up crop for the real one,
          // dry, which would undo the guess above. This render's unit list only
          // knows the made-up crop, so re-guess against the list that answer
          // brought and put just the touched units back, leaving everything
          // else on screen as it now stands. The can and purse were already
          // spent by the first guess.
          const landed = unitsFromLastCreate.current;
          const carriedFrom = landed ? { ...guessedFrom, units: landed } : null;
          const carried = optimisticApplied && carriedFrom ? predictStackAcresAction(body, carriedFrom) : null;
          if (carriedFrom && carried?.units) {
            const moved = guessClaims(carriedFrom, { units: carried.units });
            for (const key of moved) ownClaims.add(key);
            heldGuesses.current.claim(moved);
            layFarm({ units: carried.units }, { base: "prev", keys: new Set(moved) });
          }
        }
        // A key held over from an attempt that never came back makes this press
        // a retry of that one; otherwise it names a new intent.
        const key = pendingKeys.current.get(intent) ?? newIntentKey();
        pendingKeys.current.set(intent, key);
        // The travelers' story ticks the instant this request is sent, not
        // when it lands -- see storyRef's own header. Every event this action
        // WOULD produce on success, replayed against whichever bubble happens
        // to be open right now; `noteEvent` is a no-op if none is.
        for (const event of storyEventsForAction(body, { units: unitsRef.current })) {
          storyRef.current?.noteEvent(event);
        }
        // A lost answer is retried under the same key with the guess still on
        // screen; the server replays a write that already landed.
        const { response, data } = await sendActionWithRetry<Partial<StackAcresResponse>>(
          (attempt, signal) =>
            fetch("/api/stackacres/actions", {
              method: "POST",
              cache: "no-store",
              signal,
              headers: { "Content-Type": "application/json", "X-Action-Attempt": String(attempt) },
              body: JSON.stringify({ ...body, key }),
            }),
        );
        if (response.status === 429) {
          // Rejected before it reached the farm, so the server applied
          // nothing. The guess goes back when this action lets go in
          // `finally`.
          answered = true;
          if (waits) window.setTimeout(() => void refresh(), 0);
          const header = Number(response.headers.get("Retry-After"));
          const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
          const tooFast = `Too many taps. Give it ${seconds}s.`;
          if (mounted.current) setError(tooFast);
          return { ok: false, message: tooFast };
        }
        if (response.status === 401) {
          answered = true;
          window.location.reload();
          return { ok: false, message: "Your pass expired. Reloading." };
        }
        answered = true;
        if (!mounted.current) return { ok: false, message: "Left the farm." };
        if (!response.ok) {
          // A dull knock on wood, never a buzzer: most refusals here are "you
          // cannot afford that yet", which is ordinary and frequent, and a
          // harsh error tone on an ordinary event teaches a player to dread
          // their own farm.
          refusedSound();
          // Nothing was written, so the guess goes back when this action lets
          // go in `finally`. The refusal carries the true round; paint it (a
          // stale one is dropped like any answer), and only raise a banner
          // when there is no round to speak for itself.
          applyResponse(
            {
              ...(data.round ? { units: data.round.units, revision: data.round.revision } : {}),
              ...(data.profile ? { profile: data.profile } : {}),
            },
            ownClaims,
          );
          // A refused purchase takes its own instant toast back too -- left
          // standing, "Bought a Hen!" would sit on screen next to the refusal
          // banner claiming the opposite.
          if (purchaseCue) setLastCollect(null);
          if (!data.round) {
            setError(data.error ?? "That did not go through.");
          } else if (body.action === "collect") {
            // Take back the "on its way" promise from above -- the round
            // repainted silently because there was nothing to collect after
            // all, and nothing is actually inbound.
            setLastCollect(null);
          }
          // Re-read, so the farm shows the server's truth rather than what this
          // browser thought it could send. The round only carries units, and a
          // refused bed or fence may well be standing on the server already.
          if (optimisticApplied || waits) window.setTimeout(() => void refresh(), 0);
          return { ok: false, message: data.error ?? "That did not go through." };
        }
        // This action's own claims are the one thing this answer is the truth
        // for, so they do not shield it.
        applyResponse(data, ownClaims);
        // What a tap on the just-made crop will match its provisional id
        // against, recorded before React has committed the list above.
        if (createGate && data.units) unitsFromLastCreate.current = data.units;
        // Where the finger that asked for this landed, if it was a tap on the
        // map rather than a sidebar row -- the reward floats out of the thing
        // that was tapped. A sidebar press leaves this null and the toast
        // below is the whole answer, same as it always was.
        const anchor = tapAnchor.current;
        if (body.action === "collect" && data.harvest) {
          const { harvest } = data;
          const single = body.unitIds?.length === 1 ? body.unitIds[0] : null;
          // Critical Harvest Cascade: stash it for `triggerCascade` to pick
          // up once this call has fully returned -- see lastHarvests' own
          // header.
          if (single) lastHarvests.current.set(single, { crit: harvest.crit, units: data.units ?? [] });
          // A tapped crop already sounded on the press; a sweep sounds here
          // with the loudest thing it brought in.
          const sounded = single ? undefined : unitsRef.current.find((candidate) => candidate.state === "ready");
          if (sounded) collectSound(sounded.stock);
          if (single) setCelebrate({ unitId: single, nonce: Date.now() });
          // A critical harvest shows on the crop itself: the crit flash names
          // the multiple the ladder just paid. `1 + critBonus` because the
          // label reads as a total ("CRIT! x2" for a bonus of 1).
          if (single && harvest.crit && harvest.critBonus.length > 0) {
            world.current?.celebrateCrit(single, 1 + stackacresToolTierDef(toolTierRef.current).critBonus);
          }
        }
        if (body.action === "upgrade-tool" && data.upgraded) {
          goldSound();
          setLastCollect({
            text: `${stackacresToolTierDef(data.upgraded.to).label} in hand`,
            nonce: Date.now(),
          });
        }
        // A new cutter goes straight into your hand. The Scythe is one tap
        // away in the picker beside the Mow key.
        if (body.action === "buy-cutter" && data.boughtCutter) {
          goldSound();
          setPickedCutter(data.boughtCutter);
          setLastCollect({
            text: `${stackacresCutterDef(data.boughtCutter).label} in hand`,
            nonce: Date.now(),
          });
        }
        // A delivered contract sounds and toasts like the other Gold payer
        // does, so the two ways money arrives on this farm feel like the same
        // event rather than two features.
        if (body.action === "fulfill-contract" && data.contractReward) {
          goldSound();
          setLastCollect({
            text: `Order filled · +${data.contractReward.gold.toLocaleString()} Gold`,
            nonce: Date.now(),
          });
        }
        // The vat is the third Gold payer, and it answers like the other two.
        if (body.action === "collect-vat" && data.vatCollected) {
          goldSound();
          setLastCollect({
            text: `Vat opened · +${data.vatCollected.gold.toLocaleString()} Gold`,
            nonce: Date.now(),
          });
        }
        if ((body.action === "feed" || body.action === "feed-pen") && data.fed) {
          setLastCollect({ text: data.fed.toast, nonce: Date.now() });
        }
        // A cast pays no Gold -- it fills the shelf, same as a harvest. This
        // is the server's dice roll, the first point anything knows which fish
        // it was. The map shows it once the gauge is gone (`onWorldFishHooked`).
        if (body.action === "catch-fish" && data.fishCaught) {
          landedFish.current = data.fishCaught.species;
        }
        // A stalk pays no Gold either -- it fills the shelf with meat and a
        // pelt. The scope's own banner already played; this names what the
        // server's dice roll actually gave, the same beat a catch gets.
        if (body.action === "bag-quarry" && data.quarryBagged) {
          const { species, meat, pelt } = data.quarryBagged;
          const meatLabel = machineItemLabel("meat", meat);
          const peltLabel = machineItemLabel("pelt", pelt);
          setLastCollect({
            text: `${QUARRY_CATALOGUE[species].label}! ${meatLabel} and ${peltLabel}.`,
            nonce: Date.now(),
          });
          if (anchor) world.current?.floatAt(anchor, `+${meatLabel}, +${peltLabel}`, "gain");
        }
        // Chopping, mining and clearing are answered in the scene: the swing,
        // the strike and the pieces bursting into his hands. Only a sector
        // opening gets a line of its own.
        if (data.landCleared) {
          const { sectorOpened, ground } = data.landCleared;
          if (sectorOpened && isClearableSector(ground)) setLastCollect({ text: `${sectorLabel(ground)} is yours!`, nonce: Date.now() });
        }
        // The zone's own optimistic puff already fired on the press (see
        // stackacres-scene.ts's `secretDiscoveryPuff`, called from the
        // dispatch itself). This is the SECOND, more celebratory beat --
        // fired only once the real answer is in -- for an actual find; a
        // miss stays exactly as quiet as the puff already made it, matching
        // the "a growing crop stays silent" refusal posture elsewhere on
        // this map.
        if (body.action === "tap-secret-zone" && data.discovery) {
          const found = SECRET_ITEM_CATALOGUE[data.discovery];
          goldSound();
          setLastCollect({ text: `${found.icon} Found the ${found.label}!`, nonce: Date.now() });
          if (anchor) world.current?.floatAt(anchor, `${found.icon} ${found.label}!`, "gain");
        }
        // The dialogue moves from "greeting" to "result" here, on the one
        // response `pray` ever gives -- never on the press, since a decline
        // never reaches this function at all. Keeps the dialogue's own
        // anchor rather than reading a fresh one: the finger has not moved.
        if (body.action === "pray" && data.prayer) {
          setMonkDialogue((prev) => (prev ? { phase: "result", at: prev.at, ...data.prayer! } : null));
          if (!data.prayer.alreadyPrayedToday) {
            panelSound();
            if (anchor) world.current?.floatAt(anchor, `🙏 Day ${data.prayer.streak}`, "gain");
          }
          if (data.prayer.grantedRelic) {
            const relic = RELIC_CATALOGUE[data.prayer.grantedRelic];
            goldSound();
            setLastCollect({
              text: `${relic.icon} The Pilgrim entrusts you the ${relic.label}`,
              nonce: Date.now(),
            });
          }
        }
        // Same "moves from greeting to result on the one response an action
        // ever gives" pattern `pray` documents above -- a decline never
        // reaches this function at all.
        if (body.action === "give-gift" && data.gift) {
          setGiftDialogue((prev) => (prev ? { phase: "result", at: prev.at, ...data.gift! } : null));
          if (data.gift.outcome === "gifted") {
            panelSound();
            if (anchor) world.current?.floatAt(anchor, "🎁", "gain");
            world.current?.emote(body.npc, "heart");
          }
          if (data.gift.grantedKeepsake) {
            const keepsake = KEEPSAKE_CATALOGUE[data.gift.grantedKeepsake];
            goldSound();
            setLastCollect({
              text: `${keepsake.icon} Ray gives you his ${keepsake.label}`,
              nonce: Date.now(),
            });
          }
        }
        // The travelers' story. Unlike the prayer and gift dialogues above,
        // there is no separate "phase" state to flip here -- the bubble's
        // node is derived straight off `storyView` (see `dialogueNodeFor`),
        // and `data.story`, already applied a few lines up, is what moves
        // it from "hello" to "progress" or from "done" to "home" on its
        // own. This block is only the toast for a traveler's line finishing.
        if (body.action === "story-turn-in" && data.storyResult) {
          if (data.storyResult.outcome === "advanced") {
            questStepSound();
            world.current?.emote(data.storyResult.traveler, "note");
          }
          if (data.storyResult.outcome === "completed") {
            goldSound();
            world.current?.emote(data.storyResult.traveler, "sparkle");
            if (typeof data.storyResult.granted === "string" && isStoryItemId(data.storyResult.granted)) {
              const item = STORY_ITEM_CATALOGUE[data.storyResult.granted];
              setLastCollect({ text: `${item.icon} ${TRAVELER_CATALOGUE[data.storyResult.traveler].name} leaves you the ${item.label}`, nonce: Date.now() });
            }
          }
        }
        if (body.action === "unlock-synergy-perk" && data.synergyUnlock?.success) {
          goldSound();
          setLastCollect({
            text: `${SYNERGY_PERKS[body.archetype].label} unlocked!`,
            nonce: Date.now(),
          });
        }
        return { ok: true, reward: data.contractReward };
      } catch {
        // The outcome is unknown -- the write may well have committed. The
        // guess goes back in `finally` so nothing false is on screen, then
        // the re-read shows the truth.
        window.setTimeout(() => void refresh(), 0);
        const unreachable = "Could not reach the farm. Check your connection.";
        if (mounted.current) setError(unreachable);
        return { ok: false, message: unreachable };
      } finally {
        // Lets go of the guess. After a success this changes nothing (its
        // answer is already on screen); otherwise it puts back what the last
        // accepted answer had.
        settleGuess(ownClaims);
        if (createGate) {
          pendingUnitCreates.current.delete(createGate.promise);
          createGate.settle();
        }
        if (ownsIntent) clearInFlight(intent);
        if (answered) pendingKeys.current.delete(intent);
        // One request, one anchor. Leaving it set would float the NEXT
        // action's reward out of the last place a finger happened to be.
        tapAnchor.current = null;
      }
    },
    [
      applyResponse,
      refresh,
      markInFlight,
      clearInFlight,
      buildPredictContext,
      settleProvisionalTargets,
      layFarm,
      settleGuess,
    ],
  );

  /* ---------------------------------------------------------------- */
  /* Batched tool taps                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * One open window per batchable action, with the timer that will close it.
   * See lib/stackacres/action-batch.ts for the rule; this is the clock and
   * the `act` call that module deliberately does not own.
   */
  const batchWindows = useRef(new Map<BatchableAction, { window: ActionBatchWindow; timer: number | null }>());

  /** Sends a window's trailing batch, or waits out one more window when the
   *  leading request is somehow still in the air. Held in a ref because the
   *  timer it arms calls it again. */
  const flushBatchRef = useRef<(kind: BatchableAction, attempt: number) => void>(() => undefined);

  const flushBatch = useCallback(
    (kind: BatchableAction, attempt: number): void => {
      const entry = batchWindows.current.get(kind);
      if (!entry) return;
      if (entry.timer !== null) window.clearTimeout(entry.timer);
      batchWindows.current.delete(kind);
      // A crop some harvest already in the air names is on its way.
      const collecting = kind === "collect" ? unitsBeingCollected(inFlight.current) : null;
      const body = actionForUnits(
        kind,
        collecting ? entry.window.queued.filter((id) => !collecting.has(id)) : entry.window.queued,
      );
      if (!body) return;
      // The same request can still be in the air (the same crops, or the same
      // water anchor). Waiting a window is the difference between these taps
      // landing late and being refused as duplicates.
      if (inFlight.current.has(intentOf(body)) && attempt < BATCH_FLUSH_ATTEMPTS) {
        const reopened = reopenActionBatch(kind, entry.window.queued, Date.now());
        batchWindows.current.set(kind, {
          window: reopened,
          timer: window.setTimeout(() => flushBatchRef.current(kind, attempt + 1), ACTION_BATCH_WINDOW_MS),
        });
        return;
      }
      void act(body);
    },
    [act],
  );

  useEffect(() => {
    flushBatchRef.current = flushBatch;
  }, [flushBatch]);

  /**
   * A water or harvest press, coalesced.
   *
   * The first press goes out immediately, so a single tap is exactly as
   * responsive as it was before this existed. Presses that land inside the
   * next 200ms ride one plural request instead of one each -- the same
   * `unitIds` body the water can's group drop and the Harvest Cascade
   * already send, so the server, the route's own validation and the
   * optimistic prediction all see a shape they already handle.
   */
  const tapBatched = useCallback(
    (kind: BatchableAction, unitId: string): void => {
      // A second press at a crop already being harvested is the same press.
      // (A second press at a crop already being watered is left to `act`'s
      // own duplicate guard, which keys water per crop.)
      if (kind === "collect" && unitsBeingCollected(inFlight.current).has(unitId)) return;
      const open = batchWindows.current.get(kind);
      if (open?.timer != null) window.clearTimeout(open.timer);
      const tap = coalesceActionTap(open?.window ?? null, kind, unitId, Date.now());
      if (tap.flush) void act(tap.flush);
      if (tap.send) void act(tap.send);
      if (tap.full) {
        batchWindows.current.set(kind, { window: tap.window, timer: null });
        flushBatchRef.current(kind, 0);
        return;
      }
      // Nothing queued behind the leading press: no timer to arm, and the
      // next press inside the window arms its own.
      const timer =
        tap.window.queued.length > 0
          ? window.setTimeout(
              () => flushBatchRef.current(kind, 0),
              batchWindowRemainingMs(tap.window, Date.now()),
            )
          : null;
      batchWindows.current.set(kind, { window: tap.window, timer });
    },
    [act],
  );

  // Leaving the farm mid-burst sends what was queued rather than dropping
  // it: the presses already happened, and the request is the only record of
  // them. `act` handles its own unmount (it checks `mounted` before it
  // touches state), so the POST still lands even though nothing repaints.
  useEffect(() => {
    const windows = batchWindows.current;
    const flushAll = flushBatchRef;
    return () => {
      for (const kind of [...windows.keys()]) flushAll.current(kind, BATCH_FLUSH_ATTEMPTS);
    };
  }, []);

  /**
   * The travelers' story. `submit` posts the one intent a committing choice
   * in the bubble sends, through the exact same `act` (and so the exact
   * same optimistic/rollback/retry machinery) every other action here uses;
   * a refusal there rejects, and the hook leaves the bubble on its current
   * node either way (see the hook's own header). Rejecting on `!ok` rather
   * than swallowing it is what lets a "You do not have everything he
   * asked for" refusal reach `act`'s own error banner instead of vanishing.
   */
  const storySubmit = useCallback(
    async (intent: StoryIntent) => {
      const result = await act(
        intent.action === "story-meet"
          ? { action: "story-meet", traveler: intent.traveler }
          : { action: "story-turn-in", traveler: intent.traveler },
      );
      if (!result.ok) throw new Error(result.message);
    },
    [act],
  );
  const story = useStackAcresStory({ view: storyView, submit: storySubmit });
  useEffect(() => {
    storyRef.current = story;
  });

  // Shows/hides each traveler as their own unlock is met (nobody stands on
  // the farm before that -- see `setTravelerUnlocks` in the scene). "Push,
  // never rebuild": an unchanged unlock set is a no-op on the scene's side.
  // useLayoutEffect because `story.view` is server-confirmed.
  useLayoutEffect(() => {
    if (!story.view) return;
    const unlocked: Record<string, boolean> = {};
    for (const [id, traveler] of Object.entries(story.view.travelers)) unlocked[id] = traveler.unlocked;
    world.current?.setTravelerUnlocks(unlocked as TravelerUnlocks);
  }, [story.view]);

  /** How far this sector's clearing has got, for its sheet. */
  const clearingProgress = useMemo(
    () =>
      clearing && isClearableSector(clearing)
        ? landClearingProgress(clearing, landObstacles)
        : { cleared: 0, total: 0 },
    [clearing, landObstacles],
  );

  /** Who a closed wild gate is waiting on, for its sheet. */
  const clearingOpener = useMemo(() => {
    const traveler = clearing ? WILD_AREA_TRAVELER[clearing] : undefined;
    if (!traveler) return null;
    return { name: TRAVELER_CATALOGUE[traveler].name, hint: story.view?.travelers[traveler].hint ?? null };
  }, [clearing, story.view]);

  // No effect needed to disarm the retire confirmation on district change:
  // StackAcresUnitRows only ever renders the current district's own units
  // (districtUnits, below), so a unit armed elsewhere simply has no row left
  // to show the confirmation on until the player travels back to it.
  /**
   * Every handler below answers its own press with its own sound rather than
   * the app's generic chrome click. Sowing, harvesting and paying to expand a
   * pen used to be audibly the same event, which made the one surface in
   * StackChips where the press IS the game feel like a form. See
   * lib/audio/stackacres-sfx.ts.
   *
   * The sound fires on the PRESS, not on the response: the server round trip
   * is real, and a farm that stays silent for 200ms after every tap feels
   * broken however fast it eventually answers. A press that turns out to be
   * refused gets the wooden knock on top of it, from `act`.
   */
  /* ---------------------------------------------------------------- */
  /* The Pixel Pilgrim                                                  */
  /* ---------------------------------------------------------------- */

  const onWorldMonkTap = useCallback((at: TapPoint) => {
    setMonkDialogue({ phase: "greeting", at, line: PIXEL_PILGRIM_LINES[Math.floor(Math.random() * PIXEL_PILGRIM_LINES.length)] });
  }, []);

  /**
   * The only path that ever sends `pray`. Fires the scene's own optimistic
   * bow first (the player already said "yes"; the request has not answered
   * yet, same posture every other tap-triggered animation on this map
   * takes), then the request itself. A decline in the dialogue calls
   * neither of these -- see StackAcresMonkDialogue. The dialogue's own
   * anchor is preserved across the phase switch (`act`'s own `data.prayer`
   * handling), never a new tap point.
   */
  const onMonkPray = useCallback(() => {
    void act({ action: "pray" });
  }, [act]);

  /* ---------------------------------------------------------------- */
  /* NPC friendship                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Ray carries two separate interactions: his own story line (he is one of
   * the eleven travelers, `TRAVELER_IDS` in travelers.ts) and the
   * gift-giving loop `friendship.ts` only ever wired to him. Before this, a
   * tap always opened gifts, so his story line could never
   * start and Leo's finale, which needs all ten travelers plus Ray, could
   * never be reached. Story first when he actually has something to say,
   * same as every other traveler; gifts otherwise, so the everyday loop
   * still works once his current beat is done.
   */
  const onWorldRayTap = useCallback(
    (at: TapPoint) => {
      const ray = story.view?.travelers.ray;
      const hasSomethingToSay = ray && ray.unlocked && !ray.done && (!ray.met || ray.ready);
      if (hasSomethingToSay) {
        story.open("ray", at);
        return;
      }
      setGiftDialogue({ npc: "ray", phase: "greeting", at, line: RAY_GIFT_LINES[Math.floor(Math.random() * RAY_GIFT_LINES.length)] });
    },
    [story],
  );

  /**
   * A finger landed on one of the eleven story travelers. `at` is already
   * the point over their head (the scene computed it), not the finger --
   * see stackacres-scene.ts's `travelerHeadPoint`. Nothing here calls the
   * server; `story.open` only decides which node to show, and only a
   * committing button inside the bubble ever reaches `storySubmit` below.
   */
  const onWorldTravelerTap = useCallback(
    (traveler: TravelerId, at: TapPoint) => {
      story.open(traveler, at);
    },
    [story],
  );

  /** The player's house: its own panel, nothing to do with Ray. */
  const onWorldHouseTap = useCallback(() => {
    panelSound();
    setShowHouse(true);
  }, []);

  /** The bed: by night it offers sleep, by day it says when you can. */
  const onWorldBedTap = useCallback(
    (at: TapPoint) => {
      if (!canSleepAt(gameHourNow())) {
        refusedSound();
        setError(NOT_SLEEPY);
        return;
      }
      panelSound();
      setSleepDialog(at);
    },
    [gameHourNow],
  );

  /**
   * Sleep: the clock jumps to 6 AM here while the view is dark, then the
   * server is asked. A refusal puts the old offset back, and `act` shows why.
   * No toast on success: waking up to morning light is the answer.
   */
  const onSleep = useCallback(() => {
    setSleepDialog(null);
    const whileDark = async () => {
      const from = clockRef.current.offsetMs;
      sleepingFrom.current = from;
      clockRef.current = {
        ...clockRef.current,
        offsetMs: offsetAfterSleep(Date.now() + clockRef.current.skewMs, from),
      };
      setClockHour(gameHourNow());
      try {
        const result = await act({ action: "sleep" });
        if (!result.ok) {
          clockRef.current = { ...clockRef.current, offsetMs: from };
          setClockHour(gameHourNow());
          // Another device may have slept already; read the farm's real clock.
          window.setTimeout(() => void refresh(), 0);
        }
      } finally {
        sleepingFrom.current = null;
      }
    };
    if (world.current) void world.current.sleep(whileDark);
    else void whileDark();
  }, [act, gameHourNow, refresh]);

  /** The Eat tab in the player's house (./stackacres-kitchen.tsx). */
  const onEat = useCallback((item: FoodItem) => act({ action: "eat", item }), [act]);
  /** Built machine kinds, for the seed locks (lib/stackacres/seed-unlocks.ts). */
  const builtKinds = useMemo(
    () => new Set(processing.machines.map((machine) => machine.kind)),
    [processing.machines],
  );
  const builtKindsRef = useRef(builtKinds);
  useEffect(() => {
    builtKindsRef.current = builtKinds;
  });
  const chapters = useMemo(
    () => chapterViews(builtKinds, { gold, inventory: processing.inventory }),
    [builtKinds, gold, processing.inventory],
  );
  const chapterNow = currentChapter(chapters);
  /** Ray's seed shelf: open seeds first, then locked ones, each in catalogue order. */
  const shopSeeds = useMemo(() => {
    const active = STACKACRES_CROPS.filter(isActiveStock);
    return [
      ...active.filter((crop) => isSeedUnlocked(crop, builtKinds)),
      ...active.filter((crop) => !isSeedUnlocked(crop, builtKinds)),
    ];
  }, [builtKinds]);
  const kitchenBuilt = useCallback(
    (kind: MachineKind) => processing.machines.some((machine) => machine.kind === kind),
    [processing.machines],
  );
  const onStoreJars = useCallback((item: CellarItem) => act({ action: "seal-cellar", item }), [act]);
  const farmKitchenRow = processing.machines.find((machine) => machine.kind === "farm_kitchen") ?? null;
  const onSetKitchenOrder = useCallback(
    (recipe: RecipeId) => act({ action: "set-kitchen-order", recipe }),
    [act],
  );
  const onRunFarmKitchen = useCallback(async () => {
    takeProcessingDelta();
    const result = await act({ action: "work" });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, cooked: takeProcessingDelta()?.work?.kitchenCooked ?? null };
  }, [act, takeProcessingDelta]);
  const onOpenCellar = useCallback(async () => {
    takeProcessingDelta();
    const result = await act({ action: "collect-cellar" });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, gold: takeProcessingDelta()?.vatCollected?.gold };
  }, [act, takeProcessingDelta]);
  const radishesHeld = processing.inventory[FISHING_BAIT_ITEM] ?? 0;
  useEffect(() => {
    baitOnHook.current = useBait && radishesHeld > 0;
  }, [useBait, radishesHeld]);

  /** The only path that ever sends `give-gift`. Unlike a prayer, there is no
   *  optimistic animation to fire on the press -- a gift's own reward (a
   *  keepsake) only ever shows once the server confirms it, the same
   *  "nothing to guess" posture a secret-item donation already takes. */
  const onGiveGift = useCallback(
    (npc: NpcId, item: MachineItemId) => {
      void act({ action: "give-gift", npc, item });
    },
    [act],
  );

  /**
   * Bring in everything that is ready, in one act. This is the only control
   * that can earn a Bountiful Harvest: the synergy is a property of what was
   * gathered TOGETHER, so a unit tapped on its own can never qualify.
   */
  const onHarvestAll = useCallback(() => {
    // Same as a single collect: `act` answers with the loudest thing the
    // sweep brought in. The key only renders while `carrying > 0`, so there
    // is always something to answer with.
    void act({ action: "collect" });
  }, [act]);


  const onSeed = useCallback(
    (stock: StackAcresStock) => {
      sowSound();
      void act({ action: "stock", stock });
    },
    [act],
  );
  const onBuyOutright = useCallback(
    (stock: StackAcresStock) => {
      buySound();
      void act({ action: "buy-stock", stock });
    },
    [act],
  );
  const onExpand = useCallback(
    (stock: StackAcresStock) => {
      expandSound();
      void act({ action: "expand-capacity", stock });
    },
    [act],
  );


  const travel = useCallback(
    (zone: ZoneId) => {
      travelSound();
      setPlace(zone);
      world.current?.focusZone(zone);
      // Picking wild land off the signpost flies you there AND makes the
      // offer. Landing at a wood with no explanation would be the one place
      // on this screen where going somewhere tells you nothing.
      setClearing(isSectorUnlocked(zone, sectors) ? null : zone);
    },
    [sectors],
  );

  /** A place picked off the map: walk there, and say what is still in the way. */
  const travelToPlace = useCallback(
    (id: MapPlaceId) => {
      setShowMap(false);
      // The Crop Fields are not a place with a gate on it any more -- they
      // are overgrown ground the player walks straight onto and breaks
      // himself (see stackacres-service.ts's `placeStackAcresSoilTile`), so
      // this only aims the camera at them.
      if (id === "cropfields") {
        travelSound();
        world.current?.focusZone("cropfields");
        return;
      }
      travel(id);
    },
    [travel],
  );

  /** The map button: the farmer's own place is read off the scene here, on the
   *  press, since React has no way to observe him walking. */
  const openMap = useCallback(() => {
    mapSound();
    setMapHere(world.current?.currentPlace() ?? "farmstead");
    setShowMap(true);
  }, []);

  /** Every place, in map order, with whose gate is shut and what opens it.
   *  Only the Homestead and its own Crop Fields are on the map right now --
   *  the other districts are staying off the map while polish focuses on the
   *  Homestead alone (Kayo, 2026-09-22). */
  const mapPlaces = useMemo(
    () =>
      mapPlaceStates(
      mapHere,
      // The Crop Fields are always walkable now; nothing is bought to open
      // them, so they never carry a locked label either.
      (id) => id === "cropfields" || isSectorUnlocked(id, sectors),
      (id) => {
        // Never reached for the Crop Fields -- they are open above -- but the
        // map's id space is wider than a district's, so it is said here.
        if (id === "cropfields") return null;
        const traveler = WILD_AREA_TRAVELER[id];
        if (traveler) return `Opens when ${TRAVELER_CATALOGUE[traveler].name} arrives`;
        const check = sectorClearCheck(id, { unlocked: sectors, unitCount: units.length });
        return `Clear for ${check.cost.toLocaleString()} Gold`;
      },
    ).filter((place) => place.id === "farmstead" || place.id === "cropfields"),
    [mapHere, sectors, units.length],
  );

  // The view moving under whatever is pinned to it closes both screen-
  // anchored panels the same way -- neither is anchored to the world, so
  // both go away rather than drift off what they were opened on.
  // Where the farmer just arrived, for a moment. The counter keys the tag, so going through two doors quickly
  // replays it rather than leaving the first one fading.
  const [placeTag, setPlaceTag] = useState<{ name: string; n: number } | null>(null);
  const onPlaceEntered = useCallback((name: string) => setPlaceTag((was) => ({ name, n: (was?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!placeTag) return;
    const timer = window.setTimeout(() => setPlaceTag(null), 1900);
    return () => window.clearTimeout(timer);
  }, [placeTag]);

  const onViewMoved = useCallback(() => {
    setMonkDialogue(null);
    setGiftDialogue(null);
    setSleepDialog(null);
    story.close();
  }, [story]);

  /**
   * Critical Harvest Cascade: a solo tap that just crit chains into other
   * ready units standing in the same district, each collected through the
   * exact same `collect` action a second tap would have sent -- see
   * lib/stackacres/harvest-cascade.ts's own header for why that is the
   * entire write path (no new RPC, no separate Gold or inventory call at
   * all) and why this goes exactly one generation deep.
   *
   * Called ONLY from onWorldUnitTap's own collect branch, and only after
   * that branch's own `act(...)` call has fully settled. `originUnitId`/
   * `originStock` are the just-tapped unit as it stood BEFORE the harvest,
   * handed in by the caller's own closure rather than re-read here: a
   * consumed, non-permanent crop is gone from `units` the instant it
   * settles, so there would be nothing left in state to look its stock up
   * from afterward.
   */
  const triggerCascade = useCallback(
    async (originUnitId: string, originStock: StackAcresStock) => {
      const result = lastHarvests.current.get(originUnitId);
      lastHarvests.current.delete(originUnitId);
      if (!result || !result.crit) return;
      const targets = findCascadeTargets(
        result.units,
        stockZone(originStock),
        new Set([originUnitId]),
      );
      if (targets.length === 0) return;
      // Local-optimistic: pop every chained unit immediately, before the
      // follow-up request is even sent -- the same "answer the touch, let
      // the network answer later" contract onWorldUnitTap's own popUnit
      // already keeps for the tap that started this chain.
      for (const id of targets) world.current?.popUnit(id);
      const chained = await act({ action: "collect", unitIds: targets });
      if (chained.ok) world.current?.celebrateCascade(targets);
    },
    [act],
  );

  /**
   * A finger landed on a unit's own picture. It pops immediately -- before
   * anything has been sent, which is the whole point: the farm answers the
   * touch, and the network answers a moment later. What happens next is
   * `tapActionFor`'s call, off `unitRowAction`.
   *
   * A refusal never leaves the browser. There is no room on a canvas for a
   * disabled button with a title attribute explaining itself, so the reason
   * floats where the finger was instead.
   */
  /**
   * A tap in a pen, or on one of its animals. Floats the feed scoop with an
   * arrow to the pen's trough when anything there is hungry, and says why
   * not otherwise. Feeding is per pen now, never per animal.
   */
  /** Feeds everyone hungry in a pen. The one place `feed-pen` is sent. */
  const feedPen = useCallback(
    (zone: ZoneId) => {
      const resident = liveUnits.find((unit) => stockZone(unit.stock) === zone);
      if (resident) feedSound(resident.stock);
      world.current?.farmerAction("harvest");
      void act({ action: "feed-pen", zone });
    },
    [act, liveUnits],
  );

  /**
   * Sows one bed with the seed on the wheel. The single-tile half of what
   * `onRadialSeed` used to do; the whole-block drop it also did is gone, replaced
   * by holding Use and walking the row, so a bed is only ever sown by a farmer
   * standing on it.
   *
   * If this exact bed was just tilled and that request has not answered yet, the
   * request waits for it (see `pendingSoilPlacements`) but the seed shows at once. Ignored either way: a refusal
   * there leaves the tile bedless, which `assignSoilSlot` already handles.
   */
  const onSowTile = useCallback(
    (tx: number, ty: number, stock: StackAcresCrop) => {
      // The seed shows at once; only the request waits for a bed hoed a moment ago.
      void act({ action: "stock", stock, tx, ty }, { after: pendingSoilPlacements.current.get(`${tx},${ty}`) });
    },
    [act],
  );

  const openPenFeed = useCallback(
    (zone: ZoneId, at: TapPoint) => {
      const residents = liveUnits.filter((unit) => stockZone(unit.stock) === zone);
      if (residents.length === 0) {
        world.current?.floatAt(at, "Nothing lives here yet.", "deny");
        return;
      }
      if (!residents.some((unit) => unit.state === "hungry")) {
        world.current?.floatAt(at, "Nobody here is hungry.", "deny");
        return;
      }
      // Hens and cattle eat off the shelf before the Feed Sack (lib/stackacres/feeding.ts).
      const canEatShelf = residents.some(
        (unit) => unit.state === "hungry" && shelfFeedFor(unit.stock, processing.inventory) > 0,
      );
      if (feed < 1 && !canEatShelf) {
        refusedSound();
        world.current?.floatAt(at, "No feed left in the barn.", "deny");
        return;
      }
      // Sent on the press. It used to float a scoop to be dragged into the
      // trough; the farmer is standing at the trough by the time this fires now,
      // so the walk IS the gesture and a second one on top of it is just delay.
      feedPen(zone);
    },
    [feed, feedPen, liveUnits, processing.inventory],
  );

  /**
   * A belt slot was pressed (`StackAcresToolbelt`). One slot is always held, so
   * pressing the held one again is a no-op rather than putting it down -- there
   * is no "nothing in hand" state to drop back to, and `hand` already is that
   * state. The seed pouch's own second press opens its wheel instead, which the
   * belt handles before it ever calls this.
   */
  const pickBeltTool = useCallback((next: BeltTool) => {
    toolSound();
    setError(null);
    setSeedWheelOpen(false);
    // Putting the hoe down forgets whichever bed it had asked about lifting, so
    // the question never outlives the tool that asked it.
    setArmedLift(null);
    setBelt(next);
  }, []);

  /** Scythe or Mower, from the picker beside the Mow key or the shop. */
  const pickCutter = useCallback((next: StackAcresCutter) => {
    toolSound();
    setPickedCutter(next);
  }, []);

  // Remembered on this device only. Which blade swings is client-side
  // scenery, so there is nothing for the server to keep.
  useEffect(() => {
    if (!pickedCutter) return;
    try {
      window.localStorage.setItem("sa-cutter", pickedCutter);
    } catch {
      // Storage blocked. The pick still holds for this visit.
    }
  }, [pickedCutter]);

  /** A finger landed on a district's fenced ground and hit nothing. That is
   *  "I want something HERE", answered where the finger is. */
  const onWorldGroundTap = useCallback(
    (zone: ZoneId, at: TapPoint) => {
      setPlace(zone);
      // A pen's ground is for feeding what lives there, not for building.
      // Stocking a pen is in the side panel.
      if (PEN_ZONE_IDS.includes(zone)) {
        openPenFeed(zone, at);
        return;
      }
      // Anywhere else, a tap on bare ground is just somewhere to stand. It used
      // to open the seed ring here; the belt replaced that, and the map only
      // routes a pen's ground to this callback now (scene.ts's `fire`), so the
      // branch above is the whole of it.
    },
    [openPenFeed],
  );

  /** A finger landed on the barn -- Ray's Supply Store's entryway. Nothing
   *  goes to the server. (Ray's own gift dialogue no longer shortcuts here;
   *  the barn is the only door to the store for now.) */
  const onWorldBarnTap = useCallback(() => {
    panelSound();
    setShowStore(true);
  }, []);

  /** A finger landed on the signpost, the Town Board's entryway now that
   *  the places list is gone. Same shape as `onWorldBarnTap`. */
  const onWorldSignpostTap = useCallback(() => {
    panelSound();
    setShowContracts(true);
  }, []);

  /** A finger landed on the Workshop building. Same shape
   *  as `onWorldBarnTap`. */
  const onWorldWorkshopTap = useCallback(() => {
    panelSound();
    setShowWorkshop(true);
  }, []);

  /** Fills the watering can. Tapping the yard's well does this, and so does
   *  the ring on a well the player dug. */
  const onWorldWellTap = useCallback(
    (at: TapPoint) => {
      if (water >= WATER_CAPACITY) {
        world.current?.floatAt(at, "Your watering can is already full.", "deny");
        return;
      }
      waterSound();
      world.current?.floatAt(at, `+${WATER_CAPACITY - water} water`, "gain", "ico-water");
      void act({ action: "draw-water" });
    },
    [act, water],
  );

  /**
   * A fish has taken the line. The map has already played the cast out and has
   * the farmer locked on the dock with a bent rod (scene.ts's `beginCast`);
   * this opens the gauge over it, which is the part that can be missed.
   *
   * Only landing one sends `catch-fish`. Either way the outcome goes back to
   * the map through `endFishingCast` so the farmer acts it out -- the gauge is
   * its own Phaser scene and cannot reach him itself.
   *
   * The species here is DIFFICULTY ONLY, rolled locally from the odds the
   * cast's own distance gives, to pick how hard the fight is; the fish this
   * cast actually lands is the server's roll inside `catch-fish`, so the
   * gauge's copy stays species-free.
   *
   * A landed fish is shown once both the answer is in and the gauge has
   * closed, the way Stardew waits for its fishing bar to go before the fish
   * comes out of the water: it jumps into the farmer's hands and he holds it
   * up with "+1 Trout" over it (`revealCatch`).
   */
  const onWorldFishHooked = useCallback(
    (at: TapPoint, castPower: number) => {
      tapAnchor.current = at;
      // Checked before the fight, so a tired player is never made to land a
      // fish the server would refuse. The server checks again on `catch-fish`.
      if (energyAt(energy, new Date()) < FISHING_CAST_ENERGY) {
        world.current?.endFishingCast("escaped");
        refusedSound();
        world.current?.floatAt(at, TOO_TIRED_TO_FISH, "deny");
        return;
      }
      panelSound();
      let landing: Promise<unknown> | null = null;
      world.current?.startFishingGauge({
        species: rollGaugeDifficulty(castTier(castPower)),
        title: "Something's on the line!",
        landedHint: "Reeling it in...",
        onLanded: () => {
          world.current?.endFishingCast("landed");
          landedFish.current = null;
          // Read at the moment of landing so a toggle flipped mid-fight counts.
          landing = act({ action: "catch-fish", bait: baitOnHook.current, cast: castPower });
        },
        onEscaped: () => {
          world.current?.endFishingCast("escaped");
          // No catch, no cost: the line just went slack. Said out at the
          // bobber, where the player was already looking.
          world.current?.floatAt(at, "It got away.", "deny");
        },
        // After a landed fight, the reveal. Otherwise a no-op after the
        // escape above, and the thing that saves the player from a farmer
        // stuck mid-fight when there was no gauge to fight on:
        // `startFishingGauge` answers a missing map with `onClosed` alone,
        // and the cast is still holding input at that point.
        onClosed: () => {
          if (!landing) {
            world.current?.endFishingCast("escaped");
            return;
          }
          // `act` never rejects. A refusal or a lost connection leaves no
          // fish, and the line comes in empty.
          void landing.then(() => {
            const species = landedFish.current;
            landedFish.current = null;
            if (!mounted.current) return;
            if (!species) {
              world.current?.revealCatch(null);
              return;
            }
            setLastCollect({ text: `Caught ${machineItemLabel(species, 1)}!`, nonce: Date.now() });
            world.current?.revealCatch({ species, noun: machineItemNoun(species, 1) });
          });
        },
      });
    },
    [act, energy],
  );

  /**
   * A finger landed on the Greenhouse's own footprint, from outside it
   * (lib/stackacres/greenhouse.ts). Opens the same panel either way -- built
   * or not is what decides which of its two screens shows -- and, when it is
   * already built, also eases the camera inside it. An unbuilt Greenhouse has
   * no interior worth stepping into yet, so the camera stays put and the
   * panel's own build screen is the whole story.
   */
  const onWorldGreenhouseTap = useCallback(() => {
    panelSound();
    setShowGreenhouse(true);
  }, []);

  /** Closes the Greenhouse panel, sound first, the same shape
   *  `onWorldBarnTap`'s own modal takes on the way out. */
  const closeGreenhouse = useCallback(() => {
    panelSound();
    setShowGreenhouse(false);
  }, []);

  const onBuildGreenhouse = useCallback(() => {
    buySound();
    void act({ action: "build-greenhouse" });
  }, [act]);

  const onSowGreenhouse = useCallback(
    (stock: StackAcresStock) => {
      sowSound();
      void act({ action: "stock", stock, inGreenhouse: true });
    },
    [act],
  );

  const onCollectGreenhouse = useCallback(
    (unitId: string) => {
      // Six slots side by side in one panel: the same press-down-the-list
      // burst `onCollect` batches for, for the same reason.
      const unit = unitsRef.current.find((candidate) => candidate.id === unitId);
      if (unit) collectSound(unit.stock);
      tapBatched("collect", unitId);
    },
    [tapBatched],
  );

  /**
   * A finger landed on one of the three hidden discovery spots. The scene has
   * already fired its own local, optimistic `secretDiscoveryPuff` by the time
   * this callback runs (see stackacres-scene.ts's own dispatch) -- all this
   * does is call the server and, on the response, layer the second,
   * celebratory beat if it actually found something (see the `discovery`
   * handling in `act`'s own response branch above).
   */
  const onWorldSecretZoneTap = useCallback(
    (zoneId: HiddenZoneId, at: TapPoint) => {
      tapAnchor.current = at;
      if (inFlight.current.has("tap-secret-zone")) return;
      void act({ action: "tap-secret-zone", zoneId });
    },
    [act],
  );

  /**
   * A finger landed on land nobody has cleared. There is nothing standing
   * there to act on, so this is a question rather than an action: what is
   * under the growth, what it costs, and what is still in the way.
   *
   * A full modal rather than the radial menu the fenced ground gets, and
   * deliberately: the seed menu is a fast, repeatable choice between things
   * you already understand, and this is a permanent purchase with conditions
   * on it. It is worth stopping for.
   */
  const onWorldLockedTap = useCallback((zone: ZoneId) => {
    panelSound();
    setPlace(zone);
    setClearing(zone);
  }, []);

  /**
   * The town board's two actions, handed down as promises rather than as
   * fire-and-forget calls: the sheet debits its own shelf before either goes
   * out and has to know whether to put it back. See `act`'s own doc for why
   * it answers at all.
   */
  const onSettleContract = useCallback(
    () => act({ action: "fulfill-contract" }),
    [act],
  );

  const onRequestContract = useCallback(
    () => act({ action: "request-contract" }),
    [act],
  );

  const onPassContract = useCallback(
    () => act({ action: "pass-contract" }),
    [act],
  );

  /**
   * The Workshop's actions, adapted from `act`'s fixed `ContractActionResult`
   * shape: `lastProcessing` is where the
   * answer's own "what this call just did" lands, taken once, right after
   * the call that set it. Cleared first so a stale delta from an earlier
   * call can never be read as this one's.
   */
  const workshopAct = useCallback(
    async (body: Action): Promise<WorkshopActionResult> => {
      takeProcessingDelta();
      const result = await act(body);
      if (!result.ok) return { ok: false, message: result.message };
      const delta = takeProcessingDelta();
      return { ok: true, work: delta?.work, processed: delta?.processed, sold: delta?.sold };
    },
    [act, takeProcessingDelta],
  );
  const onPlaceMachine = useCallback(
    async (kind: MachineKind) => {
      const result = await workshopAct({ action: "place-machine", kind });
      // Only once the server has said yes, so a refused build never celebrates.
      const finished = result.ok ? chapterFinishedBy(kind, new Set([...builtKindsRef.current, kind])) : null;
      if (finished) {
        setChapterCard(finished);
        townFavorSound();
        world.current?.emote("farmer", "sparkle");
      }
      return result;
    },
    [workshopAct],
  );
  const onProcessRecipe = useCallback(
    (recipe: RecipeId) => workshopAct({ action: "process", recipe }),
    [workshopAct],
  );
  const onWork = useCallback(() => workshopAct({ action: "work" }), [workshopAct]);
  const onUpgradeAxe = useCallback(
    (pay: AxePayment) => {
      buySound();
      return workshopAct({ action: "upgrade-axe", pay });
    },
    [workshopAct],
  );
  const onSell = useCallback(
    (item: MachineItemId, quantity: number) => {
      sellSound();
      return workshopAct({ action: "sell", item, quantity });
    },
    [workshopAct],
  );

  /** The vat's two actions, same adapter, its own result shape. */
  const vatAct = useCallback(
    async (body: Action): Promise<VatActionResult> => {
      takeProcessingDelta();
      const result = await act(body);
      if (!result.ok) return { ok: false, message: result.message };
      return { ok: true, collected: takeProcessingDelta()?.vatCollected };
    },
    [act, takeProcessingDelta],
  );
  const onSealVat = useCallback(() => vatAct({ action: "seal-vat" }), [vatAct]);
  const onCollectVat = useCallback(() => vatAct({ action: "collect-vat" }), [vatAct]);

  /** The Synergy Tree's two actions, same "hand down as a promise" shape as
   *  the town board's above. */
  const onUnlockSynergyPerk = useCallback(
    (archetype: SynergyArchetype) => act({ action: "unlock-synergy-perk", archetype }),
    [act],
  );

  const onActivateSynergyPerk = useCallback(
    (archetype: SynergyArchetype, slot: number) => act({ action: "activate-synergy-perk", archetype, slot }),
    [act],
  );

  /**
   * The Prestige Reset Valve's own request, adapted from `act`'s fixed
   * `ContractActionResult` shape to `StackAcresPrestigeActionResult` --
   * `lastPrestigeReset` is where the extra field (what THIS reset just
   * bought) lands.
   */
  const onPrestigeReset = useCallback(async (): Promise<StackAcresPrestigeActionResult> => {
    const result = await act({ action: "prestige-reset", confirm: true });
    if (!result.ok) return { ok: false, message: result.message };
    if (!lastPrestigeReset.current) {
      return { ok: false, message: "That did not go through. Nothing was reset." };
    }
    return { ok: true, result: lastPrestigeReset.current };
  }, [act]);

  /** The Sunlight Forge's own request. `act`'s fixed `ContractActionResult`
   *  shape is already exactly `ForgeActionResult` -- there is no extra field
   *  to adapt out of a sidecar the way `onPrestigeReset` needs, since `forge`
   *  above already carries the resulting owned-list on the same response. */
  const onForgeEnchantment = useCallback(
    (enchantmentId: string): Promise<ForgeActionResult> =>
      act({ action: "forge-enchantment", itemId: enchantmentId }),
    [act],
  );

  /** The Crossbreeding Bed's two requests. A plant is answered by the bed
   *  itself repainting off the response; a harvest also wants to say what it
   *  bred, which rides the same sidecar ref `onPrestigeReset` uses. */
  const onPlantCrossbreed = useCallback(
    (row: number, col: number, stock: StackAcresStock): Promise<CrossbreedActionResult> =>
      act({ action: "plant-crossbreed", row, col, stock }),
    [act],
  );
  const onHarvestCrossbreed = useCallback(
    async (plotId: string): Promise<CrossbreedHarvestActionResult> => {
      lastCrossbreedHarvest.current = null;
      const result = await act({ action: "harvest-crossbreed", plotId });
      if (!result.ok) return result;
      return { ok: true, settlement: lastCrossbreedHarvest.current };
    },
    [act],
  );

  /** Ray's Mythic Blueprints. Same shape reuse as `onForgeEnchantment` above
   *  -- `act`'s `ContractActionResult` is already a superset of
   *  `BlueprintActionResult`, and `blueprints` in the response already
   *  carries the resulting card, so there is nothing else to adapt. */
  const onStartBlueprint = useCallback(
    (structureId: BlueprintId): Promise<BlueprintActionResult> =>
      act({ action: "start-blueprint", structureId }),
    [act],
  );

  const onContributeBlueprint = useCallback(
    (structureId: BlueprintId, itemId: MachineItemId, amount: number): Promise<BlueprintActionResult> =>
      act({ action: "contribute-blueprint", structureId, itemId, amount }),
    [act],
  );

  /**
   * Tilling a bed straight out of the radial ring, or dragged across N tiles
   * by the soil brush -- see optimistic-actions.ts's `place-soil-tile` case.
   * The bed appears the instant this fires (deterministic: bare ground or
   * occupied is all there is to guess now that a bed is one tile), the same
   * posture `onPlacePipe` below already takes; the toast is flavour on top
   * of that, not a stand-in for a picture that has not arrived yet.
   */
  const onPlaceSoilTile = useCallback(
    (tx: number, ty: number) => {
      const key = `${tx},${ty}`;
      const request = act({ action: "place-soil-tile", tx, ty });
      // Held only until this exact request settles -- see
      // `pendingSoilPlacements`'s own header -- so `onRadialSeed` can wait
      // out a till it just fired before planting the same bed.
      pendingSoilPlacements.current.set(key, request);
      void request.finally(() => {
        if (pendingSoilPlacements.current.get(key) === request) {
          pendingSoilPlacements.current.delete(key);
        }
      });
    },
    [act],
  );

  /** Removing a purchased bed. Same optimistic posture as `onPlaceSoilTile`
   *  above -- the bed vanishes on the tap, not on the round trip. */
  const onRemoveSoilTile = useCallback(
    (tx: number, ty: number) => {
      buySound();
      void act({ action: "remove-soil-tile", tx, ty });
    },
    [act],
  );

  /**
   * Hold-tap lift, tap-to-drop: relocates the contiguous group of beds
   * touching the lifted tile so it lands on the tapped destination, whatever
   * crop stands on it carried along. Same optimistic posture as
   * `onPlaceSoilTile` above -- the group appears to have moved the instant
   * this fires (deterministic, see optimistic-actions.ts's
   * `move-soil-tile-group` case); a refusal (already a bed there, outside
   * the Crop Fields) rolls back through `act`'s own snapshot restore, the
   * same as every other tile action.
   */
  /**
   * A stroke's sowing, waiting to go out as one request.
   *
   * Holding Use and walking a row works a bed every time the farmer steps onto
   * one, four or five a second. Water and harvest presses already coalesce
   * through `tapBatched` (lib/stackacres/action-batch.ts), which batches by unit
   * id; sowing is by TILE and `stock` takes `tiles`, which that cannot express,
   * so it gets this one.
   *
   * `place-soil-tile` is deliberately not batched at all: it spends a bag of soil
   * per bed and the server has no grouped form, so hoeing a row is still one
   * request per bed.
   */
  const sowRun = useRef<{ stock: StackAcresCrop; tiles: { tx: number; ty: number }[] } | null>(null);
  /** The one timer that closes the run's window. Its own ref, not a field on the
   *  run, so nothing mutates an object the run's own closure already captured. */
  const sowTimer = useRef<number | null>(null);

  const flushSowRun = useCallback(() => {
    const run = sowRun.current;
    sowRun.current = null;
    if (sowTimer.current !== null) {
      window.clearTimeout(sowTimer.current);
      sowTimer.current = null;
    }
    if (!run || run.tiles.length === 0) return;
    // Wait out any bed in this run that was hoed a moment ago and has not come
    // back yet, the same as a single sowing does (see `onSowTile`).
    const waiting = run.tiles
      .map((tile) => pendingSoilPlacements.current.get(`${tile.tx},${tile.ty}`))
      .filter((pending) => pending !== undefined);
    void act(
      run.tiles.length === 1
        ? { action: "stock", stock: run.stock, tx: run.tiles[0].tx, ty: run.tiles[0].ty }
        : { action: "stock", stock: run.stock, tiles: run.tiles },
      { after: waiting.length > 0 ? Promise.allSettled(waiting) : undefined },
    );
  }, [act]);

  /** Adds one bed to the sowing run, flushing first if the crop changed mid-row. */
  const queueSow = useCallback(
    (stock: StackAcresCrop, tx: number, ty: number) => {
      if (sowRun.current && sowRun.current.stock !== stock) flushSowRun();
      const tiles = sowRun.current?.tiles ?? [];
      const already = tiles.some((tile) => tile.tx === tx && tile.ty === ty);
      sowRun.current = { stock, tiles: already ? tiles : [...tiles, { tx, ty }] };
      if (sowTimer.current === null) {
        sowTimer.current = window.setTimeout(() => {
          sowTimer.current = null;
          flushSowRun();
        }, ACTION_BATCH_WINDOW_MS);
      }
    },
    [flushSowRun],
  );

  // A run in flight when the farm unmounts still has to reach the server: the
  // beds already changed on screen under the optimistic patch.
  useEffect(() => () => flushSowRun(), [flushSowRun]);


  /**
   * The farmer is standing on a square with a belt tool in hand: he walked to a
   * tapped one and arrived, or the Use key fired on the one under his feet.
   *
   * This is the whole of watering, sowing, hoeing and picking now. It replaced
   * two flows: the tap-then-drag-a-token gesture (a second on its own before
   * anything was even sent) and the seed ring on bare ground. The action is
   * resolved off the held tool by `resolveBeltAction`, which is pure and tested,
   * so this only has to send it and give it a voice.
   *
   * A stroke (Use held while walking a row) stays silent on a refusal: one
   * floated line per bed walked over would bury the map in text. A single press
   * says why, the same as a tap always has.
   */
  const onUseSquare = useCallback(
    (square: UseSquare) => {
      const unit = square.unitId ? liveUnits.find((candidate) => candidate.id === square.unitId) ?? null : null;
      const action = resolveBeltAction(
        belt,
        {
          unit,
          tile: square.tile,
          bedded: square.tile ? hasSoilTile(soilMapForTiles, square.tile.tx, square.tile.ty) : false,
          armed: Boolean(
            square.tile && armedLift && armedLift.tx === square.tile.tx && armedLift.ty === square.tile.ty,
          ),
          fenced: square.tile ? fencedSquares.has(soilSquareFenceKey(square.tile)) : false,
        },
        {
          water,
          feed,
          shelfFeed: processing.inventory,
          gold,
          nowMs,
          seed,
          seedsHeld: seed ? seedStock[seed] ?? 0 : 0,
          wood: processing.inventory.wood ?? 0,
        },
      );
      // Anything that is not the second half of a lift disarms it, so an armed
      // bed never sits waiting through a walk across the farm.
      if (action.kind !== "arm-lift" && action.kind !== "lift" && action.kind !== "arm-unfence" && action.kind !== "unfence" && armedLift) {
        setArmedLift(null);
      }
      if (action.kind === "idle") return;
      if (action.kind === "arm-lift" || action.kind === "arm-unfence") {
        if (square.stroke) return;
        setArmedLift({ tx: action.tx, ty: action.ty });
        world.current?.floatAt(square.at, action.reason, "deny");
        return;
      }
      if (action.kind === "nothing") {
        if (square.stroke) return;
        if (action.why === "blocked") refusedSound();
        world.current?.floatAt(square.at, action.reason, "deny");
        return;
      }
      // Act it out where he stands, before the request goes anywhere: the
      // optimistic patch inside `act` lands in the same tick, so the swing and
      // the change on the ground are one beat rather than two.
      const animation = beltAnimation(action);
      if (animation) world.current?.farmerAction(animation, square.at);
      tapAnchor.current = square.at;
      // A stroke crosses four or five beds a second, so the tool's sound plays
      // once at the top of a run rather than once per bed; the continuous swing
      // animation carries the rest. No run gathering means this is the first bed.
      const voice = !square.stroke || sowRun.current === null;
      switch (action.kind) {
        case "water":
          // The splash is the scene's, on the frame the can tips (farmerAction above).
          // `tapBatched` sends the first press straight away and folds anything
          // within the window behind it into one plural request, so a lone crop
          // never pays for a batch it is not part of.
          tapBatched("water", action.unitId);
          return;
        case "collect": {
          // Already on its way: a second pull would play for nothing.
          if (unitsBeingCollected(inFlight.current).has(action.unitId)) return;
          const picked = liveUnits.find((candidate) => candidate.id === action.unitId);
          if (picked) collectSound(picked.stock);
          world.current?.pullCrop(action.unitId);
          // NOT batched, even mid-stroke: the Critical Harvest Cascade chains off
          // THIS request's own settled result, and a batched send has no promise
          // to hand back to the press that joined it. Its own intent names this
          // crop, so a harvest already in the air never blocks it.
          void act({ action: "collect", unitIds: [action.unitId] }).then((result) => {
            if (result.ok && picked) void triggerCascade(action.unitId, picked.stock);
            else lastHarvests.current.delete(action.unitId);
          });
          return;
        }
        case "feed": {
          const zone = unit ? stockZone(unit.stock) : null;
          if (zone && PEN_ZONE_IDS.includes(zone)) {
            feedPen(zone);
            return;
          }
          if (unit) feedSound(unit.stock);
          void act({ action: "feed", unitId: action.unitId });
          return;
        }
        case "clear":
          muckSound();
          void act({ action: "clear", unitId: action.unitId });
          return;
        case "till":
          // On the blade's strike, the same beat the scene drops the clod on.
          if (voice) window.setTimeout(hoeSound, HOE_STRIKE_MS);
          onPlaceSoilTile(action.tx, action.ty);
          return;
        case "lift":
          setArmedLift(null);
          onRemoveSoilTile(action.tx, action.ty);
          return;
        case "plant":
          if (voice) sowSound();
          if (square.stroke) {
            queueSow(action.stock, action.tx, action.ty);
            return;
          }
          onSowTile(action.tx, action.ty, action.stock);
          return;
        case "fence": {
          if (voice) buySound();
          const { mx, my } = soilToMapTile(action.tx, action.ty);
          void act({ action: "place-fence", tx: mx, ty: my });
          return;
        }
        case "unfence": {
          setArmedLift(null);
          const { mx, my } = soilToMapTile(action.tx, action.ty);
          void act({ action: "remove-fence", tx: mx, ty: my });
          return;
        }
      }
    },
    [act, fencedSquares, belt, feed, gold, liveUnits, nowMs, processing.inventory, onPlaceSoilTile, onSowTile, feedPen, seed, seedStock, onRemoveSoilTile, armedLift, queueSow, tapBatched, soilMapForTiles, triggerCascade, water],
  );

  const onMoveSoilTileGroup = useCallback(
    (tx: number, ty: number, toTx: number, toTy: number) => {
      buySound();
      void act({ action: "move-soil-tile-group", tx, ty, toTx, toTy });
    },
    [act],
  );


  const districtUnits = useMemo(
    () => liveUnits.filter((unit) => stockZone(unit.stock) === place),
    [liveUnits, place],
  );

  /**
   * The soundscape follows the player: which district they travelled to, and
   * what hour the farm clock says. `timeOfDay` is the music's own, so the two
   * layers can never disagree about whether it is night.
   *
   * Re-read on its own interval rather than derived from `nowMs`: that clock
   * only ticks while something is growing, so a farm sitting idle across 6pm
   * would keep its daylight birds until the player did something.
   */
  // The first read is before any snapshot, so it is the shared clock; the
  // interval below picks up this farm's own offset.
  const [tod, setTod] = useState(() => timeOfDay(gameHourAt(Date.now(), 0)));
  useEffect(() => {
    // A game day is 13 minutes, so the soundscape looks every 5 seconds.
    const timer = window.setInterval(() => setTod(timeOfDay(gameHourNow())), 5_000);
    return () => window.clearInterval(timer);
  }, [gameHourNow]);
  useEffect(() => {
    setAmbiencePlace(tod);
  }, [tod]);
  /**
   * The river bed: a permanent, farm-wide fact (has the Sheep Pens' mud
   * hollow been cleared), not a positional one -- see
   * lib/stackacres/ambience-plan.ts's `riverBedGain` for why it rides the
   * same `sectors` state the map and the shop lock already read, rather than
   * which district the camera happens to be over.
   */
  useEffect(() => {
    if (!hasStarted) return;
    setAmbienceRiverUnlocked(isSectorUnlocked("wallow", sectors));
  }, [hasStarted, sectors]);

  /**
   * Standing in Ox Fields with no cattle should sound like empty ground;
   * standing there with three should sound like you keep cattle. Only the
   * animals in the district being listened to count -- a cow four districts
   * away is not audible from here.
   */
  useEffect(() => {
    const herd = { hen: 0, pig: 0, cattle: 0 };
    for (const unit of districtUnits) {
      // A mucked unit has nothing standing on it to make a noise.
      if (unit.state === "mucked") continue;
      if (unit.stock === "hen" || unit.stock === "pig" || unit.stock === "cattle") {
        herd[unit.stock] += 1;
      }
    }
    setAmbienceHerd(herd);
  }, [districtUnits]);
  /**
   * What Ray's shelf is allowed to look at when it decides which rows are
   * open -- the same four facts the SERVER reads before it takes any Gold
   * (`readShopProgress` in lib/server/stackacres-service.ts), fed through the
   * same pure evaluator. That is the whole reason this is a struct and not
   * four loose props: a greyed-out card and the refusal behind it have to be
   * two renderings of one answer, never two answers.
   */
  const shopProgress = useMemo<StackAcresShopProgress>(
    () => ({ sectors, influence, greenhouseBuilt, cropFieldsUnlocked }),
    [sectors, influence, greenhouseBuilt, cropFieldsUnlocked],
  );

  /**
   * The Journal (lib/stackacres/journal.ts): the chip's line and the sheet
   * behind it, both off one derivation so they cannot say different things.
   *
   * It reads `liveUnits` rather than `units`, so a crop the optimistic layer
   * has already moved off dry is off the "gone dry" line at the same instant
   * the bed on screen darkens. Nothing here is fetched and nothing is stored.
   */
  const journal = useMemo(
    () =>
      journalView({
        gold,
        inventory: processing.inventory,
        built: builtKinds,
        units: liveUnits,
        contract: processing.contract,
        vat,
        cellar,
        story: storyView,
        progress: shopProgress,
        machines: processing.machines,
        woodNodes,
        stoneNodes,
        forageNodes,
        nowMs,
      }),
    [
      gold,
      processing.inventory,
      processing.contract,
      processing.machines,
      builtKinds,
      liveUnits,
      vat,
      cellar,
      storyView,
      shopProgress,
      woodNodes,
      stoneNodes,
      forageNodes,
      nowMs,
    ],
  );


  /** The Supply Store's Livestock shelf: every livestock kind whose own
   *  district is unlocked, not just whichever one `place` happens to be --
   *  the store is opened from the barn, not from standing in a district, so
   *  it has no single zone of its own the way the signpost drawer's
   *  `buyOptions` above does. A kind whose district is still locked (the
   *  Fold, Ox Fields, until the sector ladder opens them) shows below as a
   *  greyed card instead (`lockedPens`), whose button opens that land's
   *  clearing sheet. */
  const livestockBuyOptions: BuyOption[] = useMemo(
    () =>
      Array.from(new Set(STACKACRES_LIVESTOCK.map(stockZone)))
        .filter((zone) => isSectorUnlocked(zone, sectors))
        .flatMap((zone) =>
          buyOptionsForZone(zone, { units: liveUnits, gold, capacity, inventory: processing.inventory }),
        ),
    [sectors, liveUnits, gold, capacity, processing.inventory],
  );
  const lockedPens = useMemo(() => lockedLivestock(sectors), [sectors]);

  /**
   * The crops the seed wheel offers: everything the barn holds seed for, best
   * first, plus whatever is already on the wheel so a pouch that just ran dry
   * still shows what it was sowing rather than emptying itself.
   */
  const seedWheelItems = useMemo<SeedWheelItem[]>(() => {
    const crops = STACKACRES_CROPS.filter((crop) => (seedStock[crop] ?? 0) > 0 || crop === seed);
    return crops.map((crop) => ({
      stock: crop,
      label: STACKACRES_CATALOGUE[crop].label,
      icon: STOCK_ICON[crop],
      qty: seedStock[crop] ?? 0,
    }));
  }, [seed, seedStock]);


  /** Produce in the barn, in catalogue order so the list never reshuffles. */
  /** Everything standing ready right now. The Harvest key's whole subject. */
  const readyUnits = useMemo(
    () => liveUnits.filter((unit) => unit.state === "ready"),
    [liveUnits],
  );
  const carrying = readyUnits.length;

  /**
   * A finger landed on the brush at the Ancestral Oak. From here it is a
   * stalk played on the open map: closing the distance without startling the
   * animal, then pressing Use, is what decides whether `bag-quarry` is sent
   * at all (see lib/stackacres/hunt-proximity.ts).
   *
   * The species here is DIFFICULTY ONLY, rolled locally to pick how hard the
   * stalk is; what this one actually yields is the server's roll inside
   * `bag-quarry`, so the scope's copy stays species-free and the response's
   * toast is what names it. The GEAR is the real input -- the Handheld
   * Camera until the farm reaches Level 4, the Telephoto Lens Scanner after.
   */
  const onWorldThicketTap = useCallback(
    (at: TapPoint) => {
      tapAnchor.current = at;
      world.current?.startHuntScope({
        species: rollQuarryDifficulty(),
        weapon: bestWeapon(shopProgress),
        baggedHint: "Back to the farm",
        onBagged: () => {
          void act({ action: "bag-quarry" });
        },
        onLost: () => {
          // No catch, no cost: it simply heard something and moved off.
          // Said where the stalk started, the same place a refusal here
          // would be said.
          world.current?.floatAt(at, "It got startled off.", "deny");
        },
      });
    },
    [act, shopProgress],
  );

  /** Checked before he swings the axe or clears land, so a tired farmer is
   *  told so instead of swinging at nothing. The server checks again. */
  const onWorldMaySwing = useCallback(
    (at: TapPoint) => {
      if (energyAt(energy, new Date()) >= AXE_SWING_ENERGY) return true;
      refusedSound();
      world.current?.floatAt(at, TOO_TIRED_TO_CHOP, "deny");
      return false;
    },
    [energy],
  );

  /**
   * The farmer has walked up to one of the Homestead's own trees and is
   * already swinging (the scene plays the swing, and refuses the tap itself
   * when the tree is still a stump). One tap is one swing.
   */
  const onWorldTreeTap = useCallback(
    (nodeId: string, at: TapPoint) => {
      tapAnchor.current = at;
      void act({ action: "chop-tree", nodeId });
    },
    [act],
  );

  /**
   * A finger landed on one of the Homestead's forage bushes.
   *
   * Fires the pick straight off, like a swing at a tree, and the optimistic
   * layer paints the seed before the server answers
   * (lib/stackacres/optimistic-actions.ts).
   */
  const onWorldForageTap = useCallback(
    (nodeId: string, at: TapPoint) => {
      const bush = forageNodes.find((node) => node.nodeId === nodeId);
      // A bare bush says so rather than sending a request the server will
      // only refuse: the picked-over art is already on screen, so a silent
      // no-op would read as a dropped tap.
      if (bush && !bush.ready) {
        world.current?.floatAt(at, "Picked over", "deny");
        return;
      }
      forageSound();
      void act({ action: "gather-forage", nodeId });
    },
    [act, forageNodes],
  );

  /** A swing at one of the Mine's own boulders. Same split as `onWorldTreeTap`. */
  const onWorldStoneTap = useCallback(
    (nodeId: string, at: TapPoint) => {
      tapAnchor.current = at;
      void act({ action: "mine-stone", nodeId });
    },
    [act],
  );

  /** A swing at something standing on land being cleared. Same split as `onWorldTreeTap`. */
  const onWorldLandTap = useCallback(
    (obstacleId: string, at: TapPoint) => {
      tapAnchor.current = at;
      void act({ action: "work-land", obstacleId });
    },
    [act],
  );

  // stackacres-scene.ts fires onReady synchronously once the scene is built
  // and the camera framed -- before Phaser's own render loop has actually
  // painted that frame to the canvas. Waiting two rAF ticks closes that gap
  // so the loading overlay doesn't drop a beat before the world.
  const onWorldReady = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setWorldReady(true)));
  }, []);

  const bootPhase = useMinHoldFade(!loaded || !worldReady, { minMs: 500, fadeMs: 320 });

  // After every hook above, same position poker-table.tsx gates its own
  // render at. A full replacement, not an overlay -- the farm itself never
  // mounts in portrait, so there is nothing underneath to half-render or to
  // trap a tap on. `useLandscape`'s server snapshot defaults to landscape, so
  // this never flashes on desktop and only ever shows up on a real portrait
  // phone once the client has actually checked.
  if (!landscape) {
    return (
      <main className="game-shell sa-rotate">
        {/* The Homestead itself behind the ask, and a phone tipping onto its side with the
            farmer walking across it once it lands: the picture says it before the words do. */}
        <div className="sa-rotate-ground" aria-hidden="true" />
        <div className="sa-rotate-card" role="status" aria-live="polite">
          <StackAcresLogo variant="stacked" className="sa-rotate-logo" alt="" aria-hidden="true" />
          <div className="sa-rotate-stage" aria-hidden="true">
            <span className="sa-rotate-phone">
              <span className="sa-rotate-screen" />
            </span>
            <span className="sa-rotate-farmer" />
          </div>
          <h1>Turn your phone sideways</h1>
          <p>The farm opens in landscape.</p>
        </div>
      </main>
    );
  }

  // Same full-replacement posture as the orientation gate above, and it runs
  // after that check on purpose: a portrait phone sees "turn sideways" first,
  // and the splash's own gesture only needs to happen once the farm can
  // actually render. Data keeps loading underneath it (the fetch effect
  // already ran on mount), so the farm is ready the instant a player taps
  // through rather than waiting on the splash's own fade.
  if (!hasStarted) {
    return (
      <StackAcresPlayScreen
        onStart={() => setHasStarted(true)}
        profile={profile}
        onProfileSaved={setProfile}
      />
    );
  }


  // Everything in .sa-hud besides Gold and the upkeep-owed pill -- see the
  // header's own comment for why this is one fragment referenced from either
  // the inline row (desktop/tablet landscape) or StackAcresHudOverflow's
  // drawer (compactNav), never both.
  const secondaryHud = (
    <>
      <span className="sa-feed" title="Feed servings">
        <StackAcresPixelIcon name="sack" />
        <strong>{feed}</strong>
        <span className="sa-sr">feed servings</span>
      </span>
      <span
        className={clsx("sa-feed sa-water", { "is-empty": water < 1 })}
        title="Water in your can. Fill it at the well."
      >
        <StackAcresPixelIcon name="water" />
        <strong>{water}</strong>
        <span className="sa-sr">of {WATER_CAPACITY} water in your can</span>
      </span>
      <SynergyBadge
        unlocked={synergyUnlocked}
        active={synergyActive}
        onOpen={() => { panelSound(); setShowSynergy(true); }}
      />
      {/* The Prestige Reset Valve's entry point is off the HUD until the
          valve is redesigned: as it stands it multiplies manual sales only,
          so it pays a player to stop using contracts, the Vat and the Farm
          Kitchen, which is backwards for an investment farm. A multiplier
          already earned keeps applying to sales. */}
      {/* The Sunlight Forge's own entry point -- same standing-badge posture
          as the Prestige valve above it, since a forged enchantment is also
          a permanent, session-spanning upgrade worth a glance rather than a
          buried menu item. */}
      <button
        type="button"
        className="sa-prestige-badge"
        onClick={() => { panelSound(); setShowForge(true); }}
        title="The Sunlight Forge"
      >
        <Wand2 size={13} aria-hidden="true" />
        <strong>{forge.length}/{Object.keys(FORGE_ENCHANTMENTS).length}</strong>
      </button>
      {/* The Crossbreeding Bed's own entry point -- same standing-badge
          posture as the two above it. The count is hybrids bred to date,
          the one number about the bed worth a glance every session. */}
      <button
        type="button"
        className="sa-prestige-badge"
        onClick={() => { panelSound(); setShowCrossbreed(true); }}
        title="The Crossbreeding Bed"
      >
        <Dna size={13} aria-hidden="true" />
        <strong>
          {Object.values(crossbreed.inventory).reduce((sum, qty) => sum + (qty ?? 0), 0)}
        </strong>
      </button>
      <StackAcresMusicToggle />
    </>
  );

  return (
    <main className="duel-shell ante-shell sa-shell">
      {placeTag && (
        <div key={placeTag.n} className="sa-place-tag" role="status">
          {placeTag.name}
        </div>
      )}
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
          <button type="button" className="htp-trigger" onClick={openMap}>
            <StackAcresPixelIcon name="map" /> Map
          </button>
          <StackAcresJournalChip view={journal} onOpen={() => { journalSound(); setShowGoals(true); }} />
        </div>
        {/* One purse now. The farm's own currency is gone, so the Gold pill
            the rest of the app already shows is the whole story, and it keeps
            its usual place at the end of the row.

            Below the compactNav tier, everything past Gold/upkeep moves into
            StackAcresHudOverflow's own "More" drawer instead of laying out
            inline -- six-plus pills was the actual complaint, not any one
            pill's size. This is gated on `compactNav` (a landscape-phone
            *height* under 500px) rather than a width breakpoint: the farm
            never renders outside landscape (see the orientation gate above),
            and every phone's width in landscape is 700px+ -- comfortably past
            any width breakpoint that would ever fire, which is why the first
            pass of this (`usePhoneViewport`, a portrait-width check borrowed
            from the lobby shell) never actually collapsed anything. Height is
            what actually separates a phone on its side from a tablet or a
            desktop window here. `secondaryHud` is declared once and
            referenced from whichever branch is live, never both at once, so
            nothing here mounts twice. */}
        <div className="sa-hud">
          {!compactNav && secondaryHud}
          {/* Only when something is actually owed. A land fee of zero is the
              normal state for a small farm, and a permanent "0" in the HUD
              would be a bill where there is no bill. */}
          {upkeep.due > 0 && (
            <span
              className="sa-upkeep"
              title={`Land maintenance on ${upkeep.plots} plots. Comes out of your next sale, contract or vat batch.`}
            >
              <StackAcresPixelIcon name="coin" />
              <strong>-{upkeep.due.toLocaleString()}</strong>
              <span className="sa-sr">Gold of land maintenance due</span>
            </span>
          )}
          <span
            className="sa-energy"
            title="Energy. Fishing, chopping and clearing land use it. Eat at your house to fill it up."
          >
            <StackAcresPixelIcon name="energy" />
            <span className="sa-sr">Energy</span>
            <span className="sa-energy-bar" aria-hidden="true">
              <span style={{ width: `${(energyAt(energy, new Date(nowMs)) / ENERGY_MAX) * 100}%` }} />
            </span>
            <strong>{energyAt(energy, new Date(nowMs))}</strong>
            <span className="sa-sr">of {ENERGY_MAX} energy</span>
          </span>
          {radishesHeld > 0 && (
            <label className="sa-bait-toggle" title="Spend a Radish per cast to catch trout and catfish more often.">
              <input type="checkbox" checked={useBait} onChange={(event) => setUseBait(event.target.checked)} />
              <span>Use radish bait ({radishesHeld})</span>
            </label>
          )}
          <span className="gold-balance floor-wallet" data-tour="sa-gold-balance" title="Gold">
            <StackAcresPixelIcon name="coin" />
            {/* A profile that never arrived (the paired land/unit fetch threw,
                so the whole /api/stackacres response was discarded) is "we
                don't know yet," not "zero" -- this once read as broke for a
                fully funded account. */}
            <strong>{profile?.unlimitedGold ? "∞" : profile ? profile.goldBalance.toLocaleString() : "—"}</strong>
          </span>
          {compactNav && <StackAcresHudOverflow>{secondaryHud}</StackAcresHudOverflow>}
        </div>
      </header>

      <div className="sa-main">
        {/* The world. Everything after it inside .sa-field is chrome pinned
            over the canvas; the canvas itself is the only thing that moves
            when the player drags. */}
        <div
          ref={fieldRef}
          className="sa-field"
          data-tour="sa-farm-world"
        >
          {loaded && (
            <StackAcresTopdownWorld
              units={liveUnits}
              woodNodes={woodNodes}
              stoneNodes={stoneNodes}
              forageNodes={forageNodes}
              landObstacles={landObstacles}
              fences={fences}
              onUseSquare={onUseSquare}
              useKeyLabel={BELT_TOOL_DEFS[belt].label}
              tool={tool}
              cutter={cutter}
              farmhandSpeedMultiplier={farmhandSpeedMultiplier}
              viewExpansion={compactNav ? HUD_VIEW_EXPANSION : 1}
              celebrate={celebrate}
              onReady={onWorldReady}
              onGroundTap={onWorldGroundTap}
              onSoilMoveCommitted={onMoveSoilTileGroup}
              onBarnTap={onWorldBarnTap}
              onSignpostTap={onWorldSignpostTap}
              onWorkshopTap={onWorldWorkshopTap}
              onWellTap={onWorldWellTap}
              onDockTap={onWorldFishHooked}
              onThicketTap={onWorldThicketTap}
              onTreeTap={onWorldTreeTap}
              maySwing={onWorldMaySwing}
              onStoneTap={onWorldStoneTap}
              onForageTap={onWorldForageTap}
              onLandTap={onWorldLandTap}
              onGreenhouseTap={onWorldGreenhouseTap}
              onMonkTap={onWorldMonkTap}
              onRayTap={onWorldRayTap}
              onHouseTap={onWorldHouseTap}
              onBedTap={onWorldBedTap}
              clockHour={gameHourNow}
              onTravelerTap={onWorldTravelerTap}
              onSecretZoneTap={onWorldSecretZoneTap}
              sectors={sectors}
              onLockedSectorTap={onWorldLockedTap}
              onViewMoved={onViewMoved}
              onPlaceEntered={onPlaceEntered}
              soilTiles={mergedSoilTiles}
              api={world}
            />
          )}
          {bootPhase !== "hidden" && (
            <div className={clsx("sa-loading", bootPhase === "hiding" && "sa-loading-hiding")}>
              <StackAcresLogo variant="stacked" className="sa-loading-logo" alt="" aria-hidden="true" />
            </div>
          )}


          {/* The masthead pill (logo, and before that the pen/field counts) that
              used to sit here is gone -- the signpost below is what a player
              actually reads on this screen, and it now takes the band this
              freed up. The page still needs its own heading for the a11y
              tree, just with no visual footprint to reclaim the space for. */}
          <h1 className="sr-only">StackAcres</h1>

          {/* The farm clock, pinned under the top bar's right end. The bar is
              already full on a narrow landscape phone, so the clock hangs
              below it instead of pushing the Gold pill off screen. */}
          <p className="sa-clock" title="Time on the farm. A day lasts 13 minutes. Sleep in your bed from 6 PM.">
            {isNightHour(clockHour) ? <Moon size={14} aria-hidden="true" /> : <Sun size={14} aria-hidden="true" />}
            <strong>{clockLabel(clockHour)}</strong>
          </p>

          {lastCollect && (
            <p key={lastCollect.nonce} className="sa-toast" role="status">
              {lastCollect.text}
            </p>
          )}

          {/* The tool belt, top left. The places list is gone and so is the old
              tool dock: Shop, Blueprints, Town Board and Workshop are walked up
              to (Ray, the signpost, the windmill), and the ground is worked with
              whichever slot is held plus the Use key across from the thumb stick. */}
          <StackAcresToolbelt
            held={belt}
            onPick={pickBeltTool}
            seed={seed}
            seedIcon={seed ? STOCK_ICON[seed] : null}
            seedsHeld={seed ? seedStock[seed] ?? 0 : 0}
            water={water}
            onOpenSeeds={() => {
              panelSound();
              setSeedWheelOpen(true);
            }}
          />

          {seedWheelOpen && (
            <StackAcresSeedWheel
              items={seedWheelItems}
              picked={seed}
              onPick={(stock) => {
                toolSound();
                setSeed(stock);
                setBelt("seeds");
                setSeedWheelOpen(false);
              }}
              onClose={() => setSeedWheelOpen(false)}
            />
          )}

          {/* The Pixel Pilgrim's dialogue, same screen-anchored treatment
              as the seed menu above. */}
          {monkDialogue && (
            <StackAcresMonkDialogue
              at={monkDialogue.at}
              devotion={devotion}
              result={monkDialogue}
              busy={pendingByPrefix("pray")}
              onPray={onMonkPray}
              onClose={() => setMonkDialogue(null)}
            />
          )}

          {/* The bed's "Go to sleep?" card, pinned where the bed was tapped. */}
          {sleepDialog && (
            <StackAcresSleepDialogue at={sleepDialog} onSleep={onSleep} onClose={() => setSleepDialog(null)} />
          )}

          {/* NPC friendship's gift dialogue, same screen-anchored treatment
              as the Pixel Pilgrim's above. */}
          {giftDialogue && (
            <StackAcresFriendshipDialogue
              at={giftDialogue.at}
              npc={giftDialogue.npc}
              npcLabel={NPC_GIFT_CATALOGUE[giftDialogue.npc].label}
              inventory={processing.inventory}
              friendship={friendship[giftDialogue.npc]}
              result={giftDialogue}
              busy={pendingByPrefix(`give-gift:${giftDialogue.npc}`)}
              onGift={(item) => onGiveGift(giftDialogue.npc, item)}
              onClose={() => setGiftDialogue(null)}
            />
          )}

          {/* One of the eleven story travelers' dialogue, same screen-anchored
              treatment as the Pixel Pilgrim's and the gift dialogue above --
              anchored over their head, not the finger (see the scene's own
              `travelerHeadPoint`). */}
          {story.dialogue && (
            <StackAcresStoryDialogue
              traveler={story.dialogue.traveler}
              at={story.dialogue.at}
              node={story.dialogue.node}
              busy={story.busy}
              onChoose={(choice) => void story.choose(choice)}
              onClose={story.close}
            />
          )}

          {/* Bring the whole farm in at once.
              THIS IS THE ONLY CONTROL THAT CAN EARN A SYNERGY, and that is why
              it exists as its own affordance rather than being implied by
              tapping units one at a time: Bountiful Harvest is a property of
              what was gathered TOGETHER, so a farm collected a tap at a time
              earns nothing. It only appears when there is something to bring
              in -- a permanently-visible disabled key on a canvas is chrome a
              player learns to stop reading. */}
          {carrying > 0 && (
            <button
              type="button"
              className="sa-harvest-all"
              disabled={isPending("collect")}
              onClick={onHarvestAll}
            >
              <StackAcresIcon name="ico-harvest" size={18} />
              <span>
                Harvest {carrying} {carrying === 1 ? "field" : "fields"}
              </span>
            </button>
          )}

        </div>
      </div>

      {showStore && (
        <div
          className="sa-store-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Supply store"
          onMouseDown={(event) => {
            // The backdrop itself, never a press that bubbled out of the card.
            if (event.currentTarget === event.target) { panelSound(); setShowStore(false); }
          }}
        >
          <div className="sa-store-card">
            {/* One line: a small Ray portrait, the store's own brand (not his
                name -- see stackacres-ray-welcome.tsx for where his own voice
                still lives), and a close key. Used to be a two-line header
                plus a whole status card (the daily Gold ceiling and Land
                Maintenance) sitting above the tabs -- StackAcres dropped that
                ceiling entirely (lib/stackacres/exchange.ts), and Land
                Maintenance already has its own HUD pill (`.sa-upkeep` above)
                whenever it is actually owed, so neither needed a second home
                here. */}
            <header className="sa-store-head">
              <img src="/stackacres/sprites/grandfather-ray-portrait.webp" alt="" className="sa-store-mark" />
              <h2>StackAcres Supply Co.</h2>
              <button
                type="button"
                className="sa-store-close"
                aria-label="Close"
                onPointerDown={addStoreSplash("close")}
                onClick={() => { panelSound(); setShowStore(false); }}
              >
                <X size={16} aria-hidden="true" />
                {storeSplashes
                  .filter((splash) => splash.key === "close")
                  .map((splash) => (
                    <span
                      key={splash.id}
                      className="sa-splash"
                      style={{ left: splash.x, top: splash.y }}
                      aria-hidden="true"
                    />
                  ))}
              </button>
            </header>

            {/* Why some prices in here are struck through. The same rung is
                named in the Town Contracts sheet, where it is EARNED -- this
                is where it gets SPENT, and a discount the player cannot see
                the reason for reads as a pricing glitch rather than as
                something they were paid. Progress to the next rung rides
                along because the shop is where wanting it happens. */}
            {(() => {
              const tier = influenceTier(influence);
              const next = nextInfluenceTier(influence);
              return (
                <p className="sa-store-favor">
                  <Sparkles size={14} aria-hidden="true" />
                  <strong>{tier.label}</strong>
                  <span>
                    {/* Named shelves, not "everything" -- the discount reaches
                        tools, cutters and feed only. See the rung-up banner in
                        TownContractsModal.tsx for the same wording and why. */}
                    {tier.discountBps > 0
                      ? `${tier.discountBps / 100}% off tools, cutters and feed`
                      : "no discount yet"}
                    {next &&
                      ` — ${(next.threshold - influence).toLocaleString()} Influence to ${next.label}`}
                  </span>
                </p>
              );
            })()}

            <div className="sa-store-tabs" role="tablist" aria-label="Store shelf">
              {STORE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={storeTab === tab.id}
                  className={clsx("sa-store-tab", storeTab === tab.id && "sa-store-tab-active")}
                  onPointerDown={addStoreSplash(tab.id)}
                  onClick={() => { panelSound(); setStoreTab(tab.id); }}
                >
                  <StackAcresIcon name={tab.icon} size={18} />
                  <span>{tab.label}</span>
                  {storeSplashes
                    .filter((splash) => splash.key === tab.id)
                    .map((splash) => (
                      <span
                        key={splash.id}
                        className="sa-splash"
                        style={{ left: splash.x, top: splash.y }}
                        aria-hidden="true"
                      />
                    ))}
                </button>
              ))}
            </div>

            <div className="sa-store-panel" role="tabpanel">
              {storeTab === "seeds" && (
                <>
                  <p className="sa-sheet-note">
                    Buy seeds here, then tap bare ground in the Crop Fields to plant them.
                  </p>
                  <div className="sa-stock-cards">
                    {shopSeeds.map((crop) => {
                      const def = STACKACRES_CATALOGUE[crop];
                      const held = seedStock[crop] ?? 0;
                      const pending = isPending(`buy-seed:${crop}`);
                      const wantedFor = wantedForLine(STACKACRES_YIELDS[crop].item);
                      const lockLine = seedLockLine(crop, builtKinds);
                      return (
                        <div key={crop} className={lockLine ? "sa-stock-card is-locked" : "sa-stock-card"}>
                          <h3>{def.label}</h3>
                          <p className="sa-stock-yield">
                            <StoreCost amount={def.seedCost} /> / seed
                          </p>
                          {wantedFor && <p className="sa-stock-wanted">{wantedFor}</p>}
                          {lockLine ? (
                            <p className="sa-lock-hint">
                              <Lock size={13} aria-hidden="true" />
                              <span>{lockLine}</span>
                            </p>
                          ) : (
                            <BuyQuantityControls
                              unitPrice={def.seedCost}
                              maxQuantity={STACKACRES_SEED_BAGS_PER_PURCHASE}
                              gold={gold}
                              pending={pending}
                              onBuy={(quantity) => {
                                buySound();
                                void act({ action: "buy-seed", crop, quantity });
                              }}
                            />
                          )}
                          {held > 0 || !lockLine ? <p className="sa-sheet-note">{held} in the barn</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {storeTab === "livestock" && (
                <>
                  <p className="sa-sheet-note">
                    Buy an animal outright, or Cycle Lease one for a single production run. A greyed
                    pen opens once you clear its land.
                  </p>
                  <div className="sa-panel-section">
                    <StackAcresBuySection
                      options={livestockBuyOptions}
                      isPending={isPending}
                      onSeed={onSeed}
                      onBuyOutright={onBuyOutright}
                      onExpand={onExpand}
                    />
                  </div>
                  {lockedPens.length > 0 && (
                    <div className="sa-stock-cards">
                      {lockedPens.map((pen) => (
                        <div key={pen.stock} className="sa-stock-card is-locked sa-locked-pen">
                          <h3>
                            <StackAcresIcon name={STOCK_ICON[pen.stock]} size={20} />
                            {pen.label}
                          </h3>
                          <p className="sa-lock-hint">
                            <Lock size={13} aria-hidden="true" />
                            <span>Clear {pen.sectorLabel} to keep these</span>
                          </p>
                          <button
                            type="button"
                            className="sa-cta"
                            onClick={() => { panelSound(); setClearing(pen.sector); }}
                          >
                            Unlock {pen.sectorLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {storeTab === "feed" && (
                <>
                  <p className="sa-sheet-note">
                    A hungry pen stops working until you feed it. Keep a shipment in the barn.
                  </p>
                  <div className="sa-stock-cards">
                    {/* Locked rows are shown greyed rather than dropped. A shelf
                        that silently shortens teaches nothing: the Bulk
                        Shipment going missing looks like a bug, whereas the
                        Bulk Shipment sitting there saying what it wants is the
                        progression being legible. (The wild-ground rule in
                        sectors.ts is the opposite and stays so -- that is
                        about the WORLD, where a padlock floating over a field
                        would be nonsense; this is a shop.) */}
                    {Object.entries(STACKACRES_FEED).map(([id, item]) => {
                      const lock = evaluateStackAcresShopLock(item, shopProgress);
                      // Town Favor discount -- same read as the tool tier card
                      // below, and the same price upgradeStackAcresTool's
                      // sibling buyStackAcresFeed will actually charge.
                      const price = applyInfluenceDiscount(item.cost, influence);
                      const pending = isPending(`buy-feed:${id}`);
                      return (
                        <div
                          key={id}
                          className={lock.isUnlocked ? "sa-stock-card" : "sa-stock-card is-locked"}
                        >
                          <h3>{item.label}</h3>
                          <p className="sa-stock-terms">{item.servings} servings</p>
                          <p className="sa-stock-yield">
                            {price < item.cost && (
                              <span className="sa-stock-was">{item.cost.toLocaleString()}</span>
                            )}{" "}
                            <StoreCost amount={price} />{" "}
                            <span>({Math.round(price / item.servings)} each)</span>
                          </p>
                          {lock.lockHint && (
                            <p className="sa-lock-hint" id={`sa-lock-hint-${id}`}>
                              <Lock size={13} aria-hidden="true" />
                              <span>{lock.lockHint}</span>
                            </p>
                          )}
                          {lock.isUnlocked ? (
                            <BuyQuantityControls
                              unitPrice={price}
                              maxQuantity={STACKACRES_FEED_SHIPMENTS_PER_PURCHASE}
                              gold={gold}
                              pending={pending}
                              onBuy={(quantity) => {
                                buySound();
                                void act({ action: "buy-feed", itemId: id, quantity });
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="sa-cta"
                              disabled
                              aria-describedby={lock.lockHint ? `sa-lock-hint-${id}` : undefined}
                            >
                              Locked
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="sa-sheet-note">
                    You have <strong>{feed}</strong> {feed === 1 ? "serving" : "servings"} in the
                    barn.
                  </p>
                </>
              )}

              {storeTab === "equipment" && (
                <>
                  <StoreShelf icon="toolGoldenSpade">Spade</StoreShelf>
                  <div className="sa-tool-rack">
                    <img
                      src={stackacresToolTierDef(toolTier).sprite}
                      alt=""
                      className="sa-tool-art"
                      width={96}
                      height={96}
                    />
                    <div className="sa-tool-copy">
                      <h3>{stackacresToolTierDef(toolTier).label}</h3>
                      <p className="sa-stock-terms">{stackacresToolTierDef(toolTier).blurb}</p>
                    </div>
                  </div>
                  {(() => {
                    // The ladder is walked one rung at a time and the SERVER
                    // decides from what -- this only renders the next rung's
                    // price, so there is no list of rungs here to get out of
                    // step with the server's own idea of which one is next.
                    const next = nextToolTier(toolTier);
                    const listPrice = toolUpgradePrice(toolTier);
                    if (!next || listPrice === null) {
                      return (
                        <p className="sa-sheet-note">
                          You hold the finest tool on the farm. Nothing left to buy here.
                        </p>
                      );
                    }
                    // Town Favor discount, read off the same Influence total
                    // the server will charge against -- see
                    // influence-tiers.ts and upgradeStackAcresTool's identical
                    // read server-side.
                    const price = applyInfluenceDiscount(listPrice, influence);
                    const def = stackacresToolTierDef(next);
                    // `unlimitedGold` makes spendGold a no-op server-side, so
                    // a profile carrying it can always afford this --
                    // disabling the button on their balance would be the
                    // client refusing a purchase the server would have
                    // allowed.
                    const affordable =
                      (profile?.unlimitedGold ?? false) || (profile?.goldBalance ?? 0) >= price;
                    // Unlimited Gold is a purse exemption, not a progression
                    // one: the milestone gate is about what the farm has
                    // done, so it applies to every account the same way.
                    const lock = evaluateStackAcresShopLock(def, shopProgress);
                    return (
                      <div className="sa-stock-cards">
                        <div className={lock.isUnlocked ? "sa-stock-card" : "sa-stock-card is-locked"}>
                          <img src={def.sprite} alt="" className="sa-tool-art" width={72} height={72} />
                          <h3>{def.label}</h3>
                          <p className="sa-stock-terms">{def.blurb}</p>
                          {/* The price stays visible while locked,
                              deliberately -- the sector modal shows its
                              clearing cost to somebody who does not qualify
                              yet for the same reason: you cannot decide to
                              save up for a number you have never been
                              shown. */}
                          <p className="sa-stock-yield">
                            {price < listPrice && (
                              <span className="sa-stock-was">{listPrice.toLocaleString()}</span>
                            )}{" "}
                            <StoreCost amount={price} />
                          </p>
                          {lock.lockHint && (
                            <p className="sa-lock-hint" id="sa-lock-hint-tool">
                              <Lock size={13} aria-hidden="true" />
                              <span>{lock.lockHint}</span>
                            </p>
                          )}
                          <button
                            type="button"
                            className="sa-cta"
                            disabled={!lock.isUnlocked || isPending("upgrade-tool") || !affordable}
                            aria-describedby={lock.lockHint ? "sa-lock-hint-tool" : undefined}
                            onClick={() => { buySound(); void act({ action: "upgrade-tool" }); }}
                          >
                            {!lock.isUnlocked ? "Locked" : affordable ? "Buy" : "Not enough Gold"}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                  <p className="sa-sheet-note">
                    A better spade makes a harvest more likely to come up rich, and a rich harvest
                    brings in extra produce on top.
                  </p>

                  {/* Grass cutters, kept apart from the spades so a spade
                      never mows the meadow. An owned one gets a Use button,
                      the same swap the picker beside the Mow key offers. */}
                  {visibleCutters.length > 0 && (
                  <>
                  <StoreShelf icon="ico-scythe">Cut the Grass</StoreShelf>
                  <div className="sa-stock-cards">
                    {visibleCutters.map((id) => {
                      const def = stackacresCutterDef(id);
                      const owned = cutters.includes(id);
                      const lock = evaluateStackAcresShopLock(def, shopProgress);
                      const listPrice = def.price ?? 0;
                      const price = applyInfluenceDiscount(listPrice, influence);
                      const affordable =
                        (profile?.unlimitedGold ?? false) || (profile?.goldBalance ?? 0) >= price;
                      const hintId = `sa-lock-hint-${id}`;
                      return (
                        <div
                          key={id}
                          className={owned || lock.isUnlocked ? "sa-stock-card" : "sa-stock-card is-locked"}
                        >
                          <StackAcresIcon name={def.icon as PainterName} size={72} className="sa-tool-art" />
                          <h3>{def.label}</h3>
                          <p className="sa-stock-terms">{def.blurb}</p>
                          {owned ? (
                            <button
                              type="button"
                              className="sa-cta"
                              disabled={cutter === id}
                              onClick={() => pickCutter(id)}
                            >
                              {cutter === id ? "In hand" : "Use"}
                            </button>
                          ) : (
                            <>
                              <p className="sa-stock-yield">
                                {price < listPrice && (
                                  <span className="sa-stock-was">{listPrice.toLocaleString()}</span>
                                )}{" "}
                                <StoreCost amount={price} />
                              </p>
                              {lock.lockHint && (
                                <p className="sa-lock-hint" id={hintId}>
                                  <Lock size={13} aria-hidden="true" />
                                  <span>{lock.lockHint}</span>
                                </p>
                              )}
                              <button
                                type="button"
                                className="sa-cta"
                                disabled={!lock.isUnlocked || isPending("buy-cutter") || !affordable}
                                aria-describedby={lock.lockHint ? hintId : undefined}
                                onClick={() => {
                                  if (!isStackAcresBuyableCutter(id)) return;
                                  buySound();
                                  void act({ action: "buy-cutter", cutter: id });
                                }}
                              >
                                {!lock.isUnlocked ? "Locked" : affordable ? "Buy" : "Not enough Gold"}
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </>
                  )}
                </>
              )}

              {storeTab === "sell" && (
                <>
                  <p className="sa-sheet-note">
                    Turn anything in the barn straight into Gold, any time, at its own shelf
                    price below -- the same door a harvest already fills.
                  </p>
                  <div className="sa-stock-cards">
                    {STACKACRES_ITEMS.map((item) => {
                      const def = STACKACRES_ITEM_CATALOGUE[item];
                      const held = inventoryQuantity(processing.inventory, item);
                      const price = itemSellPrice(item);
                      return (
                        <div key={item} className="sa-stock-card">
                          <h3>{def.label}</h3>
                          <p className="sa-stock-yield">
                            <StoreCost amount={price} /> / each
                          </p>
                          <div className="sa-buy-qty-row">
                            <button
                              type="button"
                              className="sa-cta"
                              disabled={held < 1 || isPending(`sell:${item}:1`)}
                              onClick={() => void onSell(item, 1)}
                            >
                              Sell 1
                            </button>
                            <button
                              type="button"
                              className="sa-cta"
                              disabled={held < 1 || isPending(`sell:${item}:${held}`)}
                              onClick={() => void onSell(item, held)}
                            >
                              Sell all ({held})
                            </button>
                          </div>
                          <p className="sa-sheet-note">{itemLabel(item, held)} in the barn</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showHouse && (
        <StackAcresHouse
          onClose={() => { panelSound(); setShowHouse(false); }}
          energy={energyAt(energy, new Date(nowMs))}
          inventory={processing.inventory}
          nowMs={nowMs}
          built={kitchenBuilt}
          goldBalance={profile ? (profile.unlimitedGold ? Infinity : profile.goldBalance) : null}
          busy={isPending}
          orderBusy={pendingByPrefix("set-kitchen-order")}
          onBuild={onPlaceMachine}
          onMake={onProcessRecipe}
          cellar={cellar}
          onStoreJars={onStoreJars}
          onOpenCellar={onOpenCellar}
          farmKitchen={farmKitchenRow}
          onSetKitchenOrder={onSetKitchenOrder}
          onRunFarmKitchen={onRunFarmKitchen}
          onEat={onEat}
        />
      )}

      {showGoals && (
        <StackAcresJournalSheet view={journal} onClose={() => { panelSound(); setShowGoals(false); }} />
      )}

      {chapterCard && (
        <StackAcresChapterCard chapter={chapterCard} built={builtKinds} next={chapterNow} onClose={() => setChapterCard(null)} />
      )}

      {showMap && (
        <StackAcresMapSheet
          places={mapPlaces}
          onTravel={travelToPlace}
          onClose={() => { mapSound(); setShowMap(false); }}
        />
      )}

      {clearing && (
        <StackAcresSectorModal
          sector={clearing}
          unlocked={sectors}
          unitCount={units.length}
          upkeepOutstanding={upkeep.due}
          opener={clearingOpener}
          progress={clearingProgress}
          onClose={() => { panelSound(); setClearing(null); }}
        />
      )}

      {showWelcome && <StackAcresRayWelcome onClose={dismissWelcome} />}
      {showGreenhouse && (
        <StackAcresGreenhousePanel
          built={greenhouseBuilt}
          inventory={processing.inventory}
          units={liveUnits}
          busy={isPending("build-greenhouse") || pendingByPrefix("stock")}
          onBuild={onBuildGreenhouse}
          onSow={onSowGreenhouse}
          onCollect={onCollectGreenhouse}
          onClose={closeGreenhouse}
        />
      )}
      {showContracts && (
        <TownContractsModal
          inventory={processing.inventory}
          contract={processing.contract}
          influence={influence}
          busy={isPending("fulfill-contract") || isPending("request-contract") || isPending("pass-contract")}
          onSettle={onSettleContract}
          onRequest={onRequestContract}
          onPass={onPassContract}
          onClose={() => { panelSound(); setShowContracts(false); }}
        />
      )}
      {/* The vat's sheet replaces the Workshop while it is up rather than
          stacking a second scrim over it, so one Escape closes one sheet;
          closing the vat lands back in the Workshop. */}
      {showWorkshop && !showVat && (
        <WorkshopModal
          inventory={processing.inventory}
          machines={processing.machines}
          vat={vat}
          goldBalance={profile?.goldBalance ?? 0}
          unlimitedGold={profile?.unlimitedGold ?? false}
          isPending={isPending}
          onPlaceMachine={onPlaceMachine}
          onProcess={onProcessRecipe}
          onWork={onWork}
          onSell={onSell}
          onOpenVat={() => { panelSound(); setShowVat(true); }}
          axe={axe}
          onUpgradeAxe={onUpgradeAxe}
          onClose={() => { panelSound(); setShowWorkshop(false); }}
        />
      )}
      {showWorkshop && showVat && (
        <FermentingVatModal
          vat={vat}
          cheeseHeld={processing.inventory.cheese ?? 0}
          busy={isPending("seal-vat") || isPending("collect-vat")}
          onSeal={onSealVat}
          onCollect={onCollectVat}
          onClose={() => { panelSound(); setShowVat(false); }}
        />
      )}

      {showBlueprints && (
        <MythicBlueprintDashboard
          blueprints={Object.values(blueprints)}
          inventory={processing.inventory}
          busy={pendingByPrefix("start-blueprint") || pendingByPrefix("contribute-blueprint")}
          onStart={onStartBlueprint}
          onContribute={onContributeBlueprint}
          onClose={() => { panelSound(); setShowBlueprints(false); }}
        />
      )}

      {showPrestige && (
        <StackAcresPrestigeResetModal
          prestige={prestige}
          busy={isPending("prestige-reset")}
          onReset={onPrestigeReset}
          onClose={() => { panelSound(); setShowPrestige(false); }}
        />
      )}

      {showSynergy && (
        <SynergyOverlay
          unlocked={synergyUnlocked}
          active={synergyActive}
          busy={pendingByPrefix("unlock-synergy-perk") || pendingByPrefix("activate-synergy-perk")}
          onUnlock={onUnlockSynergyPerk}
          onActivate={onActivateSynergyPerk}
          onClose={() => { panelSound(); setShowSynergy(false); }}
        />
      )}

      {showForge && (
        <SunlightForgeTable
          toolTier={toolTier}
          inventory={processing.inventory}
          goldBalance={profile?.goldBalance ?? 0}
          ownedEnchantmentIds={forge}
          busy={isPending("forge-enchantment")}
          onForge={onForgeEnchantment}
          onClose={() => { panelSound(); setShowForge(false); }}
        />
      )}

      {showCrossbreed && (
        <CrossbreedBedSheet
          bed={crossbreed}
          seedStock={seedStock}
          goldBalance={profile?.goldBalance ?? 0}
          unlimitedGold={profile?.unlimitedGold ?? false}
          cropFieldsUnlocked={cropFieldsUnlocked}
          busy={pendingByPrefix("plant-crossbreed") || pendingByPrefix("harvest-crossbreed")}
          onPlant={onPlantCrossbreed}
          onHarvest={onHarvestCrossbreed}
          onClose={() => { panelSound(); setShowCrossbreed(false); }}
        />
      )}

      {/* Refusals pop up mid-screen, over any open sheet, and fade on their own.
          The server only ever sends text written for the player
          (lib/server/public-error.ts). */}
      {error && (
        <p className="sa-notice" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
