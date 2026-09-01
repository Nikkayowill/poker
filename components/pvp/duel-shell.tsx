"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import clsx from "clsx";
import { Coins } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import type { SoundEffect } from "@/lib/audio/sound-effects";
import { MIN_DUEL_STAKE, type DuelSeat } from "@/lib/pvp/match-contract";
import { PVP_STATE_CHANGED, pvpChannelName } from "@/lib/pvp/duel-channel";
import { browserSupabase } from "@/lib/supabase/browser-client";
import type { PlayerProfile } from "@/lib/profile/types";
import { StakePicker } from "./stake-picker";

/** Round-number quick-picks above the floor. A custom field covers everything else. */
const STAKE_QUICK_PICKS = [MIN_DUEL_STAKE, 1000, 5000, 10_000, 25_000] as const;

/**
 * The client half of every duel: the lobby, the poll, and the match frame.
 *
 * A duel page is this shell plus one board component. The shell owns
 * everything that's the same for all four games (staking, challenging,
 * accepting, polling for the other player, the result card, resigning), and
 * the board owns only how its own game is drawn and what a move looks like.
 * That split is what let four games get built in parallel against one
 * contract, the same argument components/arcade/arcade-hud.tsx makes about
 * the machine cabinet.
 *
 * The server is the authority for all of it. Nothing here decides a legal
 * move, an outcome or a payout; a board renders `state` and sends intents,
 * exactly like the poker table.
 */

interface DuelPlayer {
  profileId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
}

interface DuelMatch<TSnapshot = unknown> {
  id: string;
  game: string;
  version: number;
  status: "active" | "settled";
  yourSeat: DuelSeat;
  players: [DuelPlayer, DuelPlayer];
  stake: number;
  pot: number;
  winnerSeat: DuelSeat | null;
  outcome: { winner: DuelSeat | null; reason: string } | null;
  state: TSnapshot;
}

interface DuelChallenge {
  id: string;
  game: string;
  challenger: DuelPlayer;
  opponentId: string | null;
  stake: number;
  expiresAt: string;
  mine: boolean;
}

/**
 * What a board component receives, and the whole contract between this shell
 * and the four games.
 *
 * `onMove` takes whatever that game's engine accepts as a move; the shell
 * never inspects it, and stamps the version itself so no board can forget the
 * concurrency guard. `busy` is true while a move is in flight, and a board
 * must use it to disable its own controls: without that, a fast double-click
 * sends two moves and the second is rejected by the version guard, which the
 * player sees as an error rather than as nothing happening.
 */
export interface DuelBoardProps<TSnapshot = unknown> {
  state: TSnapshot;
  yourSeat: DuelSeat;
  status: "active" | "settled";
  busy: boolean;
  onMove: (move: unknown) => void;
}

/**
 * The Realtime-path safety-net poll. Normal sync is instant, driven by
 * lib/pvp/duel-channel.ts's `pvp:<profileId>` broadcast (see the effect
 * below); this just guards against a socket that has gone quietly stale
 * without firing CHANNEL_ERROR/CLOSED, at a cadence low enough that it is
 * not the thing generating traffic.
 */
const BACKUP_POLL_MS = 15_000;

/** Fallback pause on a 429 with no usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface LobbyResponse {
  match: DuelMatch | null;
  challenges: DuelChallenge[];
  profile: PlayerProfile;
  error?: string;
}

export function DuelShell<TSnapshot>({
  game,
  title,
  rules,
  Board,
}: {
  /** The registry key: "chess", "checkers", "trivia", "word-race". */
  game: string;
  title: string;
  /** One or two lines under the heading. How the game is won, in the player's words. */
  rules: string;
  Board: ComponentType<DuelBoardProps<TSnapshot>>;
}) {
  const [match, setMatch] = useState<DuelMatch<TSnapshot> | null>(null);
  const [challenges, setChallenges] = useState<DuelChallenge[]>([]);
  // The persistent shell owns the profile now -- this screen still gets it
  // back from its own GET /api/pvp/[game] response too (unchanged this
  // phase), it just writes that into the shared setter instead of a local
  // copy, which is also what makes a stake won/lost here show up in the
  // lobby's own Gold balance without a separate refetch.
  const { profile, setProfile, setImmersive } = useAppShell();
  const [stake, setStake] = useState<number>(MIN_DUEL_STAKE);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A specific opponent, carried in from the friends drawer's Challenge
   * picker as `?challenge=<profileId>&name=<displayName>&suggested=<gold>`.
   *
   * Read from `window.location.search` in an effect rather than
   * `useSearchParams()`, since that hook would force every one of the four
   * /games/* pages into a Suspense boundary to avoid a build-time deopt
   * warning, for a value this component only ever needs once, on the mount
   * that already happens client-side.
   */
  const [challengeTarget, setChallengeTarget] = useState<string | null>(null);
  const [challengeName, setChallengeName] = useState<string | null>(null);

  // Tells the shell a match is live -- hides the persistent nav chrome the
  // same way poker-app.tsx does for a hand in progress. Deliberately not
  // narrowed to an in-progress status: the settled/result card is still this
  // screen, not the lobby, and its own FloorBackLink is the way out.
  useEffect(() => {
    setImmersive(Boolean(match));
  }, [match, setImmersive]);

  /**
   * Whether a poll is allowed to overwrite what is on screen.
   *
   * A poll that lands while the player's own move is in flight would paint the
   * pre-move state back over the board, and the move's own response would then
   * paint it forward again: a visible flicker, and worse, a board briefly
   * showing a piece back where it was. The flag is a ref rather than state
   * because the poll reads it from a timer, where a stale closure over a state
   * value would defeat the point.
   */
  const sending = useRef(false);
  const mounted = useRef(true);
  /**
   * A timestamp (Date.now()-scale) refresh-driven sync must not fire before.
   * Set by refresh() when the server answers 429, from that response's own
   * Retry-After; the backup poll and the realtime handler both check it
   * before spending a request, so a rate limit gets one clean backoff
   * instead of immediately being hit again by whichever fires next.
   */
  const pausedUntil = useRef(0);
  const play = useArcadeSound({ gameSounds: true });

  const applyResponse = useCallback((data: Partial<LobbyResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.challenges) setChallenges(data.challenges);
    if (data.match !== undefined) {
      setMatch((current) => {
        // The server stops listing a match once its settled-match grace
        // window passes, but the player still needs to see the result card
        // until they explicitly move on (Play again). Without this, a poll
        // landing after that window would return `null` and wipe the result
        // screen out from under someone still reading it. Same guard
        // cribbage-shell.tsx carries for its own match frame.
        if (!data.match && current?.status === "settled") return current;
        return (data.match as DuelMatch<TSnapshot>) ?? null;
      });
    }
  }, [setProfile]);

  /** Reads the lobby: the live match if there is one, the open challenges if not. */
  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch(`/api/pvp/${game}`, { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        pausedUntil.current = Date.now() + seconds * 1000;
        return;
      }
      const data = (await response.json()) as Partial<LobbyResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll isn't worth a banner: the next one is two seconds
      // away, and the player is looking at a board that is still correct.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [game, applyResponse]);

  /**
   * Sends an intent and takes whatever comes back as the new truth.
   *
   * A failed request still applies its payload: a 409 carries the real state,
   * so a client that fell behind resyncs from the error rather than staying
   * stuck. That's the same contract useCasinoMachine holds, and the reason the
   * error and the state are set from the same object.
   */
  const send = useCallback(
    async (url: string, body: unknown) => {
      sending.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(url, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as Partial<LobbyResponse> & {
          round?: DuelMatch<TSnapshot>;
        };
        if (!mounted.current) return;
        if (data.profile) setProfile(data.profile);
        if (!response.ok) {
          setError(data.error ?? "That did not go through.");
          // The service sends the true match under `round`, the field name
          // the shared arcade error shape already uses.
          if (data.round) setMatch(data.round);
          return;
        }
        // A move/accept response carries the match under `match`; the lobby
        // read carries the whole shape. Both are applied the same way.
        if (data.match !== undefined) setMatch((data.match as DuelMatch<TSnapshot>) ?? null);
        if (data.challenges) setChallenges(data.challenges);
        // A cancel returns only a profile, so the challenge list has to be
        // re-read rather than patched: the row that vanished wasn't the only
        // thing that may have changed.
        if (data.match === undefined && !data.challenges) void refresh();
      } catch {
        if (mounted.current) setError("Could not reach the table. Check your connection.");
      } finally {
        sending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [refresh, setProfile],
  );

  useEffect(() => {
    // Deferred through a timer for the same reason the poll below is: setting
    // state straight from an effect body commits synchronously within the
    // effect that produced it, which react-hooks/set-state-in-effect flags.
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      setChallengeTarget(params.get("challenge"));
      setChallengeName(params.get("name"));
      const suggested = Number(params.get("suggested"));
      if (Number.isFinite(suggested) && suggested >= MIN_DUEL_STAKE) setStake(suggested);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Deferred a tick so the first paint is the empty lobby rather than a
    // suspended render, matching every arcade machine. This is the one fetch
    // every mount gets regardless of how sync is wired below.
    const first = window.setTimeout(() => void refresh(), 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(first);
    };
  }, [refresh]);

  /**
   * Cross-browser sync: the other player's move, a challenge landing or
   * being accepted, a match settling. This replaces the fixed 2s poll the
   * shell used to run unconditionally -- lib/pvp/duel-channel.ts's
   * `pvp:<profileId>` channel now carries the same invalidation-ping
   * contract lib/game/table-channel.ts established for the poker table,
   * fired by the `broadcast_pvp_signal()` trigger on every write to
   * `pvp_challenges`/`pvp_matches` naming this profile.
   *
   * A hidden tab skips the re-fetch (nobody's watching), and resyncs the
   * instant the tab is looked at again in case a broadcast landed while
   * hidden -- same reasoning and pattern poker-app.tsx's resyncOnReturn
   * uses for the table itself.
   *
   * No profile id yet (the brief window right after mount, before the first
   * refresh() resolves) or no Supabase configured at all (memory-mode dev)
   * both mean no channel this effect can subscribe to -- same gap
   * poker-app.tsx's own Realtime effect accepts (`if (!gameId || !supabase)
   * return;`), rather than falling back to a poll. Once subscribed, a slow
   * BACKUP_POLL_MS poll still runs alongside the channel, purely as a safety
   * net against a socket that goes quietly stale without firing
   * CHANNEL_ERROR/CLOSED -- unlike the poker table, a two-player duel has no
   * other seated human whose own turn-clock tick would notice for it.
   */
  useEffect(() => {
    const supabase = browserSupabase();
    const profileId = profile?.id;
    if (!supabase || !profileId) return;

    const resyncOnReturn = () => {
      if (!document.hidden && Date.now() >= pausedUntil.current) void refresh();
    };
    document.addEventListener("visibilitychange", resyncOnReturn);

    // Same in-flight guard shape as poker-app.tsx's refreshLatest: a
    // broadcast landing mid-fetch queues one more refresh rather than
    // firing a second overlapping request.
    let refreshRunning = false;
    let refreshQueued = false;
    const refreshLatest = () => {
      if (Date.now() < pausedUntil.current) return;
      if (refreshRunning) {
        refreshQueued = true;
        return;
      }
      refreshRunning = true;
      refreshQueued = false;
      void refresh().finally(() => {
        refreshRunning = false;
        if (refreshQueued) refreshLatest();
      });
    };

    let channel: RealtimeChannel | null = supabase
      .channel(pvpChannelName(profileId))
      .on("broadcast", { event: PVP_STATE_CHANGED }, () => {
        if (!document.hidden) refreshLatest();
      })
      .subscribe();

    const backupTimer = window.setInterval(() => {
      if (!document.hidden) refreshLatest();
    }, BACKUP_POLL_MS);

    return () => {
      window.clearInterval(backupTimer);
      document.removeEventListener("visibilitychange", resyncOnReturn);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [profile?.id, refresh]);

  /**
   * Sends a move, stamped with the version of the match it was made on.
   *
   * The match is a parameter rather than something read back out of state,
   * the same shape useCasinoMachine's `act` uses and for the same reason: a
   * board only renders controls when it has a live match in hand, so the
   * frame can pass the exact one the player acted on. The two alternatives
   * are both wrong here: reading it inside a `setMatch` updater makes the
   * send a side effect in a function React may invoke twice under
   * StrictMode, and reading it from a ref in a click handler is the pattern
   * `react-hooks/refs` flags.
   *
   * Stamping the version here rather than in the board is what stops any of
   * the four games forgetting the concurrency guard.
   */
  const onMove = useCallback(
    (current: DuelMatch<TSnapshot>, move: unknown) => {
      if (current.status !== "active") return;
      void send(`/api/pvp/matches/${current.id}`, {
        action: "move",
        version: current.version,
        move,
      });
    },
    [send],
  );

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;

  return (
    <main className="duel-shell">
      <header className="floor-bar">
        <FloorBackLink
          confirmLeave={match?.status === "active"}
          confirmMessage="You have Gold staked on this match. Leaving won't resign it — you'll need to come back to finish, or use Resign to settle it now."
        />
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {!loaded
              ? "—"
              : profile?.unlimitedGold
                ? "Unlimited"
                : (profile?.goldBalance ?? 0).toLocaleString()}
          </strong>
        </span>
      </header>

      {error && (
        <div className="duel-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {match ? (
        <DuelMatchFrame
          match={match}
          busy={busy}
          Board={Board}
          play={play}
          onMove={(move) => onMove(match, move)}
          onResign={() => void send(`/api/pvp/matches/${match.id}`, { action: "resign" })}
          onLeave={() => setMatch(null)}
        />
      ) : (
        <DuelLobby
          title={title}
          rules={rules}
          loaded={loaded}
          busy={busy}
          balance={balance}
          stake={stake}
          onStake={setStake}
          challenges={challenges}
          challengeName={challengeTarget ? challengeName : null}
          onOpen={() => void send(`/api/pvp/${game}`, { stake, opponentId: challengeTarget ?? undefined })}
          onAccept={(id) => void send(`/api/pvp/challenges/${id}`, { action: "accept" })}
          onCancel={(id) => void send(`/api/pvp/challenges/${id}`, { action: "cancel" })}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ lobby */

function DuelLobby({
  title,
  rules,
  loaded,
  busy,
  balance,
  stake,
  onStake,
  challenges,
  challengeName,
  onOpen,
  onAccept,
  onCancel,
}: {
  title: string;
  rules: string;
  loaded: boolean;
  busy: boolean;
  balance: number;
  stake: number;
  onStake: (stake: number) => void;
  challenges: DuelChallenge[];
  /** The friend this lobby was opened to challenge, from the friends drawer's picker. Null for an ordinary visit. */
  challengeName: string | null;
  onOpen: () => void;
  onAccept: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const canAfford = stake >= MIN_DUEL_STAKE && balance >= stake;
  const mine = challenges.find((challenge) => challenge.mine) ?? null;
  const others = challenges.filter((challenge) => !challenge.mine);

  return (
    <div className="duel-lobby">
      <div className="floor-head">
        <div className="lobby-kicker">Head to head</div>
        <h1>{title}</h1>
        <p>{rules}</p>
      </div>

      <section className="duel-panel">
        <h2 className="floor-section-head">Your stake</h2>
        {/* Set only by the friends drawer's Challenge picker, and only until
            a challenge exists. Once `mine` is real, mine.opponentId (not this
            transient URL value) is what tells the pending note it was
            targeted, so that note survives a refresh where this doesn't. */}
        {challengeName && !mine && (
          <p className="duel-challenge-note">Challenging <strong>{challengeName}</strong></p>
        )}
        {/* Both players ante the same amount and the winner takes both, so
            the pot is stated as well as the stake -- "1,000" alone reads as
            the price of a round rather than as half of what is on the table. */}
        <StakePicker
          ariaLabel="Stake"
          picks={STAKE_QUICK_PICKS}
          value={stake}
          min={MIN_DUEL_STAKE}
          onChange={onStake}
        />
        <p className="duel-pot-note">
          {stake < MIN_DUEL_STAKE
            ? `Wager at least ${MIN_DUEL_STAKE.toLocaleString()} Gold to open a duel.`
            : <>
                You both put up {stake.toLocaleString()}. Winner takes {(stake * 2).toLocaleString()}.
                A draw returns each of you your own.
              </>}
        </p>

        {mine ? (
          <div className="duel-mine">
            <span>
              Your {mine.stake.toLocaleString()} Gold challenge is open — held until{" "}
              {mine.opponentId ? "they accept" : "someone takes it"}.
            </span>
            <button type="button" className="floor-play" disabled={busy} onClick={() => onCancel(mine.id)}>
              Withdraw
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="floor-play duel-open"
            disabled={busy || !loaded || !canAfford}
            onClick={onOpen}
          >
            {!loaded
              ? "…"
              : !canAfford
                ? "Not enough Gold"
                : challengeName
                  ? `Challenge ${challengeName}`
                  : `Open a ${stake.toLocaleString()} Gold challenge`}
          </button>
        )}
        {/* Only the actual Gold shortfall -- a stake below MIN_DUEL_STAKE is
            a slider issue duel-pot-note above already covers, not a "go
            earn more" one. */}
        {!mine && loaded && stake >= MIN_DUEL_STAKE && balance < stake && <GoldShortfallHint needed={stake} />}
      </section>

      <section className="duel-panel">
        <h2 className="floor-section-head">Waiting for an opponent</h2>
        {others.length === 0 ? (
          <p className="duel-empty">
            {loaded
              ? "Nobody is waiting right now. Open a challenge and the next player in takes it."
              : "Looking…"}
          </p>
        ) : (
          <ul className="duel-challenge-list">
            {others.map((challenge) => (
              <li key={challenge.id} className="duel-challenge">
                <span
                  className="duel-avatar"
                  style={{ background: challenge.challenger.accent }}
                  aria-hidden="true"
                >
                  {challenge.challenger.initials}
                </span>
                <span className="duel-challenge-identity">
                  <strong>{challenge.challenger.displayName}</strong>
                  <small>
                    {challenge.opponentId ? "Challenged you" : "Open to anyone"}
                  </small>
                </span>
                <span className="duel-challenge-stake">{challenge.stake.toLocaleString()}</span>
                <button
                  type="button"
                  className="floor-play"
                  disabled={busy || balance < challenge.stake}
                  onClick={() => onAccept(challenge.id)}
                >
                  {balance < challenge.stake ? "Low Gold" : "Accept"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="duel-footnote">
        {/* Named rather than left implicit: the whole reason these games
            replaced the house games is that nobody is playing against the
            room, and a player has no way to know that unless it is said.
            Uses the display title, not the registry id, since "word-race"
            read as a raw slug here where every other id happened to already
            be a plain word. */}
        No house cut. Every Gold staked at {title} goes to the other player.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ match */

function DuelMatchFrame<TSnapshot>({
  match,
  busy,
  Board,
  play,
  onMove,
  onResign,
  onLeave,
}: {
  match: DuelMatch<TSnapshot>;
  busy: boolean;
  Board: ComponentType<DuelBoardProps<TSnapshot>>;
  play: (effect: SoundEffect) => void;
  onMove: (move: unknown) => void;
  onResign: () => void;
  onLeave: () => void;
}) {
  const you = match.players[match.yourSeat];
  const them = match.players[match.yourSeat === 0 ? 1 : 0];
  const settled = match.status === "settled";
  const won = settled && match.winnerSeat === match.yourSeat;
  const drew = settled && match.winnerSeat === null;

  // Fires once per match, on the edge of it actually settling, not on every
  // poll that still reports the same settled match. "lose" has no asset
  // behind it (manifest.ts's own call: silence, not a synthesized stand-in),
  // so only a win makes a sound; a loss or a draw stays quiet.
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settled || announcedRef.current === match.id) return;
    announcedRef.current = match.id;
    play(won ? "win-modest" : "lose");
  }, [settled, won, match.id, play]);

  return (
    <div className="duel-match">
      <div className="duel-scoreline">
        <PlayerChip player={you} label="You" />
        <span className="duel-pot">
          <Coins size={12} aria-hidden="true" />
          <strong>{match.pot.toLocaleString()}</strong>
        </span>
        <PlayerChip player={them} label="Opponent" />
      </div>

      <div className="duel-board">
        <Board
          state={match.state}
          yourSeat={match.yourSeat}
          status={match.status}
          // A settled match must not accept input even though the board is
          // still on screen: the result card sits over it, and a board that
          // stayed live would send moves the server can only reject.
          busy={busy || settled}
          onMove={onMove}
        />
      </div>

      {settled ? (
        <div className={clsx("duel-result", won && "duel-result-won", drew && "duel-result-drew")}>
          <WinCelebration active={won} amount={match.pot} />
          <strong>{drew ? "Draw" : won ? "You win" : "You lose"}</strong>
          <span>{match.outcome?.reason ?? ""}</span>
          <span className="duel-result-gold">
            {drew
              ? `Your ${match.stake.toLocaleString()} came back.`
              : won
                ? `+${match.pot.toLocaleString()} Gold`
                : `−${match.stake.toLocaleString()} Gold`}
          </span>
          {/* Clears the finished match from the client only. The row is
              already settled and paid; there is nothing to tell the server. */}
          <button type="button" className="floor-play" onClick={onLeave}>Play again</button>
        </div>
      ) : (
        <div className="duel-controls">
          <button type="button" className="duel-resign" disabled={busy} onClick={onResign}>
            Resign
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerChip({ player, label }: { player: DuelPlayer; label: string }) {
  return (
    <span className="duel-player">
      <span className="duel-avatar" style={{ background: player.accent }} aria-hidden="true">
        {player.initials}
      </span>
      <span className="duel-player-identity">
        <strong>{player.displayName}</strong>
        <small>{label}</small>
      </span>
    </span>
  );
}
