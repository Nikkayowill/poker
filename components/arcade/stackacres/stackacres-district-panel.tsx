"use client";

import { STACKACRES_CATALOGUE, type StackAcresStock } from "@/lib/stackacres/catalogue";
import { unitRowAction, type BuyOption } from "@/lib/stackacres/district-panel";
import { timeLeftLabel } from "@/lib/stackacres/tap-action";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The district sidebar: the deep end of one district. Successor to
 * stackacres-grid.tsx's `StackAcresPlotList` + `StackAcresSeedStrip`.
 *
 * It is no longer how the game is played. Collecting, feeding, clearing and
 * seeding all happen with a tap on the map itself now (see
 * lib/stackacres/tap-action.ts and the radial menu), and this panel does not
 * open on its own any more -- it is what you go to for the Gold decisions
 * (`StackAcresBuySection`: buy outright, expand capacity) and for the full
 * standing list.
 *
 * `StackAcresUnitRows` therefore does two jobs, and the second is why it did
 * not go away with the loop it used to be. It is the ONLY keyboard and
 * screen-reader path to what a tap on the canvas does -- the canvas is
 * `aria-hidden` and always has been -- and it carries the one action a tap
 * deliberately cannot reach: retiring, which refunds nothing and stays behind
 * two presses. Same posture as before on refusals: a disabled button still
 * SAYS why, which a floating label on a canvas has no room to.
 */

/** Which painter stands for a stock. Livestock draws the animal; crops draw
 *  their ripe produce rather than the sprout -- a buy button is answering
 *  "what do I get", and one green speck looks like every other green speck. */
const STOCK_ICON: Readonly<Record<StackAcresStock, PainterName>> = {
  sprout: "ico-carrot",
  cash_crop: "ico-corn",
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

function stateLine(unit: StackAcresUnitSnapshot, nowMs: number): string {
  switch (unit.state) {
    case "ready":
      return "Ready to collect";
    case "hungry":
      return "Hungry -- feed to keep it going";
    case "dry":
      return "Thirsty -- water to keep it growing";
    case "mucked":
      return `Weather-worn -- clear for ${(unit.muckFee ?? 0).toLocaleString()} Bushels`;
    case "working":
      return unit.permanent ? `Working -- ready in ${timeLeftLabel(unit.readyAt, nowMs)}` : `Ready in ${timeLeftLabel(unit.readyAt, nowMs)}`;
  }
}

export interface StackAcresUnitRowsProps {
  units: readonly StackAcresUnitSnapshot[];
  nowMs: number;
  feed: number;
  bushels: number;
  busyUnitId: string | null;
  /** The unit currently mid-"are you sure" for retiring. Never a plain
   *  confirm(): retiring refunds nothing, so it takes two deliberate taps. */
  armedUnitId: string | null;
  onCollect: (unit: StackAcresUnitSnapshot) => void;
  onFeed: (unit: StackAcresUnitSnapshot) => void;
  onWater: (unit: StackAcresUnitSnapshot) => void;
  onClear: (unit: StackAcresUnitSnapshot) => void;
  /** First tap on a permanent unit's row. */
  onArmRetire: (unit: StackAcresUnitSnapshot) => void;
  /** Second tap, once armed -- actually retires. */
  onConfirmRetire: (unit: StackAcresUnitSnapshot) => void;
  onCancelRetire: () => void;
}

/** What's already standing in this district. */
export function StackAcresUnitRows({
  units,
  nowMs,
  feed,
  bushels,
  busyUnitId,
  armedUnitId,
  onCollect,
  onFeed,
  onWater,
  onClear,
  onArmRetire,
  onConfirmRetire,
  onCancelRetire,
}: StackAcresUnitRowsProps) {
  if (units.length === 0) {
    return (
      <p className="sa-district-empty">
        Nothing here yet -- seed the first one above, or tap the bare ground on the map.
      </p>
    );
  }

  return (
    <ul className="sa-unit-rows" aria-label="What you own here">
      {units.map((unit) => {
        const def = STACKACRES_CATALOGUE[unit.stock];
        const action = unitRowAction(unit, { feed, bushels });
        const busy = busyUnitId === unit.id;
        return (
          <li key={unit.id} className="sa-unit-row" data-state={unit.state}>
            <span className="sa-unit-icon">
              <StackAcresIcon name={STOCK_ICON[unit.stock]} size={26} />
            </span>
            <span className="sa-unit-info">
              <span className="sa-unit-name">
                {def.label}
                {unit.permanent ? " -- owned" : ""}
              </span>
              <span className="sa-unit-state" data-state={unit.state}>
                {stateLine(unit, nowMs)}
              </span>
            </span>
            {action.kind === "collect" && (
              <button
                type="button"
                className="sa-unit-action is-primary"
                disabled={busy}
                onClick={() => onCollect(unit)}
              >
                Collect
              </button>
            )}
            {action.kind === "feed" && (
              <button
                type="button"
                className="sa-unit-action is-warn"
                disabled={busy || action.disabled}
                title={action.reason ?? undefined}
                onClick={() => onFeed(unit)}
              >
                Feed
              </button>
            )}
            {action.kind === "water" && (
              <button
                type="button"
                className="sa-unit-action is-water"
                disabled={busy}
                onClick={() => onWater(unit)}
              >
                Water
              </button>
            )}
            {action.kind === "clear" && (
              <button
                type="button"
                className="sa-unit-action is-bad"
                disabled={busy || action.disabled}
                title={action.reason ?? undefined}
                onClick={() => onClear(unit)}
              >
                Clear
              </button>
            )}
            {action.kind === "retire" && armedUnitId === unit.id && (
              <span className="sa-unit-confirm">
                <button
                  type="button"
                  className="sa-unit-action is-bad"
                  disabled={busy}
                  onClick={() => onConfirmRetire(unit)}
                >
                  Confirm -- no refund
                </button>
                <button type="button" className="sa-unit-link" onClick={onCancelRetire}>
                  Keep them
                </button>
              </span>
            )}
            {action.kind === "retire" && armedUnitId !== unit.id && (
              <button
                type="button"
                className="sa-unit-action is-ghost"
                disabled={busy}
                onClick={() => onArmRetire(unit)}
              >
                Retire
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface StackAcresBuySectionProps {
  options: readonly BuyOption[];
  busy: boolean;
  onSeed: (stock: StackAcresStock) => void;
  onBuyOutright: (stock: StackAcresStock) => void;
  onExpand: (stock: StackAcresStock) => void;
}

/** What can be bought in this district. */
export function StackAcresBuySection({ options, busy, onSeed, onBuyOutright, onExpand }: StackAcresBuySectionProps) {
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
              {option.owned} / {option.cap}
            </span>
          </div>
          <div className="sa-buy-actions">
            <button
              type="button"
              className="sa-buy-btn is-bushels"
              disabled={busy || !option.seedAfford}
              title={option.seedReason ?? undefined}
              onClick={() => onSeed(option.stock)}
            >
              <span className="sa-buy-label">Seed with Bushels</span>
              <span className="sa-buy-price">{option.seedCost.toLocaleString()} Bushels</span>
            </button>
            <button
              type="button"
              className="sa-buy-btn is-gold"
              disabled={busy || option.atCap}
              title={option.atCap ? option.seedReason ?? undefined : undefined}
              onClick={() => onBuyOutright(option.stock)}
            >
              <span className="sa-buy-label">Buy outright</span>
              <span className="sa-buy-price">{option.outrightCost.toLocaleString()} Gold</span>
            </button>
            {option.expand && (
              <button
                type="button"
                className="sa-buy-btn is-expand"
                disabled={busy}
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
