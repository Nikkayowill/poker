"use client";

import clsx from "clsx";
import { dockEntriesFor, type StackAcresDockSelection } from "@/lib/stackacres/dock";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The dock: the tools for whatever is selected, and the way to Ray.
 *
 * It used to draw all six tools all the time. Two things were wrong with
 * that. The tools half is described in lib/stackacres/dock.ts -- six keys
 * with no clue which one the thing under your finger wants -- and the dock
 * follows the selection now, so the row is only ever the three or four keys
 * that can do anything to what you just tapped.
 *
 * The shop half is the other one. Ray was reachable only through the
 * signpost, and on a short landscape phone the signpost collapses into a
 * single compass button (see stackacres-destinations.tsx), which put the one
 * place you spend Gold two taps deep behind a menu you had to know to open.
 * He rides here now, past a divider so he never reads as a seventh tool, and
 * the divider is the whole reason the shop can sit on a bar that is
 * otherwise entirely about what a drag does.
 *
 * `inspect` still has no button (see lib/stackacres/tools.ts): it is the
 * resting state, and pressing whichever tool is already held drops back to
 * it.
 */

export interface StackAcresToolbeltProps {
  tool: StackAcresTool;
  onPick: (tool: StackAcresTool) => void;
  /** What was last tapped. Decides which keys the dock draws. */
  selection: StackAcresDockSelection;
  /** Opens Ray's supply store, the same sheet the signpost's own Ray entry
   *  opens. */
  onOpenShop: () => void;
  /** Produce sitting in the barn unsold, badged on Ray exactly the way the
   *  signpost badges his entry. */
  carrying: number;
}

export function StackAcresToolbelt({ tool, onPick, selection, onOpenShop, carrying }: StackAcresToolbeltProps) {
  const entries = dockEntriesFor(selection);
  return (
    <div className="sa-dock">
      {/* Keyed on the shape of the selection so the keys replay their settle
          animation when the dock reflows, and only then -- a cow going from
          hungry to fed changes which key is lit without moving any of them,
          and re-running the animation for that would be the dock twitching
          at something the player did not do. */}
      <div className="sa-dock-tools" key={selection.kind} role="radiogroup" aria-label="Toolbelt">
        {entries.map(({ tool: id, live }) => {
          const def = STACKACRES_TOOL_DEFS[id];
          const held = tool === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={held}
              className={clsx("sa-tool", { "is-held": held, "is-idle": !live })}
              aria-label={def.label}
              onClick={() => onPick(held ? "inspect" : id)}
            >
              <StackAcresIcon name={def.icon as PainterName} size={22} />
              <span className="sa-tool-label">{def.label}</span>
            </button>
          );
        })}
      </div>

      <span className="sa-dock-sep" aria-hidden="true" />

      <button
        type="button"
        className="sa-tool sa-dock-shop"
        title="Buy feed, and see what is left of the daily allowance."
        aria-label="Buy from Ray — buy feed, and see what is left of the daily allowance."
        onClick={onOpenShop}
      >
        <img
          src="/stackacres/sprites/grandfather-ray-portrait.png"
          alt=""
          className="sa-dock-shop-portrait"
          aria-hidden="true"
        />
        <span className="sa-tool-label">Shop</span>
        {carrying > 0 && (
          <span className="sa-dock-shop-badge" aria-hidden="true">
            {carrying}
          </span>
        )}
      </button>
    </div>
  );
}
