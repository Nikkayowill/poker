"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { MIN_DUEL_STAKE, type DuelSeat } from "@/lib/pvp/match-contract";
import type { PlayerProfile } from "@/lib/profile/types";
import { StakePicker } from "./stake-picker";

/** Round-number quick-picks above the floor. A custom field covers everything else. */
const STAKE_QUICK_PICKS = [MIN_DUEL_STAKE, 1000, 5000, 10_000, 25_000] as const;

/**
 * The client half of every duel: the lobby, the poll, and the match frame.
 *
 * A duel page is this shell plus one board component. The shell owns
 * everything that is the same for all four games -- staking, challenging,
 * accepting, polling for the other player, the result card, resigning -- and
 * the board owns only how its own game is drawn and what a move looks like.
 * That split is what let four games be built in parallel against one contract,
 * and it is the same argument components/arcade/arcade-hud.tsx makes about the
 * machine cabinet.
 *
 * The server is the authority for all of it. Nothing here decides a legal
 * move, an outcome or a payout; a board renders `state` and sends intents,
 * exactly like the poker table.
 */

export interface DuelPlayer {
  profileId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
}

export interface DuelMatch<TSnapshot = unknown> {
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

export interface DuelChallenge {
  id: string;
  game: string;
  challenger: DuelPlayer;
  opponentId: string | null;
  stake: number;
  expiresAt: string;
  mine: boolean;
}

/**
 * What a board component receives. The whole contract between this shell and
 * the four games.
 *
 * `onMove` takes whatever that game's engine accepts as a move -- the shell
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
 * How often the shell re-reads a live match.
 *
 * Polling rather than Realtime, deliberately: lib/game/table-channel.ts's
 * broadcast envelope carries table invalidations and is wired to the poker
 * game store, and threading duels through it is a bigger change than these
 * games need. Two seconds is fast enough that a turn-based game feels live and
 * slow enough that two players cost four requests a second between them.
 */
const POLL_MS = 2000;

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
  /** The registry key -- "chess", "checkers", "trivia", "word-race". */
  game: string;
  title: string;
  /** One or two lines under the heading. How the game is won, in the player's words. */
  rules: string;
  Board: ComponentType<DuelBoardProps<TSnapshot>>;
}) {
  const [match, setMatch] = useState<DuelMatch<TSnapshot> | null>(null);
  const [challenges, setChallenges] = useState<DuelChallenge[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [stake, setStake] = useState<number>(MIN_DUEL_STAKE);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A specific opponent, carried in from the friends drawer's Challenge
   * picker as `?challenge=<profileId>&name=<displayName>&suggested=<gold>`.
   *
   * Read from `window.location.search` in an effect rather than
   * `useSearchParams()`: that hook forces every one of the four /games/*
   * pages into a Suspense boundary to avoid a build-time deopt warning, for a
   * value this component only ever needs once, on the mount that already
   * happens client-side.
   */
  const [challengeTarget, setChallengeTarget] = useState<string | null>(null);
  const [challengeName, setChallengeName] = useState<string | null>(null);

  /**
   * Whether a poll is allowed to overwrite what is on screen.
   *
   * A poll that lands while the player's own move is in flight would paint the
   * pre-move state back over the board, and the move's own response would then
   * paint it forward again -- a visible flicker, and worse, a board briefly
   * showing a piece back where it was. The flag is a ref rather than state
   * because the poll reads it from a timer, where a stale closure over a state
   * value would defeat the point.
   */
  const sending = useRef(false);
  const mounted = useRef(true);

  const applyResponse = useCallback((data: Partial<LobbyResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.challenges) setChallenges(data.challenges);
    if (data.match !== undefined) setMatch((data.match as DuelMatch<TSnapshot>) ?? null);
  }, []);

  /** Reads the lobby: the live match if there is one, the open challenges if not. */
  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch(`/api/pvp/${game}`, { cache: "no-store" });
      const data = (await response.json()) as Partial<LobbyResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner -- the next one is two seconds
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
   * stuck. That is the same contract useCasinoMachine holds, and the reason
   * the error and the state are set from the same object.
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
          // The service sends the true match under `round`, which is the field
          // name the shared arcade error shape already uses.
          if (data.round) setMatch(data.round);
          return;
        }
        // A move/accept response carries the match under `match`; the lobby
        // read carries the whole shape. Both are applied the same way.
        if (data.match !== undefined) setMatch((data.match as DuelMatch<TSnapshot>) ?? null);
        if (data.challenges) setChallenges(data.challenges);
        // A cancel returns only a profile, so the challenge list has to be
        // re-read rather than patched -- the row that vanished was not the
        // only thing that may have changed.
        if (data.match === undefined && !data.challenges) void refresh();
      } catch {
        if (mounted.current) setError("Could not reach the table. Check your connection.");
      } finally {
        sending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [refresh],
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
    // suspended render, matching every arcade machine.
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  /**
   * Sends a move, stamped with the version of the match it was made on.
   *
   * The match is a PARAMETER rather than something read back out of state, and
   * that is the point -- the same shape useCasinoMachine's `act` uses, for the
   * same reason. A board only renders controls when it has a live match in
   * hand, so the frame can pass the exact one the player acted on. The two
   * alternatives are both wrong here: reading it inside a `setMatch` updater
   * makes the send a side effect in a function React may invoke twice under
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
        <Link className="floor-back" href="/games">← Ante Up</Link>
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
          onMove={(move) => onMove(match, move)}
          onResign={() => void send(`/api/pvp/matches/${match.id}`, { action: "resign" })}
          onLeave={() => setMatch(null)}
        />
      ) : (
        <DuelLobby
          title={title}
          rules={rules}
          game={game}
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
  game,
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
  game: string;
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
            a challenge exists: once `mine` is real, mine.opponentId (not this
            transient URL value) is what tells the pending note it was
            targeted, so that note survives a refresh where this does not. */}
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
            room, and a player has no way to know that unless it is said. */}
        No house cut. Every Gold staked at {game} goes to the other player.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ match */

function DuelMatchFrame<TSnapshot>({
  match,
  busy,
  Board,
  onMove,
  onResign,
  onLeave,
}: {
  match: DuelMatch<TSnapshot>;
  busy: boolean;
  Board: ComponentType<DuelBoardProps<TSnapshot>>;
  onMove: (move: unknown) => void;
  onResign: () => void;
  onLeave: () => void;
}) {
  const you = match.players[match.yourSeat];
  const them = match.players[match.yourSeat === 0 ? 1 : 0];
  const settled = match.status === "settled";
  const won = settled && match.winnerSeat === match.yourSeat;
  const drew = settled && match.winnerSeat === null;

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
          // still on screen -- the result card sits over it, and a board that
          // stayed live would send moves the server can only reject.
          busy={busy || settled}
          onMove={onMove}
        />
      </div>

      {settled ? (
        <div className={clsx("duel-result", won && "duel-result-won", drew && "duel-result-drew")}>
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
