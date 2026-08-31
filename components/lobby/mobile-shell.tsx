"use client";

/**
 * The phone lobby: four panes on one horizontal track, a tab bar underneath.
 *
 * It is not three routes because Ante Up (`/games`) and the leaderboard
 * (`/leaderboard`) are real routes, and every one of them unmounts PokerApp on
 * the way in, which is what makes the desktop hub flash the sign-in screen on
 * a back-navigation and refetch the profile each time. A tab bar built on those
 * routes would inherit all of it and could not be swiped between at all. So the
 * panes render inline, inside the component that already holds the session, and
 * the routes stay exactly where they are for deep links and desktop.
 *
 * Consequences worth knowing before editing:
 *   - `ArcadeFloor` and `Leaderboard` are the same components the routes mount,
 *     given `embedded` so they drop their own `<main>` and back-link. They are
 *     not reimplemented here, and must not be.
 *   - `ArcadeFloor` takes `profile` from us rather than fetching its own, or
 *     the shell would hold two diverging copies of the wallet and a buy-in
 *     would update only one of them.
 *   - Everything here is under PokerApp, so `tapSound`/`selectSound` may be
 *     called directly; see the note at the top of lobby.tsx.
 *
 * The gesture maths lives in lib/ui/swipe-pager.ts, pure and tested. This file
 * only owns the pointer plumbing and what the panes contain.
 *
 * The tab bar (2026-08-29 rebuild, replacing a deleted one) is plain CSS, no
 * JS: `position: fixed` plus a live `--safe-bottom` read. Do not add a
 * `useEffect` that forces a reflow here to chase the installed-PWA
 * cold-launch gap -- this file's history has done that three times now
 * (b694082, 1372ea2, and one on 2026-08-29 reverted before it shipped) and
 * it cannot work. See the open item at the top of 45-mobile-shell.css: the
 * gap is the *room* colour, not the bar's, under a bar that is already at
 * `bottom: 0`, which means the layout viewport itself is short and no
 * amount of DOM reflow changes what WebKit reports for it.
 */

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  BellOff,
  ChevronRight,
  ClipboardList,
  Cloud,
  Coins,
  Gift,
  HelpCircle,
  Layers,
  Lock,
  LogOut,
  type LucideIcon,
  Medal,
  Music2,
  Puzzle,
  Spade,
  Sparkles,
  Trophy,
  Users,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { CHEAPEST_TIER, STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { TABLE_FORMATS, type TableFormat } from "./table-format";
import { betStyleLabel, type BetAnimationStyle } from "@/lib/scene/bet-style";
import type { PlayerProfile } from "@/lib/profile/types";
import type { DailyGoldState } from "@/lib/profile/daily-gold";
import { browserSessionStorage } from "@/lib/profile/session-continuity";
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
import { LobbyNotices } from "./lobby-notices";

// Tab labels, not section names -- "Play" is this pane's own accessible
// name is still the fuller "Texas Hold'em" on the <section> below; the tab
// bar just needs a word short enough that none of the four ever risks the
// ellipsis clip (.mshell-nav-item span, 45-mobile-shell.css).
const PAGES = ["Play", "Ante Up", "Leaderboard", "Profile"] as const;
const PAGE_COUNT = PAGES.length;

/**
 * The settle transition's duration at a full pane width of travel — matches
 * `--duration-slower` in 45-mobile-shell.css, which is the floor it can't
 * exceed. A release already close to the target scales this down (see
 * `endGesture`) rather than always paying the full amount.
 */
const BASE_SETTLE_MS = 250;
/** Never so short it reads as a cut rather than a landing. */
const MIN_SETTLE_MS = 90;
// Puzzle over a generic controller glyph: this tab is Sudoku/Word Stack/
// Connections/Memory/Minesweeper plus the PvP duels, not "any game." Trophy
// is the same glyph poker-app.tsx's desktop menu already uses for its own
// Leaderboard link.
//
// Profile has no entry here -- Jakob's Law: TikTok, Instagram and YouTube
// all render their own last tab as the player's actual photo, not a generic
// person glyph, precisely because a familiar face is a stronger "this is
// yours" cue than a silhouette everyone's app uses. See the nav render
// below, which special-cases the last tab to <ProfileAvatar> instead of
// reading this array.
const PAGE_ICONS: readonly LucideIcon[] = [Spade, Puzzle, Trophy];

/**
 * Which pane the player was last on, so leaving the shell and coming back
 * lands where they left rather than back on Play.
 *
 * Half of this shell's doors (Collection, Achievements, Rewards, Buy Gold,
 * Challenges, every tile on Ante Up) are real routes that unmount PokerApp,
 * so returning from one rebuilt the shell from scratch. Tab bars do not behave
 * that way anywhere else, and the tell was landing two panes away from the
 * link you had just pressed.
 *
 * sessionStorage, never localStorage: this is where you are in this visit, not
 * a preference. A fresh open should still start on Play. Same reasoning as
 * lib/profile/session-continuity.ts, which is where the storage accessor comes
 * from.
 */
const PAGE_STORAGE_KEY = "stackchips:lobby-pane";

function readStoredPage(): number {
  const store = browserSessionStorage();
  if (!store) return 0;
  try {
    return clampPage(Number.parseInt(store.getItem(PAGE_STORAGE_KEY) ?? "", 10) || 0, PAGE_COUNT);
  } catch {
    return 0;
  }
}

/**
 * Anything that scrolls sideways inside a pane -- the stakes ladder, and the
 * leaderboard's own game-tab strip once it's wider than the screen (poker +
 * global + friends + every registered game is nine-plus segments). A drag
 * that starts in one belongs to it, not to the pager, or picking a stake (or
 * trying to reach the last game tab) would throw the player onto the next
 * shell tab instead.
 */
const HORIZONTAL_SCROLLER = ".mshell-tiers, .leaderboard-game-tabs";

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
  pushPermission,
  pushSubscribed,
  onTogglePushNotifications,
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
  pushPermission: NotificationPermission | "unsupported";
  pushSubscribed: boolean;
  onTogglePushNotifications: () => void;
}) {
  // Lazy, and safe to touch storage in: `usePhoneViewport` reports false on
  // the server, so this component only ever mounts on the client.
  const [page, setPage] = useState(readStoredPage);
  /** Live drag distance in px. Null whenever no horizontal drag is in flight. */
  const [drag, setDrag] = useState<number | null>(null);
  const gestureRef = useRef<SwipeGesture | null>(null);
  /** Signed px/ms at the most recent pointer move, read once on release. */
  const velocityRef = useRef(0);
  /**
   * How long the current settle transition should take. Scaled to the track's
   * remaining travel rather than fixed, so a release close to the target
   * pane arrives quickly and a release far from it takes the full duration —
   * the same page turn no longer takes as long to finish as it does to start.
   */
  const [settleMs, setSettleMs] = useState(BASE_SETTLE_MS);

  useEffect(() => {
    try {
      browserSessionStorage()?.setItem(PAGE_STORAGE_KEY, String(page));
    } catch {
      // A full or disabled store just means the next return starts on Play.
    }
  }, [page]);

  /*
   * Which panes have been looked at, or are one gesture away from being looked
   * at. All three are mounted from the start, which is what makes the slide a
   * slide, but a mounted pane runs its effects, and the leaderboard's effect
   * is a fetch. Without this a pane nobody had swiped to would spend a
   * request racing the profile fetch the visible pane was waiting on.
   *
   * Reached rather than current, and never unset: a pane keeps its content
   * once it has had any, so going back to it is instant. Neighbours count as
   * reached the moment a drag begins, which is why a pane is never caught
   * empty halfway through the slide that reveals it.
   */
  const [reached, setReached] = useState<readonly boolean[]>(
    () => PAGES.map((_, index) => index === page),
  );
  const reach = useCallback((...indexes: number[]) => {
    setReached((current) => {
      if (indexes.every((index) => current[index] ?? true)) return current;
      const next = [...current];
      for (const index of indexes) if (next[index] !== undefined) next[index] = true;
      return next;
    });
  }, []);

  const goTo = useCallback((next: number) => {
    const target = clampPage(next, PAGE_COUNT);
    reach(target);
    setSettleMs(BASE_SETTLE_MS); // a tab tap always travels the full pane width
    setPage((current) => {
      // `select`, not `tap`: a tab is a choice, and it changes what is on screen.
      if (target !== current) selectSound();
      return target;
    });
    setDrag(null);
  }, [reach]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.buttons !== 1) return;
    if (event.target instanceof Element && event.target.closest(HORIZONTAL_SCROLLER)) return;
    reach(page - 1, page + 1);
    velocityRef.current = 0;
    gestureRef.current = beginSwipe(
      event.clientX,
      event.clientY,
      event.currentTarget.clientWidth,
      event.timeStamp,
    );
  }, [page, reach]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const move = trackSwipe(gesture, event.clientX, event.clientY, page, PAGE_COUNT, event.timeStamp);
    velocityRef.current = move.velocity;
    /*
     * Capture on the axis lock, not on press.
     *
     * Capture is still needed: without it the drag dies the moment the
     * pointer crosses out of the element, which on a full-width pane happens
     * constantly at the edges. But a captured pointer also redirects the
     * `click` that follows it to the capture target, so capturing every press
     * meant the click never reached whatever was actually pressed. Touch
     * happens to survive that (the browser retargets it back), which is why
     * this was invisible on a phone; with a mouse, every link and button
     * inside the panes was simply dead: Collection, Achievements, Rewards,
     * Buy Gold, Challenges, every tile on the Ante Up pane, the whole footer.
     *
     * `trackSwipe` only reports "horizontal" once the finger has travelled
     * AXIS_LOCK_PX, and a tap never travels that far, so taking capture here
     * gives the drag everything it needs and leaves a press alone.
     */
    if (gesture.axis !== "horizontal" && move.gesture.axis === "horizontal") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    gestureRef.current = move.gesture;
    setDrag(move.offset);
  }, [page]);

  const endGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    const offsetAtRelease = drag ?? 0;
    const settled = settleSwipe(gesture, offsetAtRelease, page, PAGE_COUNT, velocityRef.current);
    /*
     * Duration scaled to what's actually left to travel, not fixed. The track
     * is already sitting at `offsetAtRelease` px into the turn; the distance
     * still to cover to reach the settled page is `(settled - page)` panes
     * plus that offset, so a release close to the target keeps moving at
     * roughly its current speed instead of visibly slowing to stretch out to
     * the full BASE_SETTLE_MS. A tab tap never reaches here, so it always
     * gets goTo's fixed duration above.
     */
    const remainingPx = Math.abs((settled - page) * gesture.width + offsetAtRelease);
    setSettleMs(Math.max(
      MIN_SETTLE_MS,
      Math.round((remainingPx / gesture.width) * BASE_SETTLE_MS),
    ));
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
          style={{
            transform: `translateX(calc(${-page * 100}% + ${Math.round(offset)}px))`,
            // Longhand wins over the class's `transition` shorthand for just
            // this property, so the CSS still owns the property/easing/delay.
            transitionDuration: drag === null ? `${settleMs}ms` : undefined,
          }}
        >
          {/* Panes off-screen stay in the document, so they'd still be in
              the tab order and still read out. `inert` is what actually takes
              them out of both; hiding them would break the slide. */}
          <section className="mshell-pane" aria-label="Texas Hold'em" inert={page !== 0}>
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
            {/* The route's own component, not a copy of it */}
            <ArcadeFloor profile={profile} embedded />
          </section>

          <section className="mshell-pane" aria-label="Leaderboard" inert={page !== 2}>
            {/* The route's own leaderboard, embedded. Its game tabs, season
                toggle, kicker and fetch all come with it, so this pane adds
                no header above it, and the fetch is why it waits until this
                pane has actually been reached rather than mounting with the
                shell -- see `reached` above. */}
            {(reached[2] ?? true) && <Leaderboard embedded />}
          </section>

          <section className="mshell-pane" aria-label="Profile" inert={page !== 3}>
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
              pushPermission={pushPermission}
              pushSubscribed={pushSubscribed}
              onTogglePushNotifications={onTogglePushNotifications}
            />
          </section>
        </div>
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
              {/* The Profile tab renders the player's own avatar rather than
                  reading PAGE_ICONS -- see the array's own comment. The other
                  two swap outline/filled by toggling `fill`, the same
                  active-state cue TikTok/Instagram/YouTube use on their own
                  generic tabs (a color change alone was the design-review
                  finding this replaces). */}
              {Icon
                ? <Icon size={20} strokeWidth={1.8} fill={active ? "currentColor" : "none"} aria-hidden="true" />
                : (
                  // aria-hidden, not just decorative styling: ProfileAvatar
                  // sets its own role="img"/aria-label ("Kayo's avatar"),
                  // which would otherwise concatenate into this button's
                  // accessible name alongside the visible "Profile" label.
                  <span aria-hidden="true">
                    <ProfileAvatar
                      profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }}
                      className="mshell-nav-avatar"
                    />
                  </span>
                )}
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
  const router = useRouter();
  const [tier, setTier] = useState<StakesTier>(CHEAPEST_TIER);
  const [format, setFormat] = useState<TableFormat>("cash");
  const [joinCode, setJoinCode] = useState("");
  const config = TIER_CONFIG[tier];
  const affordable = profile.unlimitedGold || profile.goldBalance >= config.minBuyIn;

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.trim().length !== 6) return;
    selectSound();
    onJoinCode(joinCode.trim());
  };

  // Cash seats directly through onQuickPlay; heads-up/tournament each
  // already have their own matchmaking/registration lobby, so picking
  // either just hands the chosen tier off to it -- same split BuyInModal's
  // own confirm button makes on desktop.
  const play = () => {
    selectSound();
    if (format === "cash") {
      onQuickPlay(tier);
    } else {
      router.push(`/games/${format === "heads-up" ? "heads-up" : "sit-and-go"}?tier=${tier}`);
    }
  };

  return (
    <>
      <LobbyNotices
        loading={loading}
        cashOutNotice={cashOutNotice}
        onDismissCashOut={onDismissCashOut}
        authNotice={authNotice}
        onDismissAuthNotice={onDismissAuthNotice}
        showSavePrompt={showSavePrompt}
        onSaveProgress={onSaveProgress}
        onDismissSaveProgress={onDismissSaveProgress}
        needsTopUp={needsTopUp}
        onClaimBackstop={onClaimBackstop}
      />
      <InstallPrompt />

      {error && <p className="form-error"><X size={14} /> {error}</p>}

      {/* The real table plate from public/pokertable, the same art the desktop
          hero tile carries, dissolved into the card rather than sat on top of
          it. The card itself stays on the chrome's own ground, so the felt
          reads as a photograph of the table rather than a green panel. */}
      <div className="mshell-hero">
        <div className="mshell-hero-art" aria-hidden="true" />
        <div className="mshell-hero-body">
          <span className="lobby-kicker mshell-hero-kicker">
            {TABLE_FORMATS.find((candidate) => candidate.id === format)?.blurb}
          </span>
          <strong className="mshell-hero-name">
            {TABLE_FORMATS.find((candidate) => candidate.id === format)?.label}
          </strong>
          <span className="mshell-hero-meta">
            {config.label} to sit down. Blinds {config.smallBlind} and {config.bigBlind}.
          </span>

          {/* Same three-way choice BuyInModal offers on desktop -- "choose
              blinds, then choose Texas Hold'em / Heads-Up / Tournament" in
              one flow, not scattered across separate tiles. */}
          <div className="mshell-format entry-segment" role="group" aria-label="Format">
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

          <button
            type="button"
            className="mshell-primary"
            disabled={loading || !sessionReady || !affordable}
            onClick={play}
          >
            {!sessionReady
              ? "Getting your seat ready"
              : loading
                ? "Finding you a table"
                : !affordable
                  ? `You need ${config.minBuyIn.toLocaleString()} Gold`
                  : format === "cash" ? "Take a seat" : `Go to ${TABLE_FORMATS.find((candidate) => candidate.id === format)?.label}`}
            {!loading && sessionReady && affordable && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Every tier is a fixed buy-in (minBuyIn === maxBuyIn), so picking the
          stake is also picking the amount. That's why the phone goes straight
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
  pushPermission,
  pushSubscribed,
  onTogglePushNotifications,
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
  pushPermission: NotificationPermission | "unsupported";
  pushSubscribed: boolean;
  onTogglePushNotifications: () => void;
}) {
  const dailyReady = dailyGold === "ready";
  const dailyClaimed = dailyGold === "claimed";

  return (
    <>
      {/* This pane is why the phone header carries no avatar; your name, your
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

      <div className="mshell-section">
        <span className="lobby-kicker">Settings</span>
        <div className="mshell-card">
          {/* Cycle-on-tap rows labelled with their current value, matching the
              table menu's own convention: these are the same preferences, and
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
          {/* Registered only, and hidden (not disabled) when the browser has
              no Notification API at all -- same condition and reasoning as
              poker-app.tsx's desktop player menu row, which this is the
              phone shell's only equivalent of: the phone shell has no
              dropdown of its own, so without this row a phone player who
              signed up before push existed (or just never got the
              account-creation prompt) has no way to ever turn it on. */}
          {profile.isRegistered && pushPermission !== "unsupported" && (
            <>
              <div className="mshell-rule" />
              <button
                type="button"
                className="mshell-row"
                disabled={pushPermission === "denied"}
                onClick={() => { selectSound(); onTogglePushNotifications(); }}
              >
                {pushSubscribed
                  ? <Bell size={19} strokeWidth={1.8} aria-hidden="true" />
                  : <BellOff size={19} strokeWidth={1.8} aria-hidden="true" />}
                <span className="mshell-row-body">
                  <strong>
                    {pushPermission === "denied" ? "Notifications blocked" : "Notifications"}
                  </strong>
                  {pushPermission === "denied" && <small>Check your browser/device settings</small>}
                </span>
                {pushPermission !== "denied" && (
                  <span className="mshell-setting-value">{pushSubscribed ? "On" : "Off"}</span>
                )}
              </button>
            </>
          )}
          <div className="mshell-rule" />
          {/* A guest has no account to sign out of, so the same slot offers
              the one thing that keeps their Gold: making one. */}
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
          {/* SiteFooter below already links here, but as small footer text --
              this tile is the same "always reachable" affordance the desktop
              lobby's footer gives, sized for a thumb instead of a mouse. */}
          <Link className="mshell-card mshell-tile" href="/how-to-play" onClick={tapSound}>
            <HelpCircle size={19} strokeWidth={1.8} aria-hidden="true" />
            <strong>How to Play</strong>
            <small>Rules and hand rankings</small>
          </Link>
        </div>
      </div>

      <SiteFooter />
    </>
  );
}
