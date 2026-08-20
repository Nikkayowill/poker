"use client";

/**
 * The phone lobby: three panes on one horizontal track, a tab bar underneath.
 *
 * WHY IT IS NOT THREE ROUTES. Ante Up (`/games`) and the leaderboard
 * (`/leaderboard`) are real routes, and every one of them unmounts PokerApp on
 * the way in -- which is what makes the desktop hub flash the sign-in screen on
 * a back-navigation and refetch the profile each time. A tab bar built on those
 * routes would inherit all of it and could not be swiped between at all. So the
 * panes render inline, inside the component that already holds the session, and
 * the routes stay exactly where they are for deep links and desktop.
 *
 * Consequences worth knowing before editing:
 *   - `ArcadeFloor` and `Leaderboard` are the SAME components the routes mount,
 *     given `embedded` so they drop their own `<main>` and back-link. They are
 *     not reimplemented here, and must not be.
 *   - `ArcadeFloor` takes `profile` from us rather than fetching its own, or
 *     the shell would hold two diverging copies of the wallet and a buy-in
 *     would update only one of them.
 *   - Everything here is under PokerApp, so `tapSound`/`selectSound` may be
 *     called directly -- see the note at the top of lobby.tsx.
 *
 * The gesture maths lives in lib/ui/swipe-pager.ts, pure and tested. This file
 * only owns the pointer plumbing and what the panes contain.
 */

import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardList,
  Cloud,
  Coins,
  Gamepad2,
  Gift,
  Layers,
  Lock,
  LogOut,
  type LucideIcon,
  Medal,
  Music2,
  Spade,
  Sparkles,
  ShieldCheck,
  User,
  Users,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { CHEAPEST_TIER, STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { betStyleLabel, type BetAnimationStyle } from "@/lib/scene/bet-style";
import type { PlayerProfile } from "@/lib/profile/types";
import type { DailyGoldState } from "@/lib/profile/daily-gold";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  beginSwipe,
  clampPage,
  settleSwipe,
  trackSwipe,
  type SwipeGesture,
} from "@/lib/ui/swipe-pager";
import { ArcadeFloor } from "@/components/arcade/arcade-floor";
import { Leaderboard } from "@/components/leaderboard/leaderboard";
import { SiteFooter } from "@/components/nav/site-footer";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { RankStrip } from "@/components/profile/rank-strip";
import { InstallPrompt } from "@/components/install-prompt";

const PAGES = ["Play", "Ante Up", "You"] as const;
const PAGE_COUNT = PAGES.length;
const PAGE_ICONS: readonly LucideIcon[] = [Spade, Gamepad2, User];

/**
 * Anything that scrolls sideways inside a pane -- the stakes ladder today.
 * A drag that starts in one belongs to it, not to the pager, or picking a
 * stake would throw the player onto the next tab.
 */
const HORIZONTAL_SCROLLER = ".mshell-tiers";

export function MobileShell({
  profile,
  loading,
  sessionReady,
  error,
  cashOutNotice,
  onDismissCashOut,
  authNotice,
  onDismissAuthNotice,
  showSavePrompt,
  onSaveProgress,
  onDismissSaveProgress,
  needsTopUp,
  onClaimBackstop,
  onQuickPlay,
  onHostPrivate,
  onJoinCode,
  onOpenFriends,
  onSignOut,
  soundEnabled,
  onToggleSound,
  musicEnabled,
  onToggleMenuMusic,
  betStyle,
  onCycleBetStyle,
  dailyGold,
  claimingGold,
  onClaimDailyGold,
  freeGoldEligible,
  onGetFreeGold,
  onEditProfile,
}: {
  profile: PlayerProfile;
  loading: boolean;
  sessionReady: boolean;
  error: string | null;
  cashOutNotice: number | null;
  onDismissCashOut: () => void;
  authNotice: string | null;
  onDismissAuthNotice: () => void;
  showSavePrompt: boolean;
  onSaveProgress: () => void;
  onDismissSaveProgress: () => void;
  needsTopUp: boolean;
  onClaimBackstop: () => void;
  onQuickPlay: (tier: StakesTier) => void;
  onHostPrivate: () => void;
  onJoinCode: (code: string) => void;
  onOpenFriends: () => void;
  onSignOut: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  musicEnabled: boolean;
  onToggleMenuMusic: () => void;
  betStyle: BetAnimationStyle;
  onCycleBetStyle: () => void;
  dailyGold: DailyGoldState | null;
  claimingGold: boolean;
  onClaimDailyGold: () => void;
  freeGoldEligible: boolean;
  onGetFreeGold: () => void;
  onEditProfile: () => void;
}) {
  const [page, setPage] = useState(0);
  /** Live drag distance in px. Null whenever no horizontal drag is in flight. */
  const [drag, setDrag] = useState<number | null>(null);
  const gestureRef = useRef<SwipeGesture | null>(null);

  const goTo = useCallback((next: number) => {
    setPage((current) => {
      const target = clampPage(next, PAGE_COUNT);
      // `select`, not `tap`: a tab is a choice, and it changes what is on screen.
      if (target !== current) selectSound();
      return target;
    });
    setDrag(null);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.buttons !== 1) return;
    if (event.target instanceof Element && event.target.closest(HORIZONTAL_SCROLLER)) return;
    gestureRef.current = beginSwipe(
      event.clientX,
      event.clientY,
      event.currentTarget.clientWidth,
    );
    // Without capture the drag dies the moment the finger crosses out of the
    // element, which on a full-width pane happens constantly at the edges.
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const move = trackSwipe(gesture, event.clientX, event.clientY, page, PAGE_COUNT);
    gestureRef.current = move.gesture;
    setDrag(move.offset);
  }, [page]);

  const endGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    const settled = settleSwipe(gesture, drag ?? 0, page, PAGE_COUNT);
    setDrag(null);
    if (settled !== page) {
      selectSound();
      setPage(settled);
    }
  }, [drag, page]);

  const offset = drag ?? 0;

  return (
    <div className="mshell">
      <div
        className="mshell-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <div
          className={`mshell-track${drag === null ? " mshell-track-settling" : ""}`}
          style={{ transform: `translateX(calc(${-page * 100}% + ${Math.round(offset)}px))` }}
        >
          {/* Panes off-screen are still in the document, so they are still in
              the tab order and still read out. `inert` is what actually takes
              them out of both; hiding them would break the slide. */}
          <section className="mshell-pane" aria-label="Play" inert={page !== 0}>
            <PlayPane
              profile={profile}
              loading={loading}
              sessionReady={sessionReady}
              error={error}
              cashOutNotice={cashOutNotice}
              onDismissCashOut={onDismissCashOut}
              authNotice={authNotice}
              onDismissAuthNotice={onDismissAuthNotice}
              showSavePrompt={showSavePrompt}
              onSaveProgress={onSaveProgress}
              onDismissSaveProgress={onDismissSaveProgress}
              needsTopUp={needsTopUp}
              onClaimBackstop={onClaimBackstop}
              onQuickPlay={onQuickPlay}
              onHostPrivate={onHostPrivate}
              onJoinCode={onJoinCode}
              onOpenFriends={onOpenFriends}
            />
          </section>

          <section className="mshell-pane" aria-label="Ante Up" inert={page !== 1}>
            {/* The route's own component, not a copy of it. */}
            <ArcadeFloor profile={profile} embedded />
          </section>

          <section className="mshell-pane" aria-label="You" inert={page !== 2}>
            <YouPane
              profile={profile}
              onSignOut={onSignOut}
              soundEnabled={soundEnabled}
              onToggleSound={onToggleSound}
              musicEnabled={musicEnabled}
              onToggleMenuMusic={onToggleMenuMusic}
              betStyle={betStyle}
              onCycleBetStyle={onCycleBetStyle}
              onEditProfile={onEditProfile}
              dailyGold={dailyGold}
              claimingGold={claimingGold}
              onClaimDailyGold={onClaimDailyGold}
              freeGoldEligible={freeGoldEligible}
              onGetFreeGold={onGetFreeGold}
            />
          </section>
        </div>
      </div>

      {/* The dots widen the active one rather than colouring a dead one, so the
          indicator reads as a position on a strip and not as three buttons.
          They are decoration: the tab bar below is the control. */}
      <div className="mshell-dots" aria-hidden="true">
        {PAGES.map((name, index) => (
          <span key={name} className={`mshell-dot${index === page ? " mshell-dot-on" : ""}`} />
        ))}
      </div>

      <nav className="mshell-nav" aria-label="Lobby sections">
        {PAGES.map((name, index) => {
          const Icon = PAGE_ICONS[index];
          const active = index === page;
          return (
            <button
              key={name}
              type="button"
              className={`mshell-nav-item${active ? " mshell-nav-on" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => goTo(index)}
            >
              <Icon size={23} strokeWidth={1.8} aria-hidden="true" />
              <span>{name}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ---------------------------------------------------------------- pane 1 */

function PlayPane({
  profile,
  loading,
  sessionReady,
  error,
  cashOutNotice,
  onDismissCashOut,
  authNotice,
  onDismissAuthNotice,
  showSavePrompt,
  onSaveProgress,
  onDismissSaveProgress,
  needsTopUp,
  onClaimBackstop,
  onQuickPlay,
  onHostPrivate,
  onJoinCode,
  onOpenFriends,
}: {
  profile: PlayerProfile;
  loading: boolean;
  sessionReady: boolean;
  error: string | null;
  cashOutNotice: number | null;
  onDismissCashOut: () => void;
  authNotice: string | null;
  onDismissAuthNotice: () => void;
  showSavePrompt: boolean;
  onSaveProgress: () => void;
  onDismissSaveProgress: () => void;
  needsTopUp: boolean;
  onClaimBackstop: () => void;
  onQuickPlay: (tier: StakesTier) => void;
  onHostPrivate: () => void;
  onJoinCode: (code: string) => void;
  onOpenFriends: () => void;
}) {
  const [tier, setTier] = useState<StakesTier>(CHEAPEST_TIER);
  const [joinCode, setJoinCode] = useState("");
  const config = TIER_CONFIG[tier];
  const affordable = profile.unlimitedGold || profile.goldBalance >= config.minBuyIn;

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.trim().length !== 6) return;
    selectSound();
    onJoinCode(joinCode.trim());
  };

  return (
    <>
      {cashOutNotice !== null && (
        <div className="cash-out-notice" role="status">
          <Coins size={15} />
          <span>Cashed out <strong>{cashOutNotice.toLocaleString()}</strong> Gold from the table.</span>
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
            You&rsquo;re below the {TIER_CONFIG[CHEAPEST_TIER].minBuyIn.toLocaleString()} Gold minimum
            for the cheapest seat.
          </span>
          <button type="button" className="secondary-action" disabled={loading} onClick={() => { selectSound(); onClaimBackstop(); }}>
            Claim a top-up
          </button>
        </div>
      )}
      <InstallPrompt />

      {error && <p className="form-error"><X size={14} /> {error}</p>}

      {/* The real table plate from public/pokertable, the same art the desktop
          hero tile carries, dissolved into the card rather than sat on top of
          it. The card itself stays on the chrome's own ground, so the felt
          reads as a photograph of the table and not as a green panel. */}
      <div className="mshell-hero">
        <div className="mshell-hero-art" aria-hidden="true" />
        <div className="mshell-hero-body">
          <span className="lobby-kicker mshell-hero-kicker">Six-max cash game</span>
          <strong className="mshell-hero-name">Texas Hold&rsquo;em</strong>
          <span className="mshell-hero-meta">
            {config.label} to sit down. Blinds {config.smallBlind} and {config.bigBlind}.
          </span>

          <button
            type="button"
            className="mshell-primary"
            disabled={loading || !sessionReady || !affordable}
            onClick={() => { selectSound(); onQuickPlay(tier); }}
          >
            {!sessionReady
              ? "Getting your seat ready"
              : loading
                ? "Finding you a table"
                : affordable
                  ? "Take a seat"
                  : `You need ${config.minBuyIn.toLocaleString()} Gold`}
            {!loading && sessionReady && affordable && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Every tier is a fixed buy-in (minBuyIn === maxBuyIn), so picking the
          stake is also picking the amount. That is why the phone goes straight
          to a seat instead of opening the buy-in modal the desktop hub uses.
          Hosting still opens it, because that flow also names the room. */}
      <div className="mshell-section">
        <div className="mshell-section-head">
          <span className="lobby-kicker">Stakes</span>
        </div>
        <div className="mshell-tiers" role="group" aria-label="Stakes">
          {STAKES_TIERS.map((option) => {
            const optionConfig = TIER_CONFIG[option];
            const canAfford = profile.unlimitedGold || profile.goldBalance >= optionConfig.minBuyIn;
            return (
              <button
                key={option}
                type="button"
                className={`mshell-tier${option === tier ? " mshell-tier-on" : ""}`}
                aria-pressed={option === tier}
                disabled={!canAfford}
                title={canAfford ? undefined : `Needs ${optionConfig.minBuyIn.toLocaleString()} Gold`}
                onClick={() => { selectSound(); setTier(option); }}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <RankStrip />

      <div className="mshell-grid">
        <button type="button" className="mshell-card mshell-tile" onClick={() => { tapSound(); onHostPrivate(); }}>
          <Lock size={20} strokeWidth={1.8} aria-hidden="true" />
          <strong>Private table</strong>
          <small>Open a room, share the code</small>
        </button>
        <button type="button" className="mshell-card mshell-tile" onClick={() => { tapSound(); onOpenFriends(); }}>
          <Users size={20} strokeWidth={1.8} aria-hidden="true" />
          <strong>Friends</strong>
          <small>People you play with</small>
        </button>
      </div>

      <form className="mshell-card mshell-tile" onSubmit={submitJoin}>
        <label className="lobby-kicker" htmlFor="mshell-join-code">Join with a room code</label>
        <div className="hub-code-row">
          <input
            id="mshell-join-code"
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

      <Link className="mshell-card mshell-row" href="/challenges" onClick={tapSound}>
        <ClipboardList size={20} strokeWidth={1.8} aria-hidden="true" />
        <span className="mshell-row-body">
          <strong>Challenges</strong>
          <small>Daily and weekly objectives</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </>
  );
}

/* ---------------------------------------------------------------- pane 3 */

function YouPane({
  profile,
  onSignOut,
  onEditProfile,
  dailyGold,
  claimingGold,
  onClaimDailyGold,
  freeGoldEligible,
  onGetFreeGold,
  soundEnabled,
  onToggleSound,
  musicEnabled,
  onToggleMenuMusic,
  betStyle,
  onCycleBetStyle,
}: {
  profile: PlayerProfile;
  onSignOut: () => void;
  onEditProfile: () => void;
  dailyGold: DailyGoldState | null;
  claimingGold: boolean;
  onClaimDailyGold: () => void;
  freeGoldEligible: boolean;
  onGetFreeGold: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  musicEnabled: boolean;
  onToggleMenuMusic: () => void;
  betStyle: BetAnimationStyle;
  onCycleBetStyle: () => void;
}) {
  const dailyReady = dailyGold === "ready";
  const dailyClaimed = dailyGold === "claimed";

  return (
    <>
      {/* This pane is why the phone header carries no avatar: your name, your
          level and everything you can do to your account are here. */}
      <div className="mshell-card mshell-me">
        <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
        <span className="mshell-me-body">
          <strong>{profile.displayName}</strong>
          <small>
            {profile.unlimitedGold
              ? "Unlimited Gold"
              : `${profile.goldBalance.toLocaleString()} Gold`}
            {profile.isRegistered ? "" : " · Guest"}
          </small>
        </span>
        <button type="button" className="mshell-action" onClick={() => { tapSound(); onEditProfile(); }}>
          Edit
        </button>
      </div>

      {(dailyReady || dailyClaimed || freeGoldEligible) && (
        <div className="mshell-card">
          {freeGoldEligible && (
            <>
              <button type="button" className="mshell-row" onClick={() => { selectSound(); onGetFreeGold(); }}>
                <Video size={19} strokeWidth={1.8} aria-hidden="true" />
                <span className="mshell-row-body">
                  <strong>Watch an ad for Gold</strong>
                  <small>Tops you up when you are running low</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              {(dailyReady || dailyClaimed) && <div className="mshell-rule" />}
            </>
          )}
          {(dailyReady || dailyClaimed) && (
            <button
              type="button"
              className="mshell-row"
              disabled={dailyClaimed || claimingGold}
              onClick={() => { selectSound(); onClaimDailyGold(); }}
            >
              <Gift size={19} strokeWidth={1.8} aria-hidden="true" />
              <span className="mshell-row-body">
                <strong>
                  {dailyClaimed
                    ? "Daily Gold claimed"
                    : claimingGold ? "Claiming" : "Claim your daily Gold"}
                </strong>
                <small>{dailyClaimed ? "Come back tomorrow for more" : "One free top-up a day"}</small>
              </span>
              {!dailyClaimed && <ChevronRight size={18} aria-hidden="true" />}
            </button>
          )}
        </div>
      )}

      {/* The route's own leaderboard, embedded. Its game tabs, season toggle,
          kicker and fetch all come with it, so this pane adds no header above
          it. */}
      <Leaderboard embedded />

      <div className="mshell-section">
        <span className="lobby-kicker">Settings</span>
        <div className="mshell-card">
          {/* Cycle-on-tap rows labelled with their current value, matching the
              table menu's own convention -- these are the same preferences, and
              the table menu keeps its copies for use mid-hand. */}
          <button type="button" className="mshell-row" onClick={() => { selectSound(); onToggleSound(); }}>
            {soundEnabled ? <Volume2 size={19} strokeWidth={1.8} aria-hidden="true" /> : <VolumeX size={19} strokeWidth={1.8} aria-hidden="true" />}
            <span className="mshell-row-body"><strong>Sound</strong></span>
            <span className="mshell-setting-value">{soundEnabled ? "On" : "Off"}</span>
          </button>
          <div className="mshell-rule" />
          <button type="button" className="mshell-row" onClick={() => { selectSound(); onToggleMenuMusic(); }}>
            <Music2 size={19} strokeWidth={1.8} aria-hidden="true" />
            <span className="mshell-row-body"><strong>Menu music</strong></span>
            <span className="mshell-setting-value">{musicEnabled ? "On" : "Off"}</span>
          </button>
          <div className="mshell-rule" />
          <button type="button" className="mshell-row" onClick={() => { selectSound(); onCycleBetStyle(); }}>
            <Sparkles size={19} strokeWidth={1.8} aria-hidden="true" />
            <span className="mshell-row-body"><strong>Chip style</strong></span>
            <span className="mshell-setting-value">{betStyleLabel(betStyle).replace(/^Chip style: /, "")}</span>
          </button>
          <div className="mshell-rule" />
          {/* A guest has no account to sign out of, so the same slot offers the
              one thing that keeps their Gold: making one. */}
          <button type="button" className="mshell-row" onClick={() => { tapSound(); onSignOut(); }}>
            {profile.isRegistered
              ? <LogOut size={19} strokeWidth={1.8} aria-hidden="true" />
              : <Cloud size={19} strokeWidth={1.8} aria-hidden="true" />}
            <span className="mshell-row-body">
              <strong>{profile.isRegistered ? "Sign out" : "Save your progress"}</strong>
              {!profile.isRegistered && <small>Keep your Gold if you switch phones</small>}
            </span>
          </button>
        </div>
      </div>

      <div className="mshell-section">
        <span className="lobby-kicker">More</span>
        <div className="mshell-grid">
          <Link className="mshell-card mshell-tile" href="/collection" onClick={tapSound}>
            <Layers size={19} strokeWidth={1.8} aria-hidden="true" />
            <strong>Collection</strong>
            <small>Avatars and card backs</small>
          </Link>
          <Link className="mshell-card mshell-tile" href="/achievements" onClick={tapSound}>
            <Medal size={19} strokeWidth={1.8} aria-hidden="true" />
            <strong>Achievements</strong>
            <small>Badges and milestones</small>
          </Link>
          <Link className="mshell-card mshell-tile" href="/rewards" onClick={tapSound}>
            <Gift size={19} strokeWidth={1.8} aria-hidden="true" />
            <strong>Rewards</strong>
            <small>Every way to earn Gold</small>
          </Link>
          <Link className="mshell-card mshell-tile" href="/store/gold" onClick={tapSound}>
            <Coins size={19} strokeWidth={1.8} aria-hidden="true" />
            <strong>Buy Gold</strong>
            <small>Never required to play</small>
          </Link>
        </div>
      </div>

      <SiteFooter />
    </>
  );
}
