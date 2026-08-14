"use client";

import { FormEvent, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Check, Cloud, Coins, ShieldCheck, Users, X } from "lucide-react";
import { CHEAPEST_TIER, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { TableRenderer } from "@/lib/scene/table-renderer";
import type { PlayerProfile } from "@/lib/profile/types";
import { backstopState } from "@/lib/profile/backstop";
import { accountsEnabled } from "@/lib/auth/client";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { AccountEntryCard } from "@/components/auth/account-entry-card";
import { FriendsDrawer } from "@/components/social/friends-drawer";
import { RankStrip } from "@/components/profile/rank-strip";
import { InstallPrompt } from "@/components/install-prompt";
import { FirstRunStrip } from "./first-run-strip";
import { ArcadePanel } from "./arcade-panel";
import { BuyInModal } from "./buy-in-modal";

/**
 * `--tile-index` for the entrance stagger (see `@keyframes hub-tile-in` in
 * 04-lobby.css) -- one shared helper so the numbers stay in DOM order
 * without being repeated as magic literals at every tile. Not a `.map()`
 * over a list: the tiles are individually authored JSX for their own
 * reasons (see the comments at each one), so the index is assigned by hand
 * in source order instead.
 */
function tileIndexStyle(index: number): CSSProperties {
  return { "--tile-index": index } as CSSProperties;
}

/*
 * The tap and select cues now live in lib/audio/ui-sounds.ts, which is where
 * the rest of the chrome reaches for them -- this file had the only copy for
 * a while and every other panel either inlined `playSound("ui")` or stayed
 * silent. The reasoning that used to sit here still holds and has moved with
 * them: Lobby is only ever mounted under poker-app.tsx, which keeps
 * sound-effects.ts's enabled flag in sync with the player's mute, so these
 * may call playSound directly rather than reaching for the arcade route's
 * useArcadeSound. Tap-only, never on hover -- a chime on every pointer pass
 * would be noisy and does nothing for touch, which is most of this traffic.
 */

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
  tableRenderer,
  webglAvailable,
  landscape,
  onTableRendererChange,
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
  onEmailSignIn: (email: string, password: string, captchaToken?: string) => void;
  onEmailSignUp: (email: string, password: string, captchaToken?: string) => void;
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
  /** The table-view choice, surfaced in the buy-in modal -- see BuyInModal's
   * own header for why it belongs there and not only in the in-game menu. */
  tableRenderer: TableRenderer;
  webglAvailable: boolean;
  landscape: boolean;
  onTableRendererChange: (renderer: TableRenderer) => void;
}) {
  /*
   * The buy-in modal's name field: the player's own edit if they have made one,
   * and otherwise whatever the profile currently says.
   *
   * Derived rather than seeded, because seeding is what forced the remount.
   * `useState(profile?.displayName)` only reads the prop once, so the only way
   * to pick up a renamed or newly-arrived profile was for poker-app.tsx to key
   * this whole component on `profile.updatedAt` -- rebuilding the entire hub
   * on every gold change to keep one text input honest. Holding the *override*
   * instead means the default tracks the profile for free, and a name being
   * typed survives a profile update rather than being wiped by it.
   */
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const name = nameOverride ?? profile?.displayName ?? "";
  const [joinCode, setJoinCode] = useState("");
  const [buyInMode, setBuyInMode] = useState<"join" | "host" | null>(null);
  // Local rather than lifted to poker-app.tsx: nothing outside the lobby opens
  // this, and the drawer owns its own fetch, so there is no shared state for
  // the parent to hold.
  const [friendsOpen, setFriendsOpen] = useState(false);
  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.trim().length !== 6) return;
    // `select`, not `tap`: this commits a code and asks the server for a seat.
    // The game-on cue answers if it works; nothing answers if it does not.
    selectSound();
    onJoinCode(name.trim() || "You", joinCode.trim());
  };
  // Below the cheapest buy-in there is no seat in the house they can take,
  // so offer the recovery grant rather than letting them hit a dead end --
  // but only while it is actually claimable. This used to key off goldBalance
  // alone, so a player who topped up and then busted back below the
  // threshold within claimBackstopGold's cooldown saw the banner reappear
  // and a "you've already had a top-up recently" error on the very button it
  // showed them. backstopState knows the cooldown too.
  const needsTopUp = backstopState(profile, new Date(), TIER_CONFIG[CHEAPEST_TIER].minBuyIn) === "ready";
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

  // Everything below reads a balance, a name or an avatar off the profile, so
  // there is genuinely nothing to render until one exists.
  //
  // This used to be load-bearing for a second reason -- the hub was keyed on
  // `profile.updatedAt` where it is rendered, so mounting it a moment early
  // meant React tore the whole thing down and rebuilt it when the profile
  // landed, closing the buy-in modal mid-flow. That key is gone (see the note
  // at the <Lobby> call site), so this is now only what it says it is.
  //
  // It is also reached far less often than it used to be: poker-app.tsx carries
  // this tab's last profile across a remount, so returning from the arcade
  // paints the hub directly. A first-time visitor waiting on one POST is the
  // case that still lands here, which is the honest thing to show them.
  if (!profile) {
    return (
      <main className="lobby lobby-hub">
        <section className="hub">
          <div className="hub-head">
            <div className="lobby-kicker">Your seat</div>
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
            <button type="button" onClick={() => { tapSound(); onDismissCashOut(); }} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        {authNotice && (
          <div className="cash-out-notice" role="status">
            <Check size={15} />
            <span>{authNotice}</span>
            <button type="button" onClick={() => { tapSound(); onDismissAuthNotice(); }} aria-label="Dismiss">
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
              <button type="button" className="save-progress-primary" onClick={() => { selectSound(); onSaveProgress(); }}>
                Save progress
              </button>
              <button type="button" className="save-progress-later" onClick={() => { tapSound(); onDismissSaveProgress(); }}>
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
            <button type="button" className="secondary-action" disabled={loading} onClick={() => { selectSound(); onClaimBackstop(); }}>
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
          <div className="lobby-kicker">{profile.displayName}</div>
          <h1>Pick your game</h1>
          {error && <p className="form-error"><X size={14} /> {error}</p>}
        </div>

        {/* Above the grid, never in it: .hub-grid's spans are arithmetic and a
            fifth small tile reopens the empty cell the arcade panel was added
            to close. Both render nothing until they have something to say --
            the first-run strip once it retires, the rank strip until its fetch
            lands -- so neither can push the tiles down and then pull them back
            either. */}
        <FirstRunStrip profile={profile} onTakeSeat={() => setBuyInMode("join")} />
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
            style={tileIndexStyle(0)}
            disabled={loading || !sessionReady}
            onClick={() => { tapSound(); setBuyInMode("join"); }}
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
            style={tileIndexStyle(1)}
            disabled={loading || !sessionReady}
            onClick={() => { tapSound(); setBuyInMode("host"); }}
          >
            <span className="hub-tile-body">
              <strong>Private table</strong>
              <small>Open a room, share the code</small>
            </span>
          </button>

          <Link className="hub-tile hub-tile-gold" href="/store" style={tileIndexStyle(2)} onClick={tapSound}>
            <span className="hub-tile-body">
              <strong>Support StackChips</strong>
              <small>Optional — never required to play</small>
            </span>
          </Link>

          {/* Sits here, not at the end, because the desktop grid places tiles
              by DOM order: the panel claims a 2x2 block, and any tile ahead
              of it in the source takes a cell that block needs, which pushes
              it down a row and reopens the hole it exists to close. */}
          <ArcadePanel profile={profile} style={tileIndexStyle(3)} />

          <Link className="hub-tile hub-tile-collection" href="/collection" style={tileIndexStyle(4)} onClick={tapSound}>
            <span className="hub-tile-body">
              <strong>Collection</strong>
              <small>Avatars and card backs</small>
            </span>
          </Link>

          <Link className="hub-tile hub-tile-leaderboard" href="/leaderboard" style={tileIndexStyle(5)} onClick={tapSound}>
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
            style={tileIndexStyle(6)}
            onClick={() => { tapSound(); setFriendsOpen(true); }}
          >
            <span className="hub-tile-body">
              <strong>Friends</strong>
              <small>People you play with</small>
            </span>
            <Users className="hub-tile-go" size={18} aria-hidden="true" />
          </button>

          <form className="hub-tile hub-tile-code" style={tileIndexStyle(7)} onSubmit={submitJoin}>
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
          onPlayerNameChange={setNameOverride}
          tableRenderer={tableRenderer}
          webglAvailable={webglAvailable}
          landscape={landscape}
          onTableRendererChange={onTableRendererChange}
          onConfirm={(tier, buyIn) => {
            if (buyInMode === "host") onHostPrivate(name.trim() || "You", tier, buyIn);
            else onQuickPlay(name.trim() || "You", tier, buyIn);
          }}
        />
      )}
    </main>
  );
}
