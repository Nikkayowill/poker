"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { SectorId } from "@/lib/stackacres/sectors";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { PainterName } from "./stackacres-art";
import type { StackAcresScene, StackAcresSceneUnit, TapPoint } from "./stackacres-scene";

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
 * drop a radial menu straight onto those numbers. `onViewMoved` says the
 * camera has shifted under anything so pinned. The rest of the contract is
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
  /** A line of text that lifts off the tap and fades -- the reward, or the
   *  reason there wasn't one. */
  floatAt: (at: TapPoint, text: string, tone: "gain" | "deny", icon?: PainterName) => void;
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
  /** Land the player may work (lib/stackacres/sectors.ts). Everything else
   *  is drawn as wild growth and has no farm on it to tap. */
  sectors: SectorId[];
  /** A finger landed anywhere on land that has not been cleared -- the offer
   *  to buy it, answered by the clearing modal in stackacres-farm.tsx. */
  onLockedSectorTap: (zone: ZoneId, at: TapPoint) => void;
  /** The camera moved, so anything the shell pinned to a screen position is
   *  now pointing at the wrong part of the world. */
  onViewMoved: () => void;
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
  celebrate,
  onReady,
  onUnitTap,
  onGroundTap,
  sectors,
  onLockedSectorTap,
  onViewMoved,
  api,
}: StackAcresWorldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StackAcresScene | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void } | null>(null);

  // The scene calls back into whatever the shell currently is, not whatever
  // it was when the game booted.
  const readyRef = useRef(onReady);
  const unitTapRef = useRef(onUnitTap);
  const groundTapRef = useRef(onGroundTap);
  const lockedTapRef = useRef(onLockedSectorTap);
  const viewMovedRef = useRef(onViewMoved);
  // The tool's own picture, for the mow-drag ghost -- read at mount (before
  // the scene exists to push it to) and again on every change afterward.
  const toolIconRef = useRef<PainterName>(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
  // The tool itself, not just its picture: the scythe's target is ground
  // rather than a unit, so the scene has to know which tool is held to read a
  // drag correctly. See `setTool` in stackacres-scene.ts.
  const toolRef = useRef<StackAcresTool>(tool);
  useEffect(() => {
    readyRef.current = onReady;
    unitTapRef.current = onUnitTap;
    groundTapRef.current = onGroundTap;
    lockedTapRef.current = onLockedSectorTap;
    viewMovedRef.current = onViewMoved;
    toolIconRef.current = STACKACRES_TOOL_DEFS[tool].icon as PainterName;
    toolRef.current = tool;
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
          onLockedSectorTap: (zone, at) => lockedTapRef.current(zone, at),
          onViewMoved: () => viewMovedRef.current(),
        },
        { reducedMotion, host },
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
      scene.setToolIcon(toolIconRef.current);
      scene.setTool(toolRef.current);

      // A handle for the gesture harness to read the camera through. Dev only:
      // production never gets a global.
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __stackacres?: { scene: unknown } }).__stackacres = { scene };
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
      floatAt: (at, text, tone, icon) => sceneRef.current?.floatAt(at, text, tone, icon),
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
    sceneRef.current?.setToolIcon(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
    sceneRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    if (celebrate) sceneRef.current?.celebrateHarvest(celebrate.unitId);
  }, [celebrate]);

  return <div ref={hostRef} className="sa-world" aria-hidden="true" />;
}
