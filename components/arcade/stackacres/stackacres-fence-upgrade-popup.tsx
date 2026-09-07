"use client";

import { useEffect, useRef } from "react";
import { FENCE_TIER_LABEL, FENCE_TIER_MAX_DURABILITY, nextFenceTier, type FenceTier } from "@/lib/stackacres/wildlife";
import { STACKACRES_ZONES, type ZoneId } from "@/lib/stackacres/zones";
import type { TapPoint } from "./stackacres-scene";

/**
 * The fence-upgrade popup: a tap on one bay of a district's own fence line
 * opens this, offering the next tier up. Anchored at the tap point the
 * scene hands back through `onFenceSegmentTap`, the SAME screen-pinned real
 * DOM convention `StackAcresRadialMenu` and `StackAcresMonkDialogue` both
 * already use -- not a canvas overlay, so it reads with a screen reader and
 * the Escape key closes it exactly like those two do. Dismissal is not this
 * component's own job either: the shell closes it on the next world tap
 * (`onViewMoved`) or its own close button here, same as the monk dialogue.
 */

export interface StackAcresFenceUpgradePopupProps {
  at: TapPoint;
  zone: ZoneId;
  segmentIndex: number;
  tier: FenceTier;
  durability: number;
  busy: boolean;
  onUpgrade: () => void;
  onClose: () => void;
}

/** The district's own name, read straight off ./zones.ts rather than kept as
 *  a second hand-written copy. The old copy here had already drifted -- it
 *  still said "the Long Meadow" and "the Wallow" after both were renamed --
 *  which is exactly the failure this codebase keeps hitting with restated
 *  constants (STAKES_TIERS, the wager ladders, PEN_BLOCKS against GROW_AREA).
 *  Every label already carries its own article ("The Fold", "Cattle
 *  Pasture"), so the sentence reads correctly without one being added here. */
function zoneLabel(zone: ZoneId): string {
  return STACKACRES_ZONES[zone].label;
}

export function StackAcresFenceUpgradePopup({
  at,
  zone,
  tier,
  durability,
  busy,
  onUpgrade,
  onClose,
}: StackAcresFenceUpgradePopupProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const next = nextFenceTier(tier);
  const maxDurability = FENCE_TIER_MAX_DURABILITY[tier];

  useEffect(() => {
    const timer = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sa-fence-upgrade" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-fence-upgrade-pin" aria-hidden="true" />
      <div className="sa-fence-upgrade-card" role="dialog" aria-label="Fence bay">
        <button type="button" className="sa-fence-upgrade-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <p className="sa-fence-upgrade-line">
          {FENCE_TIER_LABEL[tier]} fencing along {zoneLabel(zone)}.
        </p>
        <p className="sa-fence-upgrade-durability">
          Durability {Math.max(0, durability)}/{maxDurability}
        </p>
        {next ? (
          <div className="sa-fence-upgrade-actions">
            <button type="button" className="sa-fence-upgrade-yes" ref={firstRef} disabled={busy} onClick={onUpgrade}>
              Upgrade to {FENCE_TIER_LABEL[next]}
            </button>
            <button type="button" className="sa-fence-upgrade-no" onClick={onClose}>
              Not now
            </button>
          </div>
        ) : (
          <div className="sa-fence-upgrade-actions">
            <button type="button" className="sa-fence-upgrade-no" ref={firstRef} onClick={onClose}>
              Already Steel Mesh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
