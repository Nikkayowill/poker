"use client";

import clsx from "clsx";
import { STACKACRES_SELECTABLE_TOOLS, STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The dock: Scythe/Pipe/Soil held to drag across the ground, Water/Feed/
 * Harvest held to act on a unit -- a tap or a drag both work for every one
 * of them, see lib/stackacres/tools.ts's own header for the ground-vs-unit
 * split and why a unit action now needs the matching tool rather than
 * firing off a bare tap.
 *
 * Look is gone as a button (2026-09-09) -- it is `"inspect"`, the resting
 * state a session starts in and none of these six ever leave for good:
 * pressing whichever one is already held drops back to it, since with no
 * Look button left there would otherwise be no way to let go of a tool at
 * all. `STACKACRES_SELECTABLE_TOOLS` is the six below; `inspect` stays a
 * real `StackAcresTool` value, just not one of them.
 */

export interface StackAcresToolbeltProps {
  tool: StackAcresTool;
  onPick: (tool: StackAcresTool) => void;
}

export function StackAcresToolbelt({ tool, onPick }: StackAcresToolbeltProps) {
  return (
    <div className="sa-toolbelt" role="radiogroup" aria-label="Toolbelt">
      {STACKACRES_SELECTABLE_TOOLS.map((id) => {
        const def = STACKACRES_TOOL_DEFS[id];
        const held = tool === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={held}
            className={clsx("sa-tool", { "is-held": held })}
            aria-label={def.label}
            onClick={() => onPick(held ? "inspect" : id)}
          >
            <StackAcresIcon name={def.icon as PainterName} size={22} />
            <span className="sa-tool-label">{def.label}</span>
          </button>
        );
      })}
    </div>
  );
}
