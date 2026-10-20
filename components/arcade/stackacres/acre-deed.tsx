"use client";

import { useCallback, useState } from "react";
import clsx from "clsx";
import { acreById, type StackAcresAcresView } from "@/lib/stackacres/acres";
import { affordable, buildShortfall, costLines, costSummary } from "@/lib/stackacres/build-cost";
import type { Action } from "@/lib/stackacres/farm-actions";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import type { ContractActionResult } from "./TownContractsModal";

/**
 * Buying an acre of the wild land (lib/stackacres/acres.ts).
 *
 * The hoe or the fence on ground you do not own opens this bar instead of
 * building. It names the acre's size and price, and the Buy key sends
 * `buy-acre`. The server prices it and takes the Wood, Stone and Gold; nothing
 * shows as bought until its answer lands, because a refused purchase should not
 * flash an acre that then goes away.
 */

export interface AcreDeedProps {
  /** The farmer is out on the Homestead. Everything here is off anywhere else. */
  active: boolean;
  acres: StackAcresAcresView;
  gold: number;
  unlimitedGold: boolean;
  inventory: StackAcresInventory;
  act: (action: Action) => Promise<ContractActionResult>;
}

export interface AcreDeed {
  /** Opens the bar for an acre the farm does not own. */
  open: (acreId: string) => void;
  controls: React.ReactNode;
}

export function useAcreDeed({ active, acres, gold, unlimitedGold, inventory, act }: AcreDeedProps): AcreDeed {
  const [acreId, setAcreId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  const open = useCallback((id: string) => {
    setNotice(null);
    setAcreId(id);
  }, []);

  const close = useCallback(() => {
    setNotice(null);
    setAcreId(null);
  }, []);

  const acre = acreId ? acreById(acreId) : null;
  // Bought, or left the Homestead: nothing left to ask.
  const showing = active && acre !== null && !acres.owned.includes(acre.id) && acres.price !== null;

  const buy = () => {
    if (!acre || buying) return;
    setBuying(true);
    setNotice(null);
    void act({ action: "buy-acre", acreId: acre.id })
      .then((result) => {
        if (result.ok) setAcreId(null);
        else setNotice(result.message);
      })
      .finally(() => setBuying(false));
  };

  let controls: React.ReactNode = null;
  if (showing && acre && acres.price) {
    const { price } = acres;
    const cost = {
      lines: costLines(
        price.gold,
        [
          { item: "wood", quantity: price.wood },
          { item: "stone", quantity: price.stone },
        ],
        unlimitedGold ? Number.MAX_SAFE_INTEGER : gold,
        inventory,
      ),
    };
    const short = buildShortfall(cost);
    const can = affordable(cost.lines);
    controls = (
      <div className="sa-build-bar" role="toolbar" aria-label="Buy this acre">
        <p className={clsx("sa-build-say", (notice || short) && "is-problem")}>
          {notice ??
            `This acre is ${acre.width} by ${acre.height} squares: ${costSummary(cost)}. ${
              short ?? `Keeping it costs ${acres.upkeepEach} Gold a day, taken from what you sell.`
            }`}
        </p>
        <div className="sa-build-keys">
          <button type="button" className="sa-cta" disabled={!can || buying} onClick={buy}>
            Buy
          </button>
          <button type="button" className="sa-sheet-close" onClick={close}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  return { open, controls };
}
