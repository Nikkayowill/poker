"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Coins, Lock, Star } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  AGING_TIERS,
  VAT_INPUT_ITEM,
  VAT_INPUT_QUANTITY,
  vatTierForElapsed,
  nextAgingTier,
  msUntilAgingTier,
  agedGoldValue,
  type AgingTier,
  type VatContainer,
} from "@/lib/stackacres/aging";
import { machineItemLabel } from "@/lib/stackacres/machine-items";

/**
 * The Fermenting Vat's own sheet: what is sealed inside right now, how far
 * along the aging ladder it has climbed, and the two buttons that seal a
 * fresh batch or cash one in.
 *
 * NOT TAILWIND, ON PURPOSE. This app has no Tailwind pipeline anywhere in
 * it -- every other surface, this one's sibling sheets included
 * (TownContractsModal, the prestige reset sheet), is styled through the
 * numbered plain-CSS system app/styles/CLAUDE.md documents, and Tailwind
 * utility classes here would compile to nothing without one. This sheet
 * reuses the same `sa-sheet`/`sa-cta` chrome every other StackAcres modal
 * already draws from (52-stackacres.css) and adds its own vat-specific rules
 * alongside them there, rather than introducing a second, unstyled system for
 * one component.
 *
 * A COUNTDOWN, PRESENTATION ONLY. `now` re-renders once a second purely so
 * the ticker and the tier bar animate -- the same posture
 * stackacres-farm.tsx's own 1s interval takes for machine/plot progress (see
 * its header: "No poll. Progress is a pure function of the timestamps the
 * server already sent"). The tier actually reached, and whether collecting is
 * legal at all, is recomputed here from `vat.manifest.sealedAt` exactly the
 * way the server itself computes it -- a fast-forwarded phone clock changes
 * what this sheet SHOWS, never what the server will actually pay when
 * `onCollect` is pressed.
 */

export type VatActionResult =
  | {
      readonly ok: true;
      readonly collected?: {
        readonly quantity: number;
        readonly tier: 1 | 2 | 3;
        readonly stars: 1 | 2 | 3;
        readonly multiplier: number;
        readonly gold: number;
      };
    }
  | { readonly ok: false; readonly message: string };

export interface FermentingVatModalProps {
  /** Null when the player has not placed a Fermenting Vat yet -- the sheet
   *  still opens (so "place one first" is a real answer, not a dead button)
   *  but shows no ladder and offers no seal/collect action. */
  vat: VatContainer | null;
  /** Cheese currently on the shelf, straight off the last server response. */
  cheeseHeld: number;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `seal-vat`. Resolves once this browser knows the outcome. */
  onSeal: () => Promise<VatActionResult>;
  /** Posts `collect-vat`. Resolves once this browser knows the outcome. */
  onCollect: () => Promise<VatActionResult>;
  onClose: () => void;
}

type Note = { readonly tone: "paid" | "refused"; readonly text: string };

/** Stops a press from reaching the map underneath -- same wrapper, same
 *  reasoning, as every other StackAcres sheet (see TownContractsModal's own
 *  header on the Phaser-input trap this guards against). */
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

/** One row of the ladder: reached, current, or still ahead. Pure derivation
 *  from `manifest`/`now` so the row list and the countdown above it can never
 *  disagree about which tier is which. */
function tierRowState(
  tier: AgingTier,
  reached: AgingTier | null,
): "reached" | "current-target" | "ahead" {
  if (reached && tier.tier <= reached.tier) return "reached";
  const next = nextAgingTier(reached);
  if (next && next.tier === tier.tier) return "current-target";
  return "ahead";
}

export function FermentingVatModal({
  vat,
  cheeseHeld,
  busy,
  onSeal,
  onCollect,
  onClose,
}: FermentingVatModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, !working);

  const manifest = vat?.manifest ?? null;

  // Ticks once a second only while there is something aging to animate --
  // same "don't run a clock with nothing to show for it" guard
  // stackacres-farm.tsx's own interval takes.
  useEffect(() => {
    if (!manifest) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [manifest]);

  const elapsedMs = manifest ? Math.max(0, now - Date.parse(manifest.sealedAt)) : 0;
  const reachedTier = manifest ? vatTierForElapsed(elapsedMs) : null;
  const target = nextAgingTier(reachedTier);
  const msToTarget = manifest && target ? msUntilAgingTier(elapsedMs, target) : null;
  const collectibleGold = manifest && reachedTier ? agedGoldValue(manifest.baseGoldValue, reachedTier) : 0;
  const canSeal = !manifest && cheeseHeld >= VAT_INPUT_QUANTITY;
  const canCollect = Boolean(manifest && reachedTier);

  const handleSeal = useCallback(async () => {
    if (busy || working || manifest || !canSeal) return;
    setNote(null);
    setWorking(true);
    try {
      const result = await onSeal();
      if (!result.ok) {
        setNote({ tone: "refused", text: result.message });
        return;
      }
      setNote({
        tone: "paid",
        text: `Sealed ${machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)}. Come back once it is Aged.`,
      });
    } catch {
      setNote({ tone: "refused", text: "That did not go through. Nothing was sealed." });
    } finally {
      setWorking(false);
    }
  }, [busy, working, manifest, canSeal, onSeal]);

  const handleCollect = useCallback(async () => {
    if (busy || working || !canCollect) return;
    setNote(null);
    setWorking(true);
    try {
      const result = await onCollect();
      if (!result.ok) {
        setNote({ tone: "refused", text: result.message });
        return;
      }
      const collected = result.collected;
      setNote({
        tone: "paid",
        text: collected
          ? `Collected ${collected.tier === 1 ? "Aged" : collected.tier === 2 ? "Well-Aged" : "Artisan-Aged"} cheese for ${collected.gold.toLocaleString()} Gold.`
          : "Collected.",
      });
    } catch {
      setNote({ tone: "refused", text: "That did not go through. Nothing was collected." });
    } finally {
      setWorking(false);
    }
  }, [busy, working, canCollect, onCollect]);

  const working_ = busy || working;

  const ladderRows = AGING_TIERS.map((tier) => ({
    tier,
    state: tierRowState(tier, reachedTier),
    gold: manifest ? agedGoldValue(manifest.baseGoldValue, tier) : null,
  }));

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
        className="sa-sheet sa-vat"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-vat-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">Processing</p>
            <h2 id="sa-vat-title">The Fermenting Vat</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="sa-sheet-close" onClick={contain(closeAll)}>
            Done
          </button>
        </header>

        {!vat ? (
          <p className="sa-sheet-note">
            <Lock size={13} aria-hidden="true" /> Place a Fermenting Vat to start aging Cheese into a
            far richer batch. The longer a seal rides, the more it is worth when you crack it open.
          </p>
        ) : (
          <>
            <p className="sa-sheet-note">
              Seal {machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)} inside, then wait. Collecting
              is legal from the moment it reaches Aged quality, and every tier past that doubles what
              the batch pays.
            </p>

            {note && (
              <p className={clsx("sa-contracts-note", `is-${note.tone}`)} role={note.tone === "refused" ? "alert" : "status"}>
                {note.text}
              </p>
            )}

            <div className={clsx("sa-vat-chamber", { "is-sealed": manifest !== null })}>
              {manifest ? (
                <>
                  <p className="sa-vat-status">
                    {reachedTier ? (
                      <>
                        <strong>{reachedTier.label}</strong> — ready to collect
                      </>
                    ) : (
                      <>Aging — not yet collectible</>
                    )}
                  </p>
                  <div className="sa-vat-stars" aria-hidden="true">
                    {[1, 2, 3].map((n) => (
                      <Star
                        key={n}
                        size={20}
                        className={clsx("sa-vat-star", { "is-lit": reachedTier && n <= reachedTier.stars })}
                        fill={reachedTier && n <= reachedTier.stars ? "currentColor" : "none"}
                      />
                    ))}
                  </div>
                  <p className="sa-sr">
                    Quality: {reachedTier ? `${reachedTier.stars} of 3 stars, ${reachedTier.label}` : "not yet Aged"}
                  </p>
                  {target && msToTarget !== null && (
                    <p className="sa-vat-countdown">
                      <span className="sa-vat-countdown-time">{formatCountdown(msToTarget)}</span>
                      <span className="sa-vat-countdown-label">until {target.label}</span>
                    </p>
                  )}
                  {reachedTier && (
                    <p className="sa-vat-value">
                      <Coins size={14} aria-hidden="true" />
                      Collect now for <strong>{collectibleGold.toLocaleString()}</strong> Gold
                    </p>
                  )}
                </>
              ) : (
                <p className="sa-vat-status sa-vat-empty">Empty — nothing sealed inside.</p>
              )}
            </div>

            <ul className="sa-vat-ladder">
              {ladderRows.map(({ tier, state, gold }) => (
                <li key={tier.tier} className={clsx("sa-vat-rung", `is-${state}`)}>
                  <span className="sa-vat-rung-stars" aria-hidden="true">
                    {Array.from({ length: tier.stars }).map((_, i) => (
                      <Star key={i} size={12} fill="currentColor" />
                    ))}
                  </span>
                  <span className="sa-vat-rung-label">{tier.label}</span>
                  <span className="sa-vat-rung-multiplier">{tier.multiplier}x</span>
                  {gold !== null && <span className="sa-vat-rung-gold">{gold.toLocaleString()} Gold</span>}
                </li>
              ))}
            </ul>

            <div className="sa-vat-actions">
              {!manifest && (
                <button
                  type="button"
                  className="sa-cta"
                  disabled={working_ || !canSeal}
                  onClick={contain(() => void handleSeal())}
                >
                  {canSeal
                    ? `Seal ${machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)}`
                    : `Needs ${machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)}`}
                </button>
              )}
              {manifest && (
                <button
                  type="button"
                  className="sa-cta"
                  disabled={working_ || !canCollect}
                  onClick={contain(() => void handleCollect())}
                >
                  {canCollect ? "Collect batch" : "Still aging"}
                </button>
              )}
            </div>

            <p className="sa-sheet-note">
              A collection pays out of the same daily Gold allowance a harvest does. On a day that has
              already sent out its allowance the batch keeps sealed until midnight UTC — nothing is
              lost and nothing is taken.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
