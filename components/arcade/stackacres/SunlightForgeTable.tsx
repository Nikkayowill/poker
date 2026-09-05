"use client";

import { useCallback, useMemo, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Check, Coins, Lock, Sparkles, Wand2 } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { STACKACRES_TOOL_TIER_DEFS, type StackAcresToolTier } from "@/lib/stackacres/equipment";
import {
  FORGE_ENCHANTMENTS,
  canAffordForge,
  computeForgedToolStats,
  forgeMaterialStatus,
  type ForgeEnchantmentDef,
} from "@/lib/stackacres/forge";
import { removeFromInventory, type StackAcresInventory } from "@/lib/stackacres/inventory";
import { machineItemLabel } from "@/lib/stackacres/machine-items";

/**
 * The Sunlight Forge Table: what the held tool is worth right now, which
 * permanent enchantments are bought/buyable, and whether the shelf actually
 * has what each one costs.
 *
 * Mirrors TownContractsModal.tsx's own shape on purpose -- same sheet/scrim
 * chrome, same "authoritative props, optimistic overlay, roll back on any
 * refusal" split, same pointer-containment wrapper for the same reason
 * that file states in full: the StackAcres scene reads raw pointer events
 * off its own host element with Phaser input off entirely, so a press in
 * this sheet has to be stopped here or it also lands on the map underneath.
 *
 * ------------------------------------------------------------------------
 * WHY THE OPTIMISTIC OVERLAY COVERS BOTH GOLD AND ONE MATERIAL, NOT JUST
 * INVENTORY
 *
 * TownContractsModal only ever debits inventory optimistically -- a
 * contract never costs Gold to fulfill, it PAYS Gold. Forging spends both
 * at once (supabase/migrations/20260905130000_stackacres_tool_enchantments.sql's
 * `forge_stackacres_enchantment`), so the overlay here tracks one in-flight
 * spend as a single record (`pendingForge`) rather than a list the way the
 * contracts sheet tracks requirement lines -- this component only ever has
 * one purchase in flight at a time (every Forge button is disabled while
 * `forging` is true), so there is nothing to merge or partially unwind.
 *
 * ------------------------------------------------------------------------
 * WHY FORGING GOES THROUGH A ROUTE AND NOT THROUGH THE RPC
 *
 * Same reason TownContractsModal's settlement does: `forge_stackacres_enchantment`
 * is `security definer`, takes the profile id as a parameter, and is
 * revoked from `anon`/`authenticated` -- a browser cannot call it and must
 * not be given a way to. `onForge` is expected to post a `forge-enchantment`
 * action to /api/stackacres/actions the same way `onSettle` posts
 * `fulfill-contract`, with the server running the real check-then-mutate
 * sequence the migration's comment lays out.
 */

export type ForgeActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface SunlightForgeTableProps {
  /** Which equipment rung is currently held (./equipment.ts's
   *  STACKACRES_TOOL_TIERS). Forged stats are always computed against this
   *  tier's own base numbers -- there is no per-tool-instance row, see
   *  lib/stackacres/forge.ts's header for why that is deliberate. */
  toolTier: StackAcresToolTier;
  /** The shelf, straight off the last server response. Authoritative: the
   *  optimistic overlay below is layered on top of it and never replaces
   *  it, same contract TownContractsModal's own `inventory` prop states. */
  inventory: StackAcresInventory;
  /** Straight off the last server response. */
  goldBalance: number;
  /** Enchantment ids (FORGE_ENCHANTMENTS keys, not the `enchant_..._v1`
   *  wrapper) this profile has already forged permanently. */
  ownedEnchantmentIds: readonly string[];
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `forge-enchantment` for one catalogue id. Resolves once this
   *  browser knows the outcome; a success is expected to be followed by the
   *  parent refetching `inventory`/`goldBalance`/`ownedEnchantmentIds`, the
   *  same refresh-after-settle every other StackAcres surface does. */
  onForge: (enchantmentId: string) => Promise<ForgeActionResult>;
  onClose: () => void;
}

/** A message the sheet is showing about its own last action. Same posture
 *  TownContractsModal's `Note` takes: the page's error banner sits behind
 *  the scrim, so a refusal raised in here has to be answered in here. */
type Note = { readonly tone: "paid" | "refused"; readonly text: string };

/** One in-flight forge purchase, held only long enough to compute the
 *  optimistic Gold/material overlay and to know which slot is disabled. */
interface PendingForge {
  readonly id: string;
  readonly goldCost: number;
  readonly materialItem: ForgeEnchantmentDef["materialItem"];
  readonly materialQuantity: number;
}

interface ForgeSlotView {
  readonly def: ForgeEnchantmentDef;
  readonly owned: boolean;
  readonly materialHeld: number;
  readonly materialRequired: number;
  readonly affordable: boolean;
}

/** Wraps a handler so the press is consumed here rather than travelling on
 *  to the scene underneath. See this file's header for why that is not
 *  optional decoration. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

export function SunlightForgeTable({
  toolTier,
  inventory,
  goldBalance,
  ownedEnchantmentIds,
  busy,
  onForge,
  onClose,
}: SunlightForgeTableProps) {
  const [pendingForge, setPendingForge] = useState<PendingForge | null>(null);
  const [forging, setForging] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, !forging);

  const ownedSet = useMemo(() => new Set(ownedEnchantmentIds), [ownedEnchantmentIds]);

  /** The shelf and the purse as the player should see them: what the server
   *  last said, less whatever is currently out on an unanswered forge
   *  request. Mirrors TownContractsModal's own `heldOf`. */
  const effectiveInventory = useMemo<StackAcresInventory>(() => {
    if (!pendingForge) return inventory;
    return (
      removeFromInventory(inventory, pendingForge.materialItem, pendingForge.materialQuantity) ??
      inventory
    );
  }, [inventory, pendingForge]);

  const effectiveGold = pendingForge ? Math.max(0, goldBalance - pendingForge.goldCost) : goldBalance;

  const baseStats = STACKACRES_TOOL_TIER_DEFS[toolTier];

  const forged = useMemo(
    () => computeForgedToolStats(baseStats, ownedEnchantmentIds),
    [baseStats, ownedEnchantmentIds],
  );

  const slots = useMemo<readonly ForgeSlotView[]>(
    () =>
      Object.values(FORGE_ENCHANTMENTS).map((def) => {
        const owned = ownedSet.has(def.id);
        const status = forgeMaterialStatus(def, effectiveInventory);
        return {
          def,
          owned,
          materialHeld: status.held,
          materialRequired: status.required,
          affordable: !owned && canAffordForge(def, effectiveGold, effectiveInventory),
        } satisfies ForgeSlotView;
      }),
    [ownedSet, effectiveInventory, effectiveGold],
  );

  const working = busy || forging;

  /**
   * Debit first, ask second, put it back on any refusal -- the same three
   * exits TownContractsModal's `handleSettleContract` documents in full,
   * restated here for the Gold+material pair this purchase spends instead
   * of the inventory-only lines a contract takes:
   *   1. The shelf or purse is short. Refused here, nothing sent.
   *   2. The server refused. Its wording is shown; nothing was ever taken
   *      from the props this component renders (the overlay is cleared,
   *      and `inventory`/`goldBalance` were never touched -- only the local
   *      overlay was).
   *   3. The request threw or never came back. Same treatment: this
   *      browser does not know what happened, so it must not keep showing
   *      the purchase as spent. The next prop update is authoritative.
   */
  const handleForge = useCallback(
    async (slot: ForgeSlotView): Promise<void> => {
      if (working || slot.owned) return;
      if (!canAffordForge(slot.def, effectiveGold, effectiveInventory)) {
        setNote({
          tone: "refused",
          text: `Needs ${slot.def.goldCost.toLocaleString()} Gold and ${slot.def.materialQuantity.toLocaleString()} ${machineItemLabel(slot.def.materialItem, slot.def.materialQuantity)}.`,
        });
        return;
      }

      setNote(null);
      setForging(true);
      setPendingForge({
        id: slot.def.id,
        goldCost: slot.def.goldCost,
        materialItem: slot.def.materialItem,
        materialQuantity: slot.def.materialQuantity,
      });
      try {
        const result = await onForge(slot.def.id);
        if (!result.ok) {
          setNote({ tone: "refused", text: result.message });
          return;
        }
        setNote({ tone: "paid", text: `${slot.def.label} forged.` });
      } catch {
        setNote({ tone: "refused", text: "That did not go through. Nothing was taken." });
      } finally {
        setPendingForge(null);
        setForging(false);
      }
    },
    [working, effectiveGold, effectiveInventory, onForge],
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
        className="sa-sheet sa-forge"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-forge-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Wand2 size={13} aria-hidden="true" /> The Sunlight Forge
            </p>
            <h2 id="sa-forge-title">Enchant the {STACKACRES_TOOL_TIER_DEFS[toolTier].label}</h2>
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
          Every enchantment here is permanent and applies to whichever tool you are holding.
          Forging spends Gold and a material together, once -- there is nothing to unequip and
          nothing to sell back.
        </p>

        <dl className="sa-forge-stats" aria-label="Tool status">
          <div className="sa-forge-stat">
            <dt>Crit chance</dt>
            <dd>{Math.round(forged.critChance * 100)}%</dd>
          </div>
          <div className="sa-forge-stat">
            <dt>Crit bonus</dt>
            <dd>+{Math.round(forged.critBonus * 100)}%</dd>
          </div>
          <div className="sa-forge-stat">
            <dt>Scythe reach</dt>
            <dd>{forged.reach.toFixed(1)}</dd>
          </div>
        </dl>

        {note && (
          <p
            className={clsx("sa-forge-note", `is-${note.tone}`)}
            role={note.tone === "refused" ? "alert" : "status"}
          >
            {note.text}
          </p>
        )}

        <ul className="sa-forge-slots">
          {slots.map((slot) => {
            const filled =
              slot.materialRequired > 0
                ? Math.min(1, slot.materialHeld / slot.materialRequired)
                : 1;
            return (
              <li
                key={slot.def.id}
                className={clsx("sa-forge-slot", { "is-owned": slot.owned })}
              >
                <div className="sa-forge-slot-head">
                  <h3>{slot.def.label}</h3>
                  {slot.owned ? (
                    <span className="sa-forge-slot-tag is-owned">
                      <Check size={11} aria-hidden="true" /> Forged
                    </span>
                  ) : (
                    <span className="sa-forge-slot-tag">
                      <Lock size={11} aria-hidden="true" /> Not forged
                    </span>
                  )}
                </div>

                <p className="sa-forge-slot-desc">{slot.def.description}</p>

                {!slot.owned && (
                  <div className="sa-contract-req">
                    <span className="sa-contract-bar" aria-hidden="true">
                      <span style={{ transform: `scaleX(${filled})` }} />
                    </span>
                    <span className="sa-contract-count">
                      <strong>{slot.materialHeld.toLocaleString()}</strong>
                      {" / "}
                      {slot.materialRequired.toLocaleString()}
                    </span>
                    <span className="sa-sr">
                      {machineItemLabel(slot.def.materialItem, slot.materialRequired)} needed,{" "}
                      {slot.materialHeld.toLocaleString()} on the shelf
                    </span>
                  </div>
                )}

                {!slot.owned && (
                  <button
                    type="button"
                    className="sa-cta"
                    disabled={working || !slot.affordable}
                    onClick={contain(() => void handleForge(slot))}
                  >
                    <Coins size={15} aria-hidden="true" /> Forge for {slot.def.goldCost.toLocaleString()}{" "}
                    Gold
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <p className="sa-sheet-note">
          <Sparkles size={13} aria-hidden="true" /> A crit still pays out of the same daily Gold
          allowance a harvest does, forged or not -- an enchanted tool reaches the same wall
          sooner, never further.
        </p>
      </section>
    </div>
  );
}
