"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Check, Cloud, Coins, ShieldCheck, UsersRound, X } from "lucide-react";
import { CHEAPEST_TIER, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { Card } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { accountsEnabled } from "@/lib/auth/client";
import { AccountEntryCard } from "@/components/auth/account-entry-card";
import { BuyInModal } from "./buy-in-modal";
import { PlayingCard } from "@/components/table/playing-card";

export function Lobby({
  profile,
  onQuickPlay,
  onHostPrivate,
  onJoinCode,
  loading,
  sessionReady,
  error,
  cashOutNotice,
  onDismissCashOut,
  onClaimBackstop,
  authNotice,
  onDismissAuthNotice,
  onSaveProgress,
  onDismissSaveProgress,
  savePromptDismissed,
  entryComplete,
  authReady,
  signInPending,
  rememberSession,
  onRememberSessionChange,
  onContinueAccount,
  onContinueAsGuest,
  onSignOut,
}: {
  profile: PlayerProfile | null;
  onQuickPlay: (name: string, tier: StakesTier, buyIn: number) => void;
  onHostPrivate: (name: string, tier: StakesTier, buyIn: number) => void;
  onJoinCode: (name: string, code: string) => void;
  loading: boolean;
  sessionReady: boolean;
  error: string | null;
  cashOutNotice: number | null;
  onDismissCashOut: () => void;
  onClaimBackstop: () => void;
  authNotice: string | null;
  onDismissAuthNotice: () => void;
  onSaveProgress: () => void;
  onDismissSaveProgress: () => void;
  savePromptDismissed: boolean;
  entryComplete: boolean;
  authReady: boolean;
  signInPending: boolean;
  rememberSession: boolean;
  onRememberSessionChange: (remember: boolean) => void;
  onContinueAccount: () => void;
  onContinueAsGuest: () => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(profile?.displayName ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [buyInMode, setBuyInMode] = useState<"join" | "host" | null>(null);
  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.trim().length === 6) onJoinCode(name.trim() || "You", joinCode.trim());
  };
  // Below the cheapest buy-in there is no seat in the house they can take,
  // so offer the recovery grant rather than letting them hit a dead end.
  const needsTopUp = Boolean(
    profile && !profile.unlimitedGold && (profile.goldBalance ?? 0) < TIER_CONFIG[CHEAPEST_TIER].minBuyIn,
  );
  // Only nudge a guest once they have actually played -- a profile still
  // sitting on its untouched starting balance has nothing worth saving yet,
  // and prompting then is asking for a signup with no reason behind it.
  const showSavePrompt = Boolean(
    !savePromptDismissed && accountsEnabled() && profile && !profile.isRegistered
    && profile.lastDailyClaimAt === null
    && (profile.goldBalance !== 2000 || profile.updatedAt !== profile.createdAt),
  );
  if (!entryComplete) {
    return (
      <main className="account-entry-page">
        <AccountEntryCard
          ready={authReady && sessionReady}
          accountsAvailable={accountsEnabled()}
          pending={signInPending}
          profile={profile}
          remember={rememberSession}
          error={error}
          onRememberChange={onRememberSessionChange}
          onSignIn={onSaveProgress}
          onContinueAccount={onContinueAccount}
          onContinueAsGuest={onContinueAsGuest}
          onSignOut={onSignOut}
        />
      </main>
    );
  }

  return (
    <main className="lobby">
      <section className="hero">
        {cashOutNotice !== null && (
          <div className="cash-out-notice" role="status">
            <Coins size={15} />
            <span>
              Cashed out <strong>{cashOutNotice.toLocaleString()}</strong> Gold from the table.
            </span>
            <button type="button" onClick={onDismissCashOut} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        {authNotice && (
          <div className="cash-out-notice" role="status">
            <Check size={15} />
            <span>{authNotice}</span>
            <button type="button" onClick={onDismissAuthNotice} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        {showSavePrompt && (
          <div className="save-progress-notice" role="status" aria-label="Save guest progress">
            <div className="save-progress-icon" aria-hidden="true"><Cloud size={18} /></div>
            <div className="save-progress-copy">
              <strong>Your run is worth keeping</strong>
              <span>
                This guest profile lives only in this browser. Save your Gold, avatar,
                and collection to an account before they get left behind.
              </span>
              <small><ShieldCheck size={12} /> Google sign-in · No password to remember</small>
            </div>
            <div className="save-progress-actions">
              <button type="button" className="save-progress-primary" onClick={onSaveProgress}>
                Save progress
              </button>
              <button type="button" className="save-progress-later" onClick={onDismissSaveProgress}>
                Maybe later
              </button>
            </div>
          </div>
        )}
        {needsTopUp && (
          <div className="broke-notice" role="status">
            <span>
              You&rsquo;re below the {TIER_CONFIG[CHEAPEST_TIER].minBuyIn.toLocaleString()} Gold minimum for the
              cheapest seat.
            </span>
            <button type="button" className="secondary-action" disabled={loading} onClick={onClaimBackstop}>
              Claim a top-up
            </button>
          </div>
        )}
        <div className="lobby-kicker">River Room · 6-max</div>
        <h1>No-limit Hold’em.<br /><em>Nothing extra.</em></h1>
        <p>
          Pick your stakes, choose a buy-in, and take a seat. Start a quick
          table or open a private room for friends.
        </p>
        <div className="start-form">
          <div className="form-label-row">
            <label htmlFor="player-name">Enter Your Player Name</label>
          </div>
          <div className="name-row">
            <input
              id="player-name"
              value={name}
              maxLength={18}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your name"
              autoComplete="nickname"
            />
          </div>
          <div className="lobby-actions">
            <button
              type="button"
              className="primary-action"
              disabled={loading || !sessionReady}
              onClick={() => setBuyInMode("join")}
            >
              {!sessionReady
                ? "Preparing your seat…"
                : loading
                  ? "Joining table…"
                  : <>Join table <ArrowRight size={17} /></>}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={loading || !sessionReady}
              onClick={() => setBuyInMode("host")}
            >
              <UsersRound size={15} /> Private table
            </button>
          </div>
          {error && <p className="form-error"><X size={14} /> {error}</p>}
        </div>
        <form className="join-form" onSubmit={submitJoin}>
          <label htmlFor="join-code">Join a private table</label>
          <div className="join-row">
            <input
              id="join-code"
              value={joinCode}
              maxLength={6}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ROOM CODE"
              autoComplete="off"
            />
            <button type="submit" disabled={loading || !sessionReady || joinCode.trim().length !== 6}>Join</button>
          </div>
        </form>
        <div className="table-facts" aria-label="Table details">
          <span><strong>6</strong> seats</span>
          <span><strong>8</strong> stakes tiers</span>
          <span><strong>1,000 – 500,000</strong> buy-in</span>
        </div>
      </section>
      <aside className="lobby-preview">
        <>
            <div className="preview-heading">
              <span>No limit · 6-max</span>
            </div>
            <div className="mini-table">
              <span className="mini-seat mini-top">RV</span>
              <span className="mini-seat mini-upper-left">MA</span>
              <span className="mini-seat mini-upper-right">PR</span>
              <span className="mini-seat mini-lower-left">TH</span>
              <span className="mini-seat mini-lower-right">WR</span>
              <span className="mini-seat mini-bottom">YOU</span>
              <div className="mini-pot"><Coins size={14} /> 240</div>
              <div className="mini-cards">
                {[
                  { rank: "A", suit: "spades" },
                  { rank: "10", suit: "hearts" },
                  { rank: "K", suit: "diamonds" },
                ].map((card) => <PlayingCard key={card.rank} card={card as Card} small />)}
              </div>
            </div>
          </>
      </aside>
      {buyInMode && (
        <BuyInModal
          title={buyInMode === "host" ? "Host a private table" : "Join a table"}
          description={
            buyInMode === "host"
              ? "Pick your stakes and buy-in, then share the room code with friends."
              : "Pick a stakes tier and how much of your Gold to buy in for."
          }
          goldBalance={profile?.goldBalance ?? 0}
          unlimitedGold={profile?.unlimitedGold ?? false}
          confirmLabel={buyInMode === "host" ? "Host table" : "Join table"}
          pending={loading}
          onClose={() => setBuyInMode(null)}
          onConfirm={(tier, buyIn) => {
            if (buyInMode === "host") onHostPrivate(name.trim() || "You", tier, buyIn);
            else onQuickPlay(name.trim() || "You", tier, buyIn);
          }}
        />
      )}
    </main>
  );
}
