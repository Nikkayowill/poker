"use client";

import { useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { CHEAPEST_TIER, STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { RACETRACK_RENDERER, TABLE_RENDERER_3D_ENABLED, type TableRenderer } from "@/lib/scene/table-renderer";

/**
 * Picks a stakes tier (unless locked, e.g. rebuying at an already-seated
 * table) and a buy-in amount within that tier's range -- reused for
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
  tableRenderer,
  webglAvailable,
  landscape = true,
  onTableRendererChange,
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
   * with a locked tier at a table the player is already named at -- asking
   * them to re-confirm who they are mid-hand would be absurd.
   */
  playerName?: string;
  onPlayerNameChange?: (name: string) => void;
  /**
   * The table-view choice, surfaced here rather than left to the in-game
   * menu. All three are optional and only rendered together, for the same
   * reason `playerName` is optional above: the rebuy caller opens this at an
   * already-mounted table, where the renderer is no longer a decision --
   * changing it mid-hand is exactly the mount/discard flicker
   * `tableRendererSettled` in poker-table.tsx exists to prevent. Deciding it
   * HERE, before that room is ever created, is what removes the flicker for
   * the normal join path instead of just hiding it behind a loading hold.
   */
  tableRenderer?: TableRenderer;
  webglAvailable?: boolean;
  /** Viewport wider than tall. The 2.5D table is landscape-only. */
  landscape?: boolean;
  onTableRendererChange?: (renderer: TableRenderer) => void;
  onClose: () => void;
  onConfirm: (tier: StakesTier, buyIn: number) => void;
}) {
  const [tier, setTier] = useState<StakesTier>(lockedTier ?? CHEAPEST_TIER);
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
  const affordableNow = canAfford(tier) && buyIn <= affordableMax;

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
              sitting above the game tiles asking a question nobody had. It is
              the same control with the same accessible name -- taking a seat
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

          {/* Choosing the room here, before it exists, is what actually fixes
              the mount-then-swap flicker -- picking it after the table has
              already rendered (the old in-game menu toggle, still there for
              mid-session changes) is what glitched. Same `.entry-segment`
              control the sign-in page uses for its two-way choice. */}
          {tableRenderer && onTableRendererChange && (
            <div className="buyin-renderer">
              <span>Table view</span>
              <div className="entry-segment" role="group" aria-label="Table view">
                {/* 3D room temporarily disabled (TABLE_RENDERER_3D_ENABLED) while
                    it's being reworked -- hidden rather than disabled, since this
                    isn't a per-browser capability gap like WebGL/portrait below. */}
                {TABLE_RENDERER_3D_ENABLED && (
                  <button
                    type="button"
                    className={tableRenderer === "webgl_3d" ? "is-active" : undefined}
                    aria-pressed={tableRenderer === "webgl_3d"}
                    disabled={!webglAvailable}
                    onClick={() => { selectSound(); onTableRendererChange("webgl_3d"); }}
                  >
                    3D room
                  </button>
                )}
                {/* The 2.5D room is the only table presentation. It remains
                    landscape-oriented, so portrait users are prompted below
                    to rotate rather than being offered a removed fallback. */}
                <button
                  type="button"
                  className={tableRenderer === RACETRACK_RENDERER ? "is-active" : undefined}
                  aria-pressed={tableRenderer === RACETRACK_RENDERER}
                  disabled={!landscape}
                  onClick={() => { selectSound(); onTableRendererChange(RACETRACK_RENDERER); }}
                >
                  2.5D
                </button>
              </div>
              {TABLE_RENDERER_3D_ENABLED && !webglAvailable && <small>3D room needs a browser with WebGL.</small>}
              {!landscape && <small>2.5D table needs a landscape screen &mdash; turn your phone sideways.</small>}
            </div>
          )}

          <footer className="buyin-footer">
            <button
              className="primary-action"
              type="button"
              disabled={pending || !affordableNow}
              // The press that asks for a seat, so it answers like every
              // other choice. Arriving is the game-on cue's job -- firing that
              // here would celebrate a request that can still be refused.
              onClick={() => { selectSound(); onConfirm(tier, buyIn); }}
            >
              {pending ? "Please wait…" : confirmLabel}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
