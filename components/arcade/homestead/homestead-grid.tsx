"use client";

import clsx from "clsx";
import type { HomesteadStock } from "@/lib/homestead/catalogue";
import type { HomesteadPlotSnapshot } from "@/lib/homestead/plots";
import { affordanceFor, type AffordanceContext, type HomesteadTool } from "@/lib/homestead/tools";
import type { PainterName } from "./homestead-art";
import { HomesteadIcon } from "./homestead-icon";

/**
 * The two DOM pieces that sit beside the world canvas.
 *
 * HomesteadPlotList is the keyboard and screen-reader way onto the farm. The
 * map itself is a canvas (see homestead-world.tsx), which a screen reader
 * cannot see into and a Tab key cannot reach; this list is one real button
 * per plot, carrying the same label and firing the same tap handler, so
 * everything a finger can do on the map a keyboard can do here. It stays out
 * of the way visually until something in it has focus.
 *
 * HomesteadSeedStrip is the "what to plant" chips. Its chips are also the
 * drag handles for placing something on the map: the shell watches for a
 * pointer that presses one and moves, and turns that into a placement ghost
 * over the canvas.
 */

export interface HomesteadPlotListProps {
  plots: HomesteadPlotSnapshot[];
  tool: HomesteadTool;
  context: AffordanceContext;
  selected: number | null;
  labelFor: (plot: HomesteadPlotSnapshot) => string;
  onPlotTap: (plot: HomesteadPlotSnapshot) => void;
}

export function HomesteadPlotList({
  plots,
  tool,
  context,
  selected,
  labelFor,
  onPlotTap,
}: HomesteadPlotListProps) {
  return (
    <div className="hs-plot-list" role="group" aria-label="Homestead plots">
      <p className="hs-plot-list-hint">Plots, for the keyboard. Tab through them and press Enter.</p>
      <ul>
        {plots.map((plot) => {
          const affordance = affordanceFor(tool, plot, context);
          return (
            <li key={plot.plotIndex}>
              <button
                type="button"
                className={clsx("hs-plot-item", { "is-selected": plot.plotIndex === selected })}
                data-state={plot.state}
                data-afford={affordance.kind}
                aria-label={labelFor(plot)}
                aria-pressed={plot.plotIndex === selected}
                onClick={() => onPlotTap(plot)}
              >
                {plot.plotIndex}
              </button>
            </li>
          );
        })}
      </ul>
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
  /** A press that may turn into a drag onto the map. */
  onPressStart?: (stock: HomesteadStock, event: React.PointerEvent<HTMLButtonElement>) => void;
}

/** Which painter stands for a stock on its seed chip. Livestock draws the
 *  animal; crops draw their ripe produce rather than the sprout -- the chip
 *  is answering "what do I get?", and one green speck looks like every other
 *  green speck. */
const SEED_ICON: Readonly<Record<HomesteadStock, PainterName>> = {
  sprout: "ico-carrot",
  cash_crop: "ico-corn",
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

export function HomesteadSeedStrip({
  stocks,
  labels,
  selected,
  disabledStocks,
  onPick,
  onPressStart,
}: HomesteadSeedStripProps) {
  return (
    <div className="hs-seeds" role="radiogroup" aria-label="What to plant">
      {stocks.map((stock) => (
        <button
          key={stock}
          type="button"
          role="radio"
          aria-checked={selected === stock}
          className={clsx("hs-seed", { "is-picked": selected === stock })}
          data-full={disabledStocks.has(stock) || undefined}
          onClick={() => onPick(stock)}
          onPointerDown={onPressStart ? (event) => onPressStart(stock, event) : undefined}
        >
          <HomesteadIcon name={SEED_ICON[stock]} size={22} />
          <span>{labels[stock]}</span>
        </button>
      ))}
    </div>
  );
}
