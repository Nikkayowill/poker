"use client";

import { useCallback, useMemo, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Check, Coins, Lock, ScrollText, Sparkles } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  CONTRACT_RUNGS,
  contractProgress,
  isPostedRung,
  type ContractDef,
  type StackAcresContractRow,
} from "@/lib/stackacres/contracts";
import {
  inventoryQuantity,
  removeFromInventory,
  type StackAcresInventory,
} from "@/lib/stackacres/inventory";
import {
  MACHINE_ITEM_CATALOGUE,
  machineItemLabel,
  type MachineItemId,
} from "@/lib/stackacres/machine-items";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The town board: what the town is asking the farm for, what is on the shelf
 * toward it, and the one button that trades one for the other.
 *
 * ------------------------------------------------------------------------
 * WHY THIS DRAWS THREE ROWS AND SETTLES ONLY ONE
 *
 * `homestead_contracts` has a partial unique index on `(profile_id) where
 * status = 'open'`, and lib/stackacres/contracts.ts's header says why in
 * full: a board of several simultaneously-open contracts would let a player
 * bank processed goods against whichever paid best, which is arbitrage, not
 * the loop this feature is. That index holds against two racing tabs and is
 * not a thing a component may talk its way around.
 *
 * So the three rows here are the three RUNGS the town draws from
 * (`CONTRACT_RUNGS`), not three open contracts. Exactly one of them is
 * POSTED at a time -- the one the server actually rolled -- and only that one
 * has a live Deliver button. The other two still carry their own progress
 * bar, because that is the genuinely useful thing this screen can say: it is
 * how a player knows whether to keep the Mill running past the rung in front
 * of them.
 *
 * ------------------------------------------------------------------------
 * WHY THE SETTLEMENT GOES THROUGH A ROUTE AND NOT THROUGH THE RPC
 *
 * `adjust_homestead_inventory(profile_id, item_id, delta)` IS the mutation
 * primitive -- row-locking, never a read-then-write, and the only place a
 * quantity moves. It is also `security definer`, takes the profile id as a
 * PARAMETER rather than reading the caller's session, and is deliberately
 * revoked from `public`, `anon` and `authenticated` (see
 * supabase/migrations/20260901180000_homestead_inventory.sql, which spells
 * out that a browser that could reach it could mint another player's
 * currency outright). A browser therefore cannot call it, and must not be
 * given a way to.
 *
 * `onSettle` posts `fulfill-contract` to /api/stackacres/actions instead, and
 * the server runs the money ordering on the far side of that -- see
 * `fulfillStackAcresTownContract`, which does exactly the four steps in
 * order: goods leave inventory FIRST (through that RPC, with a negative
 * delta), Gold is reserved against the flat daily ceiling SECOND, the
 * contract is settled under a once-only guard THIRD, and Gold and Influence
 * are credited only FOURTH -- with a refund of the goods on every one of
 * those failures. What lives in this file is the CLIENT half of that same
 * ordering: the optimistic debit below is applied before the request goes
 * out and rolled back line by line the moment the server refuses, so the
 * shelf on screen never shows goods the server has already taken, nor keeps
 * showing them gone after a refusal handed them back.
 *
 * ------------------------------------------------------------------------
 * POINTER CONTAINMENT
 *
 * Every handler here is wrapped in `contain`, which stops propagation before
 * doing anything else, so no press in this sheet reaches the map underneath.
 * Worth knowing what that does and does not buy: the StackAcres scene runs
 * with PHASER INPUT OFF ENTIRELY and reads raw pointer events off its host
 * element (see `unitAt` in stackacres-scene.ts), so containment here is the
 * whole story only because this sheet renders outside that host. The trap in
 * a scene that uses Phaser's own input is different and `stopPropagation`
 * does not fix it -- Phaser listens on `window`, so the guard has to be in
 * the game object's handler, rejecting a release whose DOM target is not the
 * canvas. Do not delete these wrappers on the grounds that the map "does not
 * seem to react": that is this file working.
 */

/** One line of what a contract asks for, with the shelf measured against it.
 *  `held` is what the player can actually deliver RIGHT NOW -- it already has
 *  any in-flight optimistic debit taken out of it, so the bar and the button
 *  can never disagree. */
export interface ContractRequirement {
  readonly item: MachineItemId;
  readonly required: number;
  readonly held: number;
}

/** One line of what fulfilling it pays. Gold is currency and passes through
 *  the farm's flat daily ceiling; Influence is progression, spends nowhere,
 *  and is uncapped (lib/stackacres/contracts.ts's header). Kept as separate
 *  entries rather than two number fields so a reward the ladder does not have
 *  yet is a new `kind`, not a new column on every contract. */
export interface ContractReward {
  readonly kind: "gold" | "influence";
  readonly amount: number;
}

/**
 * `posted` is the one contract the town has actually opened -- at most one,
 * ever. `offered` is a rung on the board that is not currently being asked
 * for: shown, measured, never settleable.
 */
export type ContractStatus = "posted" | "offered";

export interface Contract {
  /** The row id for the posted contract, and a stable rung key otherwise.
   *  Never sent anywhere: the route derives the contract from the session, so
   *  a client cannot name which one it is settling. */
  readonly id: string;
  readonly title: string;
  readonly status: ContractStatus;
  readonly requirements: readonly ContractRequirement[];
  readonly rewards: readonly ContractReward[];
  /** Every requirement met. Only ever true on a `posted` contract. */
  readonly ready: boolean;
}

/** What a settle or a request came back as. A refusal carries the server's
 *  own wording, which is the wording a player should see -- this component
 *  never invents an explanation for something the server declined. */
export type ContractActionResult =
  | { readonly ok: true; readonly reward?: { readonly gold: number; readonly influence: number } }
  | { readonly ok: false; readonly message: string };

export interface TownContractsModalProps {
  /** The shelf, straight off the last server response. Authoritative: the
   *  optimistic overlay below is layered on top of it and never replaces it. */
  inventory: StackAcresInventory;
  /** The town's one open request, or null when there is not one. */
  contract: StackAcresContractRow | null;
  /** Town Influence earned to date. */
  influence: number;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `fulfill-contract`. Resolves once this browser knows the outcome. */
  onSettle: () => Promise<ContractActionResult>;
  /** Posts `request-contract`. Moves nothing; asks the town to post one. */
  onRequest: () => Promise<ContractActionResult>;
  onClose: () => void;
}

/** A message the sheet is showing about its own last action. The page's error
 *  banner sits behind the scrim, so a refusal raised in here has to be
 *  answered in here -- the same rule the supply store follows. */
type Note = { readonly tone: "paid" | "refused"; readonly text: string };

/**
 * Wraps a handler so the press is consumed here rather than travelling on.
 * Applied to every pointer entry point on the scrim and the sheet, including
 * the ones with nothing else to do -- a bare `stopPropagation` handler is the
 * point, not an oversight.
 */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

function rungKey(def: ContractDef): string {
  return `${def.item}-${def.quantity}`;
}

/** "2 Flour for the town" -- built from the requirement rather than stored, so
 *  a retune of the ladder cannot leave a title describing the old rung. */
function rungTitle(def: ContractDef): string {
  return `${machineItemLabel(def.item, def.quantity)} for the town`;
}

function rewardsOf(def: ContractDef): readonly ContractReward[] {
  const rewards: ContractReward[] = [];
  if (def.goldReward > 0) rewards.push({ kind: "gold", amount: def.goldReward });
  if (def.influenceReward > 0) rewards.push({ kind: "influence", amount: def.influenceReward });
  return rewards;
}

export function TownContractsModal({
  inventory,
  contract,
  influence,
  busy,
  onSettle,
  onRequest,
  onClose,
}: TownContractsModalProps) {
  /**
   * The optimistic debit, as the individual requirement lines it was applied
   * from rather than as a merged inventory.
   *
   * Kept this way on purpose: rolling back is then removing the exact lines
   * that were applied, in reverse, and a rollback can never overshoot into
   * stock that arrived from somewhere else while the request was out (a Mill
   * finishing on another tab, say). A merged snapshot restored wholesale
   * would silently throw that away.
   */
  const [pending, setPending] = useState<readonly ContractRequirement[]>([]);
  const [settling, setSettling] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, !settling);

  /** The shelf as the player should see it: what the server last said, less
   *  anything currently out on an unanswered request. */
  const heldOf = useCallback(
    (item: MachineItemId): number => {
      const owed = pending.reduce(
        (total, line) => (line.item === item ? total + line.required : total),
        0,
      );
      return Math.max(0, inventoryQuantity(inventory, item) - owed);
    },
    [inventory, pending],
  );

  const board = useMemo<readonly Contract[]>(
    () =>
      CONTRACT_RUNGS.map((def) => {
        const posted = isPostedRung(contract, def);
        const requirements: readonly ContractRequirement[] = [
          { item: def.item, required: def.quantity, held: heldOf(def.item) },
        ];
        return {
          id: posted && contract ? contract.id : rungKey(def),
          title: rungTitle(def),
          status: posted ? "posted" : "offered",
          requirements,
          rewards: rewardsOf(def),
          ready: posted && requirements.every((line) => line.held >= line.required),
        } satisfies Contract;
      }),
    [contract, heldOf],
  );

  /**
   * Puts back exactly the lines that were taken, newest first.
   *
   * Reverse order mirrors the server's own refund path and matters for the
   * same reason it does there: if a later line is what failed, the earlier
   * ones are the ones still standing, and unwinding from the far end is what
   * makes "applied" and "rolled back" the same list read backwards. Splices
   * one occurrence per line rather than filtering by item, so two contracts
   * asking for the same item cannot cancel each other's overlay.
   */
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
   * Debit first, ask second, put it back on any refusal.
   *
   * The three exits below are the whole safety property, and all three end in
   * the same rollback:
   *   1. The shelf is short. Refused here, nothing sent -- the cheapest
   *      refusal is the one that never leaves.
   *   2. The server refused. Its wording is shown; the goods come back.
   *   3. The request threw or never came back. Same treatment: this browser
   *      does not know what happened, so it must not keep showing goods as
   *      spent. The server is authoritative either way, and the next response
   *      overwrites `inventory` wholesale.
   * A success also clears the overlay, because by then `inventory` has been
   * replaced by the response the settlement returned and the overlay would be
   * double-counting a debit the server has already made.
   */
  const handleSettleContract = useCallback(
    async (target: Contract): Promise<void> => {
      if (busy || settling || target.status !== "posted") return;

      setNote(null);
      setSettling(true);
      const applied: ContractRequirement[] = [];
      try {
        // Step 1, the client half: the goods leave the shelf before the
        // request goes out, one requirement line at a time, exactly as the
        // server takes them.
        let working: StackAcresInventory = inventory;
        for (const requirement of target.requirements) {
          const next = removeFromInventory(working, requirement.item, requirement.required);
          if (next === null) {
            rollback(applied);
            setNote({
              tone: "refused",
              text: `This contract needs ${machineItemLabel(requirement.item, requirement.required)}.`,
            });
            return;
          }
          working = next;
          applied.push(requirement);
          setPending((current) => [...current, requirement]);
        }

        const result = await onSettle();
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
      } catch {
        rollback(applied);
        setNote({ tone: "refused", text: "That did not go through. Nothing was taken." });
      } finally {
        setSettling(false);
      }
    },
    [busy, settling, inventory, onSettle, rollback],
  );

  /** Asks the town to post one. Moves no goods and no Gold, so there is
   *  nothing to debit optimistically and nothing to roll back. */
  const handleRequestContract = useCallback(async (): Promise<void> => {
    if (busy || settling) return;
    setNote(null);
    setSettling(true);
    try {
      const result = await onRequest();
      if (!result.ok) setNote({ tone: "refused", text: result.message });
    } catch {
      setNote({ tone: "refused", text: "The town did not answer. Try again in a moment." });
    } finally {
      setSettling(false);
    }
  }, [busy, settling, onRequest]);

  const working = busy || settling;

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
          <button
            ref={closeButtonRef}
            type="button"
            className="sa-sheet-close"
            onClick={contain(closeAll)}
          >
            Done
          </button>
        </header>

        <p className="sa-sheet-note">
          The town posts one order at a time. Fill it and it pays in Gold and in standing —
          the other two are what it is likely to ask for next, so you know whether to keep the
          mill turning.
        </p>

        <p className="sa-contracts-standing">
          <Sparkles size={15} aria-hidden="true" />
          <strong>{influence.toLocaleString()}</strong>
          <span>Town Influence earned</span>
        </p>

        {note && (
          <p
            className={clsx("sa-contracts-note", `is-${note.tone}`)}
            role={note.tone === "refused" ? "alert" : "status"}
          >
            {note.text}
          </p>
        )}

        <ul className="sa-contracts-board">
          {board.map((entry) => (
            <li
              key={entry.id}
              className={clsx("sa-contract", {
                "is-posted": entry.status === "posted",
                "is-ready": entry.ready,
              })}
            >
              <div className="sa-contract-head">
                <h3>{entry.title}</h3>
                <span className="sa-contract-tag">
                  {entry.status === "posted" ? (
                    "Asked for now"
                  ) : (
                    <>
                      <Lock size={11} aria-hidden="true" /> Not asked for yet
                    </>
                  )}
                </span>
              </div>

              {entry.requirements.map((requirement) => {
                const filled = contractProgress(requirement.held, requirement.required);
                return (
                  <div className="sa-contract-req" key={`${entry.id}-${requirement.item}`}>
                    <StackAcresIcon
                      name={MACHINE_ITEM_CATALOGUE[requirement.item].icon as PainterName}
                      size={22}
                    />
                    <span className="sa-contract-bar" aria-hidden="true">
                      <span style={{ transform: `scaleX(${filled})` }} />
                    </span>
                    <span className="sa-contract-count">
                      <strong>{requirement.held.toLocaleString()}</strong>
                      {" / "}
                      {requirement.required.toLocaleString()}
                    </span>
                    <span className="sa-sr">
                      {machineItemLabel(requirement.item, requirement.required)} needed,{" "}
                      {requirement.held.toLocaleString()} on the shelf
                    </span>
                  </div>
                );
              })}

              <ul className="sa-contract-rewards">
                {entry.rewards.map((reward) => (
                  <li key={reward.kind} className={`is-${reward.kind}`}>
                    {reward.kind === "gold" ? (
                      <Coins size={13} aria-hidden="true" />
                    ) : (
                      <Sparkles size={13} aria-hidden="true" />
                    )}
                    <strong>{reward.amount.toLocaleString()}</strong>
                    <span>{reward.kind === "gold" ? "Gold" : "Influence"}</span>
                  </li>
                ))}
              </ul>

              {entry.status === "posted" && (
                <button
                  type="button"
                  className="sa-cta"
                  disabled={working || !entry.ready}
                  onClick={contain(() => void handleSettleContract(entry))}
                >
                  {entry.ready ? (
                    <>
                      <Check size={16} aria-hidden="true" /> Deliver it
                    </>
                  ) : (
                    "Not enough yet"
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>

        {contract === null && (
          <button
            type="button"
            className="sa-cta sa-contracts-ask"
            disabled={working}
            onClick={contain(() => void handleRequestContract())}
          >
            Ask the town for an order
          </button>
        )}

        <p className="sa-sheet-note">
          A delivery pays out of the same daily Gold allowance a harvest does. On a day that has
          already sent out its allowance the order keeps until midnight UTC — nothing is lost and
          nothing is taken.
        </p>
      </section>
    </div>
  );
}
