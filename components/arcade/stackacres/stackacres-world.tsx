"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { SectorId } from "@/lib/stackacres/sectors";
import type { StackAcresToolTier } from "@/lib/stackacres/equipment";
import type { MuseumGlowTier } from "@/lib/stackacres/museum-secrets";
import type { HiddenZoneId } from "@/lib/stackacres/secrets";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { PainterName } from "./stackacres-art";
import type { StackAcresScene, StackAcresSceneUnit, TapPoint } from "./stackacres-scene";
import type { FarmhandHooks } from "@/lib/stackacres/farmhand-machine";
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
  /** Send the farmhand over to a unit that has just been acted on.
   *  Decoration on a request that has already left the browser: he refuses
   *  silently outside the Farmstead, and can never delay or cancel a write.
   *  See lib/stackacres/farmhand.ts. */
  sendFarmhand: (unitId: string) => void;
  /** A tap that became a real action, never a refused one: registers one hit
   *  with the Frenzy Heat Combo Engine and throws its cosmetic feedback at
   *  the unit's own live position. `baseYieldGold` is a DISPLAY ESTIMATE,
   *  meaningful only for a "collect" tap -- see lib/stackacres/frenzy.ts's
   *  own header for why this never touches a real payout. */
  registerFrenzyTap: (unitId: string, baseYieldGold?: number) => void;
  /** What the AUTOMATED farmhand may do when a cycle finishes. Passed through
   *  the handle rather than as a prop because every hook is a request the
   *  shell already knows how to make, and rebuilding the scene's wiring on
   *  each render of the shell would be a new closure per frame. */
  setFarmhandHooks: (hooks: FarmhandHooks) => void;
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
  /** A finger landed on this district's fenced ground, on nothing in
   *  particular -- an offer to seed something there. */
  onGroundTap: (zone: ZoneId, at: TapPoint) => void;
  /** A finger landed on the barn -- Ray's Museum's own entryway. */
  onBarnTap: () => void;
  /** A finger landed on the Midnight Merchant, while he is actually
   *  standing on the lot (see `setMerchant` on the imperative handle). */
  onMerchantTap: () => void;
  /** A finger landed on one of the three hidden discovery spots (see
   *  lib/stackacres/secrets.ts's `HIDDEN_ZONES`). The scene has already fired
   *  its own local `secretDiscoveryPuff` by the time this callback runs. */
  onSecretZoneTap: (zoneId: HiddenZoneId, at: TapPoint) => void;
  /** Land the player may work (lib/stackacres/sectors.ts). Everything else
   *  is drawn as wild growth and has no farm on it to tap. */
  sectors: SectorId[];
  /** A finger landed anywhere on land that has not been cleared -- the offer
   *  to buy it, answered by the clearing modal in stackacres-farm.tsx. */
  onLockedSectorTap: (zone: ZoneId, at: TapPoint) => void;
  /** The camera moved, so anything the shell pinned to a screen position is
   *  now pointing at the wrong part of the world. */
  onViewMoved: () => void;
  /** The equipment rung held, which sets the scythe's swathe. */
  toolTier: StackAcresToolTier;
  /** Which of the barn's two glow states should be showing, if either -- see
   *  lib/stackacres/museum-secrets.ts's `museumGlowTier`. */
  museumGlowTier: MuseumGlowTier;
  /** The Synergy Tree's `automated_logistics` multiplier on the farmhand's
   *  walk speed -- `StackAcresView.synergy.farmhandSpeedMultiplier`, 1 with
   *  no active perk. */
  farmhandSpeedMultiplier: number;
  /** True once Ray's Museum's hidden set has ever been completed -- a
   *  persistent fact of the registry, not a one-shot nonce, since the
   *  farmhand's own unlock tint should hold on every load after the first,
   *  not just the harvest that earned it. The scene's own
   *  `setFarmhandSecretUnlock` is idempotent, so pushing this on every
   *  change (and once at mount) is safe even before it ever flips true. */
  secretSetComplete: boolean;
  /** What the automated farmhand works from. Null before the first snapshot
   *  lands, which is exactly when he should be standing still anyway. */
  processing: StackAcresProcessing | null;
  api: Ref<StackAcresWorldApi | null>;
}

function toUnits(units: StackAcresUnitSnapshot[]): StackAcresSceneUnit[] {
  return units.map((unit) => ({
    id: unit.id,
    stock: unit.stock,
    state: unit.state,
    progress: unit.progress,
    permanent: unit.permanent,
  }));
}

export function StackAcresWorld({
  units,
  tool,
  toolTier,
  museumGlowTier,
  farmhandSpeedMultiplier,
  secretSetComplete,
  celebrate,
  onReady,
  onUnitTap,
  onGroundTap,
  onBarnTap,
  onMerchantTap,
  onSecretZoneTap,
  sectors,
  onLockedSectorTap,
  onViewMoved,
  processing,
  api,
}: StackAcresWorldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StackAcresScene | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void } | null>(null);

  // The scene calls back into whatever the shell currently is, not whatever
  // it was when the game booted.
  /** Read at mount for the same reason `toolTierRef` is: the boot path needs
   *  the snapshot that has already arrived, and the scene does not exist yet
   *  to be told about it. Kept current by the effect below, and separately
   *  pushed into the scene by its own effect once it does exist. */
  const processingRef = useRef(processing);
  const readyRef = useRef(onReady);
  const unitTapRef = useRef(onUnitTap);
  const groundTapRef = useRef(onGroundTap);
  const barnTapRef = useRef(onBarnTap);
  const merchantTapRef = useRef(onMerchantTap);
  const secretZoneTapRef = useRef(onSecretZoneTap);
  const lockedTapRef = useRef(onLockedSectorTap);
  const viewMovedRef = useRef(onViewMoved);
  // The tool's own picture, for the mow-drag ghost -- read at mount (before
  // the scene exists to push it to) and again on every change afterward.
  const toolIconRef = useRef<PainterName>(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
  // The tool itself, not just its picture: the scythe's target is ground
  // rather than a unit, so the scene has to know which tool is held to read a
  // drag correctly. See `setTool` in stackacres-scene.ts.
  const toolRef = useRef<StackAcresTool>(tool);
  // Read at mount for the same reason `toolRef` is: the scene does not exist
  // yet to be told, and it needs the right swathe on its very first stroke.
  const toolTierRef = useRef<StackAcresToolTier>(toolTier);
  // Read at mount for the same reason `toolTierRef` is.
  const museumGlowTierRef = useRef<MuseumGlowTier>(museumGlowTier);
  // Read at mount for the same reason `toolTierRef` is: the boot path needs
  // the right walk speed on his very first step.
  const farmhandSpeedMultiplierRef = useRef(farmhandSpeedMultiplier);
  useEffect(() => {
    processingRef.current = processing;
    readyRef.current = onReady;
    unitTapRef.current = onUnitTap;
    groundTapRef.current = onGroundTap;
    barnTapRef.current = onBarnTap;
    merchantTapRef.current = onMerchantTap;
    secretZoneTapRef.current = onSecretZoneTap;
    lockedTapRef.current = onLockedSectorTap;
    viewMovedRef.current = onViewMoved;
    toolIconRef.current = STACKACRES_TOOL_DEFS[tool].icon as PainterName;
    toolRef.current = tool;
    toolTierRef.current = toolTier;
    museumGlowTierRef.current = museumGlowTier;
    farmhandSpeedMultiplierRef.current = farmhandSpeedMultiplier;
  });

  const sceneUnits = useMemo(() => toUnits(units), [units]);
  const unitsRef = useRef(sceneUnits);
  const sectorsRef = useRef(sectors);
  useEffect(() => {
    unitsRef.current = sceneUnits;
    sectorsRef.current = sectors;
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
          onGroundTap: (zone, at) => groundTapRef.current(zone, at),
          onBarnTap: () => barnTapRef.current(),
          onMerchantTap: () => merchantTapRef.current(),
          onSecretZoneTap: (zoneId, at) => secretZoneTapRef.current(zoneId, at),
          onLockedSectorTap: (zone, at) => lockedTapRef.current(zone, at),
          onViewMoved: () => viewMovedRef.current(),
        },
        {
          reducedMotion,
          host,
          toolTier: toolTierRef.current,
          museumGlowTier: museumGlowTierRef.current,
          farmhandSpeedMultiplier: farmhandSpeedMultiplierRef.current,
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
      if (processingRef.current) scene.setProcessing(processingRef.current);
      scene.setToolIcon(toolIconRef.current);
      scene.setTool(toolRef.current);

      // A handle for the gesture harness to read the camera through. Dev only:
      // production never gets a global.
      if (process.env.NODE_ENV !== "production") {
        (
          window as unknown as {
            __stackacres?: { scene: unknown; screenPointFor: (x: number, y: number) => TapPoint };
          }
        ).__stackacres = { scene, screenPointFor: (x, y) => scene.screenPointFor(x, y) };
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
      sendFarmhand: (unitId) => sceneRef.current?.sendFarmhand(unitId),
      registerFrenzyTap: (unitId, baseYieldGold) => sceneRef.current?.registerFrenzyTap(unitId, baseYieldGold),
      setFarmhandHooks: (hooks) => sceneRef.current?.setFarmhandHooks(hooks),
      floatAt: (at, text, tone, icon) => sceneRef.current?.floatAt(at, text, tone, icon),
      setMerchant: (present) => sceneRef.current?.setMerchant(present),
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

  // Every snapshot, straight through. Each call is also what lets the
  // farmhand's optimistic credits retire (see `PendingDelta` in
  // lib/stackacres/farmhand-machine.ts), so this deliberately does not try to
  // skip a snapshot whose contents look unchanged.
  useEffect(() => {
    if (!processing) return;
    sceneRef.current?.setProcessing(processing);
  }, [processing]);

  useEffect(() => {
    sceneRef.current?.setToolIcon(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
    sceneRef.current?.setTool(tool);
  }, [tool]);

  // Pushed rather than rebuilt: see `setToolTier` in stackacres-scene.ts for
  // why buying an upgrade must not tear the scene down.
  useEffect(() => {
    sceneRef.current?.setToolTier(toolTier);
  }, [toolTier]);

  // Same "push, never rebuild" reasoning as toolTier above -- see
  // `setFarmhandSpeedMultiplier` in stackacres-scene.ts.
  useEffect(() => {
    sceneRef.current?.setFarmhandSpeedMultiplier(farmhandSpeedMultiplier);
  }, [farmhandSpeedMultiplier]);

  // Same "push, never rebuild" reasoning as toolTier above -- see
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
