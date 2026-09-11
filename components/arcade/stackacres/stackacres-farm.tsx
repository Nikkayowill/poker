"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  ChevronLeft,
  Coins,
  Dna,
  HelpCircle,
  Lock,
  RotateCcw,
  Wand2,
  X,
} from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { useMinHoldFade } from "@/components/loading/use-min-hold-fade";
import { useLandscape } from "@/components/use-landscape";
import { useTightLandscape } from "@/components/use-tight-landscape";
import { useAppShell } from "@/components/shell/app-shell";
import {
  setAmbienceAwake,
  setAmbienceHerd,
  setAmbiencePlace,
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
  goldSound,
  muckSound,
  panelSound,
  refusedSound,
  retireSound,
  sellSound,
  sowSound,
  toolSound,
  travelSound,
  waterSound,
} from "@/lib/audio/stackacres-sfx";
import {
  isStackAcresCrop,
  STACKACRES_CATALOGUE,
  STACKACRES_CROPS,
  STACKACRES_FEED,
  STACKACRES_FEED_SHIPMENTS_PER_PURCHASE,
  STACKACRES_SEED_BAGS_PER_PURCHASE,
  type SeedStock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import { DRONE_DEPLOY_COST_GOLD } from "@/lib/stackacres/drone";
import { buyOptionsForZone, type BuyOption } from "@/lib/stackacres/district-panel";
import {
  exchangeState,
  msUntilNextExchangeDay,
  type StackAcresExchangeState,
} from "@/lib/stackacres/exchange";
import {
  STACKACRES_YIELDS,
  itemLabel,
  itemSellPrice,
  type StackAcresItem,
} from "@/lib/stackacres/items";
import { emptyMuseumRegistry, type MuseumRegistry } from "@/lib/stackacres/museum";
import {
  SECRET_ARTIFACTS,
  SECRET_MUSEUM_ITEM_CATALOGUE,
  emptySecretMuseumRegistry,
  museumGlowTier as museumGlowTierFor,
  secretHiddenSetComplete,
  secretsFoundCount,
  type SecretMuseumItemId,
  type SecretMuseumRegistry,
} from "@/lib/stackacres/museum-secrets";
import {
  SECRET_ITEM_CATALOGUE,
  SECRET_ITEM_IDS,
  type HiddenZoneId,
  type SecretItemId,
} from "@/lib/stackacres/secrets";
import {
  HOME_SECTOR,
  STACKACRES_SECTORS,
  isSectorUnlocked,
  type SectorId,
} from "@/lib/stackacres/sectors";
import { upkeepState, type StackAcresUpkeepState } from "@/lib/stackacres/upkeep";
import { collectFloat, tapActionFor } from "@/lib/stackacres/tap-action";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import { findCascadeTargets } from "@/lib/stackacres/harvest-cascade";
import {
  HUD_VIEW_EXPANSION,
  CROP_FIELD_BEDS,
  penFeedSpot,
  stockZone,
  type WorldPoint,
} from "@/lib/stackacres/world";
import {
  createSoilMap,
  soilSlotOnTile,
  soilSlotTile,
  soilTileAt,
  soilTilesEqual,
  thirstyTileGroup,
  type SoilTile,
} from "@/lib/stackacres/soil";
import {
  SOIL_BAGS_PER_PURCHASE,
  SOIL_DEFAULT_TIER,
  SOIL_TIERS,
  soilTierDef,
  type SoilStock,
  type SoilTier,
} from "@/lib/stackacres/soil-tiers";

import type { StackAcresContractRow } from "@/lib/stackacres/contracts";
import { emptyInventory, type StackAcresInventory } from "@/lib/stackacres/inventory";
import type { MachineKind, StackAcresMachineSnapshot } from "@/lib/stackacres/machines";
import type { StackAcresWheatPlotSnapshot } from "@/lib/stackacres/wheat-plot";
import type { VatContainer } from "@/lib/stackacres/aging";
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
import { machineItemLabel, type MachineItemId, type MachineProcessedItem } from "@/lib/stackacres/machine-items";
import type { FishSpecies } from "@/lib/stackacres/fishing";
import { SYNERGY_PERKS, type SynergyArchetype } from "@/lib/stackacres/synergy-perks";
import {
  STACKACRES_PRESTIGE_BASE_MULTIPLIER,
  STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS,
  type StackAcresPrestigeResetResult,
  type StackAcresPrestigeView,
} from "@/lib/stackacres/prestige";
import { FORGE_ENCHANTMENTS } from "@/lib/stackacres/forge";
import {
  PIPE_NEIGHBORS,
  PIPE_PLACE_COST,
  pipeTileAt,
  type PipeFacing,
  type PipeKind,
  type PipeNode,
} from "@/lib/stackacres/irrigation";
import { PEN_ZONE_IDS, STACKACRES_ZONES, type ZoneId } from "@/lib/stackacres/zones";
import type { PlayerProfile } from "@/lib/profile/types";
import type { PainterName } from "./stackacres-art";
import { StackAcresBuySection, StackAcresUnitRows } from "./stackacres-district-panel";
import { StackAcresIcon } from "./stackacres-icon";
import { StackAcresMuseum } from "./stackacres-museum";
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
import { SynergyOverlay } from "./SynergyOverlay";
import {
  MidnightMerchantStorefront,
  type MidnightMerchantPurchaseResult,
} from "./midnight-merchant-storefront";
import {
  MidnightMerchantManager,
  type MidnightMerchantItemId,
  type MidnightMerchantRenderSnapshot,
  type MidnightMerchantSnapshot,
} from "@/lib/stackacres/midnight-merchant";
import { StackAcresHudOverflow } from "./stackacres-hud-overflow";
import { StackAcresMusicToggle } from "./stackacres-music-toggle";
import { StackAcresPlayScreen } from "./stackacres-play-screen";
import { StackAcresRadialMenu, STOCK_ICON } from "./stackacres-radial-menu";
import { StackAcresGelDock, type StackAcresGelDockItem } from "./stackacres-gel-dock";
import { StackAcresPipeAim } from "./stackacres-pipe-aim";
import { StackAcresMonkDialogue } from "./stackacres-monk-dialogue";
import { StackAcresFenceUpgradePopup } from "./stackacres-fence-upgrade-popup";
import type { FenceTier } from "@/lib/stackacres/wildlife";
import { StackAcresFriendshipDialogue } from "./stackacres-friendship-dialogue";
import { StackAcresSectorModal } from "./stackacres-sector-modal";
import { StackAcresCropFieldsModal } from "./stackacres-crop-fields-modal";
import { StackAcresRayWelcome } from "./stackacres-ray-welcome";
import { StackAcresVisitorGreeting } from "./stackacres-visitor-greeting";
import { visitorForKind, type VisitorId } from "@/lib/stackacres/visitors";
import type { PropKind } from "@/lib/stackacres/props";
import { StackAcresGroundTools } from "./stackacres-ground-tools";
import { StackAcresDragAffordance } from "./stackacres-drag-affordance";
import { dragIconSpot } from "@/lib/stackacres/drag-affordance";
import { WATER_CAPACITY } from "@/lib/stackacres/water-can";
import { FISHING_SPOT } from "@/lib/stackacres/water";
import { StackAcresFishingAffordance } from "./stackacres-fishing-affordance";
import { useStackAcresMusic } from "./use-stackacres-music";
import { StackAcresWorld, type StackAcresWorldApi } from "./stackacres-world";
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
import {
  evaluateStackAcresShopLock,
  type StackAcresShopProgress,
} from "@/lib/stackacres/shop-locks";
import { applyInfluenceDiscount } from "@/lib/stackacres/influence-tiers";
import type { TapPoint } from "./stackacres-scene";
import { type Action, intentOf, newIntentKey, purchaseCueText } from "@/lib/stackacres/farm-actions";
import {
  predictStackAcresAction,
  type FarmPredictContext,
  type MachineView,
} from "@/lib/stackacres/optimistic-actions";

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
 * given tap is, off the same `unitRowAction` the sidebar rows use, so the
 * two surfaces can never disagree about what a unit affords.
 *
 * The sidebar (./stackacres-district-panel.tsx) is for the deep end now:
 * capacity bought with Gold, stock bought outright, and the district's own
 * standing list. It no longer opens on its own -- travelling flies the
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

/**
 * The preset sizes offered on Ray's shelf for soil, seed, and feed. A single
 * "Buy" button meant a player restocking ten bags fired ten separate presses,
 * and every press after the first one in flight was dropped silently by the
 * in-flight guard in `act` below -- Ray looked like he'd shorted the order.
 * These three buttons ask for the whole stack in one request instead, so a
 * player who wants ten bags gets ten bags from one tap. Filtered per shelf
 * against that shelf's own per-request ceiling (SOIL_BAGS_PER_PURCHASE and
 * siblings), so it never offers a size the server would refuse outright.
 */
const BULK_BUY_QUANTITIES: readonly number[] = [1, 10, 20];

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

/** Grandfather Ray's own opening lines, in the same drawl the welcome
 *  modal and the Museum's own intro already use. One is picked at random
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

/** A drag tool on offer: what a good drop does, where the tool floats and
 *  where it has to land. `key` remounts the overlay for each new offer. */
type DragOffer =
  // unitIds is set only when the tapped crop sits in a >=2x2 block of
  // thirsty crops (soil.ts's `thirstyTileGroup`) -- the drop then waters the
  // whole block in one request instead of just `unitId`.
  | {
      key: string;
      kind: "water";
      unitId: string;
      unitIds?: string[];
      iconAt: TapPoint;
      targetAt: TapPoint;
    }
  | { key: string; kind: "feed-pen"; zone: ZoneId; iconAt: TapPoint; targetAt: TapPoint }
  | { key: string; kind: "feed-unit"; unitId: string; iconAt: TapPoint; targetAt: TapPoint };

/** The fishing rod floating at the dock, mid-cast. Its own state, not a
 *  `DragOffer`: a cast is a two-stage gesture (drag in, wait for a bite,
 *  drag back out), not the single drop the water can/feed scoop settle on --
 *  see stackacres-fishing-affordance.tsx. */
interface FishingOffer {
  key: string;
  iconAt: TapPoint;
  targetAt: TapPoint;
}

interface StackAcresResponse {
  units: StackAcresUnitSnapshot[];
  /** Null for a cookie-less first visit: the read route never mints a session. */
  profile: PlayerProfile | null;
  feed: number;
  /** Water in the can. Absent from a response older than the can. */
  water?: number;
  capacity: Partial<Record<StackAcresStock, number>>;
  exchange: StackAcresExchangeState;
  museum: MuseumRegistry;
  /** Ray's Museum, secret wing: which hidden finds this player has ever
   *  turned up (lib/stackacres/museum-secrets.ts). Absent from a response
   *  old enough to predate the wing, which `emptySecretMuseumRegistry`
   *  covers the same way `toStackAcresToolTier` covers a missing `tool`. */
  museumSecrets?: SecretMuseumRegistry;
  /** Land the player may work. Everything else is drawn as wild growth. */
  sectors: SectorId[];
  upkeep: StackAcresUpkeepState;
  /** The equipment rung held. Absent only from a response old enough to
   *  predate the ladder, which `toStackAcresToolTier` reads as the Trowel. */
  tool?: StackAcresToolTier;
  /** Grass cutters owned, Scythe first. Absent from a response older than
   *  cutters, which leaves the Scythe alone in hand. */
  cutters?: StackAcresCutter[];
  boughtCutter?: StackAcresBuyableCutter;
  collected?: { stock: StackAcresStock; item: StackAcresItem; quantity: number; mucked: boolean };
  harvest?: {
    units: number;
    /** Produce actually credited to inventory -- base yield plus any crit
     *  bonus plus any Ray's Museum discovery bonus. Pays no Gold at all;
     *  see lib/server/stackacres-service.ts's own header. */
    tally: { item: StackAcresItem; quantity: number }[];
    /** Every settled unit's yield at today's sell price, before any bonus --
     *  a production figure, not Gold paid (a harvest pays none). */
    gross: number;
    mucked: number;
    /** Whether this sweep rolled a critical harvest. */
    crit: boolean;
    /** Bonus units a crit added, summed per item. Empty when the roll missed. */
    critBonus: { item: StackAcresItem; quantity: number }[];
    /** Items donated to Ray's Museum for the very first time in this sweep,
     *  and the bonus UNITS each discovery added -- already folded into
     *  `tally` above. */
    discoveries: { item: StackAcresItem; bonusQuantity: number }[];
    /** Ray's Museum, secret wing: what this sweep's one roll turned up, or
     *  null on the overwhelming majority of harvests. Pays no Gold and no
     *  inventory. */
    secretFind: SecretMuseumItemId | null;
    /** True only on the harvest whose find just completed the core hidden
     *  set for the first time ever. */
    secretSetJustCompleted: boolean;
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
  /** What one Workshop call just did, each set only by its own action's
   *  answer: `work` by the idle-worker pass, `processed` by `process`,
   *  `sold` by `sell`, `vatCollected` by `collect-vat`. The view itself
   *  already carries the resulting state; these are the sheet's own
   *  "here is what that press did" line. */
  work?: { wheatCollected: number; machinesStarted: number; machinesCollected: number };
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
  /** The Midnight Merchant's current visit, straight through from the
   *  server every response carries it on. `null` (not merely absent) means
   *  "confirmed no visit right now" -- see `MidnightMerchantManager.
   *  applySnapshot`'s own header for why that distinction from a plain
   *  missing field matters. Absent only from a response old enough to
   *  predate the feature. */
  midnightMerchant?: MidnightMerchantSnapshot | null;
  /** Set only by a successful `midnight-merchant-buy` response; every other
   *  action's response leaves this undefined. */
  midnightMerchantPurchase?: {
    itemId: string;
    pricePaid: number;
    purchaseStreak: number;
    remaining: number;
  };
  /** Purchased soil beds (lib/stackacres/soil.ts). Absent only from a
   *  response old enough to predate the feature, which `applyResponse` reads
   *  as "no purchased tiles yet" -- starter tiles are never carried here, see
   *  `StackAcresView.soilTiles`'s own doc comment. */
  soilTiles?: SoilTile[];
  /** Unplaced bags per tier. Absent on a response predating Ray's soil shelf,
   *  which reads as an empty barn. */
  soilStock?: SoilStock;
  /** Unplanted crop seeds per crop id. Absent on a response predating Ray's
   *  seed shelf, which reads as an empty shelf. */
  seedStock?: SeedStock;
  error?: string;
  round?: StackAcresUnitSnapshot[];
  /** Why a refusal is ordinary play rather than a fault. `day-capped` is the
   *  farm having hit its flat daily Gold ceiling -- see the ceiling throw in
   *  `harvestStackAcres`. Absent on a plain refusal and on every success. */
  reason?: "day-capped";
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
  /** The Mechanical Forage Drone hangar: whether it is unlocked (derived
   *  from Ray's Museum donations) and every drone this profile owns.
   *  Absent only from a response old enough to predate the feature, which
   *  `applyResponse` reads as "no drones yet, hangar unconfirmed" -- the
   *  same "old response, nothing changes" posture every other optional
   *  field here takes. */
  droneHangar?: { unlocked: boolean; drones: { droneId: string; deployedAt: string }[] };
  /** Set only by a successful `deploy-drone` response; every other action's
   *  answer leaves this undefined. `droneHangar` above already carries the
   *  resulting ownership list -- this is only which one was just bought. */
  droneDeploy?: { droneId: string };
  /** Set only by a successful `collect-drone-forage` response; every other
   *  action's answer leaves this undefined. */
  droneForage?: { droneId: string; reward: number };
  /** The Prestige Reset Valve's own standing: how many times pulled, the
   *  live multiplier, and gross production still needed before the next
   *  pull. Always present on a current server, same as `upkeep`/`exchange`
   *  above -- optional only so a bundle old enough to predate the feature
   *  keeps working. See lib/stackacres/prestige.ts. */
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
  /** The irrigation pipe network, straight off `StackAcresView.irrigation`.
   *  Always present on a current server, same as `prestige`/`forge` above --
   *  optional only so a bundle old enough to predate the feature keeps
   *  working, which `applyResponse` reads as "no pipes yet". See
   *  lib/stackacres/irrigation.ts. */
  irrigation?: readonly PipeNode[];
  /** Ray's Mythic Blueprints: one entry per structure in the catalogue,
   *  present whether or not the player has started it, shaped identically to
   *  `BlueprintCardView` (mythic-blueprint-dashboard.tsx's own client-local
   *  type -- see that file's header for why this reads it structurally
   *  rather than importing the server's `BlueprintView`). Always present on
   *  a current server, optional only so a bundle old enough to predate the
   *  feature keeps working. */
  blueprints?: Record<BlueprintId, BlueprintCardView>;
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
 *
 * The district drawer's own headings ("What's here", "Buy") deliberately do
 * NOT take one: there are two of them, they are the whole content of a narrow
 * panel, and a badge on each is decoration on something nobody was lost in.
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

function countdownLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Re-derives readiness, hunger and dry soil locally so a unit flips without a
 * network trip. Both freeze conditions are checked before readiness and both
 * stop the progress bar where it stood, mirroring lib/stackacres/units.ts
 * exactly -- if these two ever disagree the server wins, because it is the
 * only one that can pay.
 */
function withLocalClock(units: StackAcresUnitSnapshot[], nowMs: number): StackAcresUnitSnapshot[] {
  return units.map((unit) => {
    if (unit.state === "mucked") return unit;
    const ready = Date.parse(unit.readyAt);
    const started = Date.parse(unit.startedAt);
    const progressAt = (atMs: number) =>
      ready > started ? Math.min(1, Math.max(0, (atMs - started) / (ready - started))) : 1;

    const hungry = unit.hungryAt !== null && Date.parse(unit.hungryAt) <= nowMs;
    if (hungry) return { ...unit, state: "hungry" };
    const driedAt = unit.thirstyAt === null ? null : Date.parse(unit.thirstyAt);
    // `ready > driedAt` mirrors isStackAcresUnitDry's own carve-out: a crop
    // that finished growing before the ground dried is not dry, it is just
    // waiting to be picked. Dropping this here would flip a ripe row to dry
    // between refetches even though the server would still collect it.
    const dry = driedAt !== null && Number.isFinite(driedAt) && driedAt <= nowMs && ready > driedAt;
    // `ready > driedAt` is already false for an unparseable readyAt, so this
    // branch always has real timestamps to read the frozen bar at: the moment
    // the soil went dry rather than now, so a frozen crop's bar stops where it
    // stopped instead of creeping on to a full bar it cannot cash.
    if (dry) return { ...unit, state: "dry", isWatered: false, progress: progressAt(driedAt) };
    if (!Number.isFinite(ready) || !Number.isFinite(started)) return unit;
    if (ready <= nowMs) return { ...unit, state: "ready", progress: 1, isWatered: true };
    return { ...unit, state: "working", progress: progressAt(nowMs), isWatered: true };
  });
}

export function StackAcresFarm() {
  const [units, setUnits] = useState<StackAcresUnitSnapshot[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [feed, setFeed] = useState(0);
  const [water, setWater] = useState(WATER_CAPACITY);
  /** The drag tool floating on the map right now, if any: the watering can
   *  over a dry crop, or the feed scoop over a hungry pen. */
  const [dragOffer, setDragOffer] = useState<DragOffer | null>(null);
  /** The rod mid-cast at the dock, if any. See `FishingOffer`'s own header. */
  const [fishingOffer, setFishingOffer] = useState<FishingOffer | null>(null);
  /** The map's own box, so a drag tool can be kept inside it. */
  const fieldRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState<Partial<Record<StackAcresStock, number>>>({});
  const [toolTier, setToolTier] = useState<StackAcresToolTier>(STACKACRES_STARTING_TIER);
  // Grass cutters owned, and the one last picked on this device. `cutter` is
  // what is actually in hand: the pick while it is still owned, else the best.
  const [cutters, setCutters] = useState<StackAcresCutter[]>([STACKACRES_STARTING_CUTTER]);
  const [pickedCutter, setPickedCutter] = useState<StackAcresCutter | null>(null);
  const cutter = heldStackAcresCutter(pickedCutter, cutters);
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
  // through `onPrestigeReset`'s own return value -- the same sidecar-ref
  // shape `lastMerchantPurchase` uses, for the same reason: `act`'s return
  // type is the fixed `ContractActionResult` shared by every action, and
  // this is the one extra field a reset's own answer carries beyond it.
  const lastPrestigeReset = useRef<StackAcresPrestigeResetResult | null>(null);
  // The Sunlight Forge. Seeded to "nothing forged yet" -- the same standing
  // a brand-new farm's own first read comes back with.
  const [forge, setForge] = useState<readonly string[]>([]);
  const [showForge, setShowForge] = useState(false);
  // The Crossbreeding Bed. Seeded empty -- the same standing a brand-new
  // farm's own first read comes back with. `lastCrossbreedHarvest` is the
  // same sidecar-ref shape `lastPrestigeReset` uses, for the same reason:
  // `act`'s fixed return type has no room for what a harvest just bred.
  const [crossbreed, setCrossbreed] = useState<CrossbreedBedView>(emptyCrossbreedBedView);
  const [showCrossbreed, setShowCrossbreed] = useState(false);
  const lastCrossbreedHarvest = useRef<CrossbreedHarvestSettlement | null>(null);
  // The irrigation pipe network. Seeded empty -- the same standing a
  // brand-new farm's own first read comes back with.
  const [irrigation, setIrrigation] = useState<readonly PipeNode[]>([]);
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
  /**
   * The fence-upgrade popup: opened by `onWorldFenceSegmentTap`, closed by
   * "Not now", the next world tap (`onViewMoved`), or a successful upgrade.
   * Unlike the monk dialogue, it holds no separate "result" phase -- a
   * successful upgrade just closes it, since there is nothing more to say
   * once the fence line is already whichever tier a re-tap would show.
   */
  const [fencePopup, setFencePopup] = useState<
    | { zone: ZoneId; segmentIndex: number; at: TapPoint; tier: FenceTier; durability: number; version: number }
    | null
  >(null);
  const [fenceUpgradeBusy, setFenceUpgradeBusy] = useState(false);
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
   * One of the ten stranded visitors' greeting bubble -- opened by
   * `onWorldVisitorTap`, closed by its own close button or the next world
   * tap (`onViewMoved`), the same screen-anchored posture every other
   * dialogue on this map takes. Placement + flavour dialogue only: there is
   * no "result" phase because there is nothing here that answers.
   */
  const [visitorGreeting, setVisitorGreeting] = useState<{ id: VisitorId; at: TapPoint } | null>(null);
  // Seeded from the same pure helper the server uses, so the window's terms are
  // right on the first paint rather than blank until the read lands.
  const [exchange, setExchange] = useState<StackAcresExchangeState>(() =>
    exchangeState(0, new Date()),
  );
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
  /** Bags bought from Ray but not laid down yet. Plain object rather than a Map
   *  so a response can replace it wholesale. */
  const [soilStock, setSoilStock] = useState<SoilStock>({});
  /** Crop seeds bought from Ray but not planted yet -- the ownership filter
   *  that keeps the gel dock from ever offering a crop the player isn't
   *  carrying, see `cropFieldGelItems`. Same plain-object shape as
   *  `soilStock` and for the same reason. */
  const [seedStock, setSeedStock] = useState<SeedStock>({});
  /** The Mechanical Forage Drone hangar: whether it is unlocked and every
   *  drone this profile owns. Starts closed/empty, same as every other
   *  gated feature here, until the first response confirms otherwise. */
  const [droneHangar, setDroneHangar] = useState<{
    unlocked: boolean;
    drones: { droneId: string; deployedAt: string }[];
  }>({ unlocked: false, drones: [] });
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
  /** The wild district a finger just landed on, if the clearing modal is up. */
  const [clearing, setClearing] = useState<SectorId | null>(null);
  /** `clearing`'s own twin for the Crop Fields -- see
   *  StackAcresCropFieldsModal's own header on why they need a separate
   *  modal and a separate open flag since the 2026-09-08 district merge. */
  const [cropFieldsModalOpen, setCropFieldsModalOpen] = useState(false);

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
  const [tool, setTool] = useState<StackAcresTool>("inspect");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [museum, setMuseum] = useState<MuseumRegistry>(() => emptyMuseumRegistry());
  const [museumSecrets, setMuseumSecrets] = useState<SecretMuseumRegistry>(() =>
    emptySecretMuseumRegistry(),
  );
  /** Hidden secrets: what is held, and whether a crit boost is armed. Empty
   *  and unarmed until the first read lands, same posture `museum` takes. */
  const [secrets, setSecrets] = useState<{
    held: Partial<Record<SecretItemId, number>>;
    boostArmed: boolean;
  }>({ held: {}, boostArmed: false });
  const [secretDonations, setSecretDonations] = useState<Record<SecretItemId, boolean>>(
    () => Object.fromEntries(SECRET_ITEM_IDS.map((id) => [id, false])) as Record<SecretItemId, boolean>,
  );
  const [showHelp, setShowHelp] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [showMuseum, setShowMuseum] = useState(false);
  const [showContracts, setShowContracts] = useState(false);
  const [showWorkshop, setShowWorkshop] = useState(false);
  /** The vat's own sheet, opened from inside the Workshop. */
  const [showVat, setShowVat] = useState(false);
  const [showGreenhouse, setShowGreenhouse] = useState(false);
  const [greenhouseBuilt, setGreenhouseBuilt] = useState(false);
  const [cropFieldsUnlocked, setCropFieldsUnlocked] = useState(false);
  const [showMerchant, setShowMerchant] = useState(false);
  /** Owns this farm's entire Midnight Merchant render state -- see
   *  lib/stackacres/midnight-merchant.ts's own header. One instance per
   *  mount, never recreated: `applySnapshot`'s "same visit vs. a new one"
   *  distinction depends on comparing against whatever the LAST snapshot
   *  was, and a fresh instance on every render would lose that memory and
   *  replay the arrival animation on every unrelated re-render. */
  const merchantManager = useRef(new MidnightMerchantManager());
  /**
   * The manager's own derived render state, mirrored into real React state
   * rather than read from `merchantManager.current` during render.
   *
   * `merchantManager` itself stays a plain mutable class instance for the
   * same reason `FarmhandStateMachine`'s is -- a value ticked every second
   * has no business being reconstructed through `setState` every second --
   * but reading a ref's `.current` IN THE RENDER BODY is exactly what the
   * `react-hooks/refs` rule exists to catch: React does not know a render
   * depends on it, so a change to it alone would never schedule the
   * re-render this component needs to show it. `merchantSnapshot` is the
   * fix: every place that mutates the manager (the tick interval below, and
   * `applySnapshot` inside `applyResponse`) immediately mirrors its fresh
   * `.snapshot()` into this state right after, in an effect or a handler,
   * never during render -- so React always knows exactly when to repaint. */
  const [merchantSnapshot, setMerchantSnapshot] = useState<MidnightMerchantRenderSnapshot>({
    state: "absent",
    msRemaining: 0,
    urgent: false,
    visit: null,
  });
  /** Sidecar for `act`'s fixed `ContractActionResult` return shape -- see
   *  `onBuyFromMerchant`, and `tapAnchor` above for the same "extra
   *  information the generic action layer does not carry" pattern already
   *  used in this file. Read exactly once, synchronously, right after the
   *  `act` call that set it -- nothing else in this component writes it. */
  const lastMerchantPurchase = useRef<{ pricePaid: number } | null>(null);
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
  // Grandfather Ray's one-time hello, first visit only -- a plain localStorage
  // flag rather than a profile field, since this is a hello, not a fact about
  // the farm. Read only once `hasStarted` flips true, so it never flashes
  // behind the tap-to-play splash.
  const [showWelcome, setShowWelcome] = useState(false);
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

  useStackAcresMusic(hasStarted);

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
  const sending = useRef(false);
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
  // The district panel used to sit open over the map at all times, and then
  // to open whenever a player travelled anywhere. It is deep management now
  // -- capacity, buying outright, the standing list -- so it only opens when
  // it is actually asked for: the Manage button, or the radial menu's own
  // handoff. Travelling flies the camera and nothing else.
  const [panelOpen, setPanelOpen] = useState(false);
  /**
   * The seed menu dropped beside a finger that tapped empty district ground,
   * and where to draw it -- pixels inside .sa-field, which is the same box
   * the scene reported the tap in.
   */
  const [radial, setRadial] = useState<{
    zone: ZoneId;
    at: TapPoint;
    world: WorldPoint;
    /**
     * The bed a "Remove Bed" tap on a PLANTED tile is one tap away from
     * actually lifting -- see `cropFieldGelItems`. Set on the first tap,
     * which only re-labels the same ring rather than firing anything;
     * cleared on "Keep the bed", and gone for free on any confirm or close
     * (every other `setRadial` call below replaces this whole object or
     * drops it to null), so an armed confirm can never carry over onto a
     * different tile or outlive the ring that raised it.
     */
    armedRemoveBed?: { tx: number; ty: number };
    /**
     * Which step of the Crop Fields' own bare-ground dock is showing: the
     * root Lay Pipe/Plant Soil choice, or one branch's own follow-on
     * (soil tiers, or Pipe vs. Well when no well exists yet). Lives on
     * `radial` for the same reason `armedRemoveBed` does -- a fresh tap on
     * any tile replaces the whole object, so a stale step can never survive
     * onto a different tile. `undefined` reads as `"root"`.
     */
    gelStep?: "root" | "pipe" | "soil";
  } | null>(null);
  /**
   * The four-way aim for a lone pipe stub (stackacres-pipe-aim.tsx), pinned
   * at the finger the same way the ring is. Its own state rather than a
   * mode of `radial`: it opens AFTER the ring has closed (a "Lay Pipe" that
   * landed somewhere lone, or an "Aim Pipe" on a stub already down), and
   * closes on its own terms -- a pick, the scrim, the camera moving, or the
   * stub joining a neighbour (the effect beside `radialSoilWorld` below).
   */
  const [pipeAim, setPipeAim] = useState<{ tx: number; ty: number; at: TapPoint } | null>(null);
  /**
   * Where the finger that started the request in flight landed, so the reward
   * floats out of the thing that was tapped rather than out of the middle of
   * the screen. A ref, not state: nothing renders from it, and it must not be
   * a frame behind the response that reads it.
   */
  const tapAnchor = useRef<TapPoint | null>(null);
  /**
   * Critical Harvest Cascade: what the most recent SOLO collect's response
   * said, for `triggerCascade` to read once `act`'s own promise -- and its
   * `finally`'s `inFlight` cleanup -- has actually resolved.
   *
   * A ref, not a return value threaded through `act`: `act`'s declared return
   * type is `ContractActionResult`, owned by TownContractsModal.tsx and about
   * contract settlement, not harvests -- widening it to carry this feature's
   * own payload would be a layering violation for every other caller that
   * already ignores what `act` returns. This is also NOT read from inside
   * `act` itself: every `collect` action collapses to the same intent string
   * (`intentOf` has no `unitIds` case), so a second `collect` fired while the
   * first is still inside its own try block would be rejected by the very
   * `inFlight` guard the cascade is trying to reuse. Set only for a one-unit
   * sweep (a tap, never the Harvest-All button) and read/cleared exactly once
   * by `triggerCascade`, which is the only thing that ever calls it -- see
   * that function's own header for the rest of the contract.
   */
  const lastHarvestRef = useRef<{ crit: boolean; units: StackAcresUnitSnapshot[] } | null>(null);
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
   * How many requests are in the air, across every intent. `sending.current`
   * (the flag `refresh` reads to hold off a refetch that would clobber an
   * optimistic patch) is now "this is non-zero" rather than its own boolean,
   * so two overlapping actions both have to finish before a background
   * refresh is allowed through.
   */
  const inFlightCount = useRef(0);

  /**
   * Add / remove one intent from both the ref (synchronous, what the
   * duplicate guard reads) and the render mirror (what a button reads).
   * Called from `act` and from `send`.
   */
  const markInFlight = useCallback((intent: string) => {
    inFlight.current.add(intent);
    inFlightCount.current += 1;
    sending.current = true;
    setPendingIntents((prev) => {
      if (prev.has(intent)) return prev;
      const next = new Set(prev);
      next.add(intent);
      return next;
    });
  }, []);
  const clearInFlight = useCallback((intent: string) => {
    inFlight.current.delete(intent);
    inFlightCount.current = Math.max(0, inFlightCount.current - 1);
    if (inFlightCount.current === 0) sending.current = false;
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
  // Which unit is mid-"are you sure" for retiring. Never a plain confirm():
  // retiring refunds nothing, so it has to be two deliberate taps.
  const [retiringUnitId, setRetiringUnitId] = useState<string | null>(null);
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
   *  on now, in place of the old screen-wide `busy`. `anyPending` is only for
   *  the ambient "Working…" tool hint, which gates nothing. */
  const isPending = useCallback(
    (intent: string) => pendingIntents.has(intent),
    [pendingIntents],
  );
  /** Whether any in-flight intent is `prefix` or `prefix:...` -- for a modal
   *  or menu that fires a family of intents (every synergy archetype, every
   *  merchant item) and greys the whole surface while one is settling, while
   *  the rest of the screen stays live. */
  const pendingByPrefix = useCallback(
    (prefix: string) => {
      for (const intent of pendingIntents) {
        if (intent === prefix || intent.startsWith(`${prefix}:`)) return true;
      }
      return false;
    },
    [pendingIntents],
  );
  const anyPending = pendingIntents.size > 0;

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

  const applyResponse = useCallback((data: Partial<StackAcresResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.units) setUnits(data.units);
    if (typeof data.feed === "number") setFeed(data.feed);
    if (typeof data.water === "number") setWater(data.water);
    if (data.capacity) setCapacity(data.capacity);
    if (data.exchange) setExchange(data.exchange);
    if (data.museum) setMuseum(data.museum);
    if (data.museumSecrets) setMuseumSecrets(data.museumSecrets);
    if (data.sectors) setSectors(data.sectors);
    if (data.upkeep) setUpkeep(data.upkeep);
    if (typeof data.influence === "number") setInfluence(data.influence);
    // Through toStackAcresToolTier rather than a cast, for the same reason the
    // store reads it that way: an unknown rung must degrade to a playable one.
    if (data.tool) setToolTier(toStackAcresToolTier(data.tool));
    if (data.cutters) setCutters(ownedStackAcresCutters(data.cutters));
    if (data.synergy) {
      setSynergyUnlocked(data.synergy.unlocked);
      setSynergyActive(data.synergy.active);
      setFarmhandSpeedMultiplier(data.synergy.farmhandSpeedMultiplier);
    }
    // All four move together or not at all: a response either carries the
    // processing track or predates it, and a half-applied one would show a
    // contract next to inventory numbers from a different moment.
    if (data.inventory && data.wheatPlots && data.machines) {
      setProcessing({
        contract: data.contract ?? null,
        inventory: data.inventory,
        machines: data.machines,
        wheatPlots: data.wheatPlots,
      });
    }
    if (data.secrets) setSecrets(data.secrets);
    if (data.secretDonations) setSecretDonations(data.secretDonations);
    if (data.devotion) setDevotion(data.devotion);
    if (data.friendship) setFriendship(data.friendship);
    if (typeof data.greenhouseBuilt === "boolean") setGreenhouseBuilt(data.greenhouseBuilt);
    if (typeof data.cropFieldsUnlocked === "boolean") setCropFieldsUnlocked(data.cropFieldsUnlocked);
    // `!== undefined` on purpose, not a truthiness check: `null` is a real,
    // meaningful answer here ("confirmed no visit"), and treating it like a
    // missing field would mean a visit that just expired could never be
    // told apart from a response too old to carry the field at all. See
    // `midnightMerchant`'s own doc comment on StackAcresResponse.
    if (data.midnightMerchant !== undefined) {
      merchantManager.current.applySnapshot(data.midnightMerchant);
      const next = merchantManager.current.snapshot();
      setMerchantSnapshot(next);
      // A visit ending while its own sheet is open closes that sheet here,
      // in the same handler that just learned the visit is gone, rather
      // than a second effect watching for it -- setting it to `false` when
      // it is already `false` is a no-op React bails out of on its own.
      if (!next.visit) setShowMerchant(false);
    }
    if (data.midnightMerchantPurchase) {
      lastMerchantPurchase.current = { pricePaid: data.midnightMerchantPurchase.pricePaid };
    }
    // `!== undefined` for the same reason as the merchant above: null is the
    // real "no vat placed" answer, and an optimistic patch carries no field.
    if (data.vat !== undefined) setVat(data.vat);
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
    if (data.irrigation) setIrrigation(data.irrigation);
    if (data.blueprints) setBlueprints(data.blueprints);
    // Every response carries the FULL purchased list, not a diff, so a feed
    // or a water tap that never touched the soil still hands this a fresh
    // array from JSON. `soilTilesEqual` is what stops that from becoming a
    // new state identity (and, downstream, a scene repaint) on every
    // unrelated action -- see that function's own doc comment.
    if (data.soilTiles) {
      setSoilTiles((prev) => (soilTilesEqual(prev, data.soilTiles!) ? prev : data.soilTiles!));
    }
    if (data.soilStock) setSoilStock(data.soilStock);
    if (data.seedStock) setSeedStock(data.seedStock);
    if (data.droneHangar) setDroneHangar(data.droneHangar);
    if (data.blueprints) setBlueprints(data.blueprints);
  }, []);

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
      capacity,
      seedStock,
      toolTier,
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
      merchantVisit: merchantSnapshot.visit,
      greenhouseBuilt,
      cropFieldsUnlocked,
      irrigation,
      // This profile's placed soil, same posture as `irrigation` above.
      soilTiles,
      soilStock,
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
      capacity,
      seedStock,
      toolTier,
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
      merchantSnapshot,
      greenhouseBuilt,
      cropFieldsUnlocked,
      irrigation,
      soilTiles,
      soilStock,
    ],
  );

  /**
   * A copy of every farm atom an optimistic patch might touch, taken the
   * instant before a guess is applied. Restored verbatim when the server
   * refuses or the request never lands -- see `act`. The merchant VISIT is
   * deliberately out: no predictor moves it, and it carries its own
   * arriving/departing animation state that a blunt restore would jar.
   */
  const captureFarmSnapshot = useCallback(
    () => ({
      units,
      profile,
      feed,
      water,
      capacity,
      // seedStock IS guessed at by the "stock" predictor above, so a
      // refused or dropped planting has to be able to put the spent seed
      // back. soilTiles/soilStock now join it: place-soil-tile spends a bag
      // (soilStock) and adds a bed (soilTiles) optimistically, same as
      // place-pipe does for irrigation below.
      seedStock,
      exchange,
      museum,
      museumSecrets,
      sectors,
      upkeep,
      influence,
      toolTier,
      cutters,
      synergyUnlocked,
      synergyActive,
      farmhandSpeedMultiplier,
      processing,
      secrets,
      secretDonations,
      greenhouseBuilt,
      cropFieldsUnlocked,
      irrigation,
      soilTiles,
      soilStock,
    }),
    [
      units,
      profile,
      feed,
      water,
      capacity,
      seedStock,
      exchange,
      museum,
      museumSecrets,
      sectors,
      upkeep,
      influence,
      toolTier,
      cutters,
      synergyUnlocked,
      synergyActive,
      farmhandSpeedMultiplier,
      processing,
      secrets,
      secretDonations,
      greenhouseBuilt,
      cropFieldsUnlocked,
      irrigation,
      soilTiles,
      soilStock,
    ],
  );
  type FarmSnapshot = ReturnType<typeof captureFarmSnapshot>;
  const restoreFarmSnapshot = useCallback((snap: FarmSnapshot) => {
    setUnits(snap.units);
    setProfile(snap.profile);
    setFeed(snap.feed);
    setWater(snap.water);
    setCapacity(snap.capacity);
    setSeedStock(snap.seedStock);
    setExchange(snap.exchange);
    setMuseum(snap.museum);
    setMuseumSecrets(snap.museumSecrets);
    setSectors(snap.sectors);
    setUpkeep(snap.upkeep);
    setInfluence(snap.influence);
    setToolTier(snap.toolTier);
    setCutters(snap.cutters);
    setSynergyUnlocked(snap.synergyUnlocked);
    setSynergyActive(snap.synergyActive);
    setFarmhandSpeedMultiplier(snap.farmhandSpeedMultiplier);
    setProcessing(snap.processing);
    setSecrets(snap.secrets);
    setSecretDonations(snap.secretDonations);
    setGreenhouseBuilt(snap.greenhouseBuilt);
    setSoilTiles(snap.soilTiles);
    setSoilStock(snap.soilStock);
    setCropFieldsUnlocked(snap.cropFieldsUnlocked);
    setIrrigation(snap.irrigation);
  }, []);

  const refresh = useCallback(async () => {
    if (sending.current) return;
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
      if (!mounted.current || sending.current) return;
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

  /**
   * The crop standing on tile `(tx, ty)` right now, or null on bare or
   * empty ground -- the same `soilSlotOnTile` question
   * `removeStackAcresSoilTile` asks server-side before it deletes a bed's
   * occupant. Used only to decide whether removing a bed needs a warning
   * first; the server is the one that actually enforces the loss.
   */
  const cropOnTile = useCallback(
    (tx: number, ty: number): StackAcresUnitSnapshot | null => {
      for (const unit of liveUnits) {
        if (unit.soilSlot !== null && soilSlotOnTile(soilMapForTiles, unit.soilSlot, tx, ty)) {
          return unit;
        }
      }
      return null;
    },
    [liveUnits, soilMapForTiles],
  );

  /** The id of whichever crop stands on `(tx, ty)` AND is dry right now, or
   *  null -- `soil.ts`'s `thirstyTileGroup` calls this once per tile it
   *  walks to decide how far a group-water block reaches. */
  const dryUnitAt = useCallback(
    (tx: number, ty: number): string | null => {
      const unit = cropOnTile(tx, ty);
      return unit && unit.state === "dry" ? unit.id : null;
    },
    [cropOnTile],
  );

  // The barn's own beacon (lib/stackacres/museum-secrets.ts) and whether the
  // Pixel Pilgrim's own unlock tint should be showing -- both pure
  // derivations of state already held above, recomputed only when one of
  // its real inputs changes rather than tracked as state of their own.
  const museumGlowTier = useMemo(
    () =>
      museumGlowTierFor({
        regularUndonatedCount: Object.values(museum).filter((donated) => !donated).length,
        secretsFound: secretsFoundCount(museumSecrets),
        secretsTotal: SECRET_ARTIFACTS.length,
        hasGoldenSpade: toolTier === "golden-spade",
      }),
    [museum, museumSecrets, toolTier],
  );
  const secretSetComplete = useMemo(() => secretHiddenSetComplete(museumSecrets), [museumSecrets]);

  const anyWorking = units.some(
    (unit) =>
      unit.state === "working" ||
      unit.state === "hungry" ||
      unit.state === "dry" ||
      unit.state === "ready",
  );
  useEffect(() => {
    if (!anyWorking) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyWorking]);

  // The Merchant's own clock -- unconditional, unlike the interval above:
  // a visit can be live with every animal idle, and `tick` is a cheap no-op
  // whenever there is nothing to age down (see its own early return). The
  // fresh snapshot is mirrored into React state immediately, in the same
  // callback that mutated the manager -- never read from the ref during
  // render (see `merchantSnapshot`'s own declaration for why that matters).
  useEffect(() => {
    const timer = window.setInterval(() => {
      merchantManager.current.tick(1000);
      const next = merchantManager.current.snapshot();
      setMerchantSnapshot(next);
      if (!next.visit) setShowMerchant(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Pushed to the scene only when the render decision actually flips, the
  // same "push, never rebuild" contract setToolTier/setMuseumGlowTier
  // already follow -- see StackAcresWorldApi's own `setMerchant` doc.
  const merchantRendered = merchantSnapshot.state !== "absent";
  useEffect(() => {
    world.current?.setMerchant(merchantRendered);
  }, [merchantRendered]);

  // Whether a tap landed inside the Crop Fields' own bed lattice
  // (`CROP_FIELD_BEDS`), rather than merely somewhere in the Farmstead --
  // since the 2026-09-08 district merge, `radial.zone === "farmstead"` alone
  // is true for the Farmstead's own yard too (its Hen Coop remnant grow
  // area), and soil is only ever a Crop Fields concept.
  const radialInCropFieldBeds =
    !!radial &&
    radial.zone === "farmstead" &&
    radial.world.x >= CROP_FIELD_BEDS.x &&
    radial.world.x <= CROP_FIELD_BEDS.x + CROP_FIELD_BEDS.width &&
    radial.world.y >= CROP_FIELD_BEDS.y &&
    radial.world.y <= CROP_FIELD_BEDS.y + CROP_FIELD_BEDS.height;

  // The bed outline follows the ring, because the ring is where a bed is
  // bought. Keyed on the radial state, which changes only on a tap, so this
  // pushes once per open and once per close rather than per frame -- and
  // every `setRadial(null)` site clears the outline without having to know
  // it exists. Only the Crop Fields can hold a bed (the service refuses
  // every other district), so no other zone draws one.
  const radialSoilWorld = radialInCropFieldBeds && radial ? radial.world : null;
  useEffect(() => {
    world.current?.previewSoilAt(radialSoilWorld);
  }, [radialSoilWorld]);

  // The stub being aimed, as the farm currently knows it. The aim only means
  // anything while the tile is lone (irrigation.ts's `PipeFacing`), so the
  // popover goes away the moment a neighbour joins it -- whether by this
  // player's next drag or by a refresh that says so. A tile the farm does
  // not know at all is NOT stale, only hidden: a ring "Lay Pipe" sets
  // `pipeAim` in the same tap that fires the request, and the tile's own
  // node only lands with the optimistic patch a beat later, so clearing on
  // "missing" would throw the aim away before the stub ever appears. A
  // lifted tile reads as missing the same way and simply stays hidden.
  const pipeAimNode = pipeAim
    ? (irrigation.find((node) => node.tx === pipeAim.tx && node.ty === pipeAim.ty) ?? null)
    : null;
  const pipeAimStale = pipeAimNode !== null && (pipeAimNode.kind !== "pipe" || pipeAimNode.mask !== 0);
  useEffect(() => {
    if (!pipeAimStale) return;
    // Deferred a macrotask rather than set synchronously in the effect body
    // -- the `window.setTimeout(fn, 0)` shape table-loading-splash.tsx and
    // useMinHoldFade use, required by this codebase's react-hooks/
    // set-state-in-effect lint. The render below already hides the popover
    // for a stale tile, so the one-tick gap draws nothing.
    const timer = window.setTimeout(() => setPipeAim(null), 0);
    return () => window.clearTimeout(timer);
  }, [pipeAimStale]);

  // The bed actually standing at the tap, if any -- the one thing that
  // decides both what the ring/strip offers (a crop needs an empty bed to
  // land on; bare ground only ever offers to till one) and, via
  // `onRadialSeed`, which tile a planting names. Null on bare ground, same
  // as it is outside the Crop Fields entirely.
  const radialSoilTile =
    radial && radialInCropFieldBeds
      ? (() => {
          const { tx, ty } = soilTileAt(radial.world.x, radial.world.y);
          return mergedSoilTiles.find((t) => t.tx === tx && t.ty === ty) ?? null;
        })()
      : null;

  // Same "push, never rebuild" contract: the scene diffs its own drone set
  // against this list (see StackAcresScene.setDroneHangar), so pushing on
  // every response -- even one that rebuilt the array without actually
  // changing the fleet -- is a harmless no-op on the scene's own side.
  useEffect(() => {
    world.current?.setDroneHangar(droneHangar.drones.map((drone) => drone.droneId));
  }, [droneHangar.drones]);

  /** Whether the truck exists at all is a plain function of whether a Town
   *  Contract is open -- see lib/stackacres/delivery-truck.ts's own module
   *  doc for why the truck holds no opinion of its own about that fact.
   *  `truckKnownRef` skips the drive-in animation exactly once: the very
   *  first time this effect runs, so a player who opens the farm with a
   *  contract already posted sees the truck simply standing at its dock
   *  rather than replaying an eleven-second arrival on every page load.
   *  Every later transition -- a fresh request, or a fulfilled contract
   *  clearing -- plays the real drive, because by then the ref is already
   *  true. */
  const truckKnownRef = useRef(false);
  const truckWanted = processing.contract !== null;
  useEffect(() => {
    // `world.current` is null until the scene has actually booted -- and the
    // first response (with the first `truckWanted` value it ever carries)
    // routinely lands before that: `refresh()` fires on mount, the same
    // frame `<StackAcresWorld>` starts mounting, and a same-machine fetch
    // resolves well inside Phaser's own boot time. Depending on `worldReady`
    // too, and guarding the whole body on `world.current` rather than just
    // optional-chaining the call, is what turns that from "the truck's first
    // real state change is silently dropped" into "try again once the world
    // exists" -- optional-chaining alone still marks `truckKnownRef` done
    // and never gets a second chance.
    if (!world.current) return;
    world.current.setTruckPresent(truckWanted, truckWanted && !truckKnownRef.current);
    truckKnownRef.current = true;
  }, [truckWanted, worldReady]);

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
    async (body: Action): Promise<ContractActionResult> => {
      // A second press at something already being asked about is a duplicate,
      // not a second request. Dropped here rather than sent and deduplicated
      // server-side: the cheapest duplicate is the one that never leaves.
      const intent = intentOf(body);
      if (inFlight.current.has(intent)) {
        return { ok: false, message: "That is already on its way." };
      }
      markInFlight(intent);
      setError(null);
      // A key held over from an attempt that never came back makes this press
      // a retry of that one; otherwise it names a new intent.
      const key = pendingKeys.current.get(intent) ?? newIntentKey();
      pendingKeys.current.set(intent, key);
      // Assume the server says yes. `predictStackAcresAction` returns the
      // patch a success would produce (or null when the outcome is a dice
      // roll we won't fake), applied through the very same `applyResponse`
      // the real answer uses. `snapshot` is what a refusal or a dropped
      // request rolls back to.
      const snapshot = captureFarmSnapshot();
      const patch = predictStackAcresAction(body, buildPredictContext());
      const optimisticApplied = patch !== null;
      if (patch) applyResponse(patch);
      // The unit resets instantly (above), but the payout itself is a dice
      // roll this layer won't fake -- see predictStackAcresAction's header.
      // A player who taps and hears/sees nothing until the round trip lands
      // reads that gap as lag, so say the honest, numberless part out loud
      // right away; the real toast overwrites this the moment the response
      // is in, and a refusal below retracts it.
      if (body.action === "collect" && optimisticApplied) {
        setLastCollect({ text: "Your gold will arrive in your wallet shortly...", nonce: Date.now() });
      }
      // Every shop purchase without its own call-site toast gets one here --
      // see `purchaseCueText`'s own header for why this is the one place to
      // do it and which actions it deliberately skips.
      const purchaseCue = purchaseCueText(body);
      if (purchaseCue) setLastCollect({ text: purchaseCue, nonce: Date.now() });
      // Set the moment this browser knows what became of the request. While it
      // is false the key survives, so the next press at the same thing is a
      // retry; once it is true the key is dropped and the next press is a new
      // intent. Deliberately NOT set merely because `fetch` resolved: a body
      // that fails to parse leaves the outcome just as unknown as a dropped
      // connection does.
      let answered = false;
      try {
        const response = await fetch("/api/stackacres/actions", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, key }),
        });
        if (response.status === 429) {
          // Rejected before it reached the farm, so the server applied
          // nothing -- but this browser did, so put the guess back.
          answered = true;
          if (optimisticApplied) restoreFarmSnapshot(snapshot);
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
        const data = (await response.json()) as Partial<StackAcresResponse>;
        answered = true;
        if (!mounted.current) return { ok: false, message: "Left the farm." };
        if (!response.ok) {
          // A dull knock on wood, never a buzzer: most refusals here are "you
          // cannot afford that yet", which is ordinary and frequent, and a
          // harsh error tone on an ordinary event teaches a player to dread
          // their own farm.
          refusedSound();
          // Nothing was written, so unwind the optimistic guess FIRST --
          // purse, capacity, feed, the lot -- then overlay whatever
          // authoritative unit list the refusal carried on top.
          if (optimisticApplied) restoreFarmSnapshot(snapshot);
          // A refusal carries the true round; paint it, and only raise a
          // banner when there is no round to speak for itself.
          if (data.round) setUnits(data.round);
          if (data.profile) setProfile(data.profile);
          // A refused purchase takes its own instant toast back too -- left
          // standing, "Bought a Hen!" would sit on screen next to the refusal
          // banner claiming the opposite. `data.reason === "day-capped"`
          // below sets its own toast on top of this a few lines down, so this
          // never fights it.
          if (purchaseCue) setLastCollect(null);
          // The daily Gold ceiling is the feature working, not a fault. It
          // repaints the round silently like any other refusal, which left a
          // harvest press looking like it did nothing -- so say it out loud
          // in the same toast a good harvest answers in, and let the standing
          // notice by the Harvest key (below) carry the countdown.
          if (data.reason === "day-capped") {
            // A capped farm refuses every drone claim too, and the drones
            // ask on their own -- so park the fleet's drops until the day
            // rolls over rather than let five patrols keep flying to gold
            // that cannot pay and firing a refused request apiece every few
            // seconds until midnight.
            world.current?.holdDroneForage(msUntilNextExchangeDay(new Date()));
            setLastCollect({
              text: data.error ?? "The farm has sent out all the Gold it can today.",
              nonce: Date.now(),
            });
          } else if (!data.round) {
            setError(data.error ?? "That did not go through.");
          } else if (body.action === "collect") {
            // Take back the "on its way" promise from above -- the round
            // repainted silently because there was nothing to collect after
            // all, and nothing is actually inbound.
            setLastCollect(null);
          }
          // Re-read the allowance once this request has let go of the send
          // lock, so the window (and the standing notice) show the server's
          // truth rather than the amount this browser thought it could send.
          if (body.action === "collect") window.setTimeout(() => void refresh(), 0);
          return { ok: false, message: data.error ?? "That did not go through." };
        }
        applyResponse(data);
        // Where the finger that asked for this landed, if it was a tap on the
        // map rather than a sidebar row -- the reward floats out of the thing
        // that was tapped. A sidebar press leaves this null and the toast
        // below is the whole answer, same as it always was.
        const anchor = tapAnchor.current;
        if (body.action === "collect" && data.harvest) {
          const { harvest } = data;
          const single = body.unitIds?.length === 1 ? body.unitIds[0] : null;
          // Critical Harvest Cascade: stash it for `triggerCascade` to pick
          // up once this call has fully returned -- see lastHarvestRef's own
          // header for why that has to happen outside this function.
          if (single) lastHarvestRef.current = { crit: harvest.crit, units: data.units ?? [] };
          // Fired here rather than on the press because the ANIMAL is what
          // makes this sound worth having, and only the response knows which
          // unit actually paid out: a hen clucking as the eggs go in the
          // basket is the moment the farm most needs to feel alive. A
          // whole-farm sweep plays the loudest thing it brought in.
          const sounded = single
            ? unitsRef.current.find((candidate) => candidate.id === single)
            : unitsRef.current.find((candidate) => candidate.state === "ready");
          if (sounded) collectSound(sounded.stock);
          if (single) setCelebrate({ unitId: single, nonce: Date.now() });
          // The toast leads with what went into the barn, because that is
          // what a harvest is now -- it pays no Gold, and selling is a
          // separate choice made at the Workshop. Ray's Museum rides on the
          // same toast; its bonus units are already folded into `tally`.
          const tallyText = harvest.tally
            .map((line) => itemLabel(line.item, line.quantity))
            .join(", ");
          const discoveryPart =
            harvest.discoveries.length > 0
              ? ` · ${harvest.discoveries.length === 1 ? "New Discovery!" : "New Discoveries!"}`
              : "";
          setLastCollect({
            text: `+${tallyText} to the barn${discoveryPart}`,
            nonce: Date.now(),
          });
          if (anchor) {
            // A one-unit sweep floats its produce, which is what a tap on that
            // animal was asking about. A whole-farm sweep floats a count:
            // naming five kinds of produce over one thumb is unreadable.
            const float =
              single && harvest.tally.length === 1
                ? collectFloat(harvest.tally[0].item, harvest.tally[0].quantity)
                : { text: `+${harvest.units} brought in`, icon: "ico-harvest" };
            world.current?.floatAt(anchor, float.text, "gain", float.icon as PainterName);
          }
          // A critical harvest gets its own line: a player who cannot see WHY
          // the haul was bigger than usual has not really been told the
          // ladder is working.
          if (harvest.crit && harvest.critBonus.length > 0) {
            goldSound();
            setLastCollect({
              text: `Rich pickings! +${harvest.critBonus
                .map((line) => itemLabel(line.item, line.quantity))
                .join(", ")}`,
              nonce: Date.now(),
            });
            // And the world's own answer to it, on the unit that got lucky:
            // the crit flash names the exact multiple the ladder just paid.
            // `1 + critBonus` rather than `critBonus`, because the label reads
            // as a TOTAL ("CRIT! x2" for the Golden Spade's bonus of 1) -- see
            // `critFlashLabel`. A whole-farm sweep has no single unit to hang
            // this on, so it keeps the toast alone.
            if (single) {
              world.current?.celebrateCrit(
                single,
                1 + stackacresToolTierDef(toolTierRef.current).critBonus,
              );
            }
          }
          // Ray's Museum, secret wing: its own toast, never folded into the
          // money line above -- a secret find pays no Gold at all, so it has
          // nothing to add to that figure and everything to say on its own.
          if (harvest.secretFind) {
            goldSound();
            setLastCollect({
              text: `You found something in the straw… ${SECRET_MUSEUM_ITEM_CATALOGUE[harvest.secretFind].label}!`,
              nonce: Date.now(),
            });
          }
          if (harvest.secretSetJustCompleted) {
            setLastCollect({
              text: "Ray's hidden collection is complete!",
              nonce: Date.now(),
            });
          }
          if (harvest.mucked > 0) {
            setError(
              harvest.mucked === 1
                ? "That came up weather-worn. Clear it before it earns again."
                : `${harvest.mucked} came up weather-worn. Clear them before they earn again.`,
            );
          }
        }
        // The other three a finger can start from the map. No produce to
        // name, so the float just confirms the verb landed.
        const done =
          body.action === "feed"
            ? "Fed"
            : body.action === "water"
              ? "Watered"
              : body.action === "clear"
                ? "Cleared"
                : body.action === "stock"
                  ? "Seeded"
                  : null;
        if (anchor && done) world.current?.floatAt(anchor, done, "gain");
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
        // A cast pays no Gold -- it fills the shelf, same as a harvest. The
        // reel-out animation already played on the press; this is the actual
        // catch, once the server's dice roll is in.
        if (body.action === "catch-fish" && data.fishCaught) {
          const label = machineItemLabel(data.fishCaught.species, 1);
          waterSound();
          setLastCollect({ text: `Caught a ${label}!`, nonce: Date.now() });
          if (anchor) world.current?.floatAt(anchor, `+1 ${label}`, "gain");
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
        // A drone's own vacuum animation already played (the scene's local-
        // optimistic half, see `onDroneForageCollected`); this is only the
        // confirmed amount, once the server's own cooldown/ceiling check
        // has actually settled it. A refusal leaves `data.droneForage`
        // undefined and this block simply does not run -- there is nothing
        // to roll back on the canvas, since the pull was cosmetic either
        // way. `setLastCollect`, not `floatAt`: a drone's own drop sits
        // wherever it is patrolling on the map, not at a finger's tap
        // point, so the fixed celebration toast is the honest fit rather
        // than a floating text anchored to nothing.
        if (body.action === "collect-drone-forage" && data.droneForage && data.droneForage.reward > 0) {
          goldSound();
          setLastCollect({ text: `🛰️ Drone forage: +${data.droneForage.reward} Gold`, nonce: Date.now() });
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
        // The outcome is unknown -- the write may well have committed. Put
        // the guess back so nothing false is on screen, then re-read the
        // farm from the server for the truth.
        if (optimisticApplied) restoreFarmSnapshot(snapshot);
        window.setTimeout(() => void refresh(), 0);
        const unreachable = "Could not reach the farm. Check your connection.";
        if (mounted.current) setError(unreachable);
        return { ok: false, message: unreachable };
      } finally {
        clearInFlight(intent);
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
      captureFarmSnapshot,
      restoreFarmSnapshot,
      buildPredictContext,
    ],
  );

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
    setRadial(null);
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
    world.current?.playMonkPrayer();
    void act({ action: "pray" });
  }, [act]);

  /* ---------------------------------------------------------------- */
  /* Wildlife Ecosystem & Nighttime Predator Defense                    */
  /* ---------------------------------------------------------------- */

  /**
   * A finger landed on one bay of a district's own fence line. Reads that
   * bay's current tier/durability/version fresh (rather than trusting
   * whatever the live simulation last saw) before opening the popup, so a
   * stale client can never offer an upgrade against a version the server
   * has already moved past.
   *
   * A SEPARATE fetch from `act`, deliberately: this feature's route
   * (`/api/stackacres/defense`) answers in a different shape than
   * `StackAcresResponse`, and folding it into `act`'s response handling
   * would mean teaching that one large function a second response contract
   * for a feature with no Gold/unit-list side effects of its own.
   */
  const onWorldFenceSegmentTap = useCallback((zone: ZoneId, segmentIndex: number, at: TapPoint) => {
    setRadial(null);
    setMonkDialogue(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/stackacres/defense?zone=${zone}&segmentIndex=${segmentIndex}`,
          { cache: "no-store" },
        );
        if (!response.ok || !mounted.current) return;
        const data = (await response.json()) as {
          segment?: { tier: FenceTier; durability: number; version: number };
        };
        if (!data.segment) return;
        setFencePopup({
          zone,
          segmentIndex,
          at,
          tier: data.segment.tier,
          durability: data.segment.durability,
          version: data.segment.version,
        });
      } catch {
        // A failed read just means the popup does not open -- nothing was
        // asked of the server, so there is nothing to undo.
      }
    })();
  }, []);

  /** The only path that ever sends `upgrade-fence`. On success, pushes the
   *  new tier straight into the live simulation (`setFenceTier`) so a
   *  predator testing that bay a moment later already sees it, rather than
   *  waiting on a reload. On a lost race (409, someone else's tap landed
   *  first), the response still carries the segment as it now stands --
   *  the popup re-renders from that truth instead of just erroring. */
  const onUpgradeFence = useCallback(() => {
    if (!fencePopup) return;
    const { zone, segmentIndex, version, at } = fencePopup;
    setFenceUpgradeBusy(true);
    void (async () => {
      try {
        const response = await fetch("/api/stackacres/defense", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "upgrade-fence", zone, segmentIndex, version }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          segment?: { tier: FenceTier; durability: number; version: number };
          error?: string;
        };
        if (!mounted.current) return;
        if (!response.ok) {
          refusedSound();
          if (data.segment) {
            world.current?.setFenceTier(zone, segmentIndex, data.segment.tier, data.segment.durability);
            setFencePopup({ zone, segmentIndex, at, ...data.segment });
          }
          setError(data.error ?? "Could not upgrade that fence.");
          return;
        }
        if (data.segment) {
          world.current?.setFenceTier(zone, segmentIndex, data.segment.tier, data.segment.durability);
        }
        panelSound();
        setFencePopup(null);
      } catch {
        if (mounted.current) setError("Could not upgrade that fence.");
      } finally {
        if (mounted.current) setFenceUpgradeBusy(false);
      }
    })();
  }, [fencePopup]);

  /* ---------------------------------------------------------------- */
  /* The Mechanical Forage Drone                                        */
  /* ---------------------------------------------------------------- */

  /**
   * The scene's own local-optimistic vacuum animation just started on a
   * spawned drop -- fire the real claim immediately, exactly as
   * `onDroneForageCollected`'s own doc comment on StackAcresSceneCallbacks
   * describes. `void act(...)`: a refusal (the drone's own cooldown losing
   * a race, or the daily Gold ceiling) repaints nothing that needs undoing
   * here -- there was never an optimistic Gold change to roll back, only a
   * cosmetic pull that already played.
   */
  const onDroneForageCollected = useCallback(
    (droneId: string) => {
      void act({ action: "collect-drone-forage", droneId });
    },
    [act],
  );

  /* ---------------------------------------------------------------- */
  /* NPC friendship                                                     */
  /* ---------------------------------------------------------------- */

  const onWorldRayTap = useCallback((at: TapPoint) => {
    setRadial(null);
    setGiftDialogue({ npc: "ray", phase: "greeting", at, line: RAY_GIFT_LINES[Math.floor(Math.random() * RAY_GIFT_LINES.length)] });
  }, []);

  /**
   * A finger landed on one of the ten stranded visitors. `kind` is the
   * `PropKind` the scene hit; `visitorForKind` resolves it back to a visitor
   * id (name + line + portrait, all in lib/stackacres/visitors.ts). Nothing
   * here calls the server -- a greeting has nothing to answer.
   */
  const onWorldVisitorTap = useCallback((kind: PropKind, at: TapPoint) => {
    const id = visitorForKind(kind);
    if (!id) return;
    setRadial(null);
    setVisitorGreeting({ id, at });
  }, []);

  /** The only path that ever sends `give-gift`. Unlike a prayer, there is no
   *  optimistic animation to fire on the press -- a gift's own reward (a
   *  keepsake) only ever shows once the server confirms it, the same
   *  "nothing to guess" posture a museum donation already takes. */
  const onGiveGift = useCallback(
    (npc: NpcId, item: MachineItemId) => {
      void act({ action: "give-gift", npc, item });
    },
    [act],
  );

  const onCollect = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      // Silent on the press on purpose: the collection announces itself when
      // it lands (in `act`), with the voice of the animal that actually paid
      // out. A chrome click in front of that is one sound too many, and it is
      // the app's click rather than the farm's.
      void act({ action: "collect", unitIds: [unit.id] });
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

  // Feed/water/clear used to tend the tapped unit locally here, ahead of the
  // network, via a dedicated `tendLocally`. That is now `act`'s own job --
  // `predictStackAcresAction` runs the identical `optimisticallyFedUnit`/
  // `optimisticallyWateredUnit` math the instant the request is sent, so a
  // second local tend here would double-apply it. These handlers now only
  // supply the press's own sound.
  const onFeed = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      feedSound(unit.stock);
      const zone = stockZone(unit.stock);
      // Feeding is per pen now, so the side panel's Feed feeds the whole pen.
      if (PEN_ZONE_IDS.includes(zone)) void act({ action: "feed-pen", zone });
      else void act({ action: "feed", unitId: unit.id });
    },
    [act],
  );
  const onWater = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      if (water < 1) {
        refusedSound();
        setError("Your watering can is empty. Fill it at the well.");
        return;
      }
      waterSound();
      void act({ action: "water", unitId: unit.id });
    },
    [act, water],
  );
  const onClear = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      muckSound();
      void act({ action: "clear", unitId: unit.id });
    },
    [act],
  );
  const onArmRetire = useCallback((unit: StackAcresUnitSnapshot) => {
    panelSound();
    setRetiringUnitId(unit.id);
  }, []);
  const onCancelRetire = useCallback(() => {
    panelSound();
    setRetiringUnitId(null);
  }, []);
  const onConfirmRetire = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      retireSound();
      setRetiringUnitId(null);
      void act({ action: "retire", unitId: unit.id });
    },
    [act],
  );

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

  /** The backpack's three uses for a held secret item -- see the "Hidden
   *  secrets" panel section below. */
  const onDonateSecretItem = useCallback(
    (itemId: SecretItemId) => {
      panelSound();
      void act({ action: "donate-secret-item", itemId });
    },
    [act],
  );
  const onConsumeSecretItem = useCallback(
    (itemId: SecretItemId) => {
      goldSound();
      void act({ action: "consume-secret-item", itemId });
    },
    [act],
  );
  const onTradeSecretItem = useCallback(
    (itemId: SecretItemId) => {
      buySound();
      void act({ action: "trade-secret-item", itemId });
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

  const closeRadial = useCallback(() => {
    panelSound();
    setRadial(null);
  }, []);
  /** The scrim's own click: closes the menu, same as `closeRadial`, then
   *  replays the very click that closed it against the scene underneath
   *  (`StackAcresScene.tapAt`) -- a real DOM button sits over the canvas
   *  while the menu is open, so that canvas never sees the click at all.
   *  Without this, switching to a DIFFERENT patch took two taps: one that
   *  only closed the old menu, and a second that finally landed on the new
   *  spot. */
  const onRadialScrimTap = useCallback((event: { clientX: number; clientY: number }) => {
    panelSound();
    setRadial(null);
    world.current?.tapAt(event.clientX, event.clientY);
  }, []);
  // The view moving under whatever is pinned to it closes both screen-
  // anchored panels the same way -- neither is anchored to the world, so
  // both go away rather than drift off what they were opened on.
  const onViewMoved = useCallback(() => {
    setRadial(null);
    setDragOffer(null);
    setPipeAim(null);
    setMonkDialogue(null);
    setFencePopup(null);
    setGiftDialogue(null);
    setVisitorGreeting(null);
  }, []);

  /**
   * Critical Harvest Cascade: a solo tap that just crit chains into other
   * ready units standing in the same district, each collected through the
   * exact same `collect` action a second tap would have sent -- see
   * lib/stackacres/harvest-cascade.ts's own header for why that is the
   * entire write path (no new RPC, no separate Gold or inventory call at
   * all) and why this goes exactly one generation deep.
   *
   * Called ONLY from onWorldUnitTap's own collect branch, and only after
   * that branch's own `act(...)` call has fully settled -- reading
   * `lastHarvestRef` any earlier would race `act`'s `inFlight` guard, since
   * every `collect` action collapses to the same intent string regardless of
   * which units it names. `originUnitId`/`originStock` are the just-tapped
   * unit as it stood BEFORE the harvest, handed in by the caller's own
   * closure rather than re-read here: a consumed, non-permanent crop is gone
   * from `units` the instant it settles, so there would be nothing left in
   * state to look its stock up from afterward.
   */
  const triggerCascade = useCallback(
    async (originUnitId: string, originStock: StackAcresStock) => {
      const result = lastHarvestRef.current;
      lastHarvestRef.current = null;
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
   * `tapActionFor`'s call, off the same `unitRowAction` the sidebar's rows
   * read, so the map and the list can never disagree.
   *
   * A refusal never leaves the browser. There is no room on a canvas for a
   * disabled button with a title attribute explaining itself, so the reason
   * floats where the finger was instead.
   */
  /** Where to float a drag tool for a tap at `at`, kept inside the map. */
  const offerIconAt = useCallback((at: TapPoint): TapPoint => {
    const field = fieldRef.current;
    return dragIconSpot(at, {
      width: field?.clientWidth ?? window.innerWidth,
      height: field?.clientHeight ?? window.innerHeight,
    });
  }, []);

  /**
   * A tap in a pen, or on one of its animals. Floats the feed scoop with an
   * arrow to the pen's trough when anything there is hungry, and says why
   * not otherwise. Feeding is per pen now, never per animal.
   */
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
      if (feed < 1) {
        refusedSound();
        world.current?.floatAt(at, "No feed left in the barn.", "deny");
        return;
      }
      const spot = penFeedSpot(zone);
      const targetAt = world.current?.fieldPointFor(spot.x, spot.y);
      if (!targetAt) return;
      panelSound();
      setDragOffer({
        key: `feed-pen:${zone}:${Date.now()}`,
        kind: "feed-pen",
        zone,
        iconAt: offerIconAt(at),
        targetAt,
      });
    },
    [feed, liveUnits, offerIconAt],
  );

  const onWorldUnitTap = useCallback(
    (unitId: string, at: TapPoint) => {
      setRadial(null);
      const unit = liveUnits.find((candidate) => candidate.id === unitId);
      if (!unit) return;
      world.current?.popUnit(unitId);
      // The sidebar follows the finger rather than gating it: whatever the
      // player is touching is what "here" means now.
      setPlace(stockZone(unit.stock));
      const action = tapActionFor(unit, { feed, gold, nowMs });
      if (action.kind === "refused") {
        // A knock on wood for a real no, and silence for a unit that is only
        // still growing -- see `why` on StackAcresTapAction. The floated line
        // answers both either way.
        if (action.why === "blocked") refusedSound();
        world.current?.floatAt(at, action.reason, "deny");
        return;
      }
      // Drop a second press at THIS unit's own action while its request is
      // still out -- but nothing else. Two taps on different animals in the
      // same frame both fire now (each is its own intent); a re-mash of the
      // same one is caught here, and `act`'s own synchronous `inFlight` check
      // and the idempotency key behind it are the backstops for the rest (a
      // retry after a dropped connection, another tab).
      const tapIntent = action.kind === "collect" ? "collect" : `${action.kind}:${unitId}`;
      if (inFlight.current.has(tapIntent)) return;
      // Watering and feeding are drag-and-drop: the tap floats the tool, and
      // the drop sends the action (`onDragDrop`).
      if (action.kind === "water") {
        if (water < 1) {
          refusedSound();
          world.current?.floatAt(at, "Your watering can is empty. Fill it at the well.", "deny");
          return;
        }
        panelSound();
        // A dry crop's own tile, if it has one -- crops off the lattice
        // (open-field scatter) have no bed to walk a block out from, so
        // they always water alone. Same >=2x2 rule `thirstyTileGroup`'s own
        // header describes; a lone or L-shaped run falls back to `unitId`.
        const tile = unit.soilSlot !== null ? soilSlotTile(soilMapForTiles, unit.soilSlot) : null;
        const group = tile ? thirstyTileGroup(soilMapForTiles, tile.tx, tile.ty, dryUnitAt) : [];
        setDragOffer({
          key: `water:${unitId}:${Date.now()}`,
          kind: "water",
          unitId,
          unitIds: group.length > 1 ? group : undefined,
          iconAt: offerIconAt(at),
          targetAt: at,
        });
        return;
      }
      if (action.kind === "feed") {
        const zone = stockZone(unit.stock);
        if (PEN_ZONE_IDS.includes(zone)) {
          openPenFeed(zone, at);
          return;
        }
        panelSound();
        setDragOffer({
          key: `feed-unit:${unitId}:${Date.now()}`,
          kind: "feed-unit",
          unitId,
          iconAt: offerIconAt(at),
          targetAt: at,
        });
        return;
      }
      // The farm's own voice for the gesture, chosen off the same `action`
      // that is about to be sent. This is the press the whole sound set was
      // written for and it was the last thing still answering with the app's
      // chrome click: tapping a hen, a dry row and a mucked plot all made the
      // one lobby noise, while the sidebar rows beside them -- doing exactly
      // the same three things -- had had their own sounds since the sound
      // pass landed. The tap path simply predated it.
      //
      // Clear speaks on the PRESS because `act`'s optimistic layer applies it
      // the instant the request is sent. Feed and water never get here; they
      // speak on the drop, in `onDragDrop`. Collect stays silent here and
      // answers in `act` with the voice of the animal that paid out.
      if (action.kind === "clear") muckSound();
      tapAnchor.current = at;
      // Frenzy Heat Combo Engine: every accepted tap (a refused one already
      // returned above) counts as a hit for how fast the player is tapping.
      // Collect is the only action with a yield to bonus off of --
      // STACKACRES_YIELDS' quantity times its Gold value, an ESTIMATE with
      // no crit or synergy bonus folded in (both are rolled server-side, and
      // this fires before the server has answered at all). This is a
      // DISPLAY-ONLY number: it never changes what `act` below actually
      // settles for -- see lib/stackacres/frenzy.ts's own header.
      const baseYieldGold =
        action.kind === "collect"
          ? STACKACRES_YIELDS[unit.stock].quantity * itemSellPrice(STACKACRES_YIELDS[unit.stock].item)
          : undefined;
      world.current?.registerFrenzyTap(unitId, baseYieldGold);
      // A tap is a one-unit sweep. It earns no synergy by construction --
      // three is the fewest a Bountiful Harvest considers -- which is exactly
      // what the Harvest key beside it is for. A collect is chained onto
      // `triggerCascade` once it settles, in case it crit -- every other verb
      // has nothing to chain.
      if (action.kind === "collect") {
        void act({ action: "collect", unitIds: [unitId] }).then((result) => {
          if (result.ok) void triggerCascade(unitId, unit.stock);
        });
      } else {
        void act({ action: action.kind, unitId });
      }
    },
    [act, dryUnitAt, feed, gold, liveUnits, nowMs, offerIconAt, openPenFeed, soilMapForTiles, triggerCascade, water],
  );

  /**
   * A tap on a unit with nothing to do yet: still growing, or idle and
   * permanent. Retiring is never a tap (see tap-action.ts). The unit just
   * pops so the tap isn't silently dropped. Nothing is sent.
   */
  const onWorldUnitSelect = useCallback((unitId: string) => {
    panelSound();
    setRadial(null);
    world.current?.popUnit(unitId);
  }, []);

  /**
   * A Mow, Pipe or Soil key was pressed (`StackAcresGroundTools`). Water,
   * feed and harvest have no key; tapping what needs them is enough.
   * Pressing the held key again drops back to `"inspect"`.
   */
  const pickGroundTool = useCallback((next: StackAcresTool) => {
    toolSound();
    setError(null);
    setTool((held) => (held === next ? "inspect" : next));
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
    (zone: ZoneId, at: TapPoint, worldPt: WorldPoint) => {
      setPlace(zone);
      // A pen's ground is for feeding what lives there, not for building.
      // Stocking a pen is in the side panel.
      if (PEN_ZONE_IDS.includes(zone)) {
        setRadial(null);
        openPenFeed(zone, at);
        return;
      }
      // A menu opening over the map, same as the barn and the locked-land
      // sheets below. Not an action on the farm, so it takes the farm's
      // panel cue rather than one of the action voices.
      panelSound();
      setRadial({ zone, at, world: worldPt });
    },
    [openPenFeed],
  );

  /** A finger landed on the barn, Ray's Museum's entryway. A sound on the
   *  press and a sheet over the map. Nothing goes to the server; the museum
   *  registry already lives in this component's state. */
  const onWorldBarnTap = useCallback(() => {
    setRadial(null);
    panelSound();
    setShowMuseum(true);
  }, []);

  /** A finger landed on the signpost, the Town Board's entryway now that
   *  the places list is gone. Same shape as `onWorldBarnTap`. */
  const onWorldSignpostTap = useCallback(() => {
    setRadial(null);
    panelSound();
    setShowContracts(true);
  }, []);

  /** A finger landed on the parked delivery truck -- a second door to the
   *  same Town Contracts sheet `onWorldSignpostTap` opens, not a different
   *  feature. The truck only exists in the scene at all while a contract is
   *  open (see `setTruckPresent` below), so tapping it can only ever mean
   *  "I'm here for the order," the exact same intent as walking up to the
   *  signpost. */
  const onWorldTruckTap = useCallback(() => {
    setRadial(null);
    panelSound();
    setShowContracts(true);
  }, []);

  /** A finger landed on the windmill, the Workshop's entryway. Same shape
   *  as `onWorldBarnTap`. */
  const onWorldWorkshopTap = useCallback(() => {
    setRadial(null);
    panelSound();
    setShowWorkshop(true);
  }, []);

  /** Fills the watering can. Tapping the yard's well does this, and so does
   *  the ring on a well the player dug. */
  const onWorldWellTap = useCallback(
    (at: TapPoint) => {
      setRadial(null);
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

  /** A finger landed on the dock. Floats the rod for a cast -- unless one is
   *  already out, in which case the tap does nothing rather than stacking a
   *  second line on top of the first. */
  const onWorldDockTap = useCallback(
    (at: TapPoint) => {
      setRadial(null);
      if (fishingOffer) return;
      const targetAt = world.current?.fieldPointFor(FISHING_SPOT.x, FISHING_SPOT.y);
      if (!targetAt) return;
      panelSound();
      setFishingOffer({ key: `fish:${Date.now()}`, iconAt: offerIconAt(at), targetAt });
    },
    [fishingOffer, offerIconAt],
  );

  /** A cast landed a fish. The overlay plays its own splash; this sends the
   *  action and gives it a voice once the server confirms which fish. */
  const onFishCaught = useCallback(() => {
    tapAnchor.current = fishingOffer?.targetAt ?? null;
    void act({ action: "catch-fish" });
  }, [act, fishingOffer]);

  const closeFishingOffer = useCallback(() => setFishingOffer(null), []);

  /** A drag tool landed on its target. The overlay plays the pour or
   *  scatter itself; this sends the action and gives it a voice. */
  const onDragDrop = useCallback(() => {
    const offer = dragOffer;
    if (!offer) return;
    if (offer.kind === "water") {
      waterSound();
      world.current?.registerFrenzyTap(offer.unitId);
      // Deterministic (which crops in the block are still dry, clamped to
      // however much water is left) -- same posture `onPlaceSoilTile`/
      // `onMoveSoilTileGroup` already take toward their own toast, set here
      // rather than through `purchaseCueText` (water moves no Gold/shelf
      // stock, so that helper skips it).
      if (offer.unitIds && offer.unitIds.length > 1) {
        // Only ever less than the block when the can ran dry partway --
        // say so, rather than claiming the whole block got watered.
        const wateredCount = Math.min(offer.unitIds.length, water);
        if (wateredCount > 0) {
          const text =
            wateredCount === offer.unitIds.length
              ? `Watered ${wateredCount} crops!`
              : `Watered ${wateredCount} of ${offer.unitIds.length} crops. Can's empty.`;
          setLastCollect({ text, nonce: Date.now() });
        }
        void act({ action: "water", unitId: offer.unitId, unitIds: offer.unitIds });
        return;
      }
      void act({ action: "water", unitId: offer.unitId });
      return;
    }
    if (offer.kind === "feed-pen") {
      const resident = liveUnits.find((unit) => stockZone(unit.stock) === offer.zone);
      if (resident) feedSound(resident.stock);
      void act({ action: "feed-pen", zone: offer.zone });
      return;
    }
    const unit = liveUnits.find((candidate) => candidate.id === offer.unitId);
    if (unit) feedSound(unit.stock);
    void act({ action: "feed", unitId: offer.unitId });
  }, [act, dragOffer, liveUnits, water]);

  const closeDragOffer = useCallback(() => setDragOffer(null), []);

  /** A finger landed on the Midnight Merchant. Guarded on `isInteractive()`
   *  (true only in the steady `"present"` state, see
   *  lib/stackacres/midnight-merchant.ts) rather than trusting the scene's
   *  own gate alone -- the scene only calls this while its OWN
   *  `merchantNode` exists, which can be one tick ahead of or behind this
   *  component's render of `merchantSnapshot` by construction (the scene is
   *  pushed to via an effect, not read synchronously), so a tap arriving in
   *  that gap must not open a sheet for a visit already gone. */
  const onWorldMerchantTap = useCallback(() => {
    if (!merchantManager.current.isInteractive()) return;
    setRadial(null);
    panelSound();
    setShowMerchant(true);
  }, []);

  /**
   * A finger landed on the Greenhouse's own footprint, from outside it
   * (lib/stackacres/greenhouse.ts). Opens the same panel either way -- built
   * or not is what decides which of its two screens shows -- and, when it is
   * already built, also eases the camera inside it. An unbuilt Greenhouse has
   * no interior worth stepping into yet, so the camera stays put and the
   * panel's own build screen is the whole story.
   */
  const onWorldGreenhouseTap = useCallback(() => {
    setRadial(null);
    panelSound();
    setShowGreenhouse(true);
    if (greenhouseBuilt) world.current?.enterGreenhouse();
  }, [greenhouseBuilt]);

  /**
   * A finger landed on one of the Greenhouse's own six slots, while the scene
   * is already stepped inside it. The panel -- already open by the time this
   * can fire -- is the real interactive surface for a slot (same "a real DOM
   * row does what the tap does" split every other structure on this map
   * already takes; see stackacres-world.tsx's own header); this only
   * guarantees it is showing.
   */
  const onWorldGreenhouseSlotTap = useCallback(() => {
    setShowGreenhouse(true);
  }, []);

  /** Steps back to the open world and closes the panel, in that order --
   *  the same "sound, then close" shape `onWorldBarnTap`'s own modal takes
   *  on the way out (see its `onClose` below). A no-op camera-wise if the
   *  Greenhouse was never built and the camera never stepped inside. */
  const closeGreenhouse = useCallback(() => {
    panelSound();
    setShowGreenhouse(false);
    world.current?.exitGreenhouse();
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
      void act({ action: "collect", unitIds: [unitId] });
    },
    [act],
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
      setRadial(null);
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
    setRadial(null);
    setPlace(zone);
    setClearing(zone);
  }, []);

  /** `onWorldLockedTap`'s own twin for the Crop Fields -- see
   *  StackAcresCropFieldsModal's own header. */
  const onWorldCropFieldsLockedTap = useCallback(() => {
    panelSound();
    setRadial(null);
    setCropFieldsModalOpen(true);
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

  /**
   * The Workshop's actions, adapted from `act`'s fixed `ContractActionResult`
   * shape the way `onBuyFromMerchant` below is: `lastProcessing` is where the
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
  const onSowWheat = useCallback(() => workshopAct({ action: "sow-wheat" }), [workshopAct]);
  const onPlaceMachine = useCallback(
    (kind: MachineKind) => workshopAct({ action: "place-machine", kind }),
    [workshopAct],
  );
  const onProcessRecipe = useCallback(
    (recipe: RecipeId) => workshopAct({ action: "process", recipe }),
    [workshopAct],
  );
  const onWork = useCallback(() => workshopAct({ action: "work" }), [workshopAct]);
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
   * The Merchant's own purchase, adapted from `act`'s fixed
   * `ContractActionResult` shape to `MidnightMerchantPurchaseResult` --
   * see `lastMerchantPurchase`'s own doc comment for why the price paid
   * has to travel by that sidecar rather than through `act`'s return value
   * directly. A refusal's message is passed straight through unchanged:
   * this component never rewords a reason the server already gave in
   * plain language (see buyFromMidnightMerchant's own three refusal
   * messages).
   */
  const onBuyFromMerchant = useCallback(
    async (itemId: MidnightMerchantItemId): Promise<MidnightMerchantPurchaseResult> => {
      const result = await act({ action: "midnight-merchant-buy", itemId });
      if (!result.ok) return { ok: false, message: result.message };
      return { ok: true, pricePaid: lastMerchantPurchase.current?.pricePaid ?? 0 };
    },
    [act],
  );

  /**
   * The Prestige Reset Valve's own request, adapted from `act`'s fixed
   * `ContractActionResult` shape to `StackAcresPrestigeActionResult` for the
   * same reason `onBuyFromMerchant` above does -- `lastPrestigeReset` is
   * where the extra field (what THIS reset just bought) lands.
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
   *  shape is already exactly `ForgeActionResult` -- there is no extra
   *  field to adapt out of a sidecar the way `onPrestigeReset`/
   *  `onBuyFromMerchant` need, since `forge` above already carries the
   *  resulting owned-list on the same response. */
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

  const onClearSector = useCallback(
    (sector: SectorId) => {
      buySound();
      setClearing(null);
      void act({ action: "clear-sector", sector });
    },
    [act],
  );

  const onUnlockCropFields = useCallback(() => {
    buySound();
    setCropFieldsModalOpen(false);
    void act({ action: "unlock-crop-fields" });
  }, [act]);

  /** Seeding straight out of the radial menu. Closes first: the menu's
   *  prices are about to move under it, and a second tap on a stale one
   *  would be a purchase the player did not read.
   *
   *  Carries the tile the player actually tapped, when there's a bed to name
   *  -- `radialSoilTile` is only non-null inside a real bed, which is the
   *  one difference from `onSeed` below: that control has no tap to point
   *  at, so it always plants on the lowest free slot, same as ever. */
  const onRadialSeed = useCallback(
    (stock: StackAcresStock) => {
      const at = radial?.at ?? null;
      const tile = radialSoilTile ? { tx: radialSoilTile.tx, ty: radialSoilTile.ty } : null;
      setRadial(null);
      // The same seed going into the same ground as `onSeed`; the only
      // difference is which control asked for it.
      sowSound();
      tapAnchor.current = at;
      // If this exact bed was just tilled and that request has not answered
      // yet, wait for it -- see `pendingSoilPlacements`'s own header. Ignored
      // either way: a refusal there just leaves this tile without a bed,
      // which `assignSoilSlot` already handles by falling through to the
      // lowest free slot, same as it always has.
      const pending = tile ? pendingSoilPlacements.current.get(`${tile.tx},${tile.ty}`) : null;
      const send = () => act({ action: "stock", stock, ...(tile ? { tx: tile.tx, ty: tile.ty } : {}) });
      void (pending ? pending.catch(() => null).then(send) : send());
    },
    [act, radial, radialSoilTile],
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
    (tx: number, ty: number, tier: SoilTier = SOIL_DEFAULT_TIER) => {
      buySound();
      setRadial(null);
      setLastCollect({ text: "Staking out the bed…", nonce: Date.now() });
      // The tier names WHICH bed; the server reads its price from
      // SOIL_TIER_DEFS, so nothing here has to send (or can lie about) a cost.
      const key = `${tx},${ty}`;
      const request = act({ action: "place-soil-tile", tx, ty, tier });
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
      setRadial(null);
      setLastCollect({ text: "Clearing the bed…", nonce: Date.now() });
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
  const onMoveSoilTileGroup = useCallback(
    (tx: number, ty: number, toTx: number, toTy: number) => {
      buySound();
      setLastCollect({ text: "Shifting the bed…", nonce: Date.now() });
      void act({ action: "move-soil-tile-group", tx, ty, toTx, toTy });
    },
    [act],
  );

  /** Placing a well or a length of pipe straight out of the radial ring.
   *  Unlike `onPlaceSoilTile` above, this one DOES get an optimistic guess --
   *  see optimistic-actions.ts's own `place-pipe` case -- so the tile appears
   *  the instant this fires; the toast is flavour on top of that, not a
   *  stand-in for the missing picture it used to be. */
  const onPlacePipe = useCallback(
    (tx: number, ty: number, kind: PipeKind) => {
      buySound();
      setRadial(null);
      setLastCollect({ text: kind === "well" ? "Digging the well…" : "Laying pipe…", nonce: Date.now() });
      void act({ action: "place-pipe", tx, ty, kind });
    },
    [act],
  );

  /** Removing a placed tile. Same shape as `onRemoveSoilTile` above -- not a
   *  refund, a spent sink lifted for the room back -- but, like `onPlacePipe`
   *  above, WITH an optimistic guess now (see optimistic-actions.ts). */
  const onRemovePipe = useCallback(
    (tx: number, ty: number) => {
      buySound();
      setRadial(null);
      setLastCollect({ text: "Pulling the pipe…", nonce: Date.now() });
      void act({ action: "remove-pipe", tx, ty });
    },
    [act],
  );

  /** Pointing a lone stub from the aim popover. No Gold and no toast: the
   *  stub turns on the tap (optimistic-actions.ts's `aim-pipe` case) and
   *  that IS the feedback, the same posture the drag tools take. */
  const onAimPipe = useCallback(
    (tx: number, ty: number, facing: PipeFacing) => {
      panelSound();
      setPipeAim(null);
      void act({ action: "aim-pipe", tx, ty, facing });
    },
    [act],
  );

  /** The ring's own way through to the deep end -- the same drawer the peg on
   *  the right edge opens, reached without having to go and find the peg. */
  const openPanel = useCallback(() => {
    panelSound();
    setRadial(null);
    setPanelOpen(true);
  }, []);

  const districtUnits = useMemo(
    () => liveUnits.filter((unit) => stockZone(unit.stock) === place),
    [liveUnits, place],
  );

  /**
   * The soundscape follows the player: which district they travelled to, and
   * what hour it is. `timeOfDay` is the music's own, so the two layers can
   * never disagree about whether it is night.
   *
   * Re-read on a slow interval rather than derived from `nowMs`: that clock
   * only ticks while something is growing, so a farm sitting idle across 6pm
   * would keep its daylight birds until the player did something.
   */
  const [tod, setTod] = useState(() => timeOfDay());
  useEffect(() => {
    const timer = window.setInterval(() => setTod(timeOfDay()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setAmbiencePlace(place, tod);
  }, [place, tod]);
  // Wildlife Ecosystem & Nighttime Predator Defense reads the SAME `tod`
  // ambience already computes, rather than polling `timeOfDay()` a second
  // time -- see wildlife.ts's own header for why the two must never be
  // able to disagree about whether it is night.
  useEffect(() => {
    world.current?.setWildlifeTimeOfDay(tod);
  }, [tod]);

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
  const buyOptions: BuyOption[] = useMemo(
    () => buyOptionsForZone(place, { units: liveUnits, gold, capacity }),
    [place, liveUnits, gold, capacity],
  );

  // Once there is a second cutter to swap to, say where the swap is.
  const toolHint =
    tool === "scythe" && cutters.length > 1
      ? `${STACKACRES_TOOL_DEFS.scythe.hint} Pick the Scythe or the Mower beside the key.`
      : STACKACRES_TOOL_DEFS[tool].hint;

  /** Produce in the barn, in catalogue order so the list never reshuffles. */
  /** Everything standing ready right now. The Harvest key's whole subject. */
  const readyUnits = useMemo(
    () => liveUnits.filter((unit) => unit.state === "ready"),
    [liveUnits],
  );
  const carrying = readyUnits.length;
  // The Workshop's "something is ready" dot lived on the deleted places list
  // (`workshopAttention`, lib/stackacres/workshop.ts). If it comes back, it
  // belongs on the windmill sprite as a glow.

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

  const exchangeLeft = exchange.ceiling > 0 ? exchange.remaining / exchange.ceiling : 0;
  // The farm has paid out everything it can today. `< 1`, not `<= 0`, because a
  // sub-Gold remainder settles no harvest either -- every yield is whole Gold.
  // Drives the standing notice below, the feedback that was missing: the
  // allowance meter only lived in the supply-store sheet.
  const dayCapped = exchange.remaining < 1;
  const capResetLabel = countdownLabel(Date.parse(exchange.resetsAt) - nowMs);

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
      <main className="game-shell orientation-gate-shell">
        <div className="orientation-gate" role="status" aria-live="polite">
          <span className="orientation-gate-mark"><StackChipsMark size={44} /></span>
          <h1>Turn your phone sideways</h1>
          {/* Was "The StackAcres is available in landscape mode", a leftover
              from the homestead -> StackAcres rename reading straight through
              the old "The Homestead". */}
          <p>StackAcres only opens in landscape.</p>
          <small>Rotate your device to keep farming.</small>
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
    return <StackAcresPlayScreen onStart={() => setHasStarted(true)} />;
  }

  // Was `busy ? "Working…" : toolHint` -- every action now pops and applies
  // its guess the instant a finger lands (see the optimistic layer in
  // `act`), so a caption saying the farm is still thinking about a tap it
  // already answered would be a lie. The buttons below gate on their OWN
  // in-flight intent, not a screen-wide flag.
  const hint = toolHint;
  const district = STACKACRES_ZONES[place];
  const placeLocked = !isSectorUnlocked(place, sectors);

  /**
   * The Crop Fields' own gel dock, Crop-Fields-only the same way
   * `soilExtraActions` used to be -- every other zone's ground tap still
   * gets `StackAcresRadialMenu` and `pipeExtraActions` below, untouched.
   * Checked in this fixed order, since a tile is never more than one of
   * these three at once:
   *
   * 1. A pipe or well already standing here -- management tokens (Aim, Draw
   *    Water, Remove), the same items `pipeExtraActions`'s own "existing"
   *    branch computes, just reshaped for `onCommit` instead of `onSelect`.
   * 2. A bed already standing here -- owned seed tokens to plant, plus
   *    Remove Bed (armed/confirm, via `radial.armedRemoveBed`, unchanged).
   * 3. Bare ground -- the root Lay Pipe/Plant Soil choice, or whichever
   *    branch's own follow-on `radial.gelStep` says is showing (soil tiers;
   *    or Pipe vs. Well, only reachable when no well exists yet).
   */
  const cropFieldGelItems: StackAcresGelDockItem[] = (() => {
    if (!radial || !radialInCropFieldBeds) return [];
    const { tx, ty } = soilTileAt(radial.world.x, radial.world.y);
    const { tx: ptx, ty: pty } = pipeTileAt(radial.world.x, radial.world.y);
    const at = radial.at;

    const existingPipe = irrigation.find((node) => node.tx === ptx && node.ty === pty);
    if (existingPipe) {
      return [
        ...(existingPipe.kind === "pipe" && existingPipe.mask === 0
          ? [
              {
                key: "aim-pipe",
                label: "Aim Pipe",
                icon: "ico-pipe" as PainterName,
                onCommit: () => {
                  closeRadial();
                  setPipeAim({ tx: ptx, ty: pty, at });
                },
              },
            ]
          : []),
        ...(existingPipe.kind === "well"
          ? [
              {
                key: "draw-water",
                label: "Draw Water",
                icon: "ico-water" as PainterName,
                disabledReason: water >= WATER_CAPACITY ? "Your can is already full" : undefined,
                onCommit: () => onWorldWellTap(at),
              },
            ]
          : []),
        {
          key: "remove-pipe",
          label: existingPipe.kind === "well" ? "Remove Well" : "Remove Pipe",
          icon: "ico-clear" as PainterName,
          onCommit: () => onRemovePipe(ptx, pty),
        },
      ];
    }

    if (radialSoilTile) {
      const crop = cropOnTile(tx, ty);
      const armed = radial.armedRemoveBed?.tx === tx && radial.armedRemoveBed?.ty === ty;
      if (crop && armed) {
        return [
          {
            key: "remove-bed-confirm",
            label: `Confirm -- lose the ${STACKACRES_CATALOGUE[crop.stock].label}`,
            icon: "ico-clear",
            onCommit: () => onRemoveSoilTile(tx, ty),
          },
          {
            key: "remove-bed-cancel",
            label: "Keep the bed",
            icon: "ico-plant",
            keepOpen: true,
            onCommit: () => setRadial({ ...radial, armedRemoveBed: undefined }),
          },
        ];
      }
      // `seedStock` is keyed by crop only -- `heldSeed` is the same guard the
      // old seed strip used to keep a livestock stock (never in this list to
      // begin with, but the type is the broader StackAcresStock) from ever
      // reaching an unsafe index into it.
      const heldSeed = (stock: StackAcresStock): number => (isStackAcresCrop(stock) ? seedStock[stock] ?? 0 : 0);
      const seedItems: StackAcresGelDockItem[] = buyOptionsForZone(radial.zone, {
        units: liveUnits,
        gold,
        capacity,
      })
        .filter((option) => heldSeed(option.stock) > 0)
        .map((option) => ({
          key: option.stock,
          label: option.label,
          icon: STOCK_ICON[option.stock],
          qty: heldSeed(option.stock),
          disabledReason: option.atCap ? `${option.owned}/${option.cap} full` : undefined,
          onCommit: () => onRadialSeed(option.stock),
        }));
      return [
        ...seedItems,
        {
          key: "remove-bed",
          label: crop ? "Remove Bed…" : "Remove Bed",
          icon: "ico-clear" as PainterName,
          keepOpen: Boolean(crop),
          onCommit: crop
            ? () => setRadial({ ...radial, armedRemoveBed: { tx, ty } })
            : () => onRemoveSoilTile(tx, ty),
        },
      ];
    }

    // Bare ground: nothing stands here yet. `gelStep` is undefined until the
    // root choice fires once (see `radial`'s own doc), so it reads as root.
    const step = radial.gelStep ?? "root";
    if (step === "soil") {
      // ONE TOKEN PER TIER, generated from SOIL_TIER_DEFS rather than listed
      // here, so adding a tier to that table adds it here with no second
      // place to forget. NO `cost`: soil is paid for at Ray's shelf, so a
      // Gold price here would read as a second charge -- a tier with no bags
      // left is offered disabled instead, which is what points at the shop.
      return SOIL_TIERS.map((tier) => {
        const def = soilTierDef(tier);
        const held = soilStock[tier] ?? 0;
        return {
          key: `till-bed-${tier}`,
          label: def.label,
          icon: "ico-plant" as PainterName,
          qty: held,
          disabledReason: held > 0 ? undefined : "None in the barn — buy from Ray",
          onCommit: () => onPlaceSoilTile(tx, ty, tier),
        };
      });
    }
    const lone = !PIPE_NEIGHBORS.some((n) =>
      irrigation.some((node) => node.tx === ptx + n.tx && node.ty === pty + n.ty),
    );
    if (step === "pipe") {
      return [
        {
          key: "place-pipe",
          label: "Lay Pipe",
          icon: "ico-pipe",
          cost: PIPE_PLACE_COST.pipe,
          disabledReason: gold >= PIPE_PLACE_COST.pipe ? undefined : "Not enough Gold",
          onCommit: () => {
            onPlacePipe(ptx, pty, "pipe");
            if (lone) setPipeAim({ tx: ptx, ty: pty, at });
          },
        },
        {
          key: "place-well",
          label: "Dig a Well",
          icon: "ico-plant",
          cost: PIPE_PLACE_COST.well,
          disabledReason: gold >= PIPE_PLACE_COST.well ? undefined : "Not enough Gold",
          onCommit: () => onPlacePipe(ptx, pty, "well"),
        },
      ];
    }
    const hasWell = irrigation.some((node) => node.kind === "well");
    return [
      {
        key: "choose-pipe",
        label: "Lay Pipe",
        icon: "ico-pipe",
        disabledReason: hasWell && gold < PIPE_PLACE_COST.pipe ? "Not enough Gold" : undefined,
        // A well already down leaves nothing to choose (a second well is
        // never offered), so this branch fires straight away instead of
        // opening a one-item follow-on -- same posture the old ring took.
        keepOpen: !hasWell,
        onCommit: () => {
          if (hasWell) {
            onPlacePipe(ptx, pty, "pipe");
            if (lone) setPipeAim({ tx: ptx, ty: pty, at });
            return;
          }
          setRadial({ ...radial, gelStep: "pipe" });
        },
      },
      {
        key: "choose-soil",
        label: "Plant Soil",
        icon: "ico-plant",
        keepOpen: true,
        onCommit: () => setRadial({ ...radial, gelStep: "soil" }),
      },
    ];
  })();

  /**
   * The irrigation ring's own extra buttons -- offered in EVERY district,
   * unlike `cropFieldGelItems` above (a Crop Fields-only concept): the pipe
   * lattice is farm-wide (lib/stackacres/irrigation.ts's own header), so a
   * tap anywhere has a tile under it worth offering. `irrigation` is the
   * same array the scene was just handed, so "is there a pipe here" never
   * disagrees with what is actually painted.
   */
  const pipeExtraActions = (() => {
    if (!radial) return [];
    // No pipe and no well inside a pen -- Henhaven, Oxfields and Wallow are
    // grow areas the same as any district, so the ground tap that opens this
    // ring fires there too, but irrigation belongs to the Crop Fields and the
    // open farm, not inside a hen/ox/hog enclosure. The server holds this
    // rule too (stackacres-service.ts's `placeStackAcresPipeTile`), so this
    // is the polish half: hiding the offer rather than making the player
    // choose it and get refused.
    if (PEN_ZONE_IDS.includes(radial.zone)) return [];
    const { tx, ty } = pipeTileAt(radial.world.x, radial.world.y);
    const at = radial.at;
    const existing = irrigation.find((node) => node.tx === tx && node.ty === ty);
    if (existing) {
      return [
        // A lone stub can be pointed (irrigation.ts's `PipeFacing`); a joined
        // one has real arms and nothing to aim, and a well never does.
        ...(existing.kind === "pipe" && existing.mask === 0
          ? [
              {
                key: "aim-pipe",
                label: "Aim Pipe",
                icon: "ico-pipe" as PainterName,
                onSelect: () => {
                  closeRadial();
                  setPipeAim({ tx, ty, at });
                },
              },
            ]
          : []),
        ...(existing.kind === "well"
          ? [
              {
                key: "draw-water",
                label: "Draw Water",
                icon: "ico-water" as PainterName,
                disabledReason: water >= WATER_CAPACITY ? "Your can is already full" : undefined,
                onSelect: () => onWorldWellTap(at),
              },
            ]
          : []),
        {
          key: "remove-pipe",
          label: existing.kind === "well" ? "Remove Well" : "Remove Pipe",
          icon: "ico-clear" as PainterName,
          onSelect: () => onRemovePipe(tx, ty),
        },
      ];
    }
    const hasWell = irrigation.some((node) => node.kind === "well");
    // Whether the tile about to be laid will stand alone. Decided from the
    // farm as it is right now, which is the same picture the optimistic
    // `place-pipe` guess draws from -- a lone stub gets the aim offered
    // straight away, a tile joining a run has arms already and needs none.
    const lone = !PIPE_NEIGHBORS.some((step) =>
      irrigation.some((node) => node.tx === tx + step.tx && node.ty === ty + step.ty),
    );
    return [
      {
        key: "place-pipe",
        label: "Lay Pipe",
        icon: "ico-plant" as PainterName,
        cost: PIPE_PLACE_COST.pipe,
        disabledReason: gold >= PIPE_PLACE_COST.pipe ? undefined : "Not enough Gold",
        onSelect: () => {
          onPlacePipe(tx, ty, "pipe");
          if (lone) setPipeAim({ tx, ty, at });
        },
      },
      {
        key: "place-well",
        label: "Dig a Well",
        icon: "ico-plant" as PainterName,
        cost: PIPE_PLACE_COST.well,
        disabledReason: hasWell
          ? "This farm already has a well"
          : gold >= PIPE_PLACE_COST.well
            ? undefined
            : "Not enough Gold",
        onSelect: () => onPlacePipe(tx, ty, "well"),
      },
    ];
  })();

  // Everything in .sa-hud besides Gold and the upkeep-owed pill -- see the
  // header's own comment for why this is one fragment referenced from either
  // the inline row (desktop/tablet landscape) or StackAcresHudOverflow's
  // drawer (compactNav), never both.
  const secondaryHud = (
    <>
      <span className="sa-feed" title="Feed servings">
        <StackAcresIcon name="ico-feed" size={16} />
        <strong>{feed}</strong>
        <span className="sa-sr">feed servings</span>
      </span>
      <span
        className={clsx("sa-feed sa-water", { "is-empty": water < 1 })}
        title="Water in your can. Fill it at the well."
      >
        <StackAcresIcon name="ico-water" size={16} />
        <strong>{water}</strong>
        <span className="sa-sr">of {WATER_CAPACITY} water in your can</span>
      </span>
      <SynergyOverlay
        unlocked={synergyUnlocked}
        active={synergyActive}
        busy={pendingByPrefix("unlock-synergy-perk") || pendingByPrefix("activate-synergy-perk")}
        onUnlock={onUnlockSynergyPerk}
        onActivate={onActivateSynergyPerk}
      />
      {/* The Prestige Reset Valve's own entry point -- a standing badge
          rather than a buried menu item, since the multiplier it shows is
          worth seeing at a glance every session, not only when a player
          goes looking for the valve itself. */}
      <button
        type="button"
        className="sa-prestige-badge"
        onClick={() => { panelSound(); setShowPrestige(true); }}
        title="Prestige Reset Valve"
      >
        <RotateCcw size={13} aria-hidden="true" />
        <strong>{prestige.multiplier.toFixed(4)}x</strong>
      </button>
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
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
          <button type="button" className="htp-trigger" onClick={() => { panelSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
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
              title={`Land maintenance on ${upkeep.plots} plots. Comes out of your next harvest.`}
            >
              <StackAcresIcon name="ico-gold" size={16} />
              <strong>-{upkeep.due.toLocaleString()}</strong>
              <span className="sa-sr">Gold of land maintenance due</span>
            </span>
          )}
          <span className="gold-balance floor-wallet" title="Gold">
            <Coins size={13} aria-hidden="true" />
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
        {/* `data-drawer` is read by 52-stackacres.css so the signpost rail can
            give up the drawer's column while it is open -- five signs do not
            fit beside a 320px drawer on a phone, and the one that fell off the
            end was Ray's, which is the only way into the store. */}
        <div ref={fieldRef} className="sa-field" data-drawer={panelOpen ? "open" : "shut"}>
          {loaded && (
            <StackAcresWorld
              units={liveUnits}
              tool={tool}
              cutter={cutter}
              museumGlowTier={museumGlowTier}
              farmhandSpeedMultiplier={farmhandSpeedMultiplier}
              viewExpansion={compactNav ? HUD_VIEW_EXPANSION : 1}
              secretSetComplete={secretSetComplete}
              celebrate={celebrate}
              onReady={onWorldReady}
              onUnitTap={onWorldUnitTap}
              onUnitSelect={onWorldUnitSelect}
              onGroundTap={onWorldGroundTap}
              onSoilMoveCommitted={onMoveSoilTileGroup}
              onBarnTap={onWorldBarnTap}
              onSignpostTap={onWorldSignpostTap}
              onWorkshopTap={onWorldWorkshopTap}
              onWellTap={onWorldWellTap}
              onDockTap={onWorldDockTap}
              onGreenhouseTap={onWorldGreenhouseTap}
              onGreenhouseSlotTap={onWorldGreenhouseSlotTap}
              onMerchantTap={onWorldMerchantTap}
              onTruckTap={onWorldTruckTap}
              onMonkTap={onWorldMonkTap}
              onRayTap={onWorldRayTap}
              onVisitorTap={onWorldVisitorTap}
              onSecretZoneTap={onWorldSecretZoneTap}
              onFenceSegmentTap={onWorldFenceSegmentTap}
              sectors={sectors}
              cropFieldsUnlocked={cropFieldsUnlocked}
              onLockedSectorTap={onWorldLockedTap}
              onCropFieldsLockedTap={onWorldCropFieldsLockedTap}
              onViewMoved={onViewMoved}
              soilTiles={mergedSoilTiles}
              irrigation={irrigation}
              onDroneForageCollected={onDroneForageCollected}
              api={world}
            />
          )}
          {bootPhase !== "hidden" && (
            <div className={clsx("sa-loading", bootPhase === "hiding" && "sa-loading-hiding")}>
              <StackAcresLogo className="sa-loading-logo" aria-hidden="true" />
            </div>
          )}

          {/* The seed menu's dismissal layer, and its position in this file is
              the whole design: it covers the map but sits EARLIER than the
              toolbelt and the signpost, which are positioned siblings with no
              z-index of their own and therefore stack above it. So the next
              tap on the world closes the menu
              and the chrome stays live while it is open -- and, since this
              is a real DOM button the canvas underneath never sees the tap,
              `onRadialScrimTap` replays that same click against the scene
              once the menu is gone, so a tap on a different patch switches
              straight to it instead of taking a second tap to land. */}
          {radial && (
            <button
              type="button"
              className="sa-radial-scrim"
              aria-label="Close the seed menu"
              onClick={onRadialScrimTap}
            />
          )}

          {/* The masthead pill (logo, and before that the pen/field counts) that
              used to sit here is gone -- the signpost below is what a player
              actually reads on this screen, and it now takes the band this
              freed up. The page still needs its own heading for the a11y
              tree, just with no visual footprint to reclaim the space for. */}
          <h1 className="sr-only">StackAcres</h1>

          {lastCollect && (
            <p key={lastCollect.nonce} className="sa-toast" role="status">
              {lastCollect.text}
            </p>
          )}

          {/* The tool dock and the places list are gone. Tapping the world
              offers what it needs right there, and Shop, Blueprints, Town
              Board and Workshop are walked up to (Ray, the signpost, the
              windmill). Mow, Pipe and Soil keep three small keys because a
              drag-a-run gesture has nothing to tap first. */}
          <StackAcresGroundTools
            tool={tool}
            onPick={pickGroundTool}
            cutters={cutters}
            cutter={cutter}
            onPickCutter={pickCutter}
          />

          {/* The seed menu, on the canvas next to the finger that asked for
              it, inside .sa-field so its coordinates are the ones the scene
              reported the tap in. Zoom/recentre used to be two buttons here;
              they're gone (pinch and mouse-wheel already cover zoom, see
              bindInput's onWheel), and there is nothing left to stack over. */}
          {/* The Crop Fields get the gel dock (stackacres-gel-dock.tsx):
              anchored at the tap rather than a screen edge, and every token
              in it has to be DRAGGED into the circle pinned on the tapped
              tile, same physical gesture water/feed already use. Every other
              zone still gets the plain tap-to-fire ring: three livestock
              kinds fit its fixed arc fine, and livestock has no seed shelf or
              pipe/soil concept to drag in from (see SeedStock's own doc
              comment). Gated on `radialInCropFieldBeds`, not
              `radial.zone === "farmstead"` alone: since the 2026-09-08
              district merge the Farmstead is also the yard, and a tap on ITS
              own grow area (the Hen Coop remnant, which holds no stock) is
              not a seed tap. */}
          {radial && radialInCropFieldBeds && (
            <StackAcresGelDock
              at={radial.at}
              items={cropFieldGelItems}
              label={`${STACKACRES_ZONES[radial.zone].label.replace(/^The /, "")}`}
              busy={
                pendingByPrefix("stock") ||
                pendingByPrefix("place-soil-tile") ||
                pendingByPrefix("remove-soil-tile") ||
                pendingByPrefix("place-pipe") ||
                pendingByPrefix("remove-pipe") ||
                pendingByPrefix("aim-pipe") ||
                pendingByPrefix("draw-water")
              }
              onClose={closeRadial}
              onManage={openPanel}
            />
          )}
          {radial && !radialInCropFieldBeds && (
            <StackAcresRadialMenu
              at={radial.at}
              // `buyOptionsForZone` is zone-keyed, not bed-aware, so for the
              // Farmstead it still returns all 22 crops even out here on the
              // yard -- the ring's fixed arc has no room for that (see
              // stackacres-gel-dock.tsx's own header) and it has nowhere to
              // plant them anyway (a crop needs a bed, and beds only exist
              // inside `radialInCropFieldBeds`). Crops are dropped here for
              // the same reason the gel dock above is the only place they
              // ever appear.
              options={buyOptionsForZone(radial.zone, { units: liveUnits, gold, capacity }).filter(
                (option) => !isStackAcresCrop(option.stock),
              )}
              districtLabel={STACKACRES_ZONES[radial.zone].label}
              busy={
                pendingByPrefix("stock") ||
                pendingByPrefix("place-pipe") ||
                pendingByPrefix("remove-pipe")
              }
              onSeed={onRadialSeed}
              onClose={closeRadial}
              onManage={openPanel}
              extraActions={pipeExtraActions}
            />
          )}

          {/* The four-way aim for a lone pipe stub -- opened by the ring's
              own "Lay Pipe"/"Aim Pipe" above, never by a bare tap. Gated on
              `pipeAimNode` too, not just `pipeAim`: the effect beside
              `radialSoilWorld` clears the state a render after the stub
              joins or goes, and this keeps that one frame from showing an
              aim for a tile that no longer wants one. */}
          {pipeAim && pipeAimNode && !pipeAimStale && (
            <StackAcresPipeAim
              at={pipeAim.at}
              facing={pipeAimNode.facing}
              busy={pendingByPrefix("aim-pipe")}
              onAim={(facing) => onAimPipe(pipeAim.tx, pipeAim.ty, facing)}
              onClose={() => setPipeAim(null)}
            />
          )}

          {/* The drag tool, floating next to whatever was tapped. */}
          {dragOffer && (
            <StackAcresDragAffordance
              key={dragOffer.key}
              kind={dragOffer.kind === "water" ? "water" : "feed"}
              iconAt={dragOffer.iconAt}
              targetAt={dragOffer.targetAt}
              hint={
                dragOffer.kind === "water"
                  ? dragOffer.unitIds && dragOffer.unitIds.length > 1
                    ? `Drop to water all ${dragOffer.unitIds.length}`
                    : "Drag onto the soil"
                  : dragOffer.kind === "feed-pen"
                    ? "Drag into the trough"
                    : "Drag onto the animal"
              }
              onDrop={onDragDrop}
              onClose={closeDragOffer}
            />
          )}

          {/* The dock's own rod, mid-cast. */}
          {fishingOffer && (
            <StackAcresFishingAffordance
              key={fishingOffer.key}
              iconAt={fishingOffer.iconAt}
              targetAt={fishingOffer.targetAt}
              onCatch={onFishCaught}
              onClose={closeFishingOffer}
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

          {/* The fence-upgrade popup, same screen-anchored treatment as the
              seed menu and the monk dialogue above. */}
          {fencePopup && (
            <StackAcresFenceUpgradePopup
              at={fencePopup.at}
              zone={fencePopup.zone}
              segmentIndex={fencePopup.segmentIndex}
              tier={fencePopup.tier}
              durability={fencePopup.durability}
              busy={fenceUpgradeBusy}
              onUpgrade={onUpgradeFence}
              onClose={() => setFencePopup(null)}
            />
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
              onOpenShop={
                giftDialogue.npc === "ray"
                  ? () => {
                      panelSound();
                      setShowStore(true);
                    }
                  : undefined
              }
              onOpenBlueprints={
                giftDialogue.npc === "ray"
                  ? () => {
                      panelSound();
                      setShowBlueprints(true);
                    }
                  : undefined
              }
            />
          )}

          {/* One of the ten stranded visitors' greeting, same screen-anchored
              treatment as the Pixel Pilgrim's and the gift dialogue above. */}
          {visitorGreeting && (
            <StackAcresVisitorGreeting
              id={visitorGreeting.id}
              at={visitorGreeting.at}
              onClose={() => setVisitorGreeting(null)}
            />
          )}

          <p className={clsx("sa-tool-hint", { "is-busy": anyPending })} aria-live="polite">
            {hint}
          </p>

          <div className="sa-side">
            {error && <p className="duel-error" role="alert">{error}</p>}
          </div>

          {/* Bring the whole farm in at once.
              THIS IS THE ONLY CONTROL THAT CAN EARN A SYNERGY, and that is why
              it exists as its own affordance rather than being implied by
              tapping units one at a time: Bountiful Harvest is a property of
              what was gathered TOGETHER, so a farm collected a tap at a time
              earns nothing. It only appears when there is something to bring
              in -- a permanently-visible disabled key on a canvas is chrome a
              player learns to stop reading.

              Once the day is capped the key would only ever refuse, so it is
              swapped for the reason: the farm has paid out all it can today,
              the crops keep, and here is when it reopens. */}
          {carrying > 0 &&
            (dayCapped ? (
              <p className="sa-harvest-capped" role="status">
                <StackAcresIcon name="ico-gold" size={18} />
                <span>
                  Today&apos;s Gold is all sent out. {carrying}{" "}
                  {carrying === 1 ? "field keeps" : "fields keep"} growing — back in {capResetLabel}.
                </span>
              </p>
            ) : (
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
            ))}

          {/* The handle the panel hangs off when it is shut. Before this,
              the only way back into a district you had closed was to find
              its name in the signpost and travel there again -- which also
              flies the camera, so "let me look at that list again" cost you
              your view. It is a peg on the right edge, always there, always
              naming the district it will open, and it is the one piece of
              chrome that is deliberately louder than it needs to be: it is
              how a player learns the panel is a drawer rather than something
              that happens to them. */}
          <button
            type="button"
            className={clsx("sa-panel-tab", { "is-stowed": panelOpen })}
            aria-expanded={panelOpen}
            aria-controls="sa-district-panel"
            onClick={() => { panelSound(); setPanelOpen(true); }}
            tabIndex={panelOpen ? -1 : undefined}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span className="sa-panel-tab-label">{district.label.replace(/^The /, "")}</span>
          </button>

          {/* The district panel: deep management, not the way you play.
              The fast loop is on the canvas now -- tap a ripe crop to collect
              it, tap empty ground to seed it -- so this no longer opens itself
              when a player travels somewhere. The peg above is how it comes
              back, and it holds what a tap has no business doing: Gold spends,
              and the full standing list. That list is also the keyboard and
              screen-reader path to every canvas tap, which is why it is still
              here rather than deleted along with the loop it used to be. */}
          <aside
            id="sa-district-panel"
            className={clsx("sa-district-panel", { "is-open": panelOpen })}
            data-zone={place}
            aria-label={`${district.label} panel`}
            inert={!panelOpen}
          >
            <div className="sa-panel-head">
              <div className="sa-ray-row">
                <img src="/stackacres/sprites/grandfather-ray-portrait.png" alt="" className="sa-ray-portrait" />
                <span className="sa-ray-name">Grandfather Ray</span>
              </div>
              <button
                type="button"
                className="sa-panel-close"
                aria-label="Close panel"
                onClick={() => { panelSound(); setPanelOpen(false); }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <h2 className="sa-district-title">{district.label}</h2>
            <p className="sa-district-blurb">{district.blurb}</p>

            {/* A small, secondary section -- shown on every district, since a
                held secret item is not tied to any one of them -- for whatever
                Hidden secrets has turned up. Hidden entirely while nothing is
                held, so a player who never finds one never sees an empty
                backpack taking up room on this panel. */}
            {SECRET_ITEM_IDS.filter((itemId) => (secrets.held[itemId] ?? 0) > 0).map((itemId) => {
              const item = SECRET_ITEM_CATALOGUE[itemId];
              const held = secrets.held[itemId] ?? 0;
              return (
                <div className="sa-panel-section" key={itemId}>
                  <h3 className="sa-group-label">Hidden secrets</h3>
                  <p className="sa-panel-note">
                    {item.icon} {held} {held === 1 ? item.label : `${item.label}s`} -- {item.blurb}
                  </p>
                  <div className="sa-buy-actions">
                    <button
                      type="button"
                      className="sa-buy-btn"
                      disabled={isPending(`donate-secret-item:${itemId}`)}
                      onClick={() => onDonateSecretItem(itemId)}
                    >
                      <span className="sa-buy-label">Donate to Museum</span>
                    </button>
                    <button
                      type="button"
                      className="sa-buy-btn is-gold"
                      disabled={isPending(`consume-secret-item:${itemId}`) || secrets.boostArmed}
                      onClick={() => onConsumeSecretItem(itemId)}
                    >
                      <span className="sa-buy-label">
                        {secrets.boostArmed ? "A boost is already armed" : "Consume for a crit boost"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="sa-buy-btn is-expand"
                      disabled={isPending(`trade-secret-item:${itemId}`)}
                      onClick={() => onTradeSecretItem(itemId)}
                    >
                      <span className="sa-buy-label">Trade to Ray for Land Maintenance</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Wild land has no farm on it to manage, so the drawer offers
                the one thing that IS available there rather than a buy list
                for pens that do not exist and a standing list that is always
                empty. It is the same modal a tap on the trees opens -- there
                is exactly one way to buy land, reached from two places. */}
            {placeLocked ? (
              <div className="sa-panel-section">
                <h3 className="sa-group-label">Uncleared land</h3>
                <p className="sa-panel-note">{STACKACRES_SECTORS[place].promise}</p>
                <button
                  type="button"
                  className="sa-cta"
                  onClick={() => { panelSound(); setClearing(place); }}
                >
                  What would clearing it cost?
                </button>
              </div>
            ) : (
              <>
                {/* Buy comes first now. Seeding one cycle is the one thing on
                    this panel a tap on the map also does; buying outright and
                    expanding capacity are Gold, are permanent, and are the reason
                    to open this at all -- so they lead, rather than sitting under
                    a list of things you could have collected by touching them. */}
                <div className="sa-panel-section">
                  <h3 className="sa-group-label">Buy &amp; expand</h3>
                  <StackAcresBuySection
                    options={buyOptions}
                    isPending={isPending}
                    onSeed={onSeed}
                    onBuyOutright={onBuyOutright}
                    onExpand={onExpand}
                  />
                </div>

                <div className="sa-panel-section">
                  <h3 className="sa-group-label">What&apos;s here</h3>
                  <p className="sa-panel-note">
                    Tap anything on the map to collect, feed, water or clear it. These rows do the
                    same, and are how you retire something you own outright.
                  </p>
                  <StackAcresUnitRows
                    units={districtUnits}
                    nowMs={nowMs}
                    feed={feed}
                    gold={gold}
                    isPending={isPending}
                    armedUnitId={retiringUnitId}
                    onCollect={onCollect}
                    onFeed={onFeed}
                    onWater={onWater}
                    onClear={onClear}
                    onArmRetire={onArmRetire}
                    onConfirmRetire={onConfirmRetire}
                    onCancelRetire={onCancelRetire}
                  />
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      {showStore && (
        <div className="sa-sheet-scrim" role="dialog" aria-modal="true" aria-label="Supply store">
          <div className="sa-sheet">
            <header className="sa-sheet-head">
              <div>
                <div className="sa-ray-row">
                  <img src="/stackacres/sprites/grandfather-ray-portrait.png" alt="" className="sa-ray-portrait" />
                  <span className="sa-ray-name">Grandfather Ray</span>
                </div>
                <h2>Supply store</h2>
              </div>
              <button
                type="button"
                className="sa-sheet-close"
                onClick={() => { panelSound(); setShowStore(false); }}
              >
                Done
              </button>
            </header>

            {/* The page's own banner sits behind the scrim, so a refusal raised
                by a button in here has to be answered in here. */}
            {error && <p className="duel-error" role="alert">{error}</p>}

            {/* What the day has left comes first. It is the only number in
                here a player has to plan around: the farm can send out the
                same Gold whatever it owns, so a full bar is the reason to go
                and harvest and an empty one is the reason to stop. */}
            <StoreShelf icon="ico-gold">Today&apos;s allowance</StoreShelf>
            <div className="sa-exchange">
              <p className="sa-sheet-note">
                Bringing in a harvest pays Gold on the spot. Every farm can send out the same{" "}
                {exchange.ceiling.toLocaleString()} Gold a day, whatever it owns — more stock fills
                the day faster, it never makes the day bigger.
              </p>
              <p className="sa-exchange-meter">
                <span className="sa-exchange-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${exchangeLeft})` }} />
                </span>
                <span aria-live="polite">
                  <strong>{exchange.remaining.toLocaleString()}</strong> of{" "}
                  {exchange.ceiling.toLocaleString()} Gold left today
                </span>
              </p>
              {exchange.remaining < 1 && (
                <p className="sa-sheet-note">
                  That is everything this farm can send out today. Anything still standing keeps
                  until the day turns over, in {countdownLabel(Date.parse(exchange.resetsAt) - nowMs)}.
                </p>
              )}
            </div>

            <StoreShelf icon="ico-harvest">Land maintenance</StoreShelf>
            <p className="sa-sheet-note">
              Holding cleared land costs <strong>{upkeep.fee.toLocaleString()} Gold</strong> a day
              across {upkeep.plots} {upkeep.plots === 1 ? "plot" : "plots"}, and the first three are
              free. It comes out of what you harvest, never out of your balance, and it climbs
              faster than the land earns — a big estate keeps less of every extra plot than a small
              one does.
            </p>
            <p className="sa-sheet-note">
              {upkeep.due > 0 ? (
                <>
                  Today has <strong>{upkeep.due.toLocaleString()} Gold</strong> still to pay. Your
                  next harvest covers what it can.
                </>
              ) : (
                <>Today is paid up.</>
              )}
            </p>

            {/* Between feed and the exchange window on purpose. A tool is
                bought with GOLD, like the exchange below it, but it is a
                thing you own rather than money leaving the farm -- so it sits
                on the near side of that line. */}
            <StoreShelf icon="ico-scythe">Equipment</StoreShelf>
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
              // The ladder is walked one rung at a time and the SERVER decides
              // from what -- this only renders the next rung's price, so there
              // is no list of rungs here to get out of step with the server's
              // own idea of which one is next.
              const next = nextToolTier(toolTier);
              const listPrice = toolUpgradePrice(toolTier);
              if (!next || listPrice === null) {
                return (
                  <p className="sa-sheet-note">
                    You hold the finest tool on the farm. Nothing left to buy here.
                  </p>
                );
              }
              // Town Favor discount, read off the same Influence total the
              // server will charge against -- see influence-tiers.ts and
              // upgradeStackAcresTool's identical read server-side.
              const price = applyInfluenceDiscount(listPrice, influence);
              const def = stackacresToolTierDef(next);
              // `unlimitedGold` makes spendGold a no-op server-side, so a
              // profile carrying it can always afford this -- disabling the
              // button on their balance would be the client refusing a
              // purchase the server would have allowed.
              const affordable =
                (profile?.unlimitedGold ?? false) || (profile?.goldBalance ?? 0) >= price;
              // Unlimited Gold is a purse exemption, not a progression one:
              // the milestone gate is about what the farm has done, so it
              // applies to every account the same way.
              const lock = evaluateStackAcresShopLock(def, shopProgress);
              return (
                <div className="sa-stock-cards">
                  <div className={lock.isUnlocked ? "sa-stock-card" : "sa-stock-card is-locked"}>
                    <img src={def.sprite} alt="" className="sa-tool-art" width={72} height={72} />
                    <h3>{def.label}</h3>
                    <p className="sa-stock-terms">{def.blurb}</p>
                    {/* The price stays visible while locked, deliberately --
                        the sector modal shows its clearing cost to somebody
                        who does not qualify yet for the same reason: you
                        cannot decide to save up for a number you have never
                        been shown. */}
                    <p className="sa-stock-yield">
                      {price < listPrice ? (
                        <>
                          <span className="sa-stock-was">{listPrice.toLocaleString()}</span>{" "}
                          {price.toLocaleString()} Gold
                        </>
                      ) : (
                        `${price.toLocaleString()} Gold`
                      )}
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
              A better spade makes a harvest more likely to come up rich, and a rich harvest brings
              in extra produce on top.
            </p>

            {/* Grass cutters, kept apart from the spades so a spade never
                mows the meadow. An owned one gets a Use button, the same swap
                the picker beside the Mow key offers. */}
            <StoreShelf icon="ico-scythe">Mowing</StoreShelf>
            <div className="sa-stock-cards">
              {STACKACRES_CUTTERS.map((id) => {
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
                          {price < listPrice ? (
                            <>
                              <span className="sa-stock-was">{listPrice.toLocaleString()}</span>{" "}
                              {price.toLocaleString()} Gold
                            </>
                          ) : (
                            `${price.toLocaleString()} Gold`
                          )}
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

            <StoreShelf icon="ico-plant">Soil</StoreShelf>
            <p className="sa-sheet-note">
              Beds are laid in the Crop Fields, not here — buy the bags, then tap bare ground out
              there to lay one. A bed you take up is spent, so pick the spot before you dig.
            </p>
            <div className="sa-stock-cards">
              {SOIL_TIERS.map((tier) => {
                const def = soilTierDef(tier);
                const held = soilStock[tier] ?? 0;
                // Tier-blind by design (see farm-actions.ts's `intentOf`): one
                // soil purchase in flight, of any tier or size, holds every
                // tier's buttons here rather than just this one's.
                const pending = isPending("buy-soil");
                return (
                  <div key={tier} className="sa-stock-card">
                    <h3>{def.label}</h3>
                    <p className="sa-stock-terms">{def.blurb}</p>
                    <p className="sa-stock-yield">{def.price.toLocaleString()} Gold / bag</p>
                    <div className="sa-buy-qty-row">
                      {BULK_BUY_QUANTITIES.filter((quantity) => quantity <= SOIL_BAGS_PER_PURCHASE).map(
                        (quantity) => {
                          const cost = def.price * quantity;
                          return (
                            <button
                              key={quantity}
                              type="button"
                              className="sa-cta"
                              disabled={pending || gold < cost}
                              onClick={() => {
                                buySound();
                                void act({ action: "buy-soil", tier, quantity });
                              }}
                            >
                              <span>{quantity}x</span>
                              <span className="sa-buy-qty-cost">{cost.toLocaleString()}g</span>
                            </button>
                          );
                        },
                      )}
                    </div>
                    <p className="sa-sheet-note">
                      {held} in the barn
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Crops are out of the active scope this pass (lib/stackacres/
                scope.ts) -- the loop is Hens, the Wheat field and Cattle. The
                shelf stays reachable behind one disclosure rather than
                vanishing, so seed a player already bought is never stranded,
                but it no longer fills the store with 22 rows by default. */}
            <details className="sa-store-more">
              <summary>
                <StoreShelf icon="ico-carrot">More crops ({STACKACRES_CROPS.length})</StoreShelf>
              </summary>
              <p className="sa-sheet-note">
                Not part of the starter loop yet. Buy a few, then tap bare ground in the Long
                Meadow to plant.
              </p>
              <div className="sa-stock-cards">
                {STACKACRES_CROPS.map((crop) => {
                  const def = STACKACRES_CATALOGUE[crop];
                  const held = seedStock[crop] ?? 0;
                  const pending = isPending(`buy-seed:${crop}`);
                  return (
                    <div key={crop} className="sa-stock-card">
                      <h3>{def.label}</h3>
                      <p className="sa-stock-yield">{def.seedCost.toLocaleString()} Gold / seed</p>
                      <div className="sa-buy-qty-row">
                        {BULK_BUY_QUANTITIES.filter(
                          (quantity) => quantity <= STACKACRES_SEED_BAGS_PER_PURCHASE,
                        ).map((quantity) => {
                          const cost = def.seedCost * quantity;
                          return (
                            <button
                              key={quantity}
                              type="button"
                              className="sa-cta"
                              disabled={pending || gold < cost}
                              onClick={() => {
                                buySound();
                                void act({ action: "buy-seed", crop, quantity });
                              }}
                            >
                              <span>{quantity}x</span>
                              <span className="sa-buy-qty-cost">{cost.toLocaleString()}g</span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="sa-sheet-note">
                        {held} in the barn
                      </p>
                    </div>
                  );
                })}
              </div>
            </details>

            <StoreShelf icon="ico-feed">Feed</StoreShelf>
            <p className="sa-sheet-note">
              Animals eat. A hungry pen stops working until you feed it, so keep a shipment in the
              barn before you leave a Cattle Pen overnight.
            </p>
            <div className="sa-stock-cards">
              {/* Locked rows are shown greyed rather than dropped. A shelf
                  that silently shortens teaches nothing: the Bulk Shipment
                  going missing looks like a bug, whereas the Bulk Shipment
                  sitting there saying what it wants is the progression being
                  legible. (The wild-ground rule in sectors.ts is the opposite
                  and stays so -- that is about the WORLD, where a padlock
                  floating over a field would be nonsense; this is a shop.) */}
              {Object.entries(STACKACRES_FEED).map(([id, item]) => {
                const lock = evaluateStackAcresShopLock(item, shopProgress);
                // Town Favor discount -- same read as the tool tier card
                // above, and the same price upgradeStackAcresTool's sibling
                // buyStackAcresFeed will actually charge.
                const price = applyInfluenceDiscount(item.cost, influence);
                const pending = isPending(`buy-feed:${id}`);
                return (
                  <div key={id} className={lock.isUnlocked ? "sa-stock-card" : "sa-stock-card is-locked"}>
                    <h3>{item.label}</h3>
                    <p className="sa-stock-terms">{item.servings} servings</p>
                    <p className="sa-stock-yield">
                      {price < item.cost && (
                        <span className="sa-stock-was">{item.cost.toLocaleString()}</span>
                      )}{" "}
                      {price.toLocaleString()} Gold{" "}
                      <span>({Math.round(price / item.servings)} each)</span>
                    </p>
                    {lock.lockHint && (
                      <p className="sa-lock-hint" id={`sa-lock-hint-${id}`}>
                        <Lock size={13} aria-hidden="true" />
                        <span>{lock.lockHint}</span>
                      </p>
                    )}
                    {lock.isUnlocked ? (
                      <div className="sa-buy-qty-row">
                        {BULK_BUY_QUANTITIES.filter(
                          (quantity) => quantity <= STACKACRES_FEED_SHIPMENTS_PER_PURCHASE,
                        ).map((quantity) => {
                          const cost = price * quantity;
                          return (
                            <button
                              key={quantity}
                              type="button"
                              className="sa-cta"
                              disabled={pending || gold < cost}
                              onClick={() => {
                                buySound();
                                void act({ action: "buy-feed", itemId: id, quantity });
                              }}
                            >
                              <span>{quantity}x</span>
                              <span className="sa-buy-qty-cost">{cost.toLocaleString()}g</span>
                            </button>
                          );
                        })}
                      </div>
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
              You have <strong>{feed}</strong> {feed === 1 ? "serving" : "servings"} in the barn.
            </p>

            {/* Requirement's UI half: the hangar and its Gold, hangar-locked
                state, and cost were all live server-side already (see
                stackacres-drone-service.ts) with nothing on the sheet to tap
                -- this is that missing button. Locked shown greyed rather
                than hidden, same "the shelf says what it wants" rule the
                Feed rows above follow. */}
            <StoreShelf icon="ico-drone">Drone Hangar</StoreShelf>
            <p className="sa-sheet-note">
              A Mechanical Forage Drone patrols a district&apos;s outer edge on its own and vacuums
              up whatever forage it finds along the way. Deploying one is a standing purchase, not a
              single-use item — each drone you own keeps patrolling until you leave the farm.
            </p>
            <div className="sa-stock-cards">
              <div className={droneHangar.unlocked ? "sa-stock-card" : "sa-stock-card is-locked"}>
                <h3>Mechanical Forage Drone</h3>
                <p className="sa-stock-terms">
                  {droneHangar.drones.length > 0
                    ? `${droneHangar.drones.length} patrolling now`
                    : "None deployed yet"}
                </p>
                <p className="sa-stock-yield">{DRONE_DEPLOY_COST_GOLD.toLocaleString()} Gold</p>
                {!droneHangar.unlocked && (
                  <p className="sa-lock-hint" id="sa-lock-hint-drone">
                    <Lock size={13} aria-hidden="true" />
                    <span>Donate at least one item to every exhibit in Ray&apos;s Museum to unlock the hangar.</span>
                  </p>
                )}
                <button
                  type="button"
                  className="sa-cta"
                  disabled={
                    !droneHangar.unlocked ||
                    isPending("deploy-drone") ||
                    (!(profile?.unlimitedGold ?? false) && gold < DRONE_DEPLOY_COST_GOLD)
                  }
                  aria-describedby={!droneHangar.unlocked ? "sa-lock-hint-drone" : undefined}
                  onClick={() => { buySound(); void act({ action: "deploy-drone" }); }}
                >
                  {!droneHangar.unlocked
                    ? "Locked"
                    : (profile?.unlimitedGold ?? false) || gold >= DRONE_DEPLOY_COST_GOLD
                      ? "Deploy"
                      : "Not enough Gold"}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {showHelp && (
        <HowToPlayModal title="StackAcres" onClose={() => setShowHelp(false)}>
          <p>
            The farm is a map of four districts. Drag to look around, pinch or scroll to zoom, or
            tap a district&apos;s name to travel straight to it.
          </p>
          <p>
            <strong>Only the Farmstead is yours to begin with.</strong> The other three are wild
            ground — trees, scrub and long grass, with nothing built on them. Tap anywhere on one
            and it tells you what is under the growth, what clearing it costs in Gold, and what you
            still need before it is offered. Clearing is permanent.
          </p>
          <p>
            <strong>Everything is tapped on the map itself.</strong> Tap a crop or an animal to
            collect it when it is ready, feed it when it is hungry, water it when its soil has gone
            dry, or clear it when it comes up weather-worn. Tap the bare ground inside a district and a small menu opens right there
            to seed something new.
          </p>
          <p>
            The handle on the right edge opens that district&apos;s panel, which is where Gold buys
            stock outright and buys more room to keep at once. Close it and it folds back to the
            handle without moving the camera.
          </p>
          <p>
            <strong>Everything is paid in Gold, in one step.</strong> Bringing in a harvest works
            out what the produce is worth and puts the Gold straight in your balance — there is no
            second currency, no barn to empty and nothing to queue for. Gold also buys your seed,
            your feed, stock outright, more room to keep at once, and the wild districts you clear.
          </p>
          <p>
            Bringing several fields in <em>together</em> can earn a <strong>Bountiful Harvest</strong>.
            Three or more of the same kind is <strong>Mono-cropping</strong>; a balanced mix of
            things grown and things an animal made is <strong>Crop Rotation</strong>. Either
            multiplies what the whole harvest pays, so the Harvest key is worth more than tapping
            each field on its own.
          </p>
          <p>
            Every farm can send out the same {exchange.ceiling.toLocaleString()} Gold a day, whatever
            it owns — owning more reaches that sooner, it never gets more than that. Anything still
            standing keeps until tomorrow.
          </p>
          <ul>
            <li>Seed a crop or stock a pen with Gold, then come back when it turns gold.</li>
            <li>
              Animals need feeding and crops need watering. A hungry pen and a dry field both stop
              where they are until you tend them — a faded plant is one waiting for a drink.
            </li>
            <li>Nothing here can die and nothing can be lost. Neglect costs you time, not produce.</li>
            <li>
              Each kind of animal or crop can have three going at once, more if you spend Gold to
              expand it — one kind&apos;s room has nothing to do with any other&apos;s.
            </li>
            <li>
              Something finished sometimes comes up weather-worn and needs clearing, in Gold,
              before it frees its room again.
            </li>
            <li>
              Land you have cleared costs a daily maintenance fee that grows steeply the more room
              you keep, and the first three plots are free. It comes out of what you harvest and
              never out of your balance, so a big day can be worth nothing after the fee — but
              nothing you own is ever taken away.
            </li>
            <li>
              Buying outright with Gold is permanent: it starts its next run the moment you collect,
              never needs seeding again, and can be sent away if you want the room back — for
              nothing, that is not a refund.
            </li>
          </ul>
        </HowToPlayModal>
      )}

      {clearing && (
        <StackAcresSectorModal
          sector={clearing}
          unlocked={sectors}
          unitCount={units.length}
          goldBalance={profile?.goldBalance ?? null}
          unlimitedGold={profile?.unlimitedGold === true}
          upkeepOutstanding={upkeep.due}
          busy={pendingByPrefix("clear-sector")}
          onClear={onClearSector}
          onClose={() => { panelSound(); setClearing(null); }}
        />
      )}

      {cropFieldsModalOpen && (
        <StackAcresCropFieldsModal
          unlocked={cropFieldsUnlocked}
          unitCount={units.length}
          goldBalance={profile?.goldBalance ?? null}
          unlimitedGold={profile?.unlimitedGold === true}
          upkeepOutstanding={upkeep.due}
          busy={pendingByPrefix("unlock-crop-fields")}
          onUnlock={onUnlockCropFields}
          onClose={() => { panelSound(); setCropFieldsModalOpen(false); }}
        />
      )}

      {showWelcome && <StackAcresRayWelcome onClose={dismissWelcome} />}
      {showMuseum && (
        <StackAcresMuseum
          museum={museum}
          secrets={museumSecrets}
          secretDonations={secretDonations}
          onClose={() => { panelSound(); setShowMuseum(false); }}
        />
      )}
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
          busy={isPending("fulfill-contract") || isPending("request-contract")}
          onSettle={onSettleContract}
          onRequest={onRequestContract}
          onClose={() => { panelSound(); setShowContracts(false); }}
          unlockedSectors={sectors}
          onTravel={travel}
        />
      )}
      {/* The vat's sheet replaces the Workshop while it is up rather than
          stacking a second scrim over it, so one Escape closes one sheet;
          closing the vat lands back in the Workshop. */}
      {showWorkshop && !showVat && (
        <WorkshopModal
          inventory={processing.inventory}
          wheatPlots={processing.wheatPlots}
          machines={processing.machines}
          vat={vat}
          goldBalance={profile?.goldBalance ?? 0}
          unlimitedGold={profile?.unlimitedGold ?? false}
          isPending={isPending}
          onSowWheat={onSowWheat}
          onPlaceMachine={onPlaceMachine}
          onProcess={onProcessRecipe}
          onWork={onWork}
          onSell={onSell}
          onOpenVat={() => { panelSound(); setShowVat(true); }}
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
      {/*
       * OVERRIDES Ray's board rather than composing with it: `showMerchant`
       * and `showContracts` are two independent booleans, but a visit's
       * window is short and the two sheets share the identical `.sa-sheet-
       * scrim`, so a player is never meant to have both open at once in
       * practice -- see midnight-merchant-storefront.tsx's own header.
       * Gated on `merchantSnapshot.visit` rather than on `showMerchant`
       * alone: a visit that expires while its sheet is open (the countdown
       * hit zero, or a second browser tab bought the last one) must close
       * this sheet on the very next snapshot rather than show stale stock
       * with nothing left to load it from.
       */}
      {showMerchant && merchantSnapshot.visit && (
        <MidnightMerchantStorefront
          visit={merchantSnapshot.visit}
          msRemainingLocal={merchantSnapshot.msRemaining}
          urgent={merchantSnapshot.urgent}
          goldBalance={profile?.unlimitedGold ? Number.POSITIVE_INFINITY : profile?.goldBalance ?? 0}
          busy={pendingByPrefix("midnight-merchant-buy")}
          onBuy={onBuyFromMerchant}
          onClose={() => { panelSound(); setShowMerchant(false); }}
        />
      )}
    </main>
  );
}
