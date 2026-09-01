"use client";

import clsx from "clsx";
import { isLivestock, type HomesteadStock } from "@/lib/homestead/catalogue";
import type { HomesteadPlotSnapshot } from "@/lib/homestead/plots";
import { affordanceFor, type AffordanceContext, type HomesteadTool } from "@/lib/homestead/tools";

/**
 * The farm itself: a plain CSS grid of real buttons, one per plot.
 *
 * This replaced a Phaser canvas with a DOM overlay of tap targets twinned to
 * it through a shared coordinate module. That arrangement existed only because
 * a canvas is invisible to a screen reader and unreachable by keyboard, so
 * every painted tile needed a second, invisible DOM copy of itself kept in
 * sync. Here the tile IS the button: no projection to agree on, no second
 * source of truth about where anything is, and the grid grows past sixteen
 * plots by changing one number.
 *
 * The tiles are 16x16 pixel art scaled up with image-rendering: pixelated, so
 * every layer is a plain <img> and the whole thing is styleable from CSS. Art
 * is Kenney's CC0 Tiny Farm pack; see scripts/extract-homestead-tiles.py for
 * which tile means what.
 *
 * All of the rule-shaped logic (what the held tool can do here) lives in
 * lib/homestead/tools.ts. This file decides what a plot LOOKS like and nothing
 * else.
 */

/* next/image is the wrong tool for every sprite on this screen and the rule is
   off for the file rather than silenced four times. These are 16x16 PNGs of a
   few hundred bytes: the optimizer's resampling is exactly what turns pixel
   art to mush, and a loader round trip would cost more than the file. */
/* eslint-disable @next/next/no-img-element */

const TILES = "/homestead/tiles";

/** Where a growing plot sits in its three-frame life, by elapsed fraction. */
function growthStage(progress: number | null, ready: boolean): 1 | 2 | 3 {
  if (ready) return 3;
  if (progress === null) return 1;
  // Two thirds of the cycle is spent as a visibly half-grown plant. A crop
  // that looks finished long before it is finished trains people to tap a
  // plot that cannot pay yet.
  return progress < 0.34 ? 1 : 2;
}

/** The sprite standing on a plot, or null when the plot is bare. */
function stockSprite(plot: HomesteadPlotSnapshot): string | null {
  // Scrub is a bush standing ON the lawn, not a bed: locked land has never
  // been broken, so it gets no soil under it at all.
  if (plot.state === "locked") return `${TILES}/scrub.png`;
  if (plot.state === "mucked") return `${TILES}/muck.png`;
  if (!plot.stock) return null;
  if (isLivestock(plot.stock)) return `${TILES}/${plot.stock}.png`;
  const stage = growthStage(plot.progress, plot.state === "ready");
  return `${TILES}/${plot.stock}-${stage}.png`;
}

/** The bed a plot's contents stand on, or null for land still under grass. */
function groundSprite(plot: HomesteadPlotSnapshot): string | null {
  if (plot.state === "locked") return null;
  if (plot.state === "empty") return `${TILES}/soil.png`;
  return `${TILES}/soil-rich.png`;
}

export interface HomesteadGridProps {
  plots: HomesteadPlotSnapshot[];
  /** Grid width in plots. The 4x4 board is square; phase 5 grows this. */
  columns: number;
  tool: HomesteadTool;
  context: AffordanceContext;
  selected: number | null;
  labelFor: (plot: HomesteadPlotSnapshot) => string;
  onPlotTap: (plot: HomesteadPlotSnapshot) => void;
  /** Plot index to play the harvest flourish on, with a nonce to retrigger. */
  celebrate: { plotIndex: number; nonce: number } | null;
}

export function HomesteadGrid({
  plots,
  columns,
  tool,
  context,
  selected,
  labelFor,
  onPlotTap,
  celebrate,
}: HomesteadGridProps) {
  return (
    <div
      className="hs-grid"
      data-tool={tool}
      role="group"
      aria-label="Homestead plots"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {plots.map((plot) => {
        const affordance = affordanceFor(tool, plot, context);
        const ground = groundSprite(plot);
        const stock = stockSprite(plot);
        const showProgress =
          plot.progress !== null && (plot.state === "working" || plot.state === "hungry");

        return (
          <button
            key={plot.plotIndex}
            type="button"
            className={clsx("hs-plot", { "is-selected": plot.plotIndex === selected })}
            // State and affordance are separate attributes on purpose: the
            // stylesheet tints by affordance (what a tap does) and decorates
            // by state (what the plot is), and collapsing them would mean
            // writing every combination out by hand.
            data-state={plot.state}
            data-afford={affordance.kind}
            aria-label={labelFor(plot)}
            aria-pressed={plot.plotIndex === selected}
            onClick={() => onPlotTap(plot)}
          >
            {ground && (
              <img className="hs-plot-ground" src={ground} alt="" aria-hidden="true" />
            )}
            {stock && <img className="hs-plot-stock" src={stock} alt="" aria-hidden="true" />}
            {/* Keyed on the nonce so a second harvest on the same plot mounts
                a fresh node and replays the animation; re-keying the button
                itself would work too, but it would drop keyboard focus. */}
            {celebrate?.plotIndex === plot.plotIndex && (
              <span key={celebrate.nonce} className="hs-plot-pop" aria-hidden="true" />
            )}
            {showProgress && (
              <span className="hs-plot-progress" aria-hidden="true">
                <span style={{ transform: `scaleX(${plot.progress ?? 0})` }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The stock chips shown beside the dock while Plant is held. */
export interface HomesteadSeedStripProps {
  stocks: readonly HomesteadStock[];
  labels: Readonly<Record<string, string>>;
  selected: HomesteadStock | null;
  disabledStocks: ReadonlySet<HomesteadStock>;
  onPick: (stock: HomesteadStock) => void;
}

export function HomesteadSeedStrip({
  stocks,
  labels,
  selected,
  disabledStocks,
  onPick,
}: HomesteadSeedStripProps) {
  return (
    <div className="hs-seeds" role="radiogroup" aria-label="What to plant">
      {stocks.map((stock) => {
        // Ripe art on the chip, not the sprout: the chip is answering "what do
        // I get?", and one green speck looks like every other green speck.
        const icon = isLivestock(stock) ? `${TILES}/${stock}.png` : `${TILES}/${stock}-3.png`;
        return (
          <button
            key={stock}
            type="button"
            role="radio"
            aria-checked={selected === stock}
            className={clsx("hs-seed", { "is-picked": selected === stock })}
            data-full={disabledStocks.has(stock) || undefined}
            onClick={() => onPick(stock)}
          >
            <img src={icon} alt="" aria-hidden="true" />
            <span>{labels[stock]}</span>
          </button>
        );
      })}
    </div>
  );
}
