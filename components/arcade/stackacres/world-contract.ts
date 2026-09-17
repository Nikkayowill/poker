import type { Ref } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import type { StackAcresTool } from "@/lib/stackacres/tools";
import type { SectorId } from "@/lib/stackacres/sectors";
import type { StackAcresCutter } from "@/lib/stackacres/cutters";
import type { HiddenZoneId } from "@/lib/stackacres/secrets";
import type { MapPlaceId } from "@/lib/stackacres/map-places";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import type { TravelerId } from "@/lib/stackacres/story/travelers";
import type { FenceTier, WildlifeTimeOfDay } from "@/lib/stackacres/wildlife";
import type { StackAcresWeather } from "@/lib/stackacres/weather";
import type { PainterName } from "./stackacres-art";
import type { WorldPoint } from "@/lib/stackacres/world";
import type { SoilTile } from "@/lib/stackacres/soil";
import type { PipeNode } from "@/lib/stackacres/irrigation";
import type { SoilTier } from "@/lib/stackacres/soil-tiers";

/**
 * What the farm shell (stackacres-farm.tsx) hands the map under it, and what it
 * can ask of that map. The top-down world (../stackacres-td/topdown-world.tsx)
 * implements it; parts it doesn't draw yet are named no-ops there.
 */

export interface StackAcresSceneUnit {
  id: string;
  stock: StackAcresStock;
  state: "working" | "hungry" | "dry" | "ready" | "mucked";
  /** 0..1 while working, 1 once ready, null while mucked. */
  progress: number | null;
  /** True once bought outright with Gold -- drawn no differently, kept only
   *  because it is part of what makes a unit's own picture change (see
   *  `signatureOf`), the same way it was on the old cell. */
  permanent: boolean;
  /** The crop's fixed planting slot, the only thing that puts it on a tile at
   *  all (see `CropPlacement.slot`). Null for livestock, for a Greenhouse
   *  crop, and for a crop sown before soil tiers shipped -- any of which
   *  scatters off the lattice instead of standing on a bed. */
  soilSlot?: number | null;
  /** Set when this crop is standing in the built Greenhouse rather than out
   *  on the meadow's own soil. Always paired with a null `soilSlot` (see
   *  `assignSoilSlot`'s early return for it), which is what scatters it
   *  inside its own zone instead of landing on top of a real meadow crop. */
  housedIn?: "greenhouse" | null;
  /** Seed waiting for its first water; drawn as a sown heap. See
   *  `StackAcresUnitSnapshot.seed`. */
  seed: boolean;
}

/** Where a tap landed, in CSS pixels relative to the canvas host -- which is
 *  also the box every DOM overlay on this screen is positioned in, so the
 *  shell can drop a menu or a label straight onto these numbers. */
export interface TapPoint {
  x: number;
  y: number;
}

/**
 * A square the farmer is standing on with the belt's tool in hand
 * (lib/stackacres/toolbelt.ts). The map reports where he is; the shell asks the
 * belt what the held tool does there, so the map still knows nothing about what
 * anything costs or yields.
 */
export interface UseSquare {
  /** The Crop Fields bed under his feet, or null anywhere off the field. */
  tile: { tx: number; ty: number } | null;
  /** The crop on that bed, or the nearest animal he walked up to. */
  unitId: string | null;
  /** Where to float a line, in the same CSS-pixel box every overlay uses. */
  at: TapPoint;
  /** True while the Use key is held down and he is walking a row, false for a single press or a tap. */
  stroke: boolean;
}

/** What a traveler's badge says: a quest to offer, or one ready to hand in. */
export type StoryCue = "available" | "ready";

/** One badge per traveler that has one; a missing key means none. */
export type StoryCues = Readonly<Partial<Record<TravelerId, StoryCue>>>;


/** One flag per traveler: has their unlock been met yet. Read straight off
 *  `StackAcresStoryView.travelers[id].unlocked`, so the scene never keeps
 *  its own copy of the rule. */
export type TravelerUnlocks = Readonly<Record<TravelerId, boolean>>;

export type FarmerAction = "water" | "harvest" | "plant";

/** Who an emote bubble pops up over: the farmer, or a person on the map by their rig name. */
export type EmoteTarget = "farmer" | "ray" | "pilgrim" | "merchant" | TravelerId;
/** Stardew's emote set is the reference; each is a small icon bubble in the common atlas. */
export type EmoteKind = "heart" | "exclaim" | "question" | "note" | "sleep" | "sweat" | "sparkle";

export interface StackAcresWorldApi {
  zoomBy: (factor: number) => void;
  recenter: () => void;
  /** Travel to a district's gate (lib/stackacres/zones.ts). */
  focusZone: (zone: MapPlaceId) => void;
  /** Which map place the farmer is standing in right now. */
  currentPlace: () => MapPlaceId;
  /** The squash-and-stretch a tapped unit answers with, before the network
   *  has said anything at all. */
  popUnit: (unitId: string) => void;
  /** Critical Harvest Cascade: the same gold-burst `celebrate` triggers for a
   *  solo unit, fanned out across several units with a stagger between each
   *  so a chain reads as a chain. See stackacres-scene.ts's own method. */
  celebrateCascade: (unitIds: string[]) => void;
  /**
   * The extra beat a LUCKY harvest gets: the crit flash (micro shake, gold
   * wash, "CRIT! x2" springing up over the unit) and a burst of deep-gold
   * sparks at its base.
   *
   * Pushed from the shell rather than fired inside the scene alongside the
   * ordinary harvest burst, because only the settlement response knows whether
   * the roll actually hit -- the crit is rolled server-side inside the guarded
   * write (see lib/stackacres/equipment.ts's `rollHarvestCrit`), so there is
   * nothing local to predict it from.
   *
   * `multiplier` is the TOTAL payout multiple (`1 + critBonus`), not the bonus
   * alone -- see `critFlashLabel` in lib/stackacres/juice.ts.
   */
  celebrateCrit: (unitId: string, multiplier: number) => void;
  /** Starts the Pixel Pilgrim's bow, optimistically -- called only from his
   *  dialogue's own "yes", before the `pray` request has answered. See
   *  lib/stackacres/monk.ts and stackacres-scene.ts's `playMonkPrayer`. */
  playMonkPrayer: () => void;
  /** Steps the camera inside the Greenhouse (lib/stackacres/greenhouse.ts),
   *  narrowing its bounds to the interior -- the shell's own cue, once it
   *  has decided the Greenhouse is built (an unbuilt one opens a build panel
   *  instead; see `onGreenhouseTap`). */
  enterGreenhouse: () => void;
  /** Steps back out to the open world. Also what a tap outside the
   *  sub-grid's own six slots does on its own, from inside the scene. */
  exitGreenhouse: () => void;
  /** A tap that became a real action, never a refused one: registers one hit
   *  with the Frenzy Heat Combo Engine and throws its cosmetic feedback at
   *  the unit's own live position. `baseYieldGold` is a DISPLAY ESTIMATE,
   *  meaningful only for a "collect" tap -- see lib/stackacres/frenzy.ts's
   *  own header for why this never touches a real payout. */
  registerFrenzyTap: (unitId: string, baseYieldGold?: number) => void;
  /** The farmer acts out a water, harvest or planting drop where he stands.
   *  Only the top-down world has a farmer; the isometric world ignores it. */
  farmerAction: (action: FarmerAction) => void;
  /** A small emote bubble over someone's head for a moment: a heart when a gift lands, a note when a
   *  traveler's story moves on. Nothing happens when that person isn't on the map the player is looking at. */
  emote: (who: EmoteTarget, kind: EmoteKind) => void;
  /** A line of text that lifts off the tap and fades -- the reward, or the
   *  reason there wasn't one. */
  floatAt: (at: TapPoint, text: string, tone: "gain" | "deny", icon?: PainterName) => void;
  /** Adds or removes the Midnight Merchant's own picture from the lot.
   *  PUSHED rather than a prop-driven effect's usual shape because
   *  stackacres-farm.tsx already owns the render decision itself
   *  (`MidnightMerchantManager.isRendered()`) and only needs to tell the
   *  scene when that boolean actually flips -- the same "push, never
   *  rebuild" contract `setToolTier` already uses for
   *  its own props, exposed through the imperative handle instead of a
   *  prop because it is closer in shape to `popUnit`/`floatAt` (a command
   *  fired from an event) than to a value the scene must always reflect. */
  setMerchant: (present: boolean) => void;
  /** Hangs a quest badge ("!" to offer, "?" ready to hand in) over each
   *  traveler named, and takes down the rest. Same "push, never rebuild"
   *  contract as `setMerchant`: stackacres-farm.tsx calls this whenever its
   *  story view changes, and an unchanged badge is a no-op. */
  setStoryCues: (cues: StoryCues) => void;
  /** Shows or hides each traveler as their own unlock is met -- nobody
   *  stands on the farm before that. Same "push, never rebuild" contract as
   *  `setStoryCues`: called with the full eleven-entry record whenever the
   *  story view changes, a no-op where nothing flipped. */
  setTravelerUnlocks: (unlocked: TravelerUnlocks) => void;
  /** Placed soil beds (lib/stackacres/soil.ts), passed straight through to
   *  the scene's own methods of the same name -- see stackacres-scene.ts's
   *  "the seam the shop will arrive through" section for what each does.
   *  Exposed here for the same reason `popUnit`/`floatAt` are: the shell
   *  drives these off a server response landing, not off a prop the scene
   *  must always reflect. */
  soilTiles: () => SoilTile[];
  setSoil: (tiles: readonly SoilTile[]) => void;
  placeSoilAt: (x: number, y: number, tier?: SoilTier) => boolean;
  removeSoilAt: (x: number, y: number) => boolean;
  /** Outlines the tile a pending bed will actually land on, snapped through
   *  the same `soilTileAt` the placement uses. `null` clears it. Pushed from
   *  the shell because the shell owns the radial menu the preview belongs
   *  to -- the scene has no idea a ring is open. */
  previewSoilAt: (world: WorldPoint | null) => void;
  /** Replays a tap's own hit-test chain against a point that never actually
   *  reached the canvas -- see StackAcresScene's own `tapAt` for why the
   *  seed menu's dismissal scrim needs this. `clientX`/`clientY` are CSS
   *  pixels, the same space a `PointerEvent` carries. */
  tapAt: (clientX: number, clientY: number) => void;
  /** Wildlife Ecosystem & Nighttime Predator Defense -- same "push, never
   *  rebuild" shape as `setMerchant`/`setSoil` above. `setWildlifeTimeOfDay`
   *  drives the day/night population swap (the shell's own `timeOfDay()`
   *  poll); `setFenceTier`/`setLivestockHealth` hydrate one district's saved
   *  defense state, called once per segment/zone on load and again right
   *  after a successful upgrade. */
  setWildlifeTimeOfDay: (tod: WildlifeTimeOfDay) => void;
  /** The weather the ambience engine should sound like right now -- see
   *  StackAcresScene's own `getAudibleWeather` for why this can read CLEAR
   *  even while it is actually raining. */
  getAudibleWeather: () => StackAcresWeather;
  setFenceTier: (zone: ZoneId, segmentIndex: number, tier: FenceTier, durability: number) => void;
  setLivestockHealth: (zone: ZoneId, health: number) => void;
  /** Every Mechanical Forage Drone this profile owns, by id --
   *  `StackAcresView.droneHangar.drones` mapped to their ids. PUSHED, same
   *  "push, never rebuild" contract as `setMerchant`: stackacres-farm.tsx
   *  calls this when the view's own drone list changes, not on every
   *  render. Passing the unchanged list twice is a harmless no-op (the
   *  scene's own `setDroneHangar` diffs against what it already has). */
  setDroneHangar: (droneIds: string[]) => void;
  /** Wants (or stops wanting) the delivery truck on the lot -- same
   *  "push, never rebuild" contract as `setMerchant`, called whenever
   *  `StackAcresView.contract`'s presence flips. `immediate` skips the
   *  drive-in animation, for the one case that is not a genuinely observed
   *  transition (a contract already open on page load) -- see the scene's
   *  own `setTruckPresent` doc comment. */
  setTruckPresent: (wanted: boolean, immediate?: boolean) => void;
  /** Parks every drone's forage drops for `durationMs` -- they keep flying,
   *  they just stop finding anything. Called when the server refuses a claim
   *  with `day-capped`: the farm cannot pay another Gold piece today, so the
   *  fleet has nothing to fetch until the allowance refills. */
  holdDroneForage: (durationMs: number) => void;
  /** A world point as pixels inside the field, for pointing a drag tool at a
   *  fixed spot. Null until the scene has booted. */
  fieldPointFor: (x: number, y: number) => TapPoint | null;
  /** Holds (or releases) the barn's door-open tap frame for as long as the
   *  Supply Store sheet it opens is on screen, instead of letting it revert
   *  on its own short timer -- called from an effect on `showStore`. See
   *  stackacres-scene.ts's `setBarnHeldOpen`. */
  setBarnHeldOpen: (held: boolean) => void;
  /** Same contract as `setBarnHeldOpen`, for Ray's house and the gift
   *  dialogue its own tap opens. See `setRayHouseHeldOpen`. */
  setRayHouseHeldOpen: (held: boolean) => void;
  /** Same contract again, for Ray himself (the traveler, not the house) and
   *  his own story dialogue bubble. See `setTravelerRayHeldOpen`. */
  setTravelerRayHeldOpen: (held: boolean) => void;
  /** Same contract again, for the Greenhouse and the panel its own tap
   *  opens. See `setGreenhouseHeldOpen`. */
  setGreenhouseHeldOpen: (held: boolean) => void;
}

export interface StackAcresWorldProps {
  units: StackAcresUnitSnapshot[];
  tool: StackAcresTool;
  /** Fired once, by nonce, to trigger the gold-burst effect on one unit --
   *  the client-side twin of a confirmed collect. */
  celebrate: { unitId: string; nonce: number } | null;
  onReady: () => void;
  /** What the belt is holding, so the Use key beside the thumb stick names the job it will do. */
  useKeyLabel: string;
  /**
   * The farmer is standing on a square with a belt tool in hand: either he
   * walked to a tapped one and arrived, or the Use key fired on the one under
   * his feet. This is how watering, sowing, hoeing and picking all reach the
   * shell now; it replaced the drag tokens and the seed ring.
   */
  onUseSquare: (square: UseSquare) => void;
  /** A finger landed on this district's fenced ground, on nothing in
   *  particular -- an offer to seed something there. `world` is the same
   *  point in world units, alongside the CSS-pixel `at` -- see
   *  StackAcresSceneCallbacks.onGroundTap's own doc for why both travel. */
  onGroundTap: (zone: ZoneId, at: TapPoint, world: WorldPoint) => void;
  /** A hold-tap relocation landed: the bed group touching `(tx, ty)` should
   *  move so that tile lands on `(toTx, toTy)`. See
   *  StackAcresSceneCallbacks.onSoilMoveCommitted's own doc. */
  onSoilMoveCommitted?: (tx: number, ty: number, toTx: number, toTy: number) => void;
  /** A finger landed on the barn -- Ray's Supply Store's own entryway. */
  onBarnTap: () => void;
  /** A finger landed on the signpost, the Town Board's entryway now that
   *  the places list is gone. */
  onSignpostTap: () => void;
  /** A finger landed on the Workshop building. */
  onWorkshopTap: () => void;
  /** A finger landed on the yard's well. Fills the watering can. */
  onWellTap: (at: TapPoint) => void;
  /** A finger landed on the pond's dock. Casts a line. */
  onDockTap: (at: TapPoint) => void;
  /** A finger landed on the Greenhouse's own footprint, from OUTSIDE it --
   *  the shell's cue to decide whether to open a build panel or call
   *  `enterGreenhouse` (see the api handle above). */
  onGreenhouseTap: () => void;
  /** A finger landed on one of the Greenhouse's own six slots, and ONLY while
   *  the scene is stepped inside it (`enterGreenhouse`). Row 0 is nearest the
   *  door -- see lib/stackacres/greenhouse.ts's `greenhouseSlotLocal`. */
  onGreenhouseSlotTap: (row: number, col: number, at: TapPoint) => void;
  /** A finger landed on the Midnight Merchant, while he is actually
   *  standing on the lot (see `setMerchant` on the imperative handle). */
  onMerchantTap: () => void;
  /** A finger landed on the delivery truck, while it is actually parked at
   *  its dock (see `setTruckPresent` on the imperative handle). Opens the
   *  same Town Contracts sheet `onSignpostTap` does. */
  onTruckTap: () => void;
  /** A finger landed on the Pixel Pilgrim himself. Fires no bow and
   *  reaches no server by itself -- this is only the cue to open his
   *  dialogue; see stackacres-farm.tsx's `onWorldMonkTap`. */
  onMonkTap: (at: TapPoint) => void;
  /** A finger landed on Grandfather Ray himself, not the barn behind him --
   *  see stackacres-farm.tsx's `onWorldRayTap`. */
  onRayTap: (at: TapPoint) => void;
  /** A finger landed on one of the eleven story travelers (see
   *  lib/stackacres/story/placement.ts). `at` is the point over their head,
   *  where the dialogue bubble hangs; see stackacres-farm.tsx's
   *  `onWorldTravelerTap`. */
  onTravelerTap: (traveler: TravelerId, at: TapPoint) => void;
  /** A finger landed on one of the three hidden discovery spots (see
   *  lib/stackacres/secrets.ts's `HIDDEN_ZONES`). The scene has already fired
   *  its own local `secretDiscoveryPuff` by the time this callback runs. */
  onSecretZoneTap: (zoneId: HiddenZoneId, at: TapPoint) => void;
  /** A finger landed on one bay of a district's fence line -- the cue to
   *  open the fence-upgrade popup. Optional: a caller that never wires it
   *  simply never opts into the fence hit-test at all (see
   *  StackAcresSceneCallbacks.onFenceSegmentTap's own doc). */
  onFenceSegmentTap?: (zone: ZoneId, segmentIndex: number, at: TapPoint) => void;
  /** Informational: the Wildlife Manager's own predator simulation lowered
   *  a district's livestock health. The shell's cue to persist it. */
  onLivestockDamaged?: (zone: ZoneId, health: number) => void;
  /** Land the player may work (lib/stackacres/sectors.ts). Everything else
   *  is drawn as wild growth and has no farm on it to tap. */
  sectors: SectorId[];
  /** Whether the Crop Fields have been unlocked (lib/stackacres/crop-fields.ts)
   *  -- the `sectors` equivalent for ground that is not a `SectorId` any more
   *  since the 2026-09-08 district merge folded it into the Farmstead. */
  cropFieldsUnlocked: boolean;
  /** A finger landed anywhere on land that has not been cleared -- the offer
   *  to buy it, answered by the clearing modal in stackacres-farm.tsx. */
  onLockedSectorTap: (zone: ZoneId, at: TapPoint) => void;
  /** `onLockedSectorTap`'s own twin for the Crop Fields -- see
   *  StackAcresSceneCallbacks' own doc comment on why they need a separate
   *  callback since the 2026-09-08 district merge. */
  onCropFieldsLockedTap: (at: TapPoint) => void;
  /** The camera moved, so anything the shell pinned to a screen position is
   *  now pointing at the wrong part of the world. */
  onViewMoved: () => void;
  /** The cutter in hand, which sets the mow swathe and how long it stays cut. */
  cutter: StackAcresCutter;
  /** The Synergy Tree's `automated_logistics` multiplier on the farmhand's
   *  walk speed -- `StackAcresView.synergy.farmhandSpeedMultiplier`, 1 with
   *  no active perk. */
  farmhandSpeedMultiplier: number;
  /** How much wider than the arrival window the camera frames a district --
   *  `HUD_VIEW_EXPANSION` while the signpost rail is collapsed into the
   *  compass quick-nav, 1 otherwise. */
  viewExpansion: number;
  /** Placed soil beds, ALREADY merged with the starter pair -- the shell owns
   *  that merge (see stackacres-farm.tsx's `applyResponse`), this component
   *  only ever pushes what it is handed straight into the scene, the same
   *  "push, never rebuild" contract `sectors` above already follows. */
  soilTiles: readonly SoilTile[];
  /** The irrigation pipe network, straight off `StackAcresView.irrigation` --
   *  pushed straight through to the scene's own `setIrrigation`, the same
   *  "push, never rebuild" contract `soilTiles` above already follows (the
   *  scene diffs against what it already drew via `diffPipeGrid`, so a
   *  reference that has not moved repaints nothing). */
  irrigation: readonly PipeNode[];
  /** A patrolling drone just started its vacuum animation on a spawned
   *  drop -- see StackAcresSceneCallbacks.onDroneForageCollected's own doc
   *  comment for why this fires before the animation finishes. */
  onDroneForageCollected: (droneId: string) => void;
  api: Ref<StackAcresWorldApi | null>;
}
