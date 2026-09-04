"use client";

import clsx from "clsx";
import { STACKACRES_TOOLS, STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The dock: Look (the resting state) or hold the Scythe to mow the Long
 * Meadow. Down from six tools to two now that a plot tap is not how anything
 * gets done any more (see ./stackacres-district-panel.tsx) -- the scythe is
 * the one tool left whose target is the ground rather than a unit, so it's
 * the one thing still worth holding.
 */

export interface StackAcresToolbeltProps {
  tool: StackAcresTool;
  onPick: (tool: StackAcresTool) => void;
}

export function StackAcresToolbelt({ tool, onPick }: StackAcresToolbeltProps) {
  return (
    <div className="sa-toolbelt" role="radiogroup" aria-label="Toolbelt">
      {STACKACRES_TOOLS.map((id) => {
        const def = STACKACRES_TOOL_DEFS[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            className={clsx("sa-tool", { "is-held": tool === id })}
            aria-label={def.label}
            onClick={() => onPick(id)}
          >
            <StackAcresIcon name={def.icon as PainterName} size={22} />
            <span className="sa-tool-label">{def.label}</span>
          </button>
        );
      })}
    </div>
  );
}
