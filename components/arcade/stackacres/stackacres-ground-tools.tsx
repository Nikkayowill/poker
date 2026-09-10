"use client";

import clsx from "clsx";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import { stackacresCutterDef, type StackAcresCutter } from "@/lib/stackacres/cutters";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The one tool that only means anything as a drag: Mow.
 *
 * Water, feed and harvest have no key. Tapping a dry crop, a hungry pen or
 * a ready unit is enough on its own. Pipe and soil have no key either any
 * more (2026-09-10): a single tile of either is reached entirely through the
 * tap dock now (see stackacres-gel-dock.tsx), one at a time, with no
 * multi-tile drag left to arm. Only cutting the Long Meadow still has no
 * single-tile version, so it keeps the one key.
 *
 * One small key at the top left, on purpose nothing like the old
 * bottom-right dock. It shows the cutter in hand, and once the player owns
 * more than one, holding it opens a picker beside it to swap.
 */

const GROUND_TOOLS = ["scythe"] as const satisfies readonly StackAcresTool[];

export interface StackAcresGroundToolsProps {
  tool: StackAcresTool;
  onPick: (tool: StackAcresTool) => void;
  /** Cutters owned, Scythe first. */
  cutters: readonly StackAcresCutter[];
  /** The one in hand. */
  cutter: StackAcresCutter;
  onPickCutter: (cutter: StackAcresCutter) => void;
}

export function StackAcresGroundTools({
  tool,
  onPick,
  cutters,
  cutter,
  onPickCutter,
}: StackAcresGroundToolsProps) {
  const inHand = stackacresCutterDef(cutter);
  return (
    <div className="sa-ground-tools">
      <div className="sa-ground-tool-keys" role="radiogroup" aria-label="Ground tools">
        {GROUND_TOOLS.map((id) => {
          const def = STACKACRES_TOOL_DEFS[id];
          const held = tool === id;
          const mow = id === "scythe";
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={held}
              className={clsx("sa-ground-tool", { "is-held": held })}
              aria-label={mow ? inHand.label : def.label}
              title={def.hint}
              onClick={() => onPick(id)}
            >
              <StackAcresIcon name={(mow ? inHand.icon : def.icon) as PainterName} size={18} />
            </button>
          );
        })}
      </div>
      {tool === "scythe" && cutters.length > 1 && (
        <div className="sa-cutter-picker" role="radiogroup" aria-label="Cutter">
          {cutters.map((id) => {
            const def = stackacresCutterDef(id);
            const held = cutter === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={held}
                className={clsx("sa-ground-tool", "sa-cutter-option", { "is-held": held })}
                title={def.blurb}
                onClick={() => onPickCutter(id)}
              >
                <StackAcresIcon name={def.icon as PainterName} size={18} />
                <span>{def.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
