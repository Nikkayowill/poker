"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { CHEAPEST_TIER, isStakesTier, STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * The client half of heads-up poker: the lobby (quick play, invites), the
 * waiting room, and the poll. There is no match frame here at all -- the
 * instant a table deals (table.gameId is set), this redirects to
 * `/?table=<gameId>` and PokerApp takes over from its own existing
 * `?table=` deep-link bootstrap, the same way every other private-table
 * flow in this app works. Modeled on components/cribbage/cribbage-shell.tsx,
 * simplified for exactly two seats and no browsable open-table list --
 * heads-up is quick-play-or-invite, never pick-a-table-off-a-list.
 */

const POLL_MS = 2000;

interface HeadsUpPlayer {
  profileId: string;
  seat: 0 | 1;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
}

export interface HeadsUpTable {
  id: string;
  status: "waiting" | "active" | "completed" | "cancelled";
  version: number;
  tier: StakesTier;
  stake: number;
  pot: number;
  hostId: string;
  yourSeat: 0 | 1 | null;
  isHost: boolean;
  players: HeadsUpPlayer[];
  winnerId: string | null;
  gameId: string | null;
}

interface LobbyResponse {
  table: HeadsUpTable | null;
  invites: HeadsUpTable[];
  profile: PlayerProfile;
  error?: string;
}

export function HeadsUpShell() {
  const router = useRouter();
  const [table, setTable] = useState<HeadsUpTable | null>(null);
  const [invites, setInvites] = useState<HeadsUpTable[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [tier, setTier] = useState<StakesTier>(CHEAPEST_TIER);
  const [inviteTarget, setInviteTarget] = useState<{ id: string; name: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sending = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/heads-up", { cache: "no-store" });
      const data = (await response.json()) as Partial<LobbyResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) {
        if (data.profile) setProfile(data.profile);
        if (data.table !== undefined) setTable(data.table ?? null);
        if (data.invites) setInvites(data.invites);
      }
    } catch {
      // A dropped poll is not worth a banner; the next one is two seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, []);

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
      if (data.invites) setInvites(data.invites);
    } catch {
      if (mounted.current) setError("Could not reach the match. Check your connection.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  // The friend this lobby was opened to invite, from the friends drawer's
  // own picker (`?invite=<profileId>&name=<displayName>`) -- a prefill only,
  // same contract components/pvp/duel-shell.tsx's own `?challenge=` reads.
  // Deferred a tick so setting state isn't done straight from the effect
  // body (react-hooks/set-state-in-effect), same reasoning duel-shell.tsx
  // gives for its own identical effect.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("invite");
      const name = params.get("name");
      if (id) setInviteTarget({ id, name: name || "your friend" });
      // The tier picked one level up, in the main buy-in flow's own format
      // picker (BuyInModal / MobileShell) -- carried through rather than
      // asking again. A prefill only: the picker below stays freely
      // changeable.
      const requestedTier = params.get("tier");
      if (isStakesTier(requestedTier)) setTier(requestedTier);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const poll = () => {
      if (!document.hidden) void refresh();
    };
    const first = window.setTimeout(poll, 0);
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  // The whole reason this shell exists: the instant the match deals, hand
  // off to the real table. No in-shell match frame at all.
  useEffect(() => {
    if (table?.gameId) router.push(`/?table=${table.gameId}`);
  }, [table?.gameId, router]);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;

  return (
    <main className="duel-shell">
      <header className="floor-bar">
        <FloorBackLink />
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

      {table && table.status === "waiting" ? (
        <HeadsUpWaitingRoom
          table={table}
          busy={busy}
          onLeave={() => { tapSound(); void send(`/api/heads-up/${table.id}`, { action: "leave" }); }}
        />
      ) : (
        <HeadsUpLobby
          loaded={loaded}
          busy={busy}
          balance={balance}
          tier={tier}
          onTier={setTier}
          invites={invites}
          inviteTarget={inviteTarget}
          onQuickPlay={() => { selectSound(); void send("/api/heads-up", { action: "quick-play", tier }); }}
          onInviteFriend={() => {
            if (!inviteTarget) return;
            selectSound();
            void send("/api/heads-up", { action: "invite", tier, friendProfileId: inviteTarget.id });
          }}
          onAcceptInvite={(id) => { selectSound(); void send(`/api/heads-up/${id}`, { action: "join" }); }}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ lobby */

function HeadsUpLobby({
  loaded,
  busy,
  balance,
  tier,
  onTier,
  invites,
  inviteTarget,
  onQuickPlay,
  onInviteFriend,
  onAcceptInvite,
}: {
  loaded: boolean;
  busy: boolean;
  balance: number;
  tier: StakesTier;
  onTier: (tier: StakesTier) => void;
  invites: HeadsUpTable[];
  inviteTarget: { id: string; name: string } | null;
  onQuickPlay: () => void;
  onInviteFriend: () => void;
  onAcceptInvite: (id: string) => void;
}) {
  const config = TIER_CONFIG[tier];
  const canAfford = balance >= config.minBuyIn;

  return (
    <div className="duel-lobby">
      <div className="floor-head">
        <div className="lobby-kicker">Heads-up · winner takes both stacks</div>
        <h1>Heads-Up Poker</h1>
        <p>You against one opponent, hand after hand, until someone busts. No rebuys, no bots.</p>
      </div>

      {invites.length > 0 && (
        <section className="duel-panel">
          <h2 className="floor-section-head">Invited to play</h2>
          <ul className="duel-challenge-list">
            {invites.map((invite) => {
              const host = invite.players.find((p) => p.profileId === invite.hostId);
              return (
                <li key={invite.id} className="duel-challenge">
                  <span className="duel-avatar" style={{ background: host?.accent ?? "var(--gold-light)" }} aria-hidden="true">
                    {host?.initials ?? "??"}
                  </span>
                  <span className="duel-challenge-identity">
                    <strong>{host?.displayName ?? "A friend"}</strong>
                    <small>{invite.stake.toLocaleString()} Gold · {TIER_CONFIG[invite.tier].label}</small>
                  </span>
                  <button
                    type="button"
                    className="floor-play"
                    disabled={busy || balance < invite.stake}
                    onClick={() => onAcceptInvite(invite.id)}
                  >
                    {balance < invite.stake ? "Low Gold" : "Play"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="duel-panel">
        <h2 className="floor-section-head">Choose stakes</h2>
        <div className="tier-grid">
          {STAKES_TIERS.map((candidate) => {
            const candidateConfig = TIER_CONFIG[candidate];
            const affordable = balance >= candidateConfig.minBuyIn;
            return (
              <button
                type="button"
                key={candidate}
                className={clsx("tier-card", tier === candidate && "selected", !affordable && "unaffordable")}
                disabled={!affordable}
                onClick={() => { selectSound(); onTier(candidate); }}
              >
                <strong>{candidateConfig.label}</strong>
                <span>{candidateConfig.smallBlind} / {candidateConfig.bigBlind} blinds</span>
                <small>
                  {affordable
                    ? `${candidateConfig.minBuyIn.toLocaleString()} Gold entry`
                    : `Need ${candidateConfig.minBuyIn.toLocaleString()} Gold`}
                </small>
              </button>
            );
          })}
        </div>

        {inviteTarget ? (
          <>
            <p className="duel-pot-note">
              Inviting <strong>{inviteTarget.name}</strong> — you each stake {config.minBuyIn.toLocaleString()} Gold.
            </p>
            <button type="button" className="floor-play duel-open" disabled={busy || !loaded || !canAfford} onClick={onInviteFriend}>
              {!loaded ? "…" : !canAfford ? "Not enough Gold" : `Invite ${inviteTarget.name}`}
            </button>
            {loaded && !canAfford && <GoldShortfallHint needed={config.minBuyIn} />}
          </>
        ) : (
          <>
            <p className="duel-pot-note">
              {canAfford
                ? <>You each stake {config.minBuyIn.toLocaleString()} Gold. Winner takes the full {(config.minBuyIn * 2).toLocaleString()}.</>
                : `You need ${config.minBuyIn.toLocaleString()} Gold to play this tier.`}
            </p>
            <button type="button" className="floor-play duel-open" disabled={busy || !loaded || !canAfford} onClick={onQuickPlay}>
              {!loaded ? "…" : !canAfford ? "Not enough Gold" : "Quick Play"}
            </button>
            {loaded && !canAfford && <GoldShortfallHint needed={config.minBuyIn} />}
          </>
        )}
      </section>

      <p className="duel-footnote">No house cut. Every Gold staked goes to whoever wins the match.</p>
    </div>
  );
}

/* ------------------------------------------------------------ waiting room */

function HeadsUpWaitingRoom({
  table,
  busy,
  onLeave,
}: {
  table: HeadsUpTable;
  busy: boolean;
  onLeave: () => void;
}) {
  return (
    <div className="crib-waiting">
      <div className="floor-head">
        <div className="lobby-kicker">{table.stake.toLocaleString()} Gold each · pot {table.pot.toLocaleString()}</div>
        <h1>Waiting for an opponent</h1>
        <p>{table.players.length} of 2 seated — the match deals the instant the seat fills.</p>
      </div>

      <ol className="crib-seats" aria-label="Seated players">
        {[0, 1].map((seat) => {
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
                    <small>{player.profileId === table.hostId ? "Host" : "Opponent"}</small>
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
        <button type="button" className="duel-resign" disabled={busy} onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
