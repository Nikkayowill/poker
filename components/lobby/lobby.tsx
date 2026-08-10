"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Check, Cloud, Coins, ShieldCheck, Users, X } from "lucide-react";
import { CHEAPEST_TIER, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";
import { accountsEnabled } from "@/lib/auth/client";
import { AccountEntryCard } from "@/components/auth/account-entry-card";
import { FriendsDrawer } from "@/components/social/friends-drawer";
import { RankStrip } from "@/components/profile/rank-strip";
import { InstallPrompt } from "@/components/install-prompt";
import { FirstRunStrip } from "./first-run-strip";
import { ArcadePanel } from "./arcade-panel";
import { BuyInModal } from "./buy-in-modal";

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
  onEmailSignIn,
  onEmailSignUp,
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
  onEmailSignIn: (email: string, password: string) => void;
  onEmailSignUp: (email: string, password: string) => void;
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
  // Local rather than lifted to poker-app.tsx: nothing outside the lobby opens
  // this, and the drawer owns its own fetch, so there is no shared state for
  // the parent to hold.
  const [friendsOpen, setFriendsOpen] = useState(false);
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
          onEmailSignIn={onEmailSignIn}
          onEmailSignUp={onEmailSignUp}
          onContinueAccount={onContinueAccount}
          onContinueAsGuest={onContinueAsGuest}
          onSignOut={onSignOut}
        />
      </main>
    );
  }

  // The hub below is keyed on the profile where it is rendered, so mounting
  // it before one exists means React tears the whole thing down and rebuilds
  // it the moment the profile lands -- wiping the name being typed and
  // resetting buyInMode, which silently closes the buy-in modal mid-flow.
  // A first-time visitor is the only case where this is null, and only for
  // as long as one POST takes, so waiting is both cheap and the honest thing
  // to show: there is no balance to render yet.
  if (!profile) {
    return (
      <main className="lobby lobby-hub">
        <section className="hub">
          <div className="hub-head">
            <div className="lobby-kicker">The floor</div>
            <h1>Preparing your seat…</h1>
            {error && <p className="form-error"><X size={14} /> {error}</p>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="lobby lobby-hub">
      <section className="hub">
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
        <InstallPrompt />
        {/* The same pairing the landing page's sections use: a micro-label at
            10px/.25em tracking over a large light serif line. The hub used to
            state itself in a 34-52px serif under a "StackChips · 6-max"
            kicker, which was close but not the same type, so signing in
            stepped down a size and changed the label's voice. */}
        {/* Two lines and nothing else. The player-name field used to sit right
            here, which made an empty text input the first thing on a screen
            whose whole job is "pick your game" -- and it was the third control
            in the app that set the same name. It lives in the buy-in modal
            now, beside the decision it belongs to; the profile modal's
            "Display name" is still where it is changed for good. */}
        <div className="hub-head">
          <div className="lobby-kicker">The floor</div>
          <h1>
            Pick your game, <span className="hub-head-name">{profile.displayName}</span>
          </h1>
          {error && <p className="form-error"><X size={14} /> {error}</p>}
        </div>

        {/* Above the grid, never in it: .hub-grid's spans are arithmetic and a
            fifth small tile reopens the empty cell the arcade panel was added
            to close. Both render nothing until they have something to say --
            the first-run strip once it retires, the rank strip until its fetch
            lands -- so neither can push the tiles down and then pull them back
            either. */}
        <FirstRunStrip onTakeSeat={() => setBuyInMode("join")} />
        <RankStrip />

        {/* Tiles carry the real artwork -- the same table plate the game
            renders and the chip/avatar art from public/ -- rather than a flat
            card with an icon dropped in it. */}
        <div className="hub-grid">
          {/* Named for the game, not for the verb.
              "Join table" was unambiguous when a table was the only thing in
              this app; next to Blackjack, Hi-Lo, Wordle and Connections it is
              the one tile that never says what it deals. The title is
              therefore constant and the status moved into the sub-line, so
              the hero cannot stop naming the game while it is busy. */}
          <button
            type="button"
            className="hub-tile hub-tile-wide hub-tile-play"
            disabled={loading || !sessionReady}
            onClick={() => setBuyInMode("join")}
          >
            <span className="hub-tile-body">
              <span className="hub-tile-kicker">Poker · No-limit Hold&rsquo;em</span>
              <strong>Texas Hold&rsquo;em</strong>
              <small>
                {!sessionReady
                  ? "Preparing your seat…"
                  : loading
                    ? "Joining table…"
                    : "Six-max cash tables · Take the next open seat"}
              </small>
            </span>
            {/* No arrow. The hero's felt plate already occupies the right of
                the tile, and a gold chevron floated over it was one more thing
                in a corner that is doing work -- the whole tile is the target,
                which is what the artwork says. */}
          </button>

          <button
            type="button"
            className="hub-tile hub-tile-private"
            disabled={loading || !sessionReady}
            onClick={() => setBuyInMode("host")}
          >
            <span className="hub-tile-body">
              <strong>Private table</strong>
              <small>Open a room, share the code</small>
            </span>
          </button>

          <Link className="hub-tile hub-tile-gold" href="/store">
            <span className="hub-tile-body">
              <strong>Buy Gold</strong>
              <small>{(profile?.goldBalance ?? 0).toLocaleString()} in your stack</small>
            </span>
          </Link>

          {/* Sits here, not at the end, because the desktop grid places tiles
              by DOM order: the panel claims a 2x2 block, and any tile ahead
              of it in the source takes a cell that block needs, which pushes
              it down a row and reopens the hole it exists to close. */}
          <ArcadePanel profile={profile} />

          <Link className="hub-tile hub-tile-collection" href="/collection">
            <span className="hub-tile-body">
              <strong>Collection</strong>
              <small>Avatars and card backs</small>
            </span>
          </Link>

          <Link className="hub-tile hub-tile-leaderboard" href="/leaderboard">
            <span className="hub-tile-body">
              <strong>Leaderboard</strong>
              <small>This season&rsquo;s standings</small>
            </span>
          </Link>

          {/* Shown to guests too. The drawer answers the 403 with the reason
              an account is needed, which is a better prompt to sign up than a
              tile that is simply missing. */}
          <button
            type="button"
            className="hub-tile hub-tile-friends"
            onClick={() => setFriendsOpen(true)}
          >
            <span className="hub-tile-body">
              <strong>Friends</strong>
              <small>People you play with</small>
            </span>
            <Users className="hub-tile-go" size={18} aria-hidden="true" />
          </button>

          <form className="hub-tile hub-tile-code" onSubmit={submitJoin}>
            <label htmlFor="join-code">Join with a room code</label>
            <div className="hub-code-row">
              <input
                id="join-code"
                value={joinCode}
                maxLength={6}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="ROOM CODE"
                autoComplete="off"
              />
              <button type="submit" disabled={loading || !sessionReady || joinCode.trim().length !== 6}>
                Join
              </button>
            </div>
          </form>
        </div>
      </section>
      {friendsOpen && <FriendsDrawer onClose={() => setFriendsOpen(false)} />}
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
          playerName={name}
          onPlayerNameChange={setName}
          onConfirm={(tier, buyIn) => {
            if (buyInMode === "host") onHostPrivate(name.trim() || "You", tier, buyIn);
            else onQuickPlay(name.trim() || "You", tier, buyIn);
          }}
        />
      )}
    </main>
  );
}
