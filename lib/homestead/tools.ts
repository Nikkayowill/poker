/**
 * The Homestead's toolbelt: which tool is held, and what tapping a given plot
 * would do while holding it.
 *
 * This is the whole point of the redesign. The old flow was tap a plot, read a
 * panel, find the right button -- three steps and a lot of reading for one
 * action. Holding a tool instead means the grid itself can answer "what does a
 * tap do here?" before you tap: every plot the held tool can act on lights up,
 * and every plot it cannot stays quiet. On a phone that is the difference
 * between playing the farm and operating a form.
 *
 * It lives in lib/ rather than beside the component because vitest only reaches
 * lib/ and app/, and this is the part with rules in it. The grid component
 * renders whatever `affordanceFor` returns and owns no logic of its own.
 *
 * Nothing here is authoritative. An affordance of "act" means the tap is worth
 * making, not that it will succeed -- the server still refuses a stale or
 * racing action, and its refusal carries the true grid back. Treat this as the
 * same class of thing as the countdown: a local read of what the server last
 * said, good enough to paint with.
 */

import {
  HOMESTEAD_CATALOGUE,
  capFor,
  isLivestock,
  type HomesteadStock,
} from "./catalogue";
import type { HomesteadPlotSnapshot } from "./plots";

export const HOMESTEAD_TOOLS = ["inspect", "plant", "harvest", "feed", "clear"] as const;

export type HomesteadTool = (typeof HOMESTEAD_TOOLS)[number];

export interface HomesteadToolDef {
  /** What the button says, and what a screen reader announces. */
  label: string;
  /** One line under the dock saying what a tap does right now. */
  hint: string;
  /** Filename under /homestead/tiles, without the extension. */
  icon: string;
}

export const HOMESTEAD_TOOL_DEFS: Readonly<Record<HomesteadTool, HomesteadToolDef>> = {
  inspect: {
    label: "Look",
    hint: "Tap any plot to see what it is doing.",
    icon: "tool-inspect",
  },
  plant: {
    label: "Plant",
    hint: "Pick what to put in, then tap an empty plot.",
    icon: "tool-plant",
  },
  harvest: {
    label: "Harvest",
    hint: "Tap a gold plot to sell what it made.",
    icon: "tool-harvest",
  },
  feed: {
    label: "Feed",
    hint: "Tap a hungry pen to start its clock again.",
    icon: "tool-feed",
  },
  clear: {
    label: "Clear",
    hint: "Tap a weather-worn plot to put it back to work.",
    icon: "tool-clear",
  },
};

/**
 * What a tap would do on this plot with this tool held.
 *
 * - `act` lights the plot up: the tool applies and the player can pay for it.
 * - `blocked` also lights it up, in red, because the plot IS this tool's
 *   target and the only thing missing is Gold, feed, or a free slot. Telling
 *   those two apart is what makes the grid teach; collapsing them into "not
 *   tappable" hides the reason the farm has stopped.
 * - `none` stays quiet. The tool has no business here.
 */
export type PlotAffordance =
  | { kind: "act" }
  | { kind: "blocked"; reason: string }
  | { kind: "none" };

const ACT: PlotAffordance = { kind: "act" };
const NONE: PlotAffordance = { kind: "none" };

export interface AffordanceContext {
  /**
   * Bushels on hand -- NOT Gold. Every tool action is priced in the farm's own
   * currency; Gold buys acreage only, and that is not a tool.
   */
  bushels: number;
  /** Feed servings in the barn. */
  feed: number;
  /** What Plant would put down. Null while nothing is picked. */
  selectedStock: HomesteadStock | null;
  /** Every plot, needed for the two caps. */
  plots: readonly HomesteadPlotSnapshot[];
}

/** How many pens or fields are currently occupied, for the cap check. */
export function occupiedCount(
  plots: readonly HomesteadPlotSnapshot[],
  livestock: boolean,
): number {
  return plots.filter(
    (plot) =>
      plot.stock !== null && isLivestock(plot.stock) === livestock && plot.state !== "empty",
  ).length;
}

export function affordanceFor(
  tool: HomesteadTool,
  plot: HomesteadPlotSnapshot,
  context: AffordanceContext,
): PlotAffordance {
  switch (tool) {
    // Look never blocks and never lights the grid up -- it is the resting
    // state, and a farm where every tile glows tells you nothing.
    case "inspect":
      return NONE;

    case "plant": {
      if (plot.state !== "empty") return NONE;
      const stock = context.selectedStock;
      if (!stock) return { kind: "blocked", reason: "Pick something to plant first." };
      const def = HOMESTEAD_CATALOGUE[stock];
      const livestock = isLivestock(stock);
      if (occupiedCount(context.plots, livestock) >= capFor(stock)) {
        return {
          kind: "blocked",
          reason: livestock ? "Every pen is already working." : "Every field is already working.",
        };
      }
      if (context.bushels < def.seedCost) {
        return {
          kind: "blocked",
          reason: `${def.label} seed costs ${def.seedCost.toLocaleString()} Bushels.`,
        };
      }
      return ACT;
    }

    case "harvest":
      return plot.state === "ready" ? ACT : NONE;

    case "feed": {
      if (plot.state !== "hungry") return NONE;
      if (context.feed < 1) return { kind: "blocked", reason: "No feed left in the barn." };
      return ACT;
    }

    case "clear": {
      if (plot.state !== "mucked") return NONE;
      const fee = plot.muckFee ?? 0;
      if (context.bushels < fee) {
        return { kind: "blocked", reason: `Clearing costs ${fee.toLocaleString()} Bushels.` };
      }
      return ACT;
    }
  }
}

/**
 * The tool that would be most useful right now, used to move the player along
 * without stranding them in a mode that does nothing.
 *
 * Ordered by urgency rather than by the dock's own order: a hungry animal has
 * stopped earning and a ripe plot is earning nothing further, so both beat
 * planting. Returns null when the farm needs nothing, which is when Look is
 * the honest answer.
 */
export function suggestedTool(plots: readonly HomesteadPlotSnapshot[]): HomesteadTool | null {
  if (plots.some((plot) => plot.state === "hungry")) return "feed";
  if (plots.some((plot) => plot.state === "ready")) return "harvest";
  if (plots.some((plot) => plot.state === "mucked")) return "clear";
  if (plots.some((plot) => plot.state === "empty")) return "plant";
  return null;
}

/**
 * How many plots the held tool can act on, for the count on the dock button.
 * Blocked plots are deliberately included: "3 ready" should not become "0
 * ready" because the barn is empty, or the badge stops meaning what it says.
 */
export function actionableCount(
  tool: HomesteadTool,
  context: AffordanceContext,
): number {
  if (tool === "inspect") return 0;
  return context.plots.filter(
    (plot) => affordanceFor(tool, plot, context).kind !== "none",
  ).length;
}
