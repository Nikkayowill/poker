"use client";

import clsx from "clsx";
import { BELT_TOOLS, BELT_TOOL_DEFS, type BeltTool } from "@/lib/stackacres/toolbelt";
import type { StackAcresCrop } from "@/lib/stackacres/catalogue";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The tool belt, top left: hand, hoe, watering can, seed pouch.
 *
 * This replaced the single Mow key (`StackAcresGroundTools`), which armed a
 * gesture the top-down world never drew -- a belt slot that does nothing is
 * exactly what the belt is here to stop, so the scythe and the pipe stay off it
 * until the map draws them (see lib/stackacres/toolbelt.ts's own header).
 *
 * One slot is always held, and what it holds decides what the Use key and a tap
 * on a square do. The seed pouch is the one slot with a second press: tapping it
 * while it is already held opens the seed wheel (stackacres-seed-wheel.tsx) to
 * change which crop it sows, and it draws that crop rather than a generic pouch
 * so the player can see what they are about to plant without opening anything.
 */

export interface StackAcresToolbeltProps {
  held: BeltTool;
  onPick: (tool: BeltTool) => void;
  /** The crop on the seed wheel, drawn in the pouch slot when there is one. */
  seed: StackAcresCrop | null;
  /** That crop's own icon, so the pouch shows what it sows. */
  seedIcon: PainterName | null;
  /** Seeds of it on hand, shown on the slot so an empty pouch is visible before it is used. */
  seedsHeld: number;
  /** Beds on the shelf, shown on the hoe for the same reason. */
  soilHeld: number;
  /** Water left in the can. */
  water: number;
  onOpenSeeds: () => void;
}

export function StackAcresToolbelt({
  held,
  onPick,
  seed,
  seedIcon,
  seedsHeld,
  soilHeld,
  water,
  onOpenSeeds,
}: StackAcresToolbeltProps) {
  return (
    <div className="sa-toolbelt" role="radiogroup" aria-label="Tool belt">
      {BELT_TOOLS.map((tool) => {
        const def = BELT_TOOL_DEFS[tool];
        const isHeld = held === tool;
        const pouch = tool === "seeds";
        // What the slot draws, and the little number in its corner. The pouch
        // borrows the crop's own icon once one is picked.
        const icon = (pouch && seedIcon ? seedIcon : def.icon) as PainterName;
        const count = pouch ? (seed ? seedsHeld : null) : tool === "hoe" ? soilHeld : tool === "can" ? water : null;
        const label = pouch && seed ? `Seed pouch: ${seed.replace(/_/g, " ")}` : def.label;
        return (
          <button
            key={tool}
            type="button"
            role="radio"
            aria-checked={isHeld}
            className={clsx("sa-belt-slot", { "is-held": isHeld, "is-spent": count === 0 })}
            aria-label={label}
            title={def.hint}
            onClick={() => {
              // A second press on the pouch is "change the seed", not "put it down".
              if (pouch && isHeld) {
                onOpenSeeds();
                return;
              }
              onPick(tool);
              if (pouch && !seed) onOpenSeeds();
            }}
          >
            <StackAcresIcon name={icon} size={20} />
            {count !== null && <span className="sa-belt-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
