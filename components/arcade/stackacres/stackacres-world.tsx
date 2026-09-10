"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { SectorId } from "@/lib/stackacres/sectors";
import { stackacresCutterDef, type StackAcresCutter } from "@/lib/stackacres/cutters";
import type { MuseumGlowTier } from "@/lib/stackacres/museum-secrets";
import type { HiddenZoneId } from "@/lib/stackacres/secrets";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { PropKind } from "@/lib/stackacres/props";
import type { FenceTier, WildlifeTimeOfDay } from "@/lib/stackacres/wildlife";
import type { PainterName } from "./stackacres-art";
import type { StackAcresScene, StackAcresSceneUnit, TapPoint } from "./stackacres-scene";
import type { WorldPoint } from "@/lib/stackacres/world";
import type { SoilTile } from "@/lib/stackacres/soil";
import type { PipeNode } from "@/lib/stackacres/irrigation";
import type { SoilTier } from "@/lib/stackacres/soil-tiers";
import type { FarmhandPlanInput } from "@/lib/stackacres/farmhand-plan";

/** The processing half of a snapshot: everything the AUTOMATED farmhand
 *  plans against (lib/stackacres/farmhand-plan.ts). Separate from `units`
 *  because nothing in it is a `homestead_units` row -- wheat, mills and
 *  contracts are the processing track, deliberately out of reach of the
 *  harvest sweep that pays Gold. See lib/stackacres/machine-items.ts. */
export type StackAcresProcessing = Omit<FarmhandPlanInput, "claimed"> & {
  profileId: string | null;
};

/**
 * The Phaser mount, and the bundle boundary.
 *
 * Both the engine and the scene enter through the dynamic import below, so a
 * player who never opens the StackAcres never downloads Phaser -- the same
 * isolation poker-app.tsx's `dynamic(..., { ssr: false })` gives the table.
 *
 * Rendering is driven from props: `units` plus the held tool become the
 * scene's own units. THERE IS NO PLOT GRID (see 2026-09-03's CLAUDE.md entry
 * -- "districts hold stock, not plots"), but the farm is directly tappable:
 * `onUnitTap` fires when a finger lands on a unit's own picture and
 * `onGroundTap` when it lands on a district's empty fenced ground, both
 * carrying the tap point in CSS pixels relative to this host -- which is the
 * same box every DOM overlay on the screen is positioned in, so the shell can
 * drop a radial menu straight onto those numbers. `onBarnTap` fires when a
 * finger lands on the barn itself -- Ray's Museum's entryway -- and carries
 * no tap point, since it opens a modal rather than anchoring anything to the
 * screen. `onViewMoved` says the camera has shifted under anything so
 * pinned. The rest of the contract is
 * unchanged: `onReady` when the first frame is drawn, and, through `api`,
 * a way for the shell to move the camera (`zoomBy` for the zoom buttons mouse
 * users need, since nobody has a pinch gesture with a mouse; `recenter` for
 * "home"; `focusZone` for the destination signpost) and to answer a tap in
 * the world it landed in (`popUnit`, `floatAt`).
 *
 * The canvas is decorative to assistive tech -- `aria-hidden`. The
 * keyboard/screen-reader surface is the district sidebar's own real DOM
 * buttons, not a second hidden copy of the map kept in sync with it: tapping
 * the map is the fast path, and every one of those taps has a sidebar row
 * that does the same thing.
 */

export interface StackAcresWorldApi {
  zoomBy: (factor: number) => void;
  recenter: () => void;
  /** Travel to a district's gate (lib/stackacres/zones.ts). */
  focusZone: (zone: ZoneId) => void;
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
  /** A line of text that lifts off the tap and fades -- the reward, or the
   *  reason there wasn't one. */
  floatAt: (at: TapPoint, text: string, tone: "gain" | "deny", icon?: PainterName) => void;
  /** Adds or removes the Midnight Merchant's own picture from the lot.
   *  PUSHED rather than a prop-driven effect's usual shape because
   *  stackacres-farm.tsx already owns the render decision itself
   *  (`MidnightMerchantManager.isRendered()`) and only needs to tell the
   *  scene when that boolean actually flips -- the same "push, never
   *  rebuild" contract `setToolTier`/`setMuseumGlowTier` already use for
   *  their own props, exposed through the imperative handle instead of a
   *  prop because it is closer in shape to `popUnit`/`floatAt` (a command
   *  fired from an event) than to a value the scene must always reflect. */
  setMerchant: (present: boolean) => void;
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
  setFenceTier: (zone: ZoneId, segmentIndex: number, tier: FenceTier, durability: number) => void;
  setLivestockHealth: (zone: ZoneId, health: number) => void;
  /** Every Mechanical Forage Drone this profile owns, by id --
   *  `StackAcresView.droneHangar.drones` mapped to their ids. PUSHED, same
   *  "push, never rebuild" contract as `setMerchant`: stackacres-farm.tsx
   *  calls this when the view's own drone list changes, not on every
   *  render. Passing the unchanged list twice is a harmless no-op (the
   *  scene's own `setDroneHangar` diffs against what it already has). */
  setDroneHangar: (droneIds: string[]) => void;
  /** Parks every drone's forage drops for `durationMs` -- they keep flying,
   *  they just stop finding anything. Called when the server refuses a claim
   *  with `day-capped`: the farm cannot pay another Gold piece today, so the
   *  fleet has nothing to fetch until the allowance refills. */
  holdDroneForage: (durationMs: number) => void;
  /** A world point as pixels inside the field, for pointing a drag tool at a
   *  fixed spot. Null until the scene has booted. */
  fieldPointFor: (x: number, y: number) => TapPoint | null;
}

export interface StackAcresWorldProps {
  units: StackAcresUnitSnapshot[];
  tool: StackAcresTool;
  /** Fired once, by nonce, to trigger the gold-burst effect on one unit --
   *  the client-side twin of a confirmed collect. */
  celebrate: { unitId: string; nonce: number } | null;
  onReady: () => void;
  /** A finger landed on this unit's own picture. */
  onUnitTap: (unitId: string, at: TapPoint) => void;
  /** A finger landed on this unit but the held tool cannot act on it -- an
   *  offer to point at it rather than an action. See
   *  StackAcresSceneCallbacks.onUnitSelect. */
  onUnitSelect: (unitId: string, at: TapPoint) => void;
  /** A finger landed on this district's fenced ground, on nothing in
   *  particular -- an offer to seed something there. `world` is the same
   *  point in world units, alongside the CSS-pixel `at` -- see
   *  StackAcresSceneCallbacks.onGroundTap's own doc for why both travel. */
  onGroundTap: (zone: ZoneId, at: TapPoint, world: WorldPoint) => void;
  /** A finger landed on the barn -- Ray's Museum's own entryway. */
  onBarnTap: () => void;
  /** A finger landed on the signpost, the Town Board's entryway now that
   *  the places list is gone. */
  onSignpostTap: () => void;
  /** A finger landed on the windmill, the Workshop's entryway. */
  onWorkshopTap: () => void;
  /** A finger landed on the yard's well. Fills the watering can. */
  onWellTap: (at: TapPoint) => void;
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
  /** A finger landed on the Pixel Pilgrim's own shrine. Fires no bow and
   *  reaches no server by itself -- this is only the cue to open his
   *  dialogue; see stackacres-farm.tsx's `onWorldMonkTap`. */
  onMonkTap: (at: TapPoint) => void;
  /** A finger landed on Grandfather Ray himself, not the barn behind him --
   *  see stackacres-farm.tsx's `onWorldRayTap`. */
  onRayTap: (at: TapPoint) => void;
  /** A finger landed on one of the ten stranded visitors (see
   *  lib/stackacres/visitors.ts) -- the cue to show that visitor's own
   *  one-line greeting; see stackacres-farm.tsx's `onWorldVisitorTap`. */
  onVisitorTap: (kind: PropKind, at: TapPoint) => void;
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
  /** Which of the barn's two glow states should be showing, if either -- see
   *  lib/stackacres/museum-secrets.ts's `museumGlowTier`. */
  museumGlowTier: MuseumGlowTier;
  /** The Synergy Tree's `automated_logistics` multiplier on the farmhand's
   *  walk speed -- `StackAcresView.synergy.farmhandSpeedMultiplier`, 1 with
   *  no active perk. */
  farmhandSpeedMultiplier: number;
  /** How much wider than the arrival window the camera frames a district --
   *  `HUD_VIEW_EXPANSION` while the signpost rail is collapsed into the
   *  compass quick-nav, 1 otherwise. */
  viewExpansion: number;
  /** True once Ray's Museum's hidden set has ever been completed -- a
   *  persistent fact of the registry, not a one-shot nonce, since the Pixel
   *  Pilgrim's own unlock tint should hold on every load after the first,
   *  not just the harvest that earned it (see stackacres-scene.ts's own
   *  header on that method for why it now lands on him rather than the
   *  farmhand). The scene's own `setFarmhandSecretUnlock` is idempotent, so
   *  pushing this on every change (and once at mount) is safe even before it
   *  ever flips true. */
  secretSetComplete: boolean;
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

/**
 * The picture the mow-drag ghost shows: the cutter in hand (Scythe or Mower)
 * while mowing, the tool's own icon otherwise. It used to draw the spade
 * ladder's rung, so a Golden Spade owner watched a spade mow the meadow.
 */
function toolGhostIcon(tool: StackAcresTool, cutter: StackAcresCutter): PainterName {
  const def = tool === "scythe" ? stackacresCutterDef(cutter) : STACKACRES_TOOL_DEFS[tool];
  return def.icon as PainterName;
}

function toUnits(units: StackAcresUnitSnapshot[]): StackAcresSceneUnit[] {
  return units.map((unit) => ({
    id: unit.id,
    stock: unit.stock,
    state: unit.state,
    progress: unit.progress,
    permanent: unit.permanent,
    soilSlot: unit.soilSlot,
    housedIn: unit.housedIn,
    seed: unit.seed,
  }));
}

export function StackAcresWorld({
  units,
  tool,
  cutter,
  museumGlowTier,
  farmhandSpeedMultiplier,
  viewExpansion,
  secretSetComplete,
  celebrate,
  onReady,
  onUnitTap,
  onUnitSelect,
  onGroundTap,
  onBarnTap,
  onSignpostTap,
  onWorkshopTap,
  onWellTap,
  onGreenhouseTap,
  onGreenhouseSlotTap,
  onMerchantTap,
  onMonkTap,
  onRayTap,
  onVisitorTap,
  onSecretZoneTap,
  onFenceSegmentTap,
  onLivestockDamaged,
  sectors,
  cropFieldsUnlocked,
  onLockedSectorTap,
  onCropFieldsLockedTap,
  onViewMoved,
  soilTiles,
  irrigation,
  onDroneForageCollected,
  api,
}: StackAcresWorldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StackAcresScene | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void } | null>(null);

  // The scene calls back into whatever the shell currently is, not whatever
  // it was when the game booted.
  const readyRef = useRef(onReady);
  const unitTapRef = useRef(onUnitTap);
  const unitSelectRef = useRef(onUnitSelect);
  const groundTapRef = useRef(onGroundTap);
  const barnTapRef = useRef(onBarnTap);
  const signpostTapRef = useRef(onSignpostTap);
  const workshopTapRef = useRef(onWorkshopTap);
  const wellTapRef = useRef(onWellTap);
  const greenhouseTapRef = useRef(onGreenhouseTap);
  const greenhouseSlotTapRef = useRef(onGreenhouseSlotTap);
  const merchantTapRef = useRef(onMerchantTap);
  const monkTapRef = useRef(onMonkTap);
  const rayTapRef = useRef(onRayTap);
  const visitorTapRef = useRef(onVisitorTap);
  const secretZoneTapRef = useRef(onSecretZoneTap);
  const fenceSegmentTapRef = useRef(onFenceSegmentTap);
  const livestockDamagedRef = useRef(onLivestockDamaged);
  const lockedTapRef = useRef(onLockedSectorTap);
  const cropFieldsLockedTapRef = useRef(onCropFieldsLockedTap);
  const viewMovedRef = useRef(onViewMoved);
  const droneForageCollectedRef = useRef(onDroneForageCollected);
  // The tool's own picture, for the mow-drag ghost -- read at mount (before
  // the scene exists to push it to) and again on every change afterward.
  const toolIconRef = useRef<PainterName>(toolGhostIcon(tool, cutter));
  // The tool itself, not just its picture: the scythe's target is ground
  // rather than a unit, so the scene has to know which tool is held to read a
  // drag correctly. See `setTool` in stackacres-scene.ts.
  const toolRef = useRef<StackAcresTool>(tool);
  // Read at mount for the same reason `toolRef` is: the scene does not exist
  // yet to be told, and it needs the right swathe on its very first stroke.
  const cutterRef = useRef<StackAcresCutter>(cutter);
  // Read at mount for the same reason `cutterRef` is.
  const museumGlowTierRef = useRef<MuseumGlowTier>(museumGlowTier);
  // Read at mount for the same reason `cutterRef` is: the boot path needs
  // the right walk speed on his very first step.
  const farmhandSpeedMultiplierRef = useRef(farmhandSpeedMultiplier);
  // Read at mount for the same reason: the opening shot is framed in create().
  const viewExpansionRef = useRef(viewExpansion);
  useEffect(() => {
    readyRef.current = onReady;
    unitTapRef.current = onUnitTap;
    unitSelectRef.current = onUnitSelect;
    groundTapRef.current = onGroundTap;
    barnTapRef.current = onBarnTap;
    signpostTapRef.current = onSignpostTap;
    workshopTapRef.current = onWorkshopTap;
    wellTapRef.current = onWellTap;
    greenhouseTapRef.current = onGreenhouseTap;
    greenhouseSlotTapRef.current = onGreenhouseSlotTap;
    merchantTapRef.current = onMerchantTap;
    monkTapRef.current = onMonkTap;
    rayTapRef.current = onRayTap;
    visitorTapRef.current = onVisitorTap;
    secretZoneTapRef.current = onSecretZoneTap;
    fenceSegmentTapRef.current = onFenceSegmentTap;
    livestockDamagedRef.current = onLivestockDamaged;
    lockedTapRef.current = onLockedSectorTap;
    cropFieldsLockedTapRef.current = onCropFieldsLockedTap;
    viewMovedRef.current = onViewMoved;
    droneForageCollectedRef.current = onDroneForageCollected;
    toolIconRef.current = toolGhostIcon(tool, cutter);
    toolRef.current = tool;
    cutterRef.current = cutter;
    museumGlowTierRef.current = museumGlowTier;
    farmhandSpeedMultiplierRef.current = farmhandSpeedMultiplier;
    viewExpansionRef.current = viewExpansion;
  });

  const sceneUnits = useMemo(() => toUnits(units), [units]);
  const unitsRef = useRef(sceneUnits);
  const sectorsRef = useRef(sectors);
  const cropFieldsUnlockedRef = useRef(cropFieldsUnlocked);
  const soilTilesRef = useRef(soilTiles);
  const irrigationRef = useRef(irrigation);
  useEffect(() => {
    unitsRef.current = sceneUnits;
    sectorsRef.current = sectors;
    cropFieldsUnlockedRef.current = cropFieldsUnlocked;
    soilTilesRef.current = soilTiles;
    irrigationRef.current = irrigation;
  });

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      // The module namespace, not `.default`: see the import note at the top
      // of stackacres-scene.ts.
      const [Phaser, { StackAcresScene: SceneClass, DPR }] = await Promise.all([
        import("phaser"),
        import("./stackacres-scene"),
      ]);
      if (cancelled) return;

      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const scene = new SceneClass(
        {
          onReady: () => readyRef.current(),
          onUnitTap: (unitId, at) => unitTapRef.current(unitId, at),
          onUnitSelect: (unitId, at) => unitSelectRef.current(unitId, at),
          onGroundTap: (zone, at, world) => groundTapRef.current(zone, at, world),
          onBarnTap: () => barnTapRef.current(),
          onSignpostTap: () => signpostTapRef.current(),
          onWorkshopTap: () => workshopTapRef.current(),
          onWellTap: (at) => wellTapRef.current(at),
          onGreenhouseTap: () => greenhouseTapRef.current(),
          onGreenhouseSlotTap: (row, col, at) => greenhouseSlotTapRef.current(row, col, at),
          onMerchantTap: () => merchantTapRef.current(),
          onMonkTap: (at) => monkTapRef.current(at),
          onRayTap: (at) => rayTapRef.current(at),
          onVisitorTap: (kind, at) => visitorTapRef.current(kind, at),
          onSecretZoneTap: (zoneId, at) => secretZoneTapRef.current(zoneId, at),
          onFenceSegmentTap: (zone, segmentIndex, at) => fenceSegmentTapRef.current?.(zone, segmentIndex, at),
          onLivestockDamaged: (zone, health) => livestockDamagedRef.current?.(zone, health),
          onLockedSectorTap: (zone, at) => lockedTapRef.current(zone, at),
          onCropFieldsLockedTap: (at) => cropFieldsLockedTapRef.current(at),
          onViewMoved: () => viewMovedRef.current(),
          onDroneForageCollected: (droneId) => droneForageCollectedRef.current(droneId),
        },
        {
          reducedMotion,
          host,
          cutter: cutterRef.current,
          museumGlowTier: museumGlowTierRef.current,
          farmhandSpeedMultiplier: farmhandSpeedMultiplierRef.current,
          viewExpansion: viewExpansionRef.current,
        },
      );

      const size = () => ({
        width: Math.max(2, Math.round(host.clientWidth * DPR)),
        height: Math.max(2, Math.round(host.clientHeight * DPR)),
      });
      const first = size();

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        // Smoothing on, everywhere: the world is baked vector art rather than
        // pixel art, and it is drawn oversized and scaled down. `pixelArt`
        // must stay false -- true would force roundPixels on and nearest-
        // neighbour sampling, which is the blocky look this pass exists to
        // avoid. `roundPixels: false` keeps sub-pixel camera positions, so a
        // slow pan glides instead of stepping. The mipmap filter only takes
        // effect on power-of-two textures, which is why bakeTexture pads
        // every painter's canvas out to one (see stackacres-art.ts).
        pixelArt: false,
        render: { antialias: true, mipmapFilter: "LINEAR_MIPMAP_LINEAR", roundPixels: false },
        backgroundColor: "#86c96e",
        // Phaser handles no input at all. The scene reads pointer events off
        // this host element itself (see stackacres-scene.ts's bindInput for
        // why), and two input layers on one surface would double-handle every
        // press.
        input: { mouse: false, touch: false, keyboard: false },
        // Rendered at device resolution and shown at CSS size (52-stackacres.css
        // forces the canvas to fill its host): the canvas is DPR times denser
        // than the screen, which is what keeps the vector art crisp. Scale.NONE
        // because we drive the size ourselves -- RESIZE would match the canvas
        // to the CSS box and throw that density away.
        scale: { mode: Phaser.Scale.NONE, width: first.width, height: first.height },
        // The world is a few hundred sprites on one texture; the default
        // loop is cheap here, and a drag wants every frame it can get.
        scene,
        // No physics: the animals are a pure function in lib/stackacres/world.ts.
        audio: { noAudio: true },
      });
      sceneRef.current = scene;
      gameRef.current = game;
      scene.setUnits(unitsRef.current);
      // Before the units, in spirit if not in order: which land is cleared
      // decides whether a district is drawn as a farm at all, and the scene's
      // own default is "all wild" (see its `locked` field) precisely so the
      // gap between boot and this call never shows a pen that is not there.
      scene.setSectors(sectorsRef.current);
      scene.setCropFieldsUnlocked(cropFieldsUnlockedRef.current);
      scene.setSoil(soilTilesRef.current);
      scene.setIrrigation(irrigationRef.current);
      scene.setToolIcon(toolIconRef.current);
      scene.setTool(toolRef.current);

      // A handle for the gesture harness to read the camera through, and for
      // Chrono-DeLorean Mode's timescale engine to reach the live Phaser
      // instance (lib/dev/chrono-simulation-engine.ts) -- `game` rides on
      // this same handle rather than a second global so there is exactly one
      // dev-only door onto this scene, not two to keep in sync. Dev only:
      // production never gets a global.
      if (process.env.NODE_ENV !== "production") {
        (
          window as unknown as {
            __stackacres?: {
              scene: unknown;
              game: unknown;
              screenPointFor: (x: number, y: number) => TapPoint;
            };
          }
        ).__stackacres = { scene, game, screenPointFor: (x, y) => scene.screenPointFor(x, y) };
      }

      // The scale manager only has a canvas to size once the game has booted,
      // so every resize -- including the observer's own first, synchronous
      // call -- waits for it.
      const fit = () => {
        if (!game.isBooted) return;
        const next = size();
        if (game.scale.width === next.width && game.scale.height === next.height) return;
        game.scale.resize(next.width, next.height);
        game.scale.refresh();
      };
      game.events.once("ready", fit);
      observer = new ResizeObserver(fit);
      observer.observe(host);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      observer = null;
      sceneRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as { __stackacres?: unknown }).__stackacres;
      }
    };
  }, []);

  // The shell's handle. Every method looks the scene up at call time, so the
  // handle is valid from first render and simply does nothing until the
  // engine has finished booting.
  useImperativeHandle(
    api,
    () => ({
      zoomBy: (factor) => sceneRef.current?.zoomBy(factor),
      recenter: () => sceneRef.current?.recenter(),
      focusZone: (zone) => sceneRef.current?.focusZone(zone),
      popUnit: (unitId) => sceneRef.current?.popUnit(unitId),
      celebrateCascade: (unitIds) => sceneRef.current?.celebrateCascade(unitIds),
      celebrateCrit: (unitId, multiplier) => sceneRef.current?.celebrateCrit(unitId, multiplier),
      registerFrenzyTap: (unitId, baseYieldGold) => sceneRef.current?.registerFrenzyTap(unitId, baseYieldGold),
      playMonkPrayer: () => sceneRef.current?.playMonkPrayer(),
      enterGreenhouse: () => sceneRef.current?.enterGreenhouse(),
      exitGreenhouse: () => sceneRef.current?.exitGreenhouse(),
      floatAt: (at, text, tone, icon) => sceneRef.current?.floatAt(at, text, tone, icon),
      setMerchant: (present) => sceneRef.current?.setMerchant(present),
      soilTiles: () => sceneRef.current?.soilTiles() ?? [],
      setSoil: (tiles) => sceneRef.current?.setSoil(tiles),
      placeSoilAt: (x, y, tier) => sceneRef.current?.placeSoilAt(x, y, tier) ?? false,
      removeSoilAt: (x, y) => sceneRef.current?.removeSoilAt(x, y) ?? false,
      previewSoilAt: (world) => sceneRef.current?.previewSoilAt(world),
      tapAt: (clientX, clientY) => sceneRef.current?.tapAt(clientX, clientY),
      setWildlifeTimeOfDay: (tod) => sceneRef.current?.setWildlifeTimeOfDay(tod),
      setFenceTier: (zone, segmentIndex, tier, durability) =>
        sceneRef.current?.setFenceTier(zone, segmentIndex, tier, durability),
      setLivestockHealth: (zone, health) => sceneRef.current?.setLivestockHealth(zone, health),
      setDroneHangar: (droneIds) => sceneRef.current?.setDroneHangar(droneIds),
      holdDroneForage: (durationMs) => sceneRef.current?.holdDroneForage(durationMs),
      fieldPointFor: (x, y) => sceneRef.current?.fieldPointFor(x, y) ?? null,
    }),
    [],
  );

  // Repaint when some unit's picture changed. The parent re-derives units
  // every second for its countdowns; the scene diffs per unit and only
  // rebuilds the ones whose signature moved, so this is cheap to call often.
  useEffect(() => {
    sceneRef.current?.setUnits(sceneUnits);
  }, [sceneUnits]);

  // Cheap to call on every render: the scene diffs against what it has
  // already drawn and repaints nothing when the answer has not moved.
  useEffect(() => {
    sceneRef.current?.setSectors(sectors);
  }, [sectors]);

  useEffect(() => {
    sceneRef.current?.setCropFieldsUnlocked(cropFieldsUnlocked);
  }, [cropFieldsUnlocked]);

  // `setSoil` repaints the beds, the grass collar around them and every
  // crop's slot -- not cheap on a snapshot that changed nothing about the
  // soil. The shell (stackacres-farm.tsx) is what keeps this rare: it only
  // hands down a new `soilTiles` array reference when `soilTilesEqual` says
  // the layout actually moved, even though every action response carries the
  // full list whether or not it did.
  useEffect(() => {
    sceneRef.current?.setSoil(soilTiles);
  }, [soilTiles]);

  // `setIrrigation` diffs against what the scene already drew (see its own
  // doc comment), so handing it the same reference twice -- which every
  // action response does whether or not the network actually moved -- is a
  // harmless no-op, the same posture `setSectors` above takes.
  useEffect(() => {
    sceneRef.current?.setIrrigation(irrigation);
  }, [irrigation]);

  // Keyed on the cutter as well as the tool: a swap has to change what is in
  // the player's hand immediately, without a remount.
  useEffect(() => {
    sceneRef.current?.setToolIcon(toolGhostIcon(tool, cutter));
    sceneRef.current?.setTool(tool);
  }, [tool, cutter]);

  // Pushed rather than rebuilt: see `setCutter` in stackacres-scene.ts.
  useEffect(() => {
    sceneRef.current?.setCutter(cutter);
  }, [cutter]);

  // Same "push, never rebuild" reasoning as cutter above -- see
  // `setFarmhandSpeedMultiplier` in stackacres-scene.ts.
  useEffect(() => {
    sceneRef.current?.setFarmhandSpeedMultiplier(farmhandSpeedMultiplier);
  }, [farmhandSpeedMultiplier]);

  // Same "push, never rebuild" reasoning -- see `setViewExpansion`.
  useEffect(() => {
    sceneRef.current?.setViewExpansion(viewExpansion);
  }, [viewExpansion]);

  // Same "push, never rebuild" reasoning as cutter above -- see
  // `setMuseumGlowTier` in stackacres-scene.ts.
  useEffect(() => {
    sceneRef.current?.setMuseumGlowTier(museumGlowTier);
  }, [museumGlowTier]);

  useEffect(() => {
    sceneRef.current?.setFarmhandSecretUnlock(secretSetComplete);
  }, [secretSetComplete]);

  useEffect(() => {
    if (celebrate) sceneRef.current?.celebrateHarvest(celebrate.unitId);
  }, [celebrate]);

  return <div ref={hostRef} className="sa-world" aria-hidden="true" />;
}
