"use client";

import clsx from "clsx";
import { STACKACRES_TOOLS, STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The dock: Look (the resting state), Scythe/Pipe/Soil held to drag across
 * the ground, Water/Feed/Harvest held to act on a unit -- a tap or a drag
 * both work for every one of them, see lib/stackacres/tools.ts's own header
 * for the ground-vs-unit split and why a unit action now needs the matching
 * tool rather than firing off a bare tap.
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
