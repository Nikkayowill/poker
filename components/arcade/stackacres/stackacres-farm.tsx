"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronLeft, Coins, HelpCircle, LocateFixed, Lock, X, ZoomIn, ZoomOut } from "lucide-react";
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
  STACKACRES_CATALOGUE,
  STACKACRES_CROPS,
  STACKACRES_FEED,
  type SeedStock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import { DRONE_DEPLOY_COST_GOLD } from "@/lib/stackacres/drone";
import { buyOptionsForZone, type BuyOption } from "@/lib/stackacres/district-panel";
import {
  exchangeState,
  type StackAcresExchangeState,
} from "@/lib/stackacres/exchange";
import {
  STACKACRES_YIELDS,
  itemGoldValue,
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
import type { BountifulHarvest } from "@/lib/stackacres/bounty";
import { collectFloat, tapActionFor } from "@/lib/stackacres/tap-action";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import { findCascadeTargets } from "@/lib/stackacres/harvest-cascade";
import { HUD_VIEW_EXPANSION, growAreaBounds, stockZone, type WorldPoint } from "@/lib/stackacres/world";
import {
  SOIL_SLOTS_PER_TILE,
  soilTileAt,
  soilTileOwnedSlots,
  soilTileTier,
  soilTilesEqual,
  starterSoilTiles,
  type SoilTile,
} from "@/lib/stackacres/soil";
import {
  SOIL_DEFAULT_TIER,
  SOIL_TIERS,
  soilTierDef,
  type SoilStock,
  type SoilTier,
} from "@/lib/stackacres/soil-tiers";

import type { StackAcresContractRow } from "@/lib/stackacres/contracts";
import { emptyInventory, type StackAcresInventory } from "@/lib/stackacres/inventory";
import type { StackAcresMachineSnapshot } from "@/lib/stackacres/machines";
import type { StackAcresWheatPlotSnapshot } from "@/lib/stackacres/wheat-plot";
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
import type { MachineItemId } from "@/lib/stackacres/machine-items";
import { SYNERGY_PERKS, type SynergyArchetype } from "@/lib/stackacres/synergy-perks";
import { STACKACRES_ZONES, type ZoneId } from "@/lib/stackacres/zones";
import type { PlayerProfile } from "@/lib/profile/types";
import type { PainterName } from "./stackacres-art";
import { StackAcresBuySection, StackAcresUnitRows } from "./stackacres-district-panel";
import { StackAcresIcon } from "./stackacres-icon";
import { StackAcresMuseum } from "./stackacres-museum";
import { StackAcresGreenhousePanel } from "./stackacres-greenhouse-panel";
import { TownContractsModal, type ContractActionResult } from "./TownContractsModal";
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
import { StackAcresMusicToggle } from "./stackacres-music-toggle";
import { StackAcresPlayScreen } from "./stackacres-play-screen";
import { StackAcresDestinations } from "./stackacres-destinations";
import { StackAcresRadialMenu } from "./stackacres-radial-menu";
import { StackAcresSeedStrip } from "./stackacres-seed-strip";
import { StackAcresMonkDialogue } from "./stackacres-monk-dialogue";
import { StackAcresFenceUpgradePopup } from "./stackacres-fence-upgrade-popup";
import type { FenceTier } from "@/lib/stackacres/wildlife";
import { StackAcresFriendshipDialogue } from "./stackacres-friendship-dialogue";
import { StackAcresSectorModal } from "./stackacres-sector-modal";
import { StackAcresRayWelcome } from "./stackacres-ray-welcome";
import { StackAcresVisitorGreeting } from "./stackacres-visitor-greeting";
import { visitorForKind, type VisitorId } from "@/lib/stackacres/visitors";
import type { PropKind } from "@/lib/stackacres/props";
import { StackAcresToolbelt } from "./stackacres-toolbelt";
import { useStackAcresMusic } from "./use-stackacres-music";
import {
  StackAcresWorld,
  type StackAcresProcessing,
  type StackAcresWorldApi,
} from "./stackacres-world";
import {
  STACKACRES_STARTING_TIER,
  nextToolTier,
  stackacresToolTierDef,
  toStackAcresToolTier,
  toolUpgradePrice,
  type StackAcresToolTier,
} from "@/lib/stackacres/equipment";
import {
  evaluateStackAcresShopLock,
  type StackAcresShopProgress,
} from "@/lib/stackacres/shop-locks";
import { applyInfluenceDiscount } from "@/lib/stackacres/influence-tiers";
import type { TapPoint } from "./stackacres-scene";
import { type Action, intentOf, newIntentKey } from "@/lib/stackacres/farm-actions";
import {
  predictStackAcresAction,
  type FarmPredictContext,
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

interface StackAcresResponse {
  units: StackAcresUnitSnapshot[];
  /** Null for a cookie-less first visit: the read route never mints a session. */
  profile: PlayerProfile | null;
  feed: number;
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
  collected?: { stock: StackAcresStock; item: StackAcresItem; quantity: number; mucked: boolean };
  harvest?: {
    units: number;
    tally: { item: StackAcresItem; quantity: number }[];
    gross: number;
    bounty: BountifulHarvest;
    bonus: number;
    upkeep: number;
    /** Gold a critical harvest added, inside the same daily ceiling. */
    crit: number;
    gold: number;
    mucked: number;
    /** Items donated to Ray's Museum for the very first time in this sweep,
     *  and what each paid -- already folded into `gold` above. */
    discoveries: { item: StackAcresItem; bonus: number }[];
    /** Ray's Museum, secret wing: what this sweep's one roll turned up, or
     *  null on the overwhelming majority of harvests. Never folded into
     *  `gold` -- a secret find pays no Gold at all. */
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
  const [capacity, setCapacity] = useState<Partial<Record<StackAcresStock, number>>>({});
  const [toolTier, setToolTier] = useState<StackAcresToolTier>(STACKACRES_STARTING_TIER);
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
  /** Purchased soil beds only -- see `StackAcresResponse.soilTiles`'s own doc
   *  comment for why the starter pair is never in here. Merged with
   *  `starterSoilTiles` below, right before it reaches the scene. */
  const [soilTiles, setSoilTiles] = useState<SoilTile[]>([]);
  /** Bags bought from Ray but not laid down yet. Plain object rather than a Map
   *  so a response can replace it wholesale. */
  const [soilStock, setSoilStock] = useState<SoilStock>({});
  /** Crop seeds bought from Ray but not planted yet -- the ownership filter
   *  that keeps the planting strip from ever offering a crop the player
   *  isn't carrying, see StackAcresSeedStrip. Same plain-object shape as
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
  const [processing, setProcessing] = useState<Omit<StackAcresProcessing, "profileId">>(() => ({
    contract: null,
    inventory: emptyInventory(),
    machines: [],
    wheatPlots: [],
  }));
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
  const [showGreenhouse, setShowGreenhouse] = useState(false);
  const [greenhouseBuilt, setGreenhouseBuilt] = useState(false);
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
  // used to cover (`viewExpansion`).
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
  const [radial, setRadial] = useState<{ zone: ZoneId; at: TapPoint; world: WorldPoint } | null>(
    null,
  );
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
  const lastHarvestRef = useRef<{ crit: number; units: StackAcresUnitSnapshot[] } | null>(null);
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
      capacity,
      seedStock,
      toolTier,
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
      nowMs: Date.now(),
    }),
    [
      profile,
      units,
      feed,
      capacity,
      seedStock,
      toolTier,
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
      capacity,
      // Unlike soilStock (never optimistically touched -- buy-soil and
      // place-soil-tile both wait for the real response), seedStock IS
      // guessed at by the "stock" predictor above, so a refused or dropped
      // planting has to be able to put the spent seed back.
      seedStock,
      exchange,
      museum,
      museumSecrets,
      sectors,
      upkeep,
      influence,
      toolTier,
      synergyUnlocked,
      synergyActive,
      farmhandSpeedMultiplier,
      processing,
      secrets,
      secretDonations,
      greenhouseBuilt,
    }),
    [
      units,
      profile,
      feed,
      capacity,
      seedStock,
      exchange,
      museum,
      museumSecrets,
      sectors,
      upkeep,
      influence,
      toolTier,
      synergyUnlocked,
      synergyActive,
      farmhandSpeedMultiplier,
      processing,
      secrets,
      secretDonations,
      greenhouseBuilt,
    ],
  );
  type FarmSnapshot = ReturnType<typeof captureFarmSnapshot>;
  const restoreFarmSnapshot = useCallback((snap: FarmSnapshot) => {
    setUnits(snap.units);
    setProfile(snap.profile);
    setFeed(snap.feed);
    setCapacity(snap.capacity);
    setSeedStock(snap.seedStock);
    setExchange(snap.exchange);
    setMuseum(snap.museum);
    setMuseumSecrets(snap.museumSecrets);
    setSectors(snap.sectors);
    setUpkeep(snap.upkeep);
    setInfluence(snap.influence);
    setToolTier(snap.toolTier);
    setSynergyUnlocked(snap.synergyUnlocked);
    setSynergyActive(snap.synergyActive);
    setFarmhandSpeedMultiplier(snap.farmhandSpeedMultiplier);
    setProcessing(snap.processing);
    setSecrets(snap.secrets);
    setSecretDonations(snap.secretDonations);
    setGreenhouseBuilt(snap.greenhouseBuilt);
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

  /** The starter pair is never persisted (see `starterSoilTiles`'s own
   *  header) so it is recomputed here every time rather than read off any
   *  response, then handed down ahead of whatever this profile has bought. */
  const mergedSoilTiles = useMemo(
    () => [...starterSoilTiles(growAreaBounds("meadow")), ...soilTiles],
    [soilTiles],
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

  // The bed outline follows the ring, because the ring is where a bed is
  // bought. Keyed on the radial state, which changes only on a tap, so this
  // pushes once per open and once per close rather than per frame -- and
  // every `setRadial(null)` site clears the outline without having to know
  // it exists. Only the Crop Fields can hold a bed (the service refuses
  // every other district), so no other zone draws one.
  const radialSoilWorld = radial?.zone === "meadow" ? radial.world : null;
  useEffect(() => {
    world.current?.previewSoilAt(radialSoilWorld);
  }, [radialSoilWorld]);

  // Same "push, never rebuild" contract: the scene diffs its own drone set
  // against this list (see StackAcresScene.setDroneHangar), so pushing on
  // every response -- even one that rebuilt the array without actually
  // changing the fleet -- is a harmless no-op on the scene's own side.
  useEffect(() => {
    world.current?.setDroneHangar(droneHangar.drones.map((drone) => drone.droneId));
  }, [droneHangar.drones]);

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
          // The daily Gold ceiling is the feature working, not a fault. It
          // repaints the round silently like any other refusal, which left a
          // harvest press looking like it did nothing -- so say it out loud
          // in the same toast a good harvest answers in, and let the standing
          // notice by the Harvest key (below) carry the countdown.
          if (data.reason === "day-capped") {
            setLastCollect({
              text: data.error ?? "The farm has sent out all the Gold it can today.",
              nonce: Date.now(),
            });
          } else if (!data.round) {
            setError(data.error ?? "That did not go through.");
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
          // The toast leads with the money, because that is what a harvest is
          // now -- the produce is the reason, not the reward. The synergy and
          // the fee each get a clause only when they actually applied. Ray's
          // Museum rides on the same toast rather than a second one stacked
          // on top of it -- its bonus is already folded into `harvest.gold`,
          // so this clause is purely what it was FOR, not a separate figure.
          const bonusPart = harvest.bounty.label
            ? ` · ${harvest.bounty.label} +${harvest.bonus.toLocaleString()}`
            : "";
          const upkeepPart =
            harvest.upkeep > 0 ? ` · upkeep -${harvest.upkeep.toLocaleString()}` : "";
          const discoveryTotal = harvest.discoveries.reduce((sum, d) => sum + d.bonus, 0);
          const discoveryPart =
            harvest.discoveries.length > 0
              ? ` · ${harvest.discoveries.length === 1 ? "New Discovery!" : "New Discoveries!"} +${discoveryTotal.toLocaleString()}`
              : "";
          setLastCollect({
            text: `+${harvest.gold.toLocaleString()} Gold${bonusPart}${upkeepPart}${discoveryPart}`,
            nonce: Date.now(),
          });
          if (anchor) {
            // A one-unit sweep floats its produce, which is what a tap on that
            // animal was asking about. A whole-farm sweep floats the money:
            // naming five kinds of produce over one thumb is unreadable.
            const float =
              single && harvest.tally.length === 1
                ? collectFloat(harvest.tally[0].item, harvest.tally[0].quantity)
                : { text: `+${harvest.gold.toLocaleString()} Gold`, icon: "ico-gold" };
            world.current?.floatAt(anchor, float.text, "gain", float.icon as PainterName);
          }
          // A critical harvest gets its own line rather than being folded
          // into the payout float: the Gold total already moved, and a
          // player who cannot see WHY it was bigger than usual has not
          // really been told the ladder is working.
          if (harvest.crit > 0) {
            goldSound();
            setLastCollect({
              text: `Rich pickings! +${harvest.crit.toLocaleString()} Gold`,
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
      void act({ action: "feed", unitId: unit.id });
    },
    [act],
  );
  const onWater = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      waterSound();
      void act({ action: "water", unitId: unit.id });
    },
    [act],
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

  const pickTool = useCallback((next: StackAcresTool) => {
    toolSound();
    setTool(next);
    setError(null);
  }, []);

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
      if (!result || result.crit <= 0) return;
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
      // The farm's own voice for the gesture, chosen off the same `action`
      // that is about to be sent. This is the press the whole sound set was
      // written for and it was the last thing still answering with the app's
      // chrome click: tapping a hen, a dry row and a mucked plot all made the
      // one lobby noise, while the sidebar rows beside them -- doing exactly
      // the same three things -- had had their own sounds since the sound
      // pass landed. The tap path simply predated it.
      //
      // Feed, water and clear speak on the PRESS because `act`'s own
      // optimistic layer applies them locally the instant the request is
      // sent, below: the farm has changed by the time the finger lifts, so a
      // sound that waits for the network would be late for something that
      // has visibly already happened. Collect is the deliberate exception
      // and stays silent here -- it answers in `act`, where the response
      // says which unit paid out, and it answers with that animal's own
      // voice. A click in front of a hen clucking is a click in front of the
      // best sound on the farm.
      if (action.kind === "feed") feedSound(unit.stock);
      else if (action.kind === "water") waterSound();
      else if (action.kind === "clear") muckSound();
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
          ? STACKACRES_YIELDS[unit.stock].quantity * itemGoldValue(STACKACRES_YIELDS[unit.stock].item)
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
    [act, feed, gold, liveUnits, nowMs, triggerCascade],
  );

  /** A finger landed on a district's fenced ground and hit nothing. That is
   *  "I want something HERE", answered where the finger is. */
  const onWorldGroundTap = useCallback((zone: ZoneId, at: TapPoint, worldPt: WorldPoint) => {
    // A menu opening over the map, same as the barn and the locked-land
    // sheets below -- not an action on the farm, so it takes the farm's
    // panel cue rather than one of the action voices.
    panelSound();
    setPlace(zone);
    setRadial({ zone, at, world: worldPt });
  }, []);

  /** A finger landed on the barn -- Ray's Museum's own entryway. Opens the
   *  same way tapping "Buy from Ray" on the signpost opens the supply store:
   *  a sound on the press, a sheet over the map, nothing sent to the server
   *  (the museum registry already lives in this component's own state). */
  const onWorldBarnTap = useCallback(() => {
    setRadial(null);
    panelSound();
    setShowMuseum(true);
  }, []);

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

  const onClearSector = useCallback(
    (sector: SectorId) => {
      buySound();
      setClearing(null);
      void act({ action: "clear-sector", sector });
    },
    [act],
  );

  /** Seeding straight out of the radial menu. Closes first: the menu's
   *  prices are about to move under it, and a second tap on a stale one
   *  would be a purchase the player did not read. */
  const onRadialSeed = useCallback(
    (stock: StackAcresStock) => {
      const at = radial?.at ?? null;
      setRadial(null);
      // The same seed going into the same ground as `onSeed`; the only
      // difference is which control asked for it.
      sowSound();
      tapAnchor.current = at;
      void act({ action: "stock", stock });
    },
    [act, radial],
  );

  /**
   * Tilling a bed straight out of the radial ring. No optimistic guess
   * (`predictStackAcresAction`'s own default bucket -- see that module's
   * header, soil tiles are grouped with pipes there): the response's own
   * `soilTiles` reaches the scene through `applyResponse` -> the `soilTiles`
   * state below -> the controlled prop `StackAcresWorld` already pushes on
   * change, the same path a newly stocked unit's `units` field already
   * takes. Nothing here talks to the scene directly.
   */
  const onPlaceSoilTile = useCallback(
    (tx: number, ty: number, tier: SoilTier = SOIL_DEFAULT_TIER) => {
      buySound();
      setRadial(null);
      // The tier names WHICH bed; the server reads its price from
      // SOIL_TIER_DEFS, so nothing here has to send (or can lie about) a cost.
      void act({ action: "place-soil-tile", tx, ty, tier });
    },
    [act],
  );

  /** Removing a purchased bed. Same "the response is the whole story" shape
   *  as `onPlaceSoilTile` above. */
  const onRemoveSoilTile = useCallback(
    (tx: number, ty: number) => {
      buySound();
      setRadial(null);
      void act({ action: "remove-soil-tile", tx, ty });
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

  // The ghost drawn over a mow drag is whatever tier is owned (see
  // toolGhostIcon in stackacres-world.tsx) -- deliberately, so 250,000 Gold
  // buys something visibly different in hand. Without a caption that reads
  // as "I'm holding a shovel and can't get my scythe back," when what's
  // actually true is the scythe never left; the equipped tier is a skin and
  // a stat bump on it, not a second tool. Only say so once there is
  // something to explain: the Trowel already looks like the drawn scythe, so
  // its hint stays exactly what it always was.
  const toolHint =
    tool === "scythe" && toolTier !== STACKACRES_STARTING_TIER
      ? `${STACKACRES_TOOL_DEFS.scythe.hint} That's your ${stackacresToolTierDef(toolTier).label} doing the cutting -- still the scythe, just upgraded.`
      : STACKACRES_TOOL_DEFS[tool].hint;

  /** Produce in the barn, in catalogue order so the list never reshuffles. */
  /** Everything standing ready right now. The Harvest key's whole subject. */
  const readyUnits = useMemo(
    () => liveUnits.filter((unit) => unit.state === "ready"),
    [liveUnits],
  );
  const carrying = readyUnits.length;

  /**
   * What Ray's shelf is allowed to look at when it decides which rows are
   * open -- the same three facts the SERVER reads before it takes any Gold
   * (`readShopProgress` in lib/server/stackacres-service.ts), fed through the
   * same pure evaluator. That is the whole reason this is a struct and not
   * three loose props: a greyed-out card and the refusal behind it have to be
   * two renderings of one answer, never two answers.
   */
  const shopProgress = useMemo<StackAcresShopProgress>(
    () => ({ sectors, influence, greenhouseBuilt }),
    [sectors, influence, greenhouseBuilt],
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
   * The seed ring's one extra button for the Long Meadow: till one planting
   * square of empty ground, add another square to a bed already started
   * there, or lift a bed outright. Only ever set for `"meadow"" -- soil is a
   * Crop Fields concept everywhere else in this module, and every other
   * zone's ring stays exactly what it was.
   *
   * `mergedSoilTiles` (starter + purchased) is the same list the scene was
   * just handed, so "is there a tile here" never disagrees with what is
   * actually painted. A starter tile answers with neither button, matching
   * soil.ts's own "the free starter beds are permanent" rule.
   */
  const soilExtraActions = (() => {
    if (!radial || radial.zone !== "meadow") return [];
    const { tx, ty } = soilTileAt(radial.world.x, radial.world.y);
    const existing = mergedSoilTiles.find((tile) => tile.tx === tx && tile.ty === ty);
    if (!existing) {
      // ONE BUTTON PER TIER, generated from SOIL_TIER_DEFS rather than listed
      // here, so adding a tier to that table adds it to this ring and there is
      // no second place to forget. The label carries the tier's own name --
      // each button buys the bed's FIRST square, at that tier.
      // NO `cost` HERE any more: soil is paid for at Ray's shelf, so showing a
      // Gold price on this ring would read as a second charge. A tier with no
      // bags left is offered but disabled, which is what tells the player the
      // shop is where to go -- hiding it would make the ring silently shrink.
      return SOIL_TIERS.map((tier) => {
        const def = soilTierDef(tier);
        const held = soilStock[tier] ?? 0;
        return {
          key: `till-bed-${tier}`,
          label: `${def.label} (${held})`,
          icon: "ico-plant" as PainterName,
          disabledReason: held > 0 ? undefined : "None in the barn — buy from Ray",
          onSelect: () => onPlaceSoilTile(tx, ty, tier),
        };
      });
    }
    if (existing.origin === "purchased") {
      const owned = soilTileOwnedSlots(existing);
      const tier = soilTileTier(existing);
      const held = soilStock[tier] ?? 0;
      return [
        // ONLY the bed's OWN tier is ever offered here -- a bed already has
        // a fixed tier (soil.ts's `addSoilSlot` refuses a mismatched one),
        // so showing the other two tiers as if they could fill the same
        // squares would offer a purchase the server is only going to bounce
        // back with its bag refunded. Nothing at all once the bed is full --
        // there is no square left to sell.
        ...(owned < SOIL_SLOTS_PER_TILE
          ? [
              {
                key: "add-soil-square",
                label: `Add a Square (${held})`,
                icon: "ico-plant" as PainterName,
                disabledReason: held > 0 ? undefined : "None in the barn — buy from Ray",
                onSelect: () => onPlaceSoilTile(tx, ty, tier),
              },
            ]
          : []),
        {
          key: "remove-bed",
          label: "Remove Bed",
          icon: "ico-clear" as PainterName,
          onSelect: () => onRemoveSoilTile(tx, ty),
        },
      ];
    }
    return [];
  })();

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
            its usual place at the end of the row. */}
        <div className="sa-hud">
          <span className="sa-feed" title="Feed servings">
            <StackAcresIcon name="ico-feed" size={16} />
            <strong>{feed}</strong>
            <span className="sa-sr">feed servings</span>
          </span>
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
          <SynergyOverlay
            unlocked={synergyUnlocked}
            active={synergyActive}
            busy={pendingByPrefix("unlock-synergy-perk") || pendingByPrefix("activate-synergy-perk")}
            onUnlock={onUnlockSynergyPerk}
            onActivate={onActivateSynergyPerk}
          />
          <StackAcresMusicToggle />
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
        <div className="sa-field" data-drawer={panelOpen ? "open" : "shut"}>
          {loaded && (
            <StackAcresWorld
              units={liveUnits}
              tool={tool}
              toolTier={toolTier}
              museumGlowTier={museumGlowTier}
              farmhandSpeedMultiplier={farmhandSpeedMultiplier}
              viewExpansion={compactNav ? HUD_VIEW_EXPANSION : 1}
              secretSetComplete={secretSetComplete}
              celebrate={celebrate}
              onReady={onWorldReady}
              onUnitTap={onWorldUnitTap}
              onGroundTap={onWorldGroundTap}
              onBarnTap={onWorldBarnTap}
              onGreenhouseTap={onWorldGreenhouseTap}
              onGreenhouseSlotTap={onWorldGreenhouseSlotTap}
              onMerchantTap={onWorldMerchantTap}
              onMonkTap={onWorldMonkTap}
              onRayTap={onWorldRayTap}
              onVisitorTap={onWorldVisitorTap}
              onSecretZoneTap={onWorldSecretZoneTap}
              onFenceSegmentTap={onWorldFenceSegmentTap}
              sectors={sectors}
              onLockedSectorTap={onWorldLockedTap}
              onViewMoved={onViewMoved}
              soilTiles={mergedSoilTiles}
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
              toolbelt, the signpost and the camera buttons, which are
              positioned siblings with no z-index of their own and therefore
              stack above it. So the next tap on the world closes the menu
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

          <div className="sa-controls">
            <StackAcresToolbelt tool={tool} onPick={pickTool} />
          </div>

          <StackAcresDestinations
            active={place}
            compact={compactNav}
            onTravel={travel}
            unlocked={sectors}
            onOpenStore={() => { panelSound(); setShowStore(true); }}
            onOpenContracts={() => { panelSound(); setShowContracts(true); }}
            contractPosted={processing.contract !== null}
            carrying={carrying}
          />

          <div className="sa-camera" role="group" aria-label="Map view">
            <button type="button" className="sa-camera-btn" aria-label="Zoom in" onClick={() => { panelSound(); world.current?.zoomBy(1.3); }}>
              <ZoomIn size={16} aria-hidden="true" />
            </button>
            <button type="button" className="sa-camera-btn" aria-label="Zoom out" onClick={() => { panelSound(); world.current?.zoomBy(1 / 1.3); }}>
              <ZoomOut size={16} aria-hidden="true" />
            </button>
            <button type="button" className="sa-camera-btn" aria-label="Back to the farm" onClick={() => { panelSound(); setPlace("farmstead"); setRadial(null); world.current?.recenter(); }}>
              <LocateFixed size={16} aria-hidden="true" />
            </button>
          </div>

          {/* The seed menu, on the canvas next to the finger that asked for
              it. Rendered after the camera controls so it stacks over them,
              and inside .sa-field so its coordinates are the ones the scene
              reported the tap in. */}
          {/* The Long Meadow gets the scrollable seed strip -- 22 crops
              cannot lay out on a ring (see StackAcresSeedStrip's own
              header) -- and it filters to what the shelf actually holds.
              Every other district still gets the ring: three livestock
              kinds fit it fine, and livestock has no seed shelf to filter
              against (see SeedStock's own doc comment). */}
          {radial && radial.zone === "meadow" && (
            <StackAcresSeedStrip
              at={radial.at}
              options={buyOptionsForZone(radial.zone, { units: liveUnits, gold, capacity })}
              seedStock={seedStock}
              districtLabel={STACKACRES_ZONES[radial.zone].label}
              busy={
                pendingByPrefix("stock") ||
                pendingByPrefix("place-soil-tile") ||
                pendingByPrefix("remove-soil-tile")
              }
              onSeed={onRadialSeed}
              onClose={closeRadial}
              onManage={openPanel}
              extraActions={soilExtraActions}
            />
          )}
          {radial && radial.zone !== "meadow" && (
            <StackAcresRadialMenu
              at={radial.at}
              options={buyOptionsForZone(radial.zone, { units: liveUnits, gold, capacity })}
              districtLabel={STACKACRES_ZONES[radial.zone].label}
              busy={pendingByPrefix("stock")}
              onSeed={onRadialSeed}
              onClose={closeRadial}
              onManage={openPanel}
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
              A better tool cuts a wider swathe through the Long Meadow, and makes a harvest more
              likely to come up rich — a critical harvest pays Bushels straight into your hand on
              top of the produce.
            </p>

            <StoreShelf icon="ico-plant">Soil</StoreShelf>
            <p className="sa-sheet-note">
              Beds are laid in the Crop Fields, not here — buy the bags, then tap bare ground out
              there to lay one. A bed you take up is spent, so pick the spot before you dig.
            </p>
            <div className="sa-stock-cards">
              {SOIL_TIERS.map((tier) => {
                const def = soilTierDef(tier);
                const held = soilStock[tier] ?? 0;
                return (
                  <div key={tier} className="sa-stock-card">
                    <h3>{def.label}</h3>
                    <p className="sa-stock-terms">{def.blurb}</p>
                    <p className="sa-stock-yield">{def.price.toLocaleString()} Gold</p>
                    <button
                      type="button"
                      className="sa-cta"
                      disabled={isPending(`buy-soil:${tier}`) || gold < def.price}
                      onClick={() => {
                        buySound();
                        void act({ action: "buy-soil", tier, quantity: 1 });
                      }}
                    >
                      Buy
                    </button>
                    <p className="sa-sheet-note">
                      {held} in the barn
                    </p>
                  </div>
                );
              })}
            </div>

            <StoreShelf icon="ico-carrot">Seeds</StoreShelf>
            <p className="sa-sheet-note">
              Every crop is bought here first — the Long Meadow only ever offers what you&apos;re
              already carrying seed for. Buy a few, then tap bare ground out there to plant.
            </p>
            <div className="sa-stock-cards">
              {STACKACRES_CROPS.map((crop) => {
                const def = STACKACRES_CATALOGUE[crop];
                const held = seedStock[crop] ?? 0;
                return (
                  <div key={crop} className="sa-stock-card">
                    <h3>{def.label}</h3>
                    <p className="sa-stock-yield">{def.seedCost.toLocaleString()} Gold</p>
                    <button
                      type="button"
                      className="sa-cta"
                      disabled={isPending(`buy-seed:${crop}`) || gold < def.seedCost}
                      onClick={() => {
                        buySound();
                        void act({ action: "buy-seed", crop, quantity: 1 });
                      }}
                    >
                      Buy
                    </button>
                    <p className="sa-sheet-note">
                      {held} in the barn
                    </p>
                  </div>
                );
              })}
            </div>

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
                    <button
                      type="button"
                      className="sa-cta"
                      disabled={!lock.isUnlocked || isPending(`buy-feed:${id}`) || gold < price}
                      aria-describedby={lock.lockHint ? `sa-lock-hint-${id}` : undefined}
                      onClick={() => { buySound(); void act({ action: "buy-feed", itemId: id }); }}
                    >
                      {lock.isUnlocked ? "Buy" : "Locked"}
                    </button>
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
