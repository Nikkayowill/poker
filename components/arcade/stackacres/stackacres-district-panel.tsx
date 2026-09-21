"use client";

import { isLivestock, type StackAcresStock } from "@/lib/stackacres/catalogue";
import type { BuyOption } from "@/lib/stackacres/district-panel";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * Buy outright, Cycle Lease, expand capacity. All that is left of the old
 * district sidebar, which held these buttons plus a row per standing unit.
 * The sidebar is gone; this section now renders inside the Supply Store's
 * Livestock shelf, which is where buying an animal belongs anyway.
 */

/** Which painter stands for a stock. Livestock draws the animal; crops draw
 *  their ripe produce rather than the sprout -- a buy button is answering
 *  "what do I get", and one green speck looks like every other green speck. */
const STOCK_ICON: Readonly<Record<StackAcresStock, PainterName>> = {
  // All 16 crops.
  bell_pepper: "ico-bell_pepper",
  broccoli: "ico-broccoli",
  cabbage: "ico-cabbage",
  carrot: "ico-carrot",
  celery: "ico-celery",
  corn: "ico-corn",
  eggplant: "ico-eggplant",
  green_bean: "ico-green_bean",
  lettuce: "ico-lettuce",
  onion: "ico-onion",
  pepper: "ico-pepper",
  potato: "ico-potato",
  radish: "ico-radish",
  spinach: "ico-spinach",
  tomato: "ico-tomato",
  wheat: "ico-wheat",
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

export interface StackAcresBuySectionProps {
  options: readonly BuyOption[];
  /** Whether a given action intent has a request in the air -- each button
   *  greys out on its own (`stock:<stock>`, `buy-stock:<stock>`,
   *  `expand-capacity:<stock>`). */
  isPending: (intent: string) => boolean;
  onSeed: (stock: StackAcresStock) => void;
  onBuyOutright: (stock: StackAcresStock) => void;
  onExpand: (stock: StackAcresStock) => void;
}

/** What can be bought in this district. */
export function StackAcresBuySection({ options, isPending, onSeed, onBuyOutright, onExpand }: StackAcresBuySectionProps) {
  return (
    <div className="sa-buy-section" aria-label="Buy">
      {options.map((option) => (
        <div key={option.stock} className="sa-buy-kind">
          <div className="sa-buy-head">
            <span className="sa-buy-kind-name">
              <StackAcresIcon name={STOCK_ICON[option.stock]} size={20} />
              {option.label}
            </span>
            <span className="sa-buy-cap" aria-hidden="true">
              {option.cap === null ? `${option.owned} planted` : `${option.owned} / ${option.cap}`}
            </span>
          </div>
          <div className="sa-buy-actions">
            <button
              type="button"
              className="sa-buy-btn is-seed"
              disabled={isPending(`stock:${option.stock}`) || !option.seedAfford}
              title={option.seedReason ?? undefined}
              onClick={() => onSeed(option.stock)}
            >
              {/* A stocked animal runs one cycle and is deleted on collect, so for livestock this is a lease. */}
              <span className="sa-buy-label">
                {isLivestock(option.stock) ? "Cycle Lease" : "Seed one cycle"}
              </span>
              <span className="sa-buy-price">{option.seedCost.toLocaleString()} Gold</span>
            </button>
            {option.outrightCost !== null && (
              <button
                type="button"
                className="sa-buy-btn is-gold"
                disabled={isPending(`buy-stock:${option.stock}`) || option.atCap}
                title={option.atCap ? option.seedReason ?? undefined : undefined}
                onClick={() => onBuyOutright(option.stock)}
              >
                <span className="sa-buy-label">Buy outright</span>
                <span className="sa-buy-price">{option.outrightCost.toLocaleString()} Gold</span>
              </button>
            )}
            {option.expand && (
              <button
                type="button"
                className="sa-buy-btn is-expand"
                disabled={isPending(`expand-capacity:${option.stock}`)}
                onClick={() => onExpand(option.stock)}
              >
                <span className="sa-buy-label">Expand capacity</span>
                <span className="sa-buy-price">{option.expand.cost.toLocaleString()} Gold</span>
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
