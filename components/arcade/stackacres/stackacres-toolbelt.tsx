"use client";

import clsx from "clsx";
import {
  STACKACRES_TOOLS,
  STACKACRES_TOOL_DEFS,
  actionableCount,
  type AffordanceContext,
  type StackAcresTool,
} from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The dock: pick a tool, then tap plots.
 *
 * Pinned within thumb reach under the grid in portrait and turned into a
 * column beside it in landscape, so the same six targets stay reachable
 * one-handed either way round. Each button carries a count of the plots its
 * tool has something to say about, which is what lets you glance at the dock
 * and know the farm needs feeding without reading the field.
 */

export interface StackAcresToolbeltProps {
  tool: StackAcresTool;
  context: AffordanceContext;
  onPick: (tool: StackAcresTool) => void;
}

export function StackAcresToolbelt({ tool, context, onPick }: StackAcresToolbeltProps) {
  return (
    <div className="sa-toolbelt" role="radiogroup" aria-label="Toolbelt">
      {STACKACRES_TOOLS.map((id) => {
        const def = STACKACRES_TOOL_DEFS[id];
        const count = actionableCount(id, context);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            className={clsx("sa-tool", { "is-held": tool === id })}
            // The badge is decorative; the count belongs in the label so it is
            // announced as part of the tool rather than as a loose number.
            aria-label={
              count > 0
                ? `${def.label}, ${count} ${count === 1 ? "plot" : "plots"}`
                : def.label
            }
            onClick={() => onPick(id)}
          >
            <StackAcresIcon name={def.icon as PainterName} size={22} />
            <span className="sa-tool-label">{def.label}</span>
            {count > 0 && (
              <span className="sa-tool-count" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
