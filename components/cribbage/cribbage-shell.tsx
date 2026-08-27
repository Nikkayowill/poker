"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { StakePicker } from "@/components/pvp/stake-picker";
import type { SoundEffect } from "@/lib/audio/sound-effects";
import { CRIB_STATE_CHANGED, cribLobbyChannelName, cribTableChannelName } from "@/lib/cribbage/crib-channel";
import type { CribbageSeat, CribbageSnapshot } from "@/lib/cribbage/engine";
import type { PlayerProfile } from "@/lib/profile/types";
import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import { browserSupabase } from "@/lib/supabase/browser-client";

/**
 * The client half of cribbage: the open-table lobby, the waiting room, the
 * poll, and the match frame.
 *
 * Not components/pvp/duel-shell.tsx: that shell's whole lobby model is "your
 * one open challenge vs. everyone else's" and its match frame is built
 * around a fixed [player, player] pair. Cribbage's lobby is a joinable table
 * list, and a table has a waiting room (N of 4 seated, a host-start button)
 * that a 1v1 duel never needs. Same underlying discipline as that shell
 * though: the server is the sole authority, this owns polling/staking/
 * joining/starting, and the board (passed in) owns only how the game itself
 * is drawn and what a move looks like.
 */

const STAKE_QUICK_PICKS = [MIN_DUEL_STAKE, 1000, 5000, 10_000, 25_000] as const;

/**
 * The Realtime-path safety-net poll. Normal sync is instant, driven by
 * lib/cribbage/crib-channel.ts's `crib:lobby`/`crib:<tableId>` broadcast
 * (see the effect below); this just guards against a socket that has gone
 * quietly stale without firing CHANNEL_ERROR/CLOSED.
 */
const BACKUP_POLL_MS = 15_000;

/** Fallback pause on a 429 with no usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface CribbagePlayer {
  profileId: string;
  seat: CribbageSeat;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
}

interface CribbageTable {
  id: string;
  status: "waiting" | "active" | "completed" | "cancelled";
  version: number;
  stake: number;
  pot: number;
  hostId: string;
  minSeatsToStart: number;
  maxSeats: number;
  yourSeat: CribbageSeat | null;
  isHost: boolean;
  canStart: boolean;
  players: CribbagePlayer[];
  winnerId: string | null;
  state: CribbageSnapshot | null;
}

interface CribbageOpenTable {
  id: string;
  hostName: string;
  stake: number;
  seatedCount: number;
  maxSeats: number;
  createdAt: string;
  mine: boolean;
}

/**
 * What a board receives. `onMove` never carries a version; this shell
 * stamps it, the same reason duel-shell.tsx's onMove does, so no board can
 * forget the concurrency guard.
 */
export interface CribbageBoardProps {
  state: CribbageSnapshot;
  yourSeat: CribbageSeat | null;
  players: CribbagePlayer[];
  busy: boolean;
  onMove: (move: unknown) => void;
}

interface LobbyResponse {
  table: CribbageTable | null;
  tables: CribbageOpenTable[];
  profile: PlayerProfile;
  error?: string;
}

export function CribbageShell({ Board }: { Board: ComponentType<CribbageBoardProps> }) {
  const [table, setTable] = useState<CribbageTable | null>(null);
  // A primitive, not `table` itself, so the realtime effect below only
  // resubscribes on join/leave -- not on every version bump a move causes.
  const tableId = table?.id ?? null;
  const [openTables, setOpenTables] = useState<CribbageOpenTable[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [stake, setStake] = useState<number>(MIN_DUEL_STAKE);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sending = useRef(false);
  const mounted = useRef(true);
  /**
   * A timestamp (Date.now()-scale) refresh-driven sync must not fire before.
   * Set by refresh() when the server answers 429, from that response's own
   * Retry-After; the backup poll and the realtime handler both check it
   * before spending a request. Same pattern duel-shell.tsx carries for its
   * own poll.
   */
  const pausedUntil = useRef(0);
  const play = useArcadeSound({ gameSounds: true });

  const applyResponse = useCallback((data: Partial<LobbyResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.tables) setOpenTables(data.tables);
    if (data.table !== undefined) {
      setTable((current) => {
        // Once a table completes, getActiveCribbageTableFor correctly stops
        // listing it as the caller's "active" table, but the player still
        // needs to see the result card until they explicitly move on
        // (Play again), which is what actually clears it below. Without
        // this, the very next poll (at most 2s later) would return `null`
        // and wipe the result screen out from under a player who is still
        // reading it.
        if (data.table === null && current?.status === "completed") return current;
        return data.table ?? null;
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/cribbage", { cache: "no-store" });
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
      // A dropped poll is not worth a banner; the next one is two seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  /** Sends an intent and takes whatever comes back as the new truth, the same "a 409 still resyncs" contract duel-shell.tsx keeps. */
  const send = useCallback(async (url: string, body: unknown) => {
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
      const data = (await response.json()) as Partial<LobbyResponse> & { round?: CribbageTable };
      if (!mounted.current) return;
      if (data.profile) setProfile(data.profile);
      if (!response.ok) {
        setError(data.error ?? "That did not go through.");
        if (data.round) setTable(data.round);
        return;
      }
      if (data.table !== undefined) setTable(data.table);
      if (data.tables) setOpenTables(data.tables);
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
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
   * Cross-browser sync: a table appearing or filling in the open list, an
   * opponent's move, a settled table. This replaces the fixed 2s poll the
   * shell used to run unconditionally -- lib/cribbage/crib-channel.ts's
   * channels carry the same invalidation-ping contract
   * lib/pvp/duel-channel.ts established for duels, fired by the
   * `broadcast_crib_signal()` trigger on every write to `cribbage_tables` or
   * `cribbage_table_players`.
   *
   * Which channel depends on which screen this is: no live table means the
   * join screen, watching the single global `crib:lobby` channel every
   * browser there shares (the open-table list has no per-viewer filter to
   * key a narrower channel on); a live table switches to that table's own
   * `crib:<tableId>`. Keyed on the table id rather than the table object
   * itself, so a move that only bumps `table.version` doesn't tear down and
   * resubscribe the channel on every poll -- the same reason
   * poker-app.tsx's channel effect depends on `gameId`, not `game`.
   *
   * No Supabase configured at all (memory-mode dev) means no channel this
   * effect can subscribe to -- same gap poker-app.tsx's own Realtime effect
   * accepts (`if (!gameId || !supabase) return;`), rather than falling back
   * to a poll. Once subscribed, a slow BACKUP_POLL_MS poll still runs
   * alongside the channel as a safety net against a socket gone quietly
   * stale without firing CHANNEL_ERROR/CLOSED -- a cribbage table has no
   * other seated human's turn-clock tick to notice for it the poker table
   * does.
   */
  useEffect(() => {
    const supabase = browserSupabase();
    if (!supabase) return;

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

    const channelName = tableId ? cribTableChannelName(tableId) : cribLobbyChannelName();
    let channel: RealtimeChannel | null = supabase
      .channel(channelName)
      .on("broadcast", { event: CRIB_STATE_CHANGED }, () => {
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
  }, [tableId, refresh]);

  const onMove = useCallback(
    (current: CribbageTable, move: unknown) => {
      if (current.status !== "active") return;
      void send(`/api/cribbage/${current.id}`, { action: "move", version: current.version, move });
    },
    [send],
  );

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;

  return (
    <main className="duel-shell crib-shell">
      <header className="floor-bar">
        <Link className="floor-back" href="/games">← Ante Up</Link>
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {!loaded ? "—" : profile?.unlimitedGold ? "Unlimited" : (profile?.goldBalance ?? 0).toLocaleString()}
          </strong>
        </span>
      </header>

      {error && (
        <div className="duel-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {table ? (
        table.status === "waiting" ? (
          <CribbageWaitingRoom
            table={table}
            busy={busy}
            onStart={() => void send(`/api/cribbage/${table.id}`, { action: "start" })}
            onLeave={() => void send(`/api/cribbage/${table.id}`, { action: "leave" })}
          />
        ) : (
          <CribbageMatchFrame
            table={table}
            busy={busy}
            Board={Board}
            play={play}
            onMove={(move) => onMove(table, move)}
            onResign={() => void send(`/api/cribbage/${table.id}`, { action: "resign" })}
            // Clears the finished table from the client only; it's already
            // settled and paid, so there's nothing left to tell the server.
            // Directly, rather than through the next poll: the server has
            // already stopped listing a completed table as "active" (that's
            // what settling means), so waiting on a poll to clear this would
            // never actually happen on its own.
            onLeave={() => setTable(null)}
          />
        )
      ) : (
        <CribbageLobby
          loaded={loaded}
          busy={busy}
          balance={balance}
          stake={stake}
          onStake={setStake}
          openTables={openTables}
          onOpen={() => void send("/api/cribbage", { stake })}
          onJoin={(id) => void send(`/api/cribbage/${id}`, { action: "join" })}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ lobby */

function CribbageLobby({
  loaded,
  busy,
  balance,
  stake,
  onStake,
  openTables,
  onOpen,
  onJoin,
}: {
  loaded: boolean;
  busy: boolean;
  balance: number;
  stake: number;
  onStake: (stake: number) => void;
  openTables: CribbageOpenTable[];
  onOpen: () => void;
  onJoin: (id: string) => void;
}) {
  const canAfford = stake >= MIN_DUEL_STAKE && balance >= stake;

  return (
    <div className="duel-lobby">
      <div className="floor-head">
        <div className="lobby-kicker">3-4 players, winner takes the pot</div>
        <h1>Cribbage</h1>
        <p>Deal, discard to the crib, peg to 31, count your hand. First to 121 wins it all.</p>
      </div>

      <section className="duel-panel">
        <h2 className="floor-section-head">Open a table</h2>
        <StakePicker ariaLabel="Stake" picks={STAKE_QUICK_PICKS} value={stake} min={MIN_DUEL_STAKE} onChange={onStake} />
        <p className="duel-pot-note">
          {stake < MIN_DUEL_STAKE
            ? `Wager at least ${MIN_DUEL_STAKE.toLocaleString()} Gold to open a table.`
            : <>Everyone seated puts up {stake.toLocaleString()}. Whoever reaches 121 first takes the whole pot.</>}
        </p>
        <button type="button" className="floor-play duel-open" disabled={busy || !loaded || !canAfford} onClick={onOpen}>
          {!loaded ? "…" : !canAfford ? "Not enough Gold" : `Open a ${stake.toLocaleString()} Gold table`}
        </button>
      </section>

      <section className="duel-panel">
        <h2 className="floor-section-head">Open tables</h2>
        {openTables.length === 0 ? (
          <p className="duel-empty">{loaded ? "No tables open right now. Open one and others can join." : "Looking…"}</p>
        ) : (
          <ul className="duel-challenge-list">
            {openTables.map((t) => (
              <li key={t.id} className="duel-challenge crib-open-table">
                <span className="duel-challenge-identity">
                  <strong>{t.hostName}&rsquo;s table</strong>
                  <small>{t.seatedCount} of {t.maxSeats} seated</small>
                </span>
                <span className="duel-challenge-stake">{t.stake.toLocaleString()}</span>
                <button
                  type="button"
                  className="floor-play"
                  disabled={busy || balance < t.stake || t.seatedCount >= t.maxSeats}
                  onClick={() => onJoin(t.id)}
                >
                  {t.seatedCount >= t.maxSeats ? "Full" : balance < t.stake ? "Low Gold" : "Join"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="duel-footnote">No house cut. Every Gold staked at this table goes to whoever wins it.</p>
    </div>
  );
}

/* ------------------------------------------------------------ waiting room */

function CribbageWaitingRoom({
  table,
  busy,
  onStart,
  onLeave,
}: {
  table: CribbageTable;
  busy: boolean;
  onStart: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="crib-waiting">
      <div className="floor-head">
        <div className="lobby-kicker">{table.stake.toLocaleString()} Gold each · pot {table.pot.toLocaleString()}</div>
        <h1>Waiting for players</h1>
        <p>
          {table.players.length} of {table.maxSeats} seated
          {table.players.length >= table.minSeatsToStart ? " — the table starts the instant it fills." : "."}
        </p>
      </div>

      <ol className="crib-seats" aria-label="Seated players">
        {Array.from({ length: table.maxSeats }, (_, seat) => {
          const player = table.players.find((p) => p.seat === seat);
          return (
            <li key={seat} className={clsx("crib-seat", !player && "crib-seat-open")}>
              {player ? (
                <>
                  <span className="duel-avatar" style={{ background: player.accent }} aria-hidden="true">
                    {player.initials}
                  </span>
                  <span className="duel-player-identity">
                    <strong>{player.displayName}</strong>
                    <small>{player.profileId === table.hostId ? "Host" : `Seat ${seat + 1}`}</small>
                  </span>
                </>
              ) : (
                <span className="crib-seat-empty">Open seat</span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="duel-controls crib-waiting-controls">
        {table.canStart && (
          <button type="button" className="floor-play" disabled={busy} onClick={onStart}>
            Start now ({table.players.length} players)
          </button>
        )}
        <button type="button" className="duel-resign" disabled={busy} onClick={onLeave}>
          Leave table
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ match */

function CribbageMatchFrame({
  table,
  busy,
  Board,
  play,
  onMove,
  onResign,
  onLeave,
}: {
  table: CribbageTable;
  busy: boolean;
  Board: ComponentType<CribbageBoardProps>;
  play: (effect: SoundEffect) => void;
  onMove: (move: unknown) => void;
  onResign: () => void;
  onLeave: () => void;
}) {
  const completed = table.status === "completed";
  const won = completed && table.winnerId !== null
    && table.players.find((p) => p.seat === table.yourSeat)?.profileId === table.winnerId;
  const winner = completed ? table.players.find((p) => p.profileId === table.winnerId) : null;

  // Same edge-triggered announcement duel-shell.tsx's own match frame makes:
  // once per table, on the edge of it actually completing, not on every poll
  // that still reports the same completed table. Silence on a loss is
  // intentional: "lose" has no asset behind it (manifest.ts's own call).
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!completed || announcedRef.current === table.id) return;
    announcedRef.current = table.id;
    play(won ? "win-modest" : "lose");
  }, [completed, won, table.id, play]);

  return (
    <div className="duel-match crib-match">
      <div className="crib-scoreline" role="list" aria-label="Scores">
        {table.players.map((player) => (
          <span
            key={player.profileId}
            className={clsx("crib-score-chip", player.seat === table.yourSeat && "crib-score-chip-you")}
            role="listitem"
          >
            <span className="duel-avatar" style={{ background: player.accent }} aria-hidden="true">
              {player.initials}
            </span>
            <strong>{table.state?.scores[player.seat] ?? 0}</strong>
          </span>
        ))}
        <span className="duel-pot">
          <Coins size={12} aria-hidden="true" />
          <strong>{table.pot.toLocaleString()}</strong>
        </span>
      </div>

      <div className="duel-board">
        {table.state && (
          <Board
            state={table.state}
            yourSeat={table.yourSeat}
            players={table.players}
            busy={busy || completed}
            onMove={onMove}
          />
        )}
      </div>

      {completed ? (
        <div className={clsx("duel-result", won && "duel-result-won")}>
          <strong>{won ? "You win" : `${winner?.displayName ?? "Someone"} wins`}</strong>
          <span className="duel-result-gold">
            {won ? `+${(table.pot - table.stake).toLocaleString()} Gold` : `−${table.stake.toLocaleString()} Gold`}
          </span>
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
