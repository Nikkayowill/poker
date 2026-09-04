"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { selectSound } from "@/lib/audio/ui-sounds";
import { isStakesTier, STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * The client half of a Sit & Go: the tier lobby, the waiting room, and the
 * poll. There is no match frame here at all, unlike components/cribbage/
 * cribbage-shell.tsx -- once a table deals, this hands the browser straight
 * to `/?table=<gameId>`, the SAME deep-link bootstrap poker-app.tsx already
 * uses for a shared table link (see its own `?table=` effect). That path
 * already carries every bit of table plumbing a Sit & Go's hands need
 * (action dispatch, the clock, sound, backstop, the works), so reusing it
 * outright is a smaller, safer surface than a second, parallel frame trying
 * to rebuild any slice of it.
 */

const POLL_MS = 2000;
const MAX_SEATS = 6;

export interface SitAndGoTable {
  id: string;
  status: "waiting" | "active" | "completed" | "cancelled";
  tier: StakesTier;
  entryFee: number;
  prizePool: number;
  hostId: string;
  seatedCount: number;
  maxSeats: number;
  yourSeat: number | null;
  isHost: boolean;
  gameId: string | null;
  winnerId: string | null;
}

export interface SitAndGoOpenTable {
  id: string;
  hostName: string;
  tier: StakesTier;
  entryFee: number;
  seatedCount: number;
  maxSeats: number;
  createdAt: string;
  mine: boolean;
}

interface LobbyResponse {
  table: SitAndGoTable | null;
  tables: SitAndGoOpenTable[];
  profile: PlayerProfile;
  error?: string;
}

export function SitAndGoShell() {
  const router = useRouter();
  const [table, setTable] = useState<SitAndGoTable | null>(null);
  const [openTables, setOpenTables] = useState<SitAndGoOpenTable[]>([]);
  // The persistent shell owns the profile now -- this screen still gets it
  // back from its own GET /api/sit-and-go response too (unchanged this
  // phase), it just writes that into the shared setter instead of a local
  // copy.
  const { profile, setProfile } = useAppShell();
  const [tier, setTier] = useState<StakesTier>(STAKES_TIERS[0]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sending = useRef(false);
  const mounted = useRef(true);
  const redirected = useRef(false);
  // Load-bearing even though its return value goes unused: this is what
  // syncs the module-level mute flag for selectSound() below, the same
  // "call it once at the route's root" contract lib/audio/ui-sounds.ts's own
  // header documents. No gameSounds priming -- this shell never plays a
  // round-outcome cue itself; gameOnSound() fires from poker-app.tsx on the
  // real edge of arriving at the dealt table, once the redirect below lands.
  useArcadeSound();

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/sit-and-go", { cache: "no-store" });
      const data = (await response.json()) as Partial<LobbyResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) {
        if (data.profile) setProfile(data.profile);
        if (data.tables) setOpenTables(data.tables);
        if (data.table !== undefined) setTable(data.table ?? null);
      }
    } catch {
      // A dropped poll is not worth a banner; the next one is two seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [setProfile]);

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
      const data = (await response.json()) as Partial<LobbyResponse>;
      if (!mounted.current) return;
      if (data.profile) setProfile(data.profile);
      if (!response.ok) {
        setError(data.error ?? "That did not go through.");
        return;
      }
      if (data.table !== undefined) setTable(data.table ?? null);
      if (data.tables) setOpenTables(data.tables);
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [setProfile]);

  // The tier picked one level up, in the main buy-in flow's own format
  // picker (BuyInModal / MobileShell) -- `?tier=<id>`, carried straight
  // through rather than asking again. A prefill only: the picker below stays
  // freely changeable. Deferred a tick so setting state isn't done straight
  // from the effect body (react-hooks/set-state-in-effect), same reasoning
  // components/pvp/duel-shell.tsx's own `?challenge=` effect gives.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("tier");
      if (isStakesTier(requested)) setTier(requested);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  // The instant the 6th seat fills, the table is active with a real gameId.
  // Edge-triggered (once per table id) so a stray extra poll after the
  // redirect has already fired can't push the same URL twice.
  useEffect(() => {
    if (table?.status !== "active" || !table.gameId || redirected.current) return;
    redirected.current = true;
    router.push(`/?table=${table.gameId}`);
  }, [table, router]);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;

  return (
    <main className="duel-shell">
      <header className="floor-bar">
        <FloorBackLink />
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {/* profile null means "we don't know yet" (still loading, or the
                fetch that would have set it failed) -- never "zero". */}
            {profile ? (profile.unlimitedGold ? "Unlimited" : profile.goldBalance.toLocaleString()) : "—"}
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
          <SitAndGoWaitingRoom
            table={table}
            busy={busy}
            onLeave={() => void send(`/api/sit-and-go/${table.id}`, { action: "leave" })}
          />
        ) : (
          <div className="duel-lobby">
            <div className="floor-head">
              <h1>Dealing you in…</h1>
              <p>The table filled -- taking you to your seat.</p>
            </div>
          </div>
        )
      ) : (
        <SitAndGoLobby
          loaded={loaded}
          busy={busy}
          balance={balance}
          tier={tier}
          onTier={setTier}
          openTables={openTables}
          onOpen={() => void send("/api/sit-and-go", { tier })}
          onJoin={(id) => void send(`/api/sit-and-go/${id}`, { action: "join" })}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ lobby */

function SitAndGoLobby({
  loaded,
  busy,
  balance,
  tier,
  onTier,
  openTables,
  onOpen,
  onJoin,
}: {
  loaded: boolean;
  busy: boolean;
  balance: number;
  tier: StakesTier;
  onTier: (tier: StakesTier) => void;
  openTables: SitAndGoOpenTable[];
  onOpen: () => void;
  onJoin: (id: string) => void;
}) {
  const entryFee = TIER_CONFIG[tier].minBuyIn;
  const canAfford = balance >= entryFee;

  return (
    <div className="duel-lobby">
      <div className="floor-head">
        <div className="lobby-kicker">6-max, winner takes the pot</div>
        <h1>Sit &amp; Go</h1>
        <p>Everyone starts even. Blinds climb every few hands. Last stack standing takes the whole table.</p>
      </div>

      <section className="duel-panel">
        <h2 className="floor-section-head">Open a table</h2>
        <div className="tier-grid">
          {STAKES_TIERS.map((candidate) => {
            const config = TIER_CONFIG[candidate];
            const affordable = balance >= config.minBuyIn;
            return (
              <button
                type="button"
                key={candidate}
                className={clsx("tier-card", tier === candidate && "selected", !affordable && "unaffordable")}
                disabled={!affordable}
                onClick={() => { selectSound(); onTier(candidate); }}
              >
                <strong>{config.label}</strong>
                <span>{config.smallBlind} / {config.bigBlind} blinds</span>
                <small>{affordable ? `${config.minBuyIn.toLocaleString()} Gold entry` : `Need ${config.minBuyIn.toLocaleString()} Gold`}</small>
              </button>
            );
          })}
        </div>
        <p className="duel-pot-note">
          Every seat pays {entryFee.toLocaleString()} Gold. The winner takes all 6:{" "}
          {(entryFee * MAX_SEATS).toLocaleString()} Gold.
        </p>
        <button type="button" className="floor-play duel-open" disabled={busy || !loaded || !canAfford} onClick={onOpen}>
          {!loaded ? "…" : !canAfford ? "Not enough Gold" : `Open a ${entryFee.toLocaleString()} Gold table`}
        </button>
        {loaded && !canAfford && <GoldShortfallHint needed={entryFee} />}
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
                  <small>{t.seatedCount} of {t.maxSeats} seated · {TIER_CONFIG[t.tier].label}</small>
                </span>
                <span className="duel-challenge-stake">{t.entryFee.toLocaleString()}</span>
                <button
                  type="button"
                  className="floor-play"
                  disabled={busy || balance < t.entryFee || t.seatedCount >= t.maxSeats}
                  onClick={() => onJoin(t.id)}
                >
                  {t.seatedCount >= t.maxSeats ? "Full" : balance < t.entryFee ? "Low Gold" : "Join"}
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

function SitAndGoWaitingRoom({
  table,
  busy,
  onLeave,
}: {
  table: SitAndGoTable;
  busy: boolean;
  onLeave: () => void;
}) {
  return (
    <div className="crib-waiting">
      <div className="floor-head">
        <div className="lobby-kicker">
          {TIER_CONFIG[table.tier].label} · {table.entryFee.toLocaleString()} Gold each · pot{" "}
          {(table.entryFee * table.maxSeats).toLocaleString()}
        </div>
        <h1>Waiting for players</h1>
        <p>{table.seatedCount} of {table.maxSeats} seated -- the table deals the instant it fills.</p>
      </div>

      <ol className="crib-seats" aria-label="Registered players">
        {Array.from({ length: table.maxSeats }, (_, seat) => {
          const filled = seat < table.seatedCount;
          const isYou = seat === table.yourSeat;
          return (
            <li key={seat} className={clsx("crib-seat", !filled && "crib-seat-open")}>
              {filled ? (
                <span className="crib-seat-empty">{isYou ? "You" : `Seat ${seat + 1}`}</span>
              ) : (
                <span className="crib-seat-empty">Open seat</span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="duel-controls crib-waiting-controls">
        <button type="button" className="duel-resign" disabled={busy} onClick={onLeave}>
          Leave table
        </button>
      </div>
    </div>
  );
}
