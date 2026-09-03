"use client";

import clsx from "clsx";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import type { StackAcresPlotSnapshot } from "@/lib/stackacres/plots";
import { affordanceFor, type AffordanceContext, type StackAcresTool } from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The two DOM pieces that sit beside the world canvas.
 *
 * StackAcresPlotList is the keyboard and screen-reader way onto the farm. The
 * map itself is a canvas (see stackacres-world.tsx), which a screen reader
 * cannot see into and a Tab key cannot reach; this list is one real button
 * per plot, carrying the same label and firing the same tap handler, so
 * everything a finger can do on the map a keyboard can do here. It stays out
 * of the way visually until something in it has focus.
 *
 * StackAcresSeedStrip is the "what to plant" chips. Its chips are also the
 * drag handles for placing something on the map: the shell watches for a
 * pointer that presses one and moves, and turns that into a placement ghost
 * over the canvas.
 */

export interface StackAcresPlotListProps {
  plots: StackAcresPlotSnapshot[];
  tool: StackAcresTool;
  context: AffordanceContext;
  selected: number | null;
  labelFor: (plot: StackAcresPlotSnapshot) => string;
  onPlotTap: (plot: StackAcresPlotSnapshot) => void;
}

export function StackAcresPlotList({
  plots,
  tool,
  context,
  selected,
  labelFor,
  onPlotTap,
}: StackAcresPlotListProps) {
  return (
    <div className="sa-plot-list" role="group" aria-label="StackAcres plots">
      <p className="sa-plot-list-hint">Plots, for the keyboard. Tab through them and press Enter.</p>
      <ul>
        {plots.map((plot) => {
          const affordance = affordanceFor(tool, plot, context);
          return (
            <li key={plot.plotIndex}>
              <button
                type="button"
                className={clsx("sa-plot-item", { "is-selected": plot.plotIndex === selected })}
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
export interface StackAcresSeedStripProps {
  stocks: readonly StackAcresStock[];
  labels: Readonly<Record<string, string>>;
  selected: StackAcresStock | null;
  disabledStocks: ReadonlySet<StackAcresStock>;
  onPick: (stock: StackAcresStock) => void;
  /** A press that may turn into a drag onto the map. */
  onPressStart?: (stock: StackAcresStock, event: React.PointerEvent<HTMLButtonElement>) => void;
}

/** Which painter stands for a stock on its seed chip. Livestock draws the
 *  animal; crops draw their ripe produce rather than the sprout -- the chip
 *  is answering "what do I get?", and one green speck looks like every other
 *  green speck. */
const SEED_ICON: Readonly<Record<StackAcresStock, PainterName>> = {
  sprout: "ico-carrot",
  cash_crop: "ico-corn",
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

export function StackAcresSeedStrip({
  stocks,
  labels,
  selected,
  disabledStocks,
  onPick,
  onPressStart,
}: StackAcresSeedStripProps) {
  return (
    <div className="sa-seeds" role="radiogroup" aria-label="What to plant">
      {stocks.map((stock) => (
        <button
          key={stock}
          type="button"
          role="radio"
          aria-checked={selected === stock}
          className={clsx("sa-seed", { "is-picked": selected === stock })}
          data-full={disabledStocks.has(stock) || undefined}
          onClick={() => onPick(stock)}
          onPointerDown={onPressStart ? (event) => onPressStart(stock, event) : undefined}
        >
          <StackAcresIcon name={SEED_ICON[stock]} size={22} />
          <span>{labels[stock]}</span>
        </button>
      ))}
    </div>
  );
}
