"use client";

import { useCallback, useMemo, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Clock, Coins, Sparkles, TrendingUp } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  MIDNIGHT_MERCHANT_CATALOG,
  priceForNextPurchase,
  type MidnightMerchantItemId,
  type MidnightMerchantSnapshot,
} from "@/lib/stackacres/midnight-merchant";

/**
 * The Midnight Merchant's own storefront -- a DOM overlay that OVERRIDES
 * Grandfather Ray's standard `TownContractsModal` sheet while a visit is
 * live, rather than composing with it. The two are mutually exclusive by
 * construction (stackacres-farm.tsx opens at most one sheet at a time; see
 * its own `activeSheet` state), not by any check in either component --
 * Ray's board and the Merchant's cart have nothing to say about each other,
 * and asking one to know about the other would be the wrong coupling for
 * two screens that just happen to share a scrim class.
 *
 * ------------------------------------------------------------------------
 * WHY THIS DOES NOT DEBIT OPTIMISTICALLY, UNLIKE TownContractsModal
 *
 * That sheet removes goods from a local shelf before the request goes out
 * because its shelf (`inventory`) is a quantity this component already
 * holds and can safely subtract from client-side. A Merchant purchase has no
 * equivalent local quantity to subtract -- the PRICE ITSELF is server state
 * (`visit.purchaseStreak`, read under a row lock inside
 * `redeem_midnight_merchant_item`), so showing a locally-decided price and
 * then finding out the server charged a different one would be worse than
 * showing nothing until the response lands. `nextPrice` below is a PREVIEW,
 * computed from the same formula the server uses
 * (`priceForNextPurchase`) but from a snapshot that can already be one
 * concurrent purchase stale -- it is what the button labels itself with,
 * never what gets charged. The actual charge is whatever
 * `redeem_midnight_merchant_item` computed under its own lock, reported back
 * in `onBuy`'s resolved result.
 *
 * ------------------------------------------------------------------------
 * POINTER CONTAINMENT
 *
 * Identical contract to TownContractsModal's own header comment: Phaser
 * input is off entirely on this scene (stackacres-world.tsx), so every
 * `contain()` wrapper below is a belt-and-suspenders `stopPropagation` on
 * top of the DOM stacking order that already keeps a press here from
 * reaching the canvas host underneath. Do not remove these on the grounds
 * that the map does not seem to react to a tap on this sheet -- that is this
 * file working, not this file being unnecessary.
 */

/** What one attempted purchase came back as. Mirrors
 *  TownContractsModal's own `ContractActionResult` shape (never invents a
 *  message the server did not send). */
export type MidnightMerchantPurchaseResult =
  | { readonly ok: true; readonly pricePaid: number }
  | { readonly ok: false; readonly message: string };

export interface MidnightMerchantStorefrontProps {
  /** The last server-confirmed visit. Never null when this component is
   *  mounted -- stackacres-farm.tsx renders this component only while
   *  `merchantManager.isInteractive()` is true, which itself requires a
   *  non-null visit (see lib/stackacres/midnight-merchant.ts). */
  visit: MidnightMerchantSnapshot;
  /** Local countdown, ticked by `MidnightMerchantManager` -- see that
   *  class's own header for why this drifts from the server's `expiresAtIso`
   *  only downward, never upward, between polls. */
  msRemainingLocal: number;
  urgent: boolean;
  goldBalance: number;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `midnight-merchant-buy`. Resolves once this browser knows the
   *  outcome. */
  onBuy: (itemId: MidnightMerchantItemId) => Promise<MidnightMerchantPurchaseResult>;
  onClose: () => void;
}

type Note = { readonly tone: "paid" | "refused"; readonly text: string };

/** Same wrapper as TownContractsModal's own `contain` -- restated here
 *  rather than shared, because sharing a one-line function across two
 *  components buys nothing but an import, and each sheet's own header
 *  comment is the thing a future reader actually needs standing next to the
 *  handlers it explains. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MidnightMerchantStorefront({
  visit,
  msRemainingLocal,
  urgent,
  goldBalance,
  busy,
  onBuy,
  onClose,
}: MidnightMerchantStorefrontProps) {
  const [buying, setBuying] = useState<MidnightMerchantItemId | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, buying === null);

  /** One row per catalog entry that this visit actually stocked. A visit
   *  seeds every catalog entry at spawn (see `spawnMidnightMerchantVisit`),
   *  so in practice this is the full catalog every time -- filtered rather
   *  than assumed, so a future visit type that stocks a subset does not
   *  require touching this component. */
  const rows = useMemo(
    () =>
      MIDNIGHT_MERCHANT_CATALOG.map((entry) => {
        const line = visit.stock.find((s) => s.itemId === entry.itemId);
        return {
          entry,
          remaining: line?.remaining ?? 0,
          nextPrice: priceForNextPurchase(line?.basePrice ?? entry.basePrice, visit.purchaseStreak),
        };
      }).filter((row) => visit.stock.some((s) => s.itemId === row.entry.itemId)),
    [visit],
  );

  const working = busy || buying !== null;

  const handleBuy = useCallback(
    async (itemId: MidnightMerchantItemId): Promise<void> => {
      if (working) return;
      setNote(null);
      setBuying(itemId);
      try {
        const result = await onBuy(itemId);
        if (!result.ok) {
          setNote({ tone: "refused", text: result.message });
          return;
        }
        setNote({ tone: "paid", text: `Sold. ${result.pricePaid.toLocaleString()} Gold.` });
      } catch {
        setNote({ tone: "refused", text: "The Merchant didn't hear that. Nothing was taken." });
      } finally {
        setBuying(null);
      }
    },
    [working, onBuy],
  );

  return (
    <div
      className="sa-sheet-scrim"
      role="presentation"
      onMouseDown={contain(onBackdropMouseDown)}
      onPointerDown={contain()}
      onPointerUp={contain()}
      onPointerMove={contain()}
      onTouchStart={contain()}
      onTouchMove={contain()}
      onClick={contain()}
      onWheel={contain()}
    >
      <section
        className="sa-sheet sa-merchant"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-merchant-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Sparkles size={13} aria-hidden="true" /> One night only
            </p>
            <h2 id="sa-merchant-title">The Midnight Merchant</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="sa-sheet-close"
            onClick={contain(closeAll)}
          >
            Done
          </button>
        </header>

        <p className={clsx("sa-merchant-countdown", { "is-urgent": urgent })}>
          <Clock size={13} aria-hidden="true" />
          {urgent ? "Leaving any moment" : "Leaves in"} {formatCountdown(msRemainingLocal)}
        </p>

        <p className="sa-sheet-note">
          Everything here climbs 20% the moment you buy it -- the first item is the cheapest one
          you will see tonight.
        </p>

        {note && (
          <p
            className={clsx("sa-contracts-note", `is-${note.tone}`)}
            role={note.tone === "refused" ? "alert" : "status"}
          >
            {note.text}
          </p>
        )}

        <ul className="sa-merchant-stock">
          {rows.map(({ entry, remaining, nextPrice }) => {
            const soldOut = remaining <= 0;
            const affordable = goldBalance >= nextPrice;
            return (
              <li
                key={entry.itemId}
                className={clsx("sa-merchant-item", { "is-sold-out": soldOut })}
              >
                <div className="sa-merchant-item-head">
                  <h3>{entry.label}</h3>
                  <span className="sa-contract-count">
                    <strong>{remaining.toLocaleString()}</strong> left
                  </span>
                </div>
                <p className="sa-merchant-price">
                  <Coins size={14} aria-hidden="true" />
                  <strong>{nextPrice.toLocaleString()}</strong>
                  <span>Gold</span>
                  {visit.purchaseStreak > 0 && (
                    <span className="sa-merchant-streak">
                      <TrendingUp size={12} aria-hidden="true" />+
                      {Math.round((nextPrice / entry.basePrice - 1) * 100)}%
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  className="sa-cta"
                  disabled={working || soldOut || !affordable}
                  onClick={contain(() => void handleBuy(entry.itemId))}
                >
                  {soldOut ? "Sold out" : !affordable ? "Not enough Gold" : "Buy"}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="sa-sheet-note">
          Gone the moment the clock above runs out, or the moment you leave -- come back another
          night for a different Merchant and a fresh price.
        </p>
      </section>
    </div>
  );
}
