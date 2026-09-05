"use client";

import { useCallback, useMemo, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Check, Lock, Sparkles, Zap } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  SYNERGY_ARCHETYPES,
  SYNERGY_MAX_ACTIVE_SLOTS,
  SYNERGY_PERKS,
  type SynergyArchetype,
} from "@/lib/stackacres/synergy-perks";
import type { ContractActionResult } from "./TownContractsModal";

/**
 * The Synergy Tree HUD: a badge showing how many permanent perks are
 * currently working for you, and a sheet (same treatment as
 * TownContractsModal's) to unlock and slot them.
 *
 * OWNERSHIP VS. ACTIVATION, restated for the UI: unlocking a perk
 * (`unlock-synergy-perk`) spends Gold once and is forever -- see
 * lib/server/stackacres-synergy-service.ts's own header. Slotting it
 * (`activate-synergy-perk`) moves no Gold and only changes which owned
 * perks are actually contributing this session, up to
 * `SYNERGY_MAX_ACTIVE_SLOTS` at a time. This component never offers to
 * UNSLOT one -- there is no route for it yet, and with only three
 * archetypes and three slots that gap does not bite until a fourth
 * archetype ships.
 *
 * `onUnlock`/`onActivate` are handed in rather than this component owning
 * its own fetch, the same shape TownContractsModal's `onSettle`/`onRequest`
 * take -- the shell (stackacres-farm.tsx) is the one place that already
 * knows how to post to /api/stackacres/actions, apply the response, and
 * dedupe in-flight requests.
 */

export interface SynergyOverlayProps {
  /** Every archetype this profile has ever unlocked. */
  unlocked: SynergyArchetype[];
  /** Which of those are currently slotted for this session. */
  active: SynergyArchetype[];
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `unlock-synergy-perk`. Spends Gold, once, permanent. */
  onUnlock: (archetype: SynergyArchetype) => Promise<ContractActionResult>;
  /** Posts `activate-synergy-perk`. Moves no Gold, only the loadout. */
  onActivate: (archetype: SynergyArchetype, slot: number) => Promise<ContractActionResult>;
}

/** Consumed here rather than travelling on, same pointer-containment
 *  discipline TownContractsModal documents at its own top. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

/**
 * What to work toward next, in one line -- the badge's own tooltip and the
 * sheet's banner both read this. Unlocking comes before slotting in this
 * order because it is the harder of the two: a locked perk needs a Gold
 * decision, while an owned-but-unslotted one is a single free tap, so naming
 * the Gold decision first is naming the thing actually worth planning for.
 */
function nextMilestone(unlocked: SynergyArchetype[], active: SynergyArchetype[]): string {
  const nextToUnlock = SYNERGY_ARCHETYPES.find((id) => !unlocked.includes(id));
  if (nextToUnlock) {
    const def = SYNERGY_PERKS[nextToUnlock];
    return `Unlock ${def.label} for ${def.unlockCostGold.toLocaleString()} Gold`;
  }
  const nextToSlot = unlocked.find((id) => !active.includes(id));
  if (nextToSlot && active.length < SYNERGY_MAX_ACTIVE_SLOTS) {
    return `Slot ${SYNERGY_PERKS[nextToSlot].label} to put it to work`;
  }
  return "Every perk you own is working for you";
}

export function SynergyOverlay({ unlocked, active, busy, onUnlock, onActivate }: SynergyOverlayProps) {
  const [open, setOpen] = useState(false);
  const [pendingArchetype, setPendingArchetype] = useState<SynergyArchetype | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(close);

  const milestone = useMemo(() => nextMilestone(unlocked, active), [unlocked, active]);

  // The next empty slot -- correct as long as this is the only place that
  // ever slots a perk (it is: there is no unslot action, so `active` only
  // ever grows contiguously from an empty loadout).
  const nextEmptySlot = active.length;

  const handleUnlock = useCallback(
    async (archetype: SynergyArchetype) => {
      if (busy || pendingArchetype) return;
      setPendingArchetype(archetype);
      setNote(null);
      const result = await onUnlock(archetype);
      if (!result.ok) {
        setNote(result.message);
      } else if (nextEmptySlot < SYNERGY_MAX_ACTIVE_SLOTS) {
        // One tap, not two, for the common case: a freshly-bought perk is
        // almost always what a player wants working immediately. Best-effort
        // -- a failure here leaves it owned-but-unslotted, which is still a
        // real, useful state (the "Slot it in" button below picks it up).
        await onActivate(archetype, nextEmptySlot);
      }
      setPendingArchetype(null);
    },
    [busy, pendingArchetype, onUnlock, onActivate, nextEmptySlot],
  );

  const handleActivate = useCallback(
    async (archetype: SynergyArchetype) => {
      if (busy || pendingArchetype) return;
      if (nextEmptySlot >= SYNERGY_MAX_ACTIVE_SLOTS) {
        setNote("Your loadout is full.");
        return;
      }
      setPendingArchetype(archetype);
      setNote(null);
      const result = await onActivate(archetype, nextEmptySlot);
      if (!result.ok) setNote(result.message);
      setPendingArchetype(null);
    },
    [busy, pendingArchetype, onActivate, nextEmptySlot],
  );

  return (
    <>
      <button
        type="button"
        className={clsx("sa-synergy-badge", { "has-active": active.length > 0 })}
        onClick={() => setOpen(true)}
        title="Synergy Tree"
      >
        <Zap size={16} aria-hidden="true" />
        <strong>
          {active.length}/{SYNERGY_MAX_ACTIVE_SLOTS}
        </strong>
        <span className="sa-sr">
          Synergy Tree, {active.length} of {SYNERGY_MAX_ACTIVE_SLOTS} perks active
        </span>
      </button>

      {open && (
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
            className="sa-sheet sa-synergy"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sa-synergy-title"
            onPointerDown={contain()}
            onPointerUp={contain()}
            onClick={contain()}
          >
            <header className="sa-sheet-head">
              <div>
                <p className="sa-clear-kicker">
                  <Sparkles size={13} aria-hidden="true" /> Synergy Tree
                </p>
                <h2 id="sa-synergy-title">Permanent perks</h2>
              </div>
              <button ref={closeButtonRef} type="button" className="sa-sheet-close" onClick={contain(close)}>
                Done
              </button>
            </header>

            <p className="sa-sheet-note">
              Unlock a perk once, with Gold, and it is yours for good. Slot up to{" "}
              {SYNERGY_MAX_ACTIVE_SLOTS} owned perks at a time to put them to work this session.
            </p>

            <p className="sa-synergy-milestone">
              <Sparkles size={13} aria-hidden="true" /> {milestone}
            </p>

            {/* Same note treatment TownContractsModal's own refusal uses --
                this sheet has nothing of its own to say when a request pays
                off, only when one is refused. */}
            {note && (
              <p className="sa-contracts-note is-refused" role="alert">
                {note}
              </p>
            )}

            <ul className="sa-contracts-board">
              {SYNERGY_ARCHETYPES.map((archetype) => {
                const def = SYNERGY_PERKS[archetype];
                const isUnlocked = unlocked.includes(archetype);
                const isActive = active.includes(archetype);
                const working = busy || pendingArchetype === archetype;

                return (
                  <li
                    key={archetype}
                    className={clsx("sa-contract", "sa-synergy-perk", {
                      "is-active": isActive,
                      "is-locked": !isUnlocked,
                    })}
                  >
                    <div className="sa-contract-head">
                      <h3>{def.label}</h3>
                      <span className="sa-contract-tag">
                        {isActive ? (
                          <>
                            <Check size={11} aria-hidden="true" /> Active
                          </>
                        ) : isUnlocked ? (
                          "Owned"
                        ) : (
                          <>
                            <Lock size={11} aria-hidden="true" /> Locked
                          </>
                        )}
                      </span>
                    </div>
                    <p className="sa-synergy-perk-desc">{def.description}</p>
                    {!isUnlocked && (
                      <button
                        type="button"
                        className="sa-cta sa-synergy-perk-btn"
                        disabled={working}
                        onClick={contain(() => void handleUnlock(archetype))}
                      >
                        Unlock for {def.unlockCostGold.toLocaleString()} Gold
                      </button>
                    )}
                    {isUnlocked && !isActive && (
                      <button
                        type="button"
                        className="sa-cta sa-synergy-perk-btn is-slot"
                        disabled={working}
                        onClick={contain(() => void handleActivate(archetype))}
                      >
                        Slot it in
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
