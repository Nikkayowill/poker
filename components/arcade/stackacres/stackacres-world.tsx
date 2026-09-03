"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import type { StackAcresPlotSnapshot } from "@/lib/stackacres/plots";
import {
  STACKACRES_TOOL_DEFS,
  affordanceFor,
  type AffordanceContext,
  type StackAcresTool,
} from "@/lib/stackacres/tools";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { PainterName } from "./stackacres-art";
import type { StackAcresScene, StackAcresSceneCell, PlotScreenRect } from "./stackacres-scene";

export type { PlotScreenRect };

/**
 * The Phaser mount, and the bundle boundary.
 *
 * Both the engine and the scene enter through the dynamic import below, so a
 * player who never opens the StackAcres never downloads Phaser -- the same
 * isolation poker-app.tsx's `dynamic(..., { ssr: false })` gives the table.
 *
 * Rendering is driven from props: `plots` plus the held tool become the
 * scene's cells (what each plot is, and what a tap would do to it), and the
 * scene repaints only the cells whose picture actually changed. Everything
 * the player can DO comes back out through `onPlotTap`, routed by the shell
 * exactly as the old grid's taps were, so the rules never moved.
 *
 * `api` is the shell's handle for the few things that are not a render:
 * dragging a seed out of the strip (the placement ghost), and the zoom
 * buttons for mouse users who have no pinch. Its coordinates are CSS pixels
 * relative to this host; the scene converts, because the canvas underneath is
 * deliberately denser than the screen (see the scale config below).
 *
 * The canvas is decorative to assistive tech. The keyboard and screen-reader
 * surface is the plot list in stackacres-farm.tsx, which drives the same
 * callbacks -- hence aria-hidden here rather than a second, invisible copy of
 * every tile kept in sync with the canvas.
 */

export interface StackAcresWorldApi {
  /** Move (or hide, with null) the placement ghost. Returns the empty plot under it. */
  setGhost: (stock: StackAcresStock | null, clientX: number, clientY: number) => number | null;
  zoomBy: (factor: number) => void;
  recenter: () => void;
  /** Pan so a plot sits clear of the overlays, if it is not already. */
  focusPlot: (plotIndex: number) => void;
  /** Travel to a district's gate (lib/stackacres/zones.ts). */
  focusZone: (zone: ZoneId) => void;
  /** Report where a plot is on screen via `onTrackedRect` until told to stop. */
  trackPlot: (plotIndex: number | null) => void;
}

export interface StackAcresWorldProps {
  plots: StackAcresPlotSnapshot[];
  tool: StackAcresTool;
  context: AffordanceContext;
  selected: number | null;
  celebrate: { plotIndex: number; nonce: number } | null;
  onPlotTap: (plot: StackAcresPlotSnapshot) => void;
  /**
   * Fired once per plot, in crossing order, as a drag that started on an
   * actionable plot sweeps the held tool across every further one it
   * crosses -- the same thing `onPlotTap` would do to that plot, just
   * reached by dragging over it instead of tapping it alone.
   */
  onSweepPlot: (plot: StackAcresPlotSnapshot) => void;
  onGroundTap: () => void;
  onReady: () => void;
  /** The tracked plot's place on the canvas, whenever it moves. */
  onTrackedRect: (rect: PlotScreenRect | null) => void;
  api: Ref<StackAcresWorldApi | null>;
}

function toCells(
  plots: StackAcresPlotSnapshot[],
  tool: StackAcresTool,
  context: AffordanceContext,
  selected: number | null,
): StackAcresSceneCell[] {
  return plots.map((plot) => ({
    plotIndex: plot.plotIndex,
    state: plot.state,
    stock: plot.stock,
    progress: plot.progress,
    afford: affordanceFor(tool, plot, context).kind,
    selected: plot.plotIndex === selected,
    purchasable: plot.purchasable,
    unlockPrice: plot.unlockPrice,
  }));
}

export function StackAcresWorld({
  plots,
  tool,
  context,
  selected,
  celebrate,
  onPlotTap,
  onSweepPlot,
  onGroundTap,
  onReady,
  onTrackedRect,
  api,
}: StackAcresWorldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StackAcresScene | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void } | null>(null);

  // The scene calls back into whatever the shell currently is, not whatever
  // it was when the game booted.
  const plotsRef = useRef(plots);
  const tapRef = useRef(onPlotTap);
  const sweepRef = useRef(onSweepPlot);
  const groundRef = useRef(onGroundTap);
  const readyRef = useRef(onReady);
  const trackedRef = useRef(onTrackedRect);
  // The tool's own picture, for the sweep ghost -- read at mount (before the
  // scene exists to push it to) and again on every change afterward.
  const toolIconRef = useRef<PainterName>(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
  // The tool itself, not just its picture: the scythe's target is ground
  // rather than a plot, so the scene has to know which tool is held to read a
  // drag correctly. See `setTool` in stackacres-scene.ts.
  const toolRef = useRef<StackAcresTool>(tool);
  useEffect(() => {
    plotsRef.current = plots;
    tapRef.current = onPlotTap;
    sweepRef.current = onSweepPlot;
    groundRef.current = onGroundTap;
    readyRef.current = onReady;
    trackedRef.current = onTrackedRect;
    toolIconRef.current = STACKACRES_TOOL_DEFS[tool].icon as PainterName;
    toolRef.current = tool;
  });

  const cells = useMemo(() => toCells(plots, tool, context, selected), [plots, tool, context, selected]);
  const cellsRef = useRef(cells);
  useEffect(() => {
    cellsRef.current = cells;
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
          onTapPlot: (plotIndex) => {
            const plot = plotsRef.current.find((p) => p.plotIndex === plotIndex);
            if (plot) tapRef.current(plot);
          },
          onSweepPlot: (plotIndex) => {
            const plot = plotsRef.current.find((p) => p.plotIndex === plotIndex);
            if (plot) sweepRef.current(plot);
          },
          onTapGround: () => groundRef.current(),
          onReady: () => readyRef.current(),
          onTrackedRect: (rect) => trackedRef.current(rect),
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
      scene.setPlots(cellsRef.current);
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
      setGhost: (stock, clientX, clientY) => {
        const host = hostRef.current;
        const scene = sceneRef.current;
        if (!host || !scene) return null;
        const rect = host.getBoundingClientRect();
        return scene.setGhost(stock, clientX - rect.left, clientY - rect.top);
      },
      zoomBy: (factor) => sceneRef.current?.zoomBy(factor),
      recenter: () => sceneRef.current?.recenter(),
      focusPlot: (plotIndex) => sceneRef.current?.focusPlot(plotIndex),
      focusZone: (zone) => sceneRef.current?.focusZone(zone),
      trackPlot: (plotIndex) => sceneRef.current?.trackPlot(plotIndex),
    }),
    [],
  );

  // Repaint when some cell's picture changed. The parent re-derives plots
  // every second for its countdowns; the scene diffs per cell and only
  // rebuilds the ones whose signature moved, so this is cheap to call often.
  useEffect(() => {
    sceneRef.current?.setPlots(cells);
  }, [cells]);

  useEffect(() => {
    sceneRef.current?.setToolIcon(STACKACRES_TOOL_DEFS[tool].icon as PainterName);
    sceneRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    if (celebrate) sceneRef.current?.celebrateHarvest(celebrate.plotIndex);
  }, [celebrate]);

  return <div ref={hostRef} className="sa-world" aria-hidden="true" />;
}
