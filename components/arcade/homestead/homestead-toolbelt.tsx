"use client";

import clsx from "clsx";
import {
  HOMESTEAD_TOOLS,
  HOMESTEAD_TOOL_DEFS,
  actionableCount,
  type AffordanceContext,
  type HomesteadTool,
} from "@/lib/homestead/tools";

/**
 * The dock: pick a tool, then tap plots.
 *
 * Pinned within thumb reach under the grid in portrait and turned into a
 * column beside it in landscape, so the same five targets stay reachable
 * one-handed either way round. Each button carries a count of the plots its
 * tool has something to say about, which is what lets you glance at the dock
 * and know the farm needs feeding without reading the field.
 */

/* See homestead-grid.tsx: these are 16x16 pixel-art PNGs, and next/image's
   resampling is what destroys pixel art. */
/* eslint-disable @next/next/no-img-element */

const TILES = "/homestead/tiles";

export interface HomesteadToolbeltProps {
  tool: HomesteadTool;
  context: AffordanceContext;
  onPick: (tool: HomesteadTool) => void;
}

export function HomesteadToolbelt({ tool, context, onPick }: HomesteadToolbeltProps) {
  return (
    <div className="hs-toolbelt" role="radiogroup" aria-label="Toolbelt">
      {HOMESTEAD_TOOLS.map((id) => {
        const def = HOMESTEAD_TOOL_DEFS[id];
        const count = actionableCount(id, context);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            className={clsx("hs-tool", { "is-held": tool === id })}
            // The badge is decorative; the count belongs in the label so it is
            // announced as part of the tool rather than as a loose number.
            aria-label={
              count > 0
                ? `${def.label}, ${count} ${count === 1 ? "plot" : "plots"}`
                : def.label
            }
            onClick={() => onPick(id)}
          >
            <img src={`${TILES}/${def.icon}.png`} alt="" aria-hidden="true" />
            <span className="hs-tool-label">{def.label}</span>
            {count > 0 && (
              <span className="hs-tool-count" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
