"use client";

import clsx from "clsx";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The three tools that only mean anything as a drag: Mow, Pipe and Soil.
 *
 * Water, feed and harvest have no key. Tapping a dry crop, a hungry pen or
 * a ready unit is enough on its own, and a single tile of pipe or soil is
 * already on the tap ring. What's left has no other way in. Cutting the
 * Long Meadow has no single-tile version, and laying a whole run in one
 * stroke is worth keeping, so something still has to arm the drag.
 *
 * Three small keys at the top left, on purpose nothing like the old
 * bottom-right dock.
 */

const GROUND_TOOLS = ["scythe", "pipe", "soil"] as const satisfies readonly StackAcresTool[];

export interface StackAcresGroundToolsProps {
  tool: StackAcresTool;
  onPick: (tool: StackAcresTool) => void;
}

export function StackAcresGroundTools({ tool, onPick }: StackAcresGroundToolsProps) {
  return (
    <div className="sa-ground-tools" role="radiogroup" aria-label="Ground tools">
      {GROUND_TOOLS.map((id) => {
        const def = STACKACRES_TOOL_DEFS[id];
        const held = tool === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={held}
            className={clsx("sa-ground-tool", { "is-held": held })}
            aria-label={def.label}
            title={def.hint}
            onClick={() => onPick(id)}
          >
            <StackAcresIcon name={def.icon as PainterName} size={18} />
          </button>
        );
      })}
    </div>
  );
}
