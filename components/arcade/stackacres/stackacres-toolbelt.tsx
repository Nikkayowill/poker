"use client";

import clsx from "clsx";
import { BELT_TOOLS, BELT_TOOL_DEFS, WATER_TOOLS, type BeltTool } from "@/lib/stackacres/toolbelt";
import type { StackAcresCrop } from "@/lib/stackacres/catalogue";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";
import { StackAcresPixelIcon, type PixelIconName } from "./stackacres-pixel-icon";

const SLOT_ICON: Readonly<Record<(typeof BELT_TOOLS)[number], PixelIconName>> = {
  hand: "hand",
  hoe: "hoe",
  can: "can",
  seeds: "pouch",
  fence: "fence",
};

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
 *
 * By the dock the belt grows two more: the rod, and the bait. The bait is an
 * on/off switch, not a tool, and shows how many Radishes are left to put on the hook.
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
  /** Water left in the can. */
  water: number;
  onOpenSeeds: () => void;
  /** He is standing by the dock, so the rod and bait slots show. */
  nearWater: boolean;
  /** Radish bait goes on the hook for each cast. */
  baitOn: boolean;
  /** Radishes held, which is what the bait is. */
  baitHeld: number;
  onToggleBait: () => void;
}

export function StackAcresToolbelt({
  held,
  onPick,
  seed,
  seedIcon,
  seedsHeld,
  water,
  onOpenSeeds,
  nearWater,
  baitOn,
  baitHeld,
  onToggleBait,
}: StackAcresToolbeltProps) {
  return (
    <div className="sa-toolbelt" data-tour="sa-tool-belt" role="radiogroup" aria-label="Tool belt">
      {BELT_TOOLS.map((tool) => {
        const def = BELT_TOOL_DEFS[tool];
        const isHeld = held === tool;
        const pouch = tool === "seeds";
        // The little number in the slot's corner. The pouch draws the crop it
        // sows once one is picked.
        const cropIcon = pouch && seedIcon ? seedIcon : null;
        const count = pouch ? (seed ? seedsHeld : null) : tool === "can" ? water : null;
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
            {cropIcon ? <StackAcresIcon name={cropIcon} size={24} /> : <StackAcresPixelIcon name={SLOT_ICON[tool]} />}
            {count !== null && <span className="sa-belt-count">{count}</span>}
          </button>
        );
      })}
      {nearWater && (
        <>
          {WATER_TOOLS.map((tool) => (
            <button
              key={tool}
              type="button"
              role="radio"
              aria-checked={held === tool}
              className={clsx("sa-belt-slot", { "is-held": held === tool })}
              aria-label={BELT_TOOL_DEFS[tool].label}
              title={BELT_TOOL_DEFS[tool].hint}
              onClick={() => onPick(tool)}
            >
              <StackAcresIcon name="ico-rod" size={24} />
            </button>
          ))}
          <button
            type="button"
            role="switch"
            aria-checked={baitOn && baitHeld > 0}
            className={clsx("sa-belt-slot sa-belt-bait", { "is-on": baitOn && baitHeld > 0, "is-spent": baitHeld === 0 })}
            aria-label={`Radish bait, ${baitOn ? "on" : "off"}`}
            title={baitHeld > 0 ? "Bait each cast with a Radish to catch trout and catfish more often." : "Grow Radishes to use as bait."}
            disabled={baitHeld === 0}
            onClick={onToggleBait}
          >
            <StackAcresIcon name="ico-radish" size={24} />
            <span className="sa-belt-count">{baitHeld}</span>
          </button>
        </>
      )}
    </div>
  );
}
