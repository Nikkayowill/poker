"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import {
  machineItemIcon,
  machineItemLabel,
  machineItemNoun,
  machineItemSellPrice,
  type MachineItemId,
} from "@/lib/stackacres/machine-items";
import { TOWN_BUYERS, itemsBoughtBy, type TownBuyerId } from "@/lib/stackacres/town-buyers";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";
import type { WorkshopActionResult } from "./WorkshopModal";

/**
 * One of the City's buyers, opened by tapping them: the grain elevator, the general store or the sale
 * barn (lib/stackacres/town-buyers.ts). Lists what the player holds that this buyer takes, with a sell
 * button for one or for all. Styled like Cora's seed sheet.
 */
export function TownBuyerSheet({
  buyer,
  inventory,
  isPending,
  onSell,
  onClose,
}: {
  buyer: TownBuyerId;
  inventory: StackAcresInventory;
  isPending: (intent: string) => boolean;
  onSell: (buyer: TownBuyerId, item: MachineItemId, quantity: number) => Promise<WorkshopActionResult>;
  onClose: () => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const [note, setNote] = useState<{ tone: "paid" | "refused"; text: string } | null>(null);
  const def = TOWN_BUYERS[buyer];
  const takes = itemsBoughtBy(buyer);
  const held = takes.filter((item) => inventoryQuantity(inventory, item) > 0);

  const sell = async (item: MachineItemId, quantity: number) => {
    const result = await onSell(buyer, item, quantity);
    if (!result.ok) setNote({ tone: "refused", text: result.message });
    else if (result.sold)
      setNote({
        tone: "paid",
        text: `Sold ${machineItemLabel(result.sold.item, result.sold.quantity)} for ${result.sold.gold.toLocaleString()} Gold.`,
      });
  };

  return (
    <div className="sa-store-scrim" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="sa-store-card" role="dialog" aria-modal="true" aria-label={def.title}>
        <header className="sa-store-head">
          <h2>{def.title}</h2>
          <button ref={closeButtonRef} type="button" className="sa-store-close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="sa-store-panel">
          <p className="sa-sheet-note">
            {def.name}: &ldquo;{def.greeting}&rdquo;
          </p>
          {note && (
            <p className={`sa-contracts-note is-${note.tone}`} role={note.tone === "refused" ? "alert" : "status"}>
              {note.text}
            </p>
          )}
          {takes.length > 0 && held.length === 0 && (
            <p className="sa-stock-terms">You have nothing {def.name} buys yet.</p>
          )}
          {held.length > 0 && (
            <div className="sa-stock-cards">
              {held.map((item) => {
                const count = inventoryQuantity(inventory, item);
                const price = machineItemSellPrice(item);
                return (
                  <div key={item} className="sa-stock-card">
                    <h3>
                      <StackAcresIcon name={machineItemIcon(item) as PainterName} size={20} />
                      {machineItemNoun(item, 2)}
                    </h3>
                    <p className="sa-stock-yield">
                      <span className="sa-store-cost">
                        <StackAcresPixelIcon name="coin" />
                        {price.toLocaleString()}
                      </span>{" "}
                      each
                    </p>
                    <div className="sa-buy-qty-row">
                      <button
                        type="button"
                        className="sa-cta"
                        disabled={isPending(`sell:${item}:1`)}
                        onClick={() => void sell(item, 1)}
                      >
                        Sell 1
                      </button>
                      {count > 1 && (
                        <button
                          type="button"
                          className="sa-cta"
                          disabled={isPending(`sell:${item}:${count}`)}
                          onClick={() => void sell(item, count)}
                        >
                          Sell all {count}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
