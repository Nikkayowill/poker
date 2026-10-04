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
import { STACKACRES_CATALOGUE, type StackAcresMarketLivestock, type StackAcresStock } from "@/lib/stackacres/catalogue";
import {
  feederOffers,
  saleBarnPens,
  shipmentGold,
  shippedAnimalLabel,
  type MarketAnimalRow,
  type StackAcresShipment,
} from "@/lib/stackacres/sale-barn";
import { STOCK_ICON } from "./stock-icon";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";
import type { WorkshopActionResult } from "./WorkshopModal";

/**
 * One of the City's buyers, opened by tapping them: the grain elevator, the general store or the sale
 * barn (lib/stackacres/town-buyers.ts). Lists what the player holds that this buyer takes, with a sell
 * button for one or for all. Styled like Cora's seed sheet.
 */
/** What Hank's half of the sheet needs: the herd, the pen caps and the two things he does. */
export interface SaleBarnProps {
  units: readonly (MarketAnimalRow & { state: string; away?: unknown })[];
  capacity: Readonly<Partial<Record<StackAcresStock, number>>>;
  hasBarn: boolean;
  gold: number;
  /** Buys a feeder pig or a calf: the ordinary lease of one cycle. */
  onBuyFeeder: (stock: StackAcresMarketLivestock) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Sends every ready animal to market. */
  onShip: () => Promise<{ ok: true; shipped?: StackAcresShipment } | { ok: false; message: string }>;
}

export function TownBuyerSheet({
  buyer,
  inventory,
  isPending,
  onSell,
  onClose,
  saleBarn,
}: {
  buyer: TownBuyerId;
  inventory: StackAcresInventory;
  isPending: (intent: string) => boolean;
  onSell: (buyer: TownBuyerId, item: MachineItemId, quantity: number) => Promise<WorkshopActionResult>;
  onClose: () => void;
  /** Only for the sale barn. */
  saleBarn?: SaleBarnProps;
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
          {saleBarn && <SaleBarnPanel {...saleBarn} isPending={isPending} onNote={setNote} />}
          {takes.length > 0 && held.length === 0 && (
            <p className="sa-stock-terms">Nothing on hand that {def.name} buys.</p>
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

/**
 * Hank's own half of the sheet: send what is ready to market, and buy young
 * stock to raise. Each animal bought here walks home to the farm, where the
 * player sets it down in the yard like a sheep or a cow.
 */
function SaleBarnPanel({
  units,
  capacity,
  hasBarn,
  gold,
  onBuyFeeder,
  onShip,
  isPending,
  onNote,
}: SaleBarnProps & {
  isPending: (intent: string) => boolean;
  onNote: (note: { tone: "paid" | "refused"; text: string }) => void;
}) {
  const pens = saleBarnPens(units, capacity, hasBarn);
  const ready = pens.flatMap((pen) => pen.ready);
  const growing = pens.reduce((total, pen) => total + pen.owned, 0) - ready.length;

  const ship = async () => {
    const result = await onShip();
    if (!result.ok) {
      onNote({ tone: "refused", text: result.message });
      return;
    }
    const sold = result.shipped;
    onNote({
      tone: "paid",
      text: sold
        ? `Sold ${sold.animals.map(shippedAnimalLabel).join(". ")}. ${sold.gold.toLocaleString()} Gold in all.`
        : "Sold at the sale barn.",
    });
  };

  const buy = async (stock: StackAcresMarketLivestock, label: string) => {
    const result = await onBuyFeeder(stock);
    onNote(
      result.ok
        ? { tone: "paid", text: `Your ${label.toLowerCase()} is on its way home. Set it down in the yard.` }
        : { tone: "refused", text: result.message },
    );
  };

  return (
    <>
      <div className="sa-stock-cards">
        <div className="sa-stock-card">
          <h3>Ship to market</h3>
          {ready.length > 0 ? (
            <ul className="sa-sale-barn-list">
              {ready.map((line) => (
                <li key={line.unitId}>{shippedAnimalLabel(line)}</li>
              ))}
            </ul>
          ) : (
            <p className="sa-stock-terms">
              {growing > 0
                ? "Nothing is ready yet. Keep them fed and bring them in when they're grown."
                : "You have no hogs or steers yet. Buy one below."}
            </p>
          )}
          <button
            type="button"
            className="sa-cta"
            disabled={ready.length === 0 || isPending("ship-livestock")}
            onClick={() => void ship()}
          >
            {ready.length > 0 ? `Ship to market (${shipmentGold(ready).toLocaleString()} Gold)` : "Ship to market"}
          </button>
        </div>
      </div>
      <div className="sa-stock-cards">
        {feederOffers().map((offer) => {
          const pen = pens.find((candidate) => candidate.stock === offer.stock);
          const full = pen !== undefined && pen.owned >= pen.cap;
          const short = gold < offer.price;
          return (
            <div key={offer.stock} className="sa-stock-card">
              <h3>
                <StackAcresIcon name={STOCK_ICON[offer.stock]} size={20} />
                {offer.label}
              </h3>
              <p className="sa-stock-yield">
                <span className="sa-store-cost">
                  <StackAcresPixelIcon name="coin" />
                  {offer.price.toLocaleString()}
                </span>
              </p>
              <p className="sa-stock-terms">{offer.blurb}</p>
              {pen && (
                <p className="sa-stock-terms">
                  You have {pen.owned} of {pen.cap} {STACKACRES_CATALOGUE[offer.stock].label.toLowerCase()}s.
                </p>
              )}
              <button
                type="button"
                className="sa-cta"
                disabled={full || short || isPending(`stock:${offer.stock}`)}
                onClick={() => void buy(offer.stock, offer.label)}
              >
                {full ? "Pen is full" : short ? "Not enough Gold" : `Buy a ${offer.label.toLowerCase()}`}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
