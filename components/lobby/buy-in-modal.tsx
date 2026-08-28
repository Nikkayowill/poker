"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { X } from "lucide-react";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { CHEAPEST_TIER, STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { TABLE_FORMATS, type TableFormat } from "./table-format";

/**
 * Picks a stakes tier (unless locked, e.g. rebuying at an already-seated
 * table) and a buy-in amount within that tier's range. Reused for
 * quick-play, hosting a private table, and rebuying after busting.
 * Resolves to (tier, buyIn); the caller decides what request that becomes.
 */
export function BuyInModal({
  title,
  description,
  goldBalance,
  unlimitedGold,
  lockedTier,
  confirmLabel,
  pending,
  playerName,
  onPlayerNameChange,
  allowFormats = false,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  goldBalance: number;
  unlimitedGold: boolean;
  lockedTier?: StakesTier;
  confirmLabel: string;
  pending: boolean;
  /**
   * The name to sit down under. Optional because the rebuy caller opens this
   * with a locked tier at a table the player is already named at; asking
   * them to re-confirm who they are mid-hand would be absurd.
   */
  playerName?: string;
  onPlayerNameChange?: (name: string) => void;
  /**
   * Offers heads-up and tournament alongside the ordinary cash game --
   * "choose blinds, then choose Texas Hold'em / Heads-Up / Tournament" in
   * one flow, Kayo's own framing. Only the quick-play/join modal instance
   * passes this: hosting a private table and rebuying at an already-seated
   * table have no format to choose (private heads-up/tournament tables
   * don't exist yet; a rebuy's format was decided when the table was
   * created). Picking heads-up or tournament here navigates straight to
   * that format's own lobby with the chosen tier carried along, rather than
   * calling `onConfirm` -- see TableFormat's own header for why.
   */
  allowFormats?: boolean;
  onClose: () => void;
  onConfirm: (tier: StakesTier, buyIn: number) => void;
}) {
  const router = useRouter();
  const [tier, setTier] = useState<StakesTier>(lockedTier ?? CHEAPEST_TIER);
  const [format, setFormat] = useState<TableFormat>("cash");
  const config = TIER_CONFIG[tier];
  const affordableMax = unlimitedGold ? config.maxBuyIn : Math.min(config.maxBuyIn, goldBalance);
  const [buyIn, setBuyIn] = useState(() => Math.max(config.minBuyIn, Math.min(affordableMax, config.maxBuyIn)));

  const selectTier = (next: StakesTier) => {
    if (lockedTier) return;
    const nextConfig = TIER_CONFIG[next];
    const nextAffordableMax = unlimitedGold ? nextConfig.maxBuyIn : Math.min(nextConfig.maxBuyIn, goldBalance);
    setTier(next);
    setBuyIn(Math.max(nextConfig.minBuyIn, Math.min(nextAffordableMax, nextConfig.maxBuyIn)));
  };

  const canAfford = (candidate: StakesTier) => unlimitedGold || goldBalance >= TIER_CONFIG[candidate].minBuyIn;
  // Heads-up/tournament buy in for the tier's own fixed stake, not the
  // slider's `buyIn` (not even rendered for either format -- see below), so
  // only the tier itself needs to be affordable.
  const affordableNow = format === "cash" ? canAfford(tier) && buyIn <= affordableMax : canAfford(tier);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="profile-modal buyin-modal" role="dialog" aria-modal="true" aria-labelledby="buyin-title">
        <header className="profile-modal-header">
          <div>
            <span>BUY-IN</span>
            <h2 id="buyin-title">{title}</h2>
          </div>
          <button className="modal-close" onClick={() => { tapSound(); onClose(); }} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="buyin-body">
          <p className="buyin-description">{description}</p>

          {/* Moved here from the hub head, where it was an empty text input
              sitting above the game tiles asking a question nobody had. It's
              the same control with the same accessible name: taking a seat
              is when the name is actually used, and this is the one dialog
              that leads to one. */}
          {onPlayerNameChange && (
            <label className="buyin-name" htmlFor="player-name">
              <span>Player name</span>
              <input
                id="player-name"
                value={playerName ?? ""}
                maxLength={18}
                onChange={(event) => onPlayerNameChange(event.target.value)}
                placeholder="Enter your name"
                autoComplete="nickname"
              />
            </label>
          )}

          {!lockedTier && (
            <div className="tier-grid">
              {STAKES_TIERS.map((candidate) => {
                const candidateConfig = TIER_CONFIG[candidate];
                const affordable = canAfford(candidate);
                return (
                  <button
                    type="button"
                    key={candidate}
                    className={clsx("tier-card", tier === candidate && "selected", !affordable && "unaffordable")}
                    disabled={!affordable}
                    onClick={() => { selectSound(); selectTier(candidate); }}
                  >
                    <strong>{candidateConfig.label}</strong>
                    <span>{candidateConfig.smallBlind} / {candidateConfig.bigBlind} blinds</span>
                    <small>
                      {affordable
                        ? `${candidateConfig.minBuyIn.toLocaleString()} Gold buy-in`
                        : `Need ${candidateConfig.minBuyIn.toLocaleString()} Gold`}
                    </small>
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected tier only -- the grid above already flags every
              unaffordable card on its own, so a second hint per card would
              just repeat "Need X Gold" in two places. This one instead
              answers the question the grid can't: where to go about it. */}
          {!unlimitedGold && !canAfford(tier) && <GoldShortfallHint needed={config.minBuyIn} />}

          {/* Heads-up and tournament both buy in for the tier's fixed stack
              (same reasoning createHeadsUpGame/createTournamentGame give for
              why neither offers a buy-in choice), so the amount slider below
              is cash-only -- asking for an amount that format is just going
              to ignore would be a control that lies about what it does. */}
          {format === "cash" && (
            <div className="buyin-amount">
              <div className="range-row">
                <span>Buy in for</span>
                <strong>{buyIn.toLocaleString()} chips</strong>
              </div>
              {config.minBuyIn < config.maxBuyIn && (
                <input
                  aria-label="Buy-in amount"
                  type="range"
                  min={config.minBuyIn}
                  max={Math.max(config.minBuyIn, affordableMax)}
                  step={config.bigBlind}
                  value={Math.min(buyIn, Math.max(config.minBuyIn, affordableMax))}
                  onChange={(event) => setBuyIn(Number(event.target.value))}
                  disabled={!canAfford(tier)}
                />
              )}
              <div className="buyin-gold-row">
                <span>Gold balance</span>
                <strong>{unlimitedGold ? "Unlimited" : goldBalance.toLocaleString()}</strong>
              </div>
              {!unlimitedGold && (
                <div className="buyin-gold-row">
                  <span>Remaining after buy-in</span>
                  <strong>{Math.max(0, goldBalance - buyIn).toLocaleString()}</strong>
                </div>
              )}
            </div>
          )}

          {allowFormats && (
            <div className="buyin-format">
              <span>Format</span>
              <div className="entry-segment" role="group" aria-label="Format">
                {TABLE_FORMATS.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className={format === candidate.id ? "is-active" : undefined}
                    aria-pressed={format === candidate.id}
                    onClick={() => { selectSound(); setFormat(candidate.id); }}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
              <small>{TABLE_FORMATS.find((candidate) => candidate.id === format)?.blurb}</small>
            </div>
          )}

          <footer className="buyin-footer">
            <button
              className="primary-action"
              type="button"
              disabled={pending || !affordableNow}
              // The press that asks for a seat, so it answers like every
              // other choice. Arriving is the game-on cue's job; firing that
              // here would celebrate a request that can still be refused.
              // Cash seats directly through onConfirm; heads-up/tournament
              // each already have their own matchmaking/registration lobby,
              // so picking either just hands the chosen tier off to it.
              onClick={() => {
                selectSound();
                if (format === "cash") {
                  onConfirm(tier, buyIn);
                } else {
                  onClose();
                  router.push(`/games/${format === "heads-up" ? "heads-up" : "sit-and-go"}?tier=${tier}`);
                }
              }}
            >
              {pending
                ? "Please wait…"
                : format === "cash" ? confirmLabel : `Go to ${TABLE_FORMATS.find((candidate) => candidate.id === format)?.label}`}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
