"use client";

import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Check, Coins, Pin, PinOff, RefreshCw, ScrollText, Sparkles } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  CONTRACT_BOARD_SIZE,
  CONTRACT_PREMIUM,
  contractItemIcon,
  contractItemLabel,
  contractProgress,
  contractRawValue,
  contractSourceHint,
  type ContractItem,
  type ContractRequirement,
  type StackAcresContractRow,
} from "@/lib/stackacres/contracts";
import { isCrossbreedItem, type CrossbreedItem } from "@/lib/stackacres/crossbreed-items";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import {
  crossedInfluenceTier,
  influenceTier,
  nextInfluenceTier,
  type InfluenceTierDef,
} from "@/lib/stackacres/influence-tiers";
import { townFavorSound } from "@/lib/audio/stackacres-sfx";
import { ContractPayout } from "./contract-payout";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The town board: up to four open orders, what is on the shelf toward each,
 * and the buttons that deliver, pin or swap one.
 *
 * Every order on the board is a real open row and every one can be
 * delivered; the pinned one is the one the farm HUD keeps in view. See
 * lib/stackacres/contracts.ts's header for the rules (flat premium, one swap
 * a day, orders only for what the farm can make).
 *
 * SETTLEMENT GOES THROUGH A ROUTE, NOT THE RPC. `adjust_homestead_
 * processing_inventory` is security definer, takes the profile id as a
 * parameter and is revoked from every browser role, so a browser cannot
 * call it. `onSettle` posts `fulfill-contract` and the server runs the money
 * ordering: goods leave first, the order settles under a once-only guard,
 * Gold and Influence land last, with a refund on every failure. What lives
 * here is the client half of that: the optimistic debit is applied before
 * the request goes out and rolled back line by line the moment the server
 * refuses, so the shelf on screen never shows goods the server has already
 * taken, nor keeps showing them gone after a refusal handed them back.
 *
 * POINTER CONTAINMENT. Every handler is wrapped in `contain`, which stops
 * propagation first, so no press in this sheet reaches the map underneath.
 * The scene reads raw pointer events off its host element and this sheet
 * renders outside that host, so containment here is the whole story.
 */

/** A message the sheet is showing about its own last action. The page's error
 *  banner sits behind the scrim, so a refusal raised in here is answered here. */
type Note = { readonly tone: "paid" | "refused" | "pending"; readonly text: string };

/** What a settle or a request came back as. A refusal carries the server's
 *  own wording, which is the wording a player should see. Shared by every
 *  sheet that posts through the farm's `act`. */
export type ContractActionResult =
  | {
      readonly ok: true;
      readonly reward?: { readonly gold: number; readonly influence: number };
      /** Only on a settled `grocery-collect`: the Gold it actually paid. */
      readonly groceryPaid?: number;
    }
  | { readonly ok: false; readonly message: string };

export interface TownContractsModalProps {
  /** The shelf, straight off the last server response. Authoritative: the
   *  optimistic overlay is layered on top and never replaces it. */
  inventory: StackAcresInventory;
  /** Hybrids bred at the Crossbreeding Bed, on their own shelf. */
  hybrids: Partial<Record<CrossbreedItem, number>>;
  /** The open board, oldest first. */
  contracts: readonly StackAcresContractRow[];
  /** Town Influence earned to date. */
  influence: number;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `fulfill-contract` for one order. */
  onSettle: (contractId: string) => Promise<ContractActionResult>;
  /** Posts `request-contract`: fills the board's empty slots. Moves nothing. */
  onRequest: () => Promise<ContractActionResult>;
  /** Posts `pin-contract`. Null clears the pin. Moves nothing. */
  onPin: (contractId: string | null) => Promise<ContractActionResult>;
  /** Posts `replace-contract`: swaps one order out for a fresh draw. Moves
   *  nothing, and the server allows one a UTC day. */
  onReplace: (contractId: string) => Promise<ContractActionResult>;
  onClose: () => void;
}

/** A delivery that has paid, and which row it paid from. Keyed by `nonce`
 *  so a second delivery replays rather than showing a finished ticker. */
type Payout = {
  readonly contractId: string;
  readonly gold: number;
  readonly influence: number;
  readonly nonce: number;
};

/** A rung the settlement just reached, held long enough to read. */
type RungUp = {
  readonly tier: InfluenceTierDef;
  readonly nonce: number;
};

const RUNG_UP_HOLD_MS = 6_000;

/** Wraps a handler so the press is consumed here rather than travelling on. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

export function TownContractsModal({
  inventory,
  hybrids,
  contracts,
  influence,
  busy,
  onSettle,
  onRequest,
  onPin,
  onReplace,
  onClose,
}: TownContractsModalProps) {
  /**
   * The optimistic debit, as the requirement lines it was applied from.
   * Rolling back is then removing exactly those lines, newest first, and a
   * rollback can never overshoot into stock that arrived from somewhere
   * else while the request was out.
   */
  const [pending, setPending] = useState<readonly ContractRequirement[]>([]);
  const [settling, setSettling] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [rungUp, setRungUp] = useState<RungUp | null>(null);

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, !settling);

  /** The shelf as the player should see it: what the server last said, less
   *  anything currently out on an unanswered request. */
  const heldOf = useCallback(
    (item: ContractItem): number => {
      const owed = pending.reduce((total, line) => (line.item === item ? total + line.quantity : total), 0);
      const stocked = isCrossbreedItem(item) ? (hybrids[item] ?? 0) : inventoryQuantity(inventory, item);
      return Math.max(0, stocked - owed);
    },
    [inventory, hybrids, pending],
  );

  const board = useMemo(
    () =>
      contracts
        .filter((contract) => contract.status === "open")
        .map((contract) => ({
          contract,
          ready: contract.requirements.every((line) => heldOf(line.item) >= line.quantity),
          rawValue: contractRawValue(contract.requirements),
        })),
    [contracts, heldOf],
  );

  const rollback = useCallback((applied: readonly ContractRequirement[]) => {
    if (applied.length === 0) return;
    setPending((current) => {
      const next = [...current];
      for (let i = applied.length - 1; i >= 0; i -= 1) {
        const at = next.lastIndexOf(applied[i]);
        if (at >= 0) next.splice(at, 1);
      }
      return next;
    });
  }, []);

  /**
   * Debit first, ask second, put it back on any refusal. Three exits, all
   * ending in the same rollback: the shelf is short (refused here, nothing
   * sent), the server refused (its wording is shown), or the request never
   * came back (this browser does not know what happened, so it must not keep
   * showing goods as spent). A success also clears the overlay, because by
   * then `inventory` has been replaced by the settlement's own response.
   */
  const handleSettle = useCallback(
    async (contract: StackAcresContractRow): Promise<void> => {
      if (busy || settling) return;
      setNote(null);
      setPayout(null);
      setSettling(true);
      const applied: ContractRequirement[] = [];
      try {
        for (const line of contract.requirements) {
          if (heldOf(line.item) < line.quantity) {
            rollback(applied);
            setNote({ tone: "refused", text: `This order needs ${contractItemLabel(line.item, line.quantity)}.` });
            return;
          }
          applied.push(line);
          setPending((current) => [...current, line]);
        }

        const result = await onSettle(contract.id);
        rollback(applied);
        if (!result.ok) {
          setNote({ tone: "refused", text: result.message });
          return;
        }
        const reward = result.reward;
        setNote({
          tone: "paid",
          text: reward
            ? `Delivered. ${reward.gold.toLocaleString()} Gold and ${reward.influence.toLocaleString()} Influence.`
            : "Delivered.",
        });
        if (reward) {
          setPayout({ contractId: contract.id, gold: reward.gold, influence: reward.influence, nonce: Date.now() });
          // `influence` is the total from before this settlement; the parent
          // refetches, so the prop has not moved yet in this closure.
          const reached = crossedInfluenceTier(influence, influence + reward.influence);
          if (reached) {
            townFavorSound();
            setRungUp({ tier: reached, nonce: Date.now() });
          }
        }
      } catch {
        rollback(applied);
        setNote({ tone: "refused", text: "That did not go through. Nothing was taken." });
      } finally {
        setSettling(false);
      }
    },
    [busy, settling, influence, heldOf, onSettle, rollback],
  );

  useEffect(() => {
    if (!rungUp) return;
    const timer = window.setTimeout(() => setRungUp(null), RUNG_UP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [rungUp]);

  /** The three actions that move nothing share one shape: say the honest,
   *  contentless part right away, let the response overwrite it. */
  const moveNothing = useCallback(
    async (pendingText: string, request: () => Promise<ContractActionResult>): Promise<void> => {
      if (busy || settling) return;
      setNote({ tone: "pending", text: pendingText });
      setSettling(true);
      try {
        const result = await request();
        if (!result.ok) setNote({ tone: "refused", text: result.message });
        else setNote(null);
      } catch {
        setNote({ tone: "refused", text: "The town did not answer. Try again in a moment." });
      } finally {
        setSettling(false);
      }
    },
    [busy, settling],
  );

  const working = busy || settling;
  const openSlots = CONTRACT_BOARD_SIZE - board.length;

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
        className="sa-sheet sa-contracts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-contracts-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <ScrollText size={13} aria-hidden="true" /> Town board
            </p>
            <h2 id="sa-contracts-title">What the town wants</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="sa-sheet-close" onClick={contain(closeAll)}>
            Done
          </button>
        </header>

        <p className="sa-sheet-note">
          Up to {CONTRACT_BOARD_SIZE} orders at a time. Deliver any of them for Gold and standing. Pin one to keep it on
          your HUD while you work toward it.
        </p>

        <p className="sa-contracts-standing">
          <Sparkles size={15} aria-hidden="true" />
          <strong>{influence.toLocaleString()}</strong>
          <span>Town Influence earned</span>
        </p>

        {(() => {
          const tier = influenceTier(influence);
          const next = nextInfluenceTier(influence);
          return (
            <p className="sa-contracts-standing sa-town-favor">
              <strong>{tier.label}</strong>
              <span>
                {tier.discountBps > 0
                  ? `${tier.discountBps / 100}% off tools, cutters and feed at Ray's`
                  : "no discount at Ray's shop yet"}
                {next && ` — ${(next.threshold - influence).toLocaleString()} Influence to ${next.label}`}
              </span>
            </p>
          );
        })()}

        {rungUp && (
          <p key={rungUp.nonce} className="sa-rung-up" role="status">
            <Sparkles size={16} aria-hidden="true" />
            <strong>{rungUp.tier.label}</strong>
            <span>
              Tools, cutters and feed at Ray&apos;s are now {rungUp.tier.discountBps / 100}% off.
            </span>
          </p>
        )}

        {note && (
          <p className={clsx("sa-contracts-note", `is-${note.tone}`)} role={note.tone === "refused" ? "alert" : "status"}>
            {note.text}
          </p>
        )}

        {board.length === 0 && (
          <p className="sa-contracts-note is-pending" role="status">
            The board is empty. Ask the town for orders below.
          </p>
        )}

        <ul className="sa-contracts-board">
          {board.map(({ contract, ready, rawValue }) => (
            <li
              key={contract.id}
              className={clsx("sa-contract", {
                "is-posted": contract.pinned,
                "is-ready": ready,
                "is-paid": payout?.contractId === contract.id,
              })}
              data-contract-id={contract.id}
            >
              {payout?.contractId === contract.id && (
                <ContractPayout key={payout.nonce} gold={payout.gold} influence={payout.influence} />
              )}
              <div className="sa-contract-head">
                <h3>{contract.title}</h3>
                <span className="sa-contract-tag">
                  {contract.pinned ? (
                    <>
                      <Pin size={11} aria-hidden="true" /> Pinned
                    </>
                  ) : ready ? (
                    "Ready to deliver"
                  ) : (
                    "Open"
                  )}
                </span>
              </div>

              {contract.requirements.map((line) => {
                const held = heldOf(line.item);
                const filled = contractProgress(held, line.quantity);
                return (
                  <div className="sa-contract-line" key={`${contract.id}-${line.item}`}>
                    <div className="sa-contract-req">
                      <StackAcresIcon name={contractItemIcon(line.item) as PainterName} size={22} />
                      <span className="sa-contract-bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${filled})` }} />
                      </span>
                      <span className="sa-contract-count">
                        <strong>{held.toLocaleString()}</strong>
                        {" / "}
                        {line.quantity.toLocaleString()}
                      </span>
                      <span className="sa-sr">
                        {contractItemLabel(line.item, line.quantity)} needed, {held.toLocaleString()} on the shelf
                      </span>
                    </div>
                    <p className="sa-contract-hint">
                      {contractItemLabel(line.item, line.quantity)} · {contractSourceHint(line.item)}
                    </p>
                  </div>
                );
              })}

              <ul className="sa-contract-rewards">
                <li className="is-gold">
                  <Coins size={13} aria-hidden="true" />
                  <strong>{contract.goldReward.toLocaleString()}</strong>
                  <span>Gold</span>
                </li>
                <li className="is-influence">
                  <Sparkles size={13} aria-hidden="true" />
                  <strong>{contract.influenceReward.toLocaleString()}</strong>
                  <span>Influence</span>
                </li>
              </ul>
              {/* Where the number comes from: the goods' Sell value and the
                  town's flat premium on top. The same 1.3x on every order, so
                  no order is secretly the one to hoard for. */}
              <p className="sa-contract-breakdown">
                Sells for {rawValue.toLocaleString()} Gold; the town pays {Math.round((CONTRACT_PREMIUM - 1) * 100)}% over
                that.
              </p>

              <div className="sa-contract-actions">
                <button
                  type="button"
                  className="sa-cta"
                  disabled={working || !ready}
                  onClick={contain(() => void handleSettle(contract))}
                >
                  {ready ? (
                    <>
                      <Check size={16} aria-hidden="true" /> Deliver it
                    </>
                  ) : (
                    "Not enough yet"
                  )}
                </button>
                <button
                  type="button"
                  className="sa-cta is-ghost"
                  disabled={working}
                  aria-pressed={contract.pinned}
                  onClick={contain(() =>
                    void moveNothing(contract.pinned ? "Unpinning…" : "Pinning…", () =>
                      onPin(contract.pinned ? null : contract.id),
                    ),
                  )}
                >
                  {contract.pinned ? (
                    <>
                      <PinOff size={14} aria-hidden="true" /> Unpin
                    </>
                  ) : (
                    <>
                      <Pin size={14} aria-hidden="true" /> Pin
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="sa-cta is-ghost"
                  disabled={working}
                  onClick={contain(() => void moveNothing("Swapping it out…", () => onReplace(contract.id)))}
                >
                  <RefreshCw size={14} aria-hidden="true" /> Swap out
                </button>
              </div>
            </li>
          ))}
        </ul>

        {openSlots > 0 && (
          <button
            type="button"
            className="sa-cta sa-contracts-ask"
            disabled={working}
            onClick={contain(() => void moveNothing("Asking the town…", onRequest))}
          >
            {board.length === 0 ? "Ask the town for orders" : `Ask for ${openSlots} more`}
          </button>
        )}

        <p className="sa-sheet-note">
          A delivery pays in Gold and earns Town Influence, which lowers Ray&apos;s prices on tools, cutters and
          feed. An order keeps until you fill it. You can swap one order out a day; nothing else on this board
          costs anything.
        </p>
      </section>
    </div>
  );
}
