"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { PainterName } from "./stackacres-art";
import type { StackAcresScene, StackAcresSceneUnit } from "./stackacres-scene";

/**
 * The Phaser mount, and the bundle boundary.
 *
 * Both the engine and the scene enter through the dynamic import below, so a
 * player who never opens the StackAcres never downloads Phaser -- the same
 * isolation poker-app.tsx's `dynamic(..., { ssr: false })` gives the table.
 *
 * Rendering is driven from props: `units` plus the held tool become the
 * scene's own units. THERE IS NO PLOT GRID (see 2026-09-03's CLAUDE.md entry
 * -- "districts hold stock, not plots"), so unlike the old grid this
 * component has no action callbacks at all -- buying and tending a unit is
 * entirely the district sidebar's job (stackacres-district-panel.tsx), a DOM
 * surface that talks to the server directly and never touches this bridge.
 * The only thing that still comes back OUT of the canvas is `onReady`
 * (the first frame is drawn) and, through `api`, a way for the shell to move
 * the camera around -- `zoomBy` for the zoom buttons mouse users need
 * (nobody has a pinch gesture with a mouse), `recenter` for "home", and
 * `focusZone` for the destination signpost.
 *
 * The canvas is decorative to assistive tech -- `aria-hidden`. The
 * keyboard/screen-reader surface is the district sidebar's own real DOM
 * buttons, not a second hidden copy of the map kept in sync with it; there
 * is nothing left on the canvas a sidebar row doesn't already say.
 */

export interface StackAcresWorldApi {
  zoomBy: (factor: number) => void;
  recenter: () => void;
  /** Travel to a district's gate (lib/stackacres/zones.ts). */
  focusZone: (zone: ZoneId) => void;
}

export interface StackAcresWorldProps {
  units: StackAcresUnitSnapshot[];
  tool: StackAcresTool;
  /** Fired once, by nonce, to trigger the gold-burst effect on one unit --
   *  the client-side twin of a collect action the sidebar just confirmed. */
  celebrate: { unitId: string; nonce: number } | null;
  onReady: () => void;
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

export function StackAcresWorld({ units, tool, celebrate, onReady, api }: StackAcresWorldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StackAcresScene | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void } | null>(null);

  // The scene calls back into whatever the shell currently is, not whatever
  // it was when the game booted.
  const readyRef = useRef(onReady);
  // The tool's own picture, for the mow-drag ghost -- read at mount (before
  // the scene exists to push it to) and again on every change afterward.
  const toolIconRef = useRef<PainterName>(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
  // The tool itself, not just its picture: the scythe's target is ground
  // rather than a unit, so the scene has to know which tool is held to read a
  // drag correctly. See `setTool` in stackacres-scene.ts.
  const toolRef = useRef<StackAcresTool>(tool);
  useEffect(() => {
    readyRef.current = onReady;
    toolIconRef.current = STACKACRES_TOOL_DEFS[tool].icon as PainterName;
    toolRef.current = tool;
  });

  const sceneUnits = useMemo(() => toUnits(units), [units]);
  const unitsRef = useRef(sceneUnits);
  useEffect(() => {
    unitsRef.current = sceneUnits;
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
    }),
    [],
  );

  // Repaint when some unit's picture changed. The parent re-derives units
  // every second for its countdowns; the scene diffs per unit and only
  // rebuilds the ones whose signature moved, so this is cheap to call often.
  useEffect(() => {
    sceneRef.current?.setUnits(sceneUnits);
  }, [sceneUnits]);

  useEffect(() => {
    sceneRef.current?.setToolIcon(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
    sceneRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    if (celebrate) sceneRef.current?.celebrateHarvest(celebrate.unitId);
  }, [celebrate]);

  return <div ref={hostRef} className="sa-world" aria-hidden="true" />;
}
