"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowRight,
  Camera,
  Check,
  Clock3,
  Coins,
  FoldVertical,
  LockKeyhole,
  Palette,
  RotateCcw,
  Save,
  Settings2,
  UsersRound,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { Card, GameSnapshot, PlayerAction, PublicSeat } from "@/lib/game/types";
import { avatarPresets, profileAccents } from "@/lib/profile/types";
import type { AvatarPreset, PlayerProfile } from "@/lib/profile/types";

const suitSymbols: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

type AvatarView = Pick<PlayerProfile, "displayName" | "initials" | "avatarUrl" | "avatarPreset" | "accent">;

function ProfileAvatar({
  profile,
  className,
  showTurn = false,
}: {
  profile: AvatarView;
  className?: string;
  showTurn?: boolean;
}) {
  const preset = avatarPresets.find((candidate) => candidate.id === profile.avatarPreset) ?? avatarPresets[0];
  return (
    <span
      className={clsx("profile-avatar", className, profile.avatarUrl && "has-avatar-image")}
      style={{
        "--avatar-accent": profile.accent,
        ...(profile.avatarUrl ? { backgroundImage: `url("${profile.avatarUrl}")` } : {}),
      } as React.CSSProperties}
      role="img"
      aria-label={`${profile.displayName}'s avatar`}
    >
      {!profile.avatarUrl && <span>{preset.symbol}</span>}
      {showTurn && <span className="turn-ring" />}
    </span>
  );
}

function ProfileTrigger({
  profile,
  onClick,
  compact = false,
}: {
  profile: PlayerProfile;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button className={clsx("profile-trigger", compact && "profile-trigger-compact")} onClick={onClick}>
      <ProfileAvatar profile={profile} />
      {!compact && (
        <span>
          <strong>{profile.displayName}</strong>
          <small>Profile</small>
        </span>
      )}
      <Settings2 size={14} />
    </button>
  );
}

function PlayingCard({
  card,
  small = false,
  ghost = false,
}: {
  card: Card | null;
  small?: boolean;
  ghost?: boolean;
}) {
  if (ghost) return <div className={clsx("playing-card card-ghost", small && "card-small")} />;
  if (!card) {
    return (
      <div className={clsx("playing-card card-back", small && "card-small")} aria-label="Hidden card">
        <span>RR</span>
      </div>
    );
  }
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <div
      className={clsx("playing-card", small && "card-small", red && "card-red")}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{suitSymbols[card.suit]}</span>
      <span className="card-suit-large">{suitSymbols[card.suit]}</span>
    </div>
  );
}

function PlayerSeat({ seat, placement }: { seat: PublicSeat; placement: string }) {
  const folded = seat.status === "folded" || seat.status === "out";
  return (
    <article
      className={clsx("player-seat", placement, seat.isCurrent && "seat-current", folded && "seat-muted")}
      style={{ "--seat-accent": seat.accent } as React.CSSProperties}
    >
      <div className="seat-cards">
        {seat.holeCards.map((card, index) => (
          <PlayingCard key={index} card={card} small />
        ))}
      </div>
      <div className="seat-profile">
        <ProfileAvatar
          className="seat-avatar"
          profile={{
            displayName: seat.name,
            initials: seat.initials,
            avatarUrl: seat.avatarUrl,
            avatarPreset: seat.avatarPreset as AvatarPreset,
            accent: seat.accent,
          }}
          showTurn={seat.isCurrent}
        />
        <div className="seat-copy">
          <div className="seat-name-row">
            <strong>{seat.name}</strong>
            {!seat.isHuman && <span className="ai-badge">AI</span>}
            {seat.isMine && <span className="you-chip">You</span>}
            {seat.isDealer && <span className="dealer-chip">D</span>}
            {seat.isSmallBlind && <span className="blind-label">SB</span>}
            {seat.isBigBlind && <span className="blind-label">BB</span>}
          </div>
          <span className="seat-stack">
            <span className="chip-dot" /> {seat.stack.toLocaleString()}
          </span>
        </div>
      </div>
      {seat.lastAction && <span className="action-pill">{seat.lastAction}</span>}
      {seat.status === "folded" && <span className="status-pill">Folded</span>}
      {seat.status === "all-in" && <span className="status-pill all-in">All in</span>}
      {seat.streetBet > 0 && <span className="table-bet">{seat.streetBet}</span>}
    </article>
  );
}

function Lobby({ profile, onQuickPlay, onHostPrivate, onJoinCode, loading, error, onCustomize }: {
  profile: PlayerProfile | null;
  onQuickPlay: (name: string) => void;
  onHostPrivate: (name: string) => void;
  onJoinCode: (name: string, code: string) => void;
  loading: boolean;
  error: string | null;
  onCustomize: () => void;
}) {
  const [name, setName] = useState(profile?.displayName ?? "");
  const [joinCode, setJoinCode] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onQuickPlay(name.trim() || "You");
  };
  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.trim().length === 6) onJoinCode(name.trim() || "You", joinCode.trim());
  };
  return (
    <main className="lobby">
      <section className="hero">
        <div className="lobby-kicker">River Room · 4-max</div>
        <h1>No-limit Hold’em.<br /><em>Nothing extra.</em></h1>
        <p>
          Buy in for 1,000 chips, take a seat, and play. Start a quick table
          or open a private room for friends.
        </p>
        <form className="start-form" onSubmit={submit}>
          <div className="form-label-row">
            <label htmlFor="player-name">Player name</label>
            {profile && <button type="button" onClick={onCustomize}>Edit profile</button>}
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
            <button type="submit" className="primary-action" disabled={loading}>
              {loading ? "Opening table…" : <>Quick play <ArrowRight size={17} /></>}
            </button>
            <button type="button" className="secondary-action" disabled={loading} onClick={() => onHostPrivate(name.trim() || "You")}>
              <UsersRound size={15} /> Private table
            </button>
          </div>
          {error && <p className="form-error"><X size={14} /> {error}</p>}
        </form>
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
            <button type="submit" disabled={loading || joinCode.trim().length !== 6}>Join</button>
          </div>
        </form>
        <div className="table-facts" aria-label="Table details">
          <span><strong>4</strong> seats</span>
          <span><strong>10 / 20</strong> blinds</span>
          <span><strong>1,000</strong> buy-in</span>
        </div>
      </section>
      <aside className="lobby-preview">
        <div className="preview-heading">
          <span>Table preview</span>
          <span>No limit · 4-max</span>
        </div>
        <div className="mini-table">
          <span className="mini-seat mini-top">MA</span>
          <span className="mini-seat mini-left">TH</span>
          <span className="mini-seat mini-right">RV</span>
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
      </aside>
    </main>
  );
}

function ProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: PlayerProfile;
  onClose: () => void;
  onSaved: (profile: PlayerProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [avatarPreset, setAvatarPreset] = useState<AvatarPreset>(profile.avatarPreset);
  const [accent, setAccent] = useState(profile.accent);
  const [previewUrl, setPreviewUrl] = useState<string | null>(profile.avatarUrl);
  const [usingUpload, setUsingUpload] = useState(Boolean(profile.avatarUrl));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const preview: AvatarView = {
    displayName: displayName || "Player",
    initials: (displayName || "P").slice(0, 2).toUpperCase(),
    avatarUrl: usingUpload ? previewUrl : null,
    avatarPreset,
    accent,
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          avatarPreset,
          accent,
          clearUpload: !usingUpload,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save your profile.");
      onSaved(data.profile);
      setMessage("Profile saved");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("avatar", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not upload that image.");
      setPreviewUrl(data.profile.avatarUrl);
      setUsingUpload(true);
      onSaved(data.profile);
      setMessage("Photo uploaded");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not upload that image.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header className="profile-modal-header">
          <div>
            <span>PROFILE</span>
            <h2 id="profile-title">Edit player details</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close profile editor"><X size={18} /></button>
        </header>
        <form onSubmit={save}>
          <div className="profile-preview">
            <div className="avatar-stage">
              <ProfileAvatar profile={preview} />
              <label className="camera-button">
                <Camera size={15} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={upload}
                  disabled={uploading}
                />
              </label>
            </div>
            <div>
              <strong>{displayName || "Player"}</strong>
              <span>{usingUpload ? "Personal photo" : avatarPresets.find((preset) => preset.id === avatarPreset)?.label}</span>
              <label className="upload-button">
                <Upload size={13} /> {uploading ? "Uploading…" : "Upload photo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={upload}
                  disabled={uploading}
                />
              </label>
              <small>PNG, JPEG, WebP or GIF · 2 MB max</small>
            </div>
          </div>

          <div className="profile-field">
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              value={displayName}
              maxLength={18}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              required
            />
            <span>{displayName.length}/18</span>
          </div>

          <fieldset className="preset-fieldset">
            <legend>Choose an avatar</legend>
            <div className="preset-grid">
              {avatarPresets.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className={clsx(avatarPreset === preset.id && !usingUpload && "selected")}
                  onClick={() => {
                    setAvatarPreset(preset.id);
                    setUsingUpload(false);
                  }}
                  aria-label={preset.label}
                >
                  <span>{preset.symbol}</span>
                  <small>{preset.label}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="accent-fieldset">
            <legend><Palette size={13} /> Table color</legend>
            <div className="accent-row">
              {profileAccents.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={accent === color ? "selected" : ""}
                  style={{ "--swatch": color } as React.CSSProperties}
                  onClick={() => setAccent(color)}
                  aria-label={`Use color ${color}`}
                />
              ))}
            </div>
          </fieldset>

          <footer className="profile-modal-footer">
            <span className={message?.includes("saved") || message?.includes("uploaded") ? "success-message" : ""}>
              {message}
            </span>
            <button className="primary-action" type="submit" disabled={saving || uploading}>
              <Save size={15} /> {saving ? "Saving…" : "Save profile"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ActionBar({
  game,
  pending,
  onAction,
}: {
  game: GameSnapshot;
  pending: boolean;
  onAction: (action: PlayerAction) => void;
}) {
  const legal = game.legalActions;
  const [raiseTo, setRaiseTo] = useState(legal?.minRaiseTo ?? 0);

  if (game.status === "complete") {
    return (
      <div className="action-bar hand-complete">
        <div>
          <span className="action-kicker">Hand complete</span>
          <strong>{game.message}</strong>
        </div>
        <button className="primary-action" disabled={pending} onClick={() => onAction({ type: "next-hand" })}>
          <RotateCcw size={16} /> Deal next hand
        </button>
      </div>
    );
  }

  if (!legal) {
    return (
      <div className="action-bar waiting-bar">
        <span className="waiting-dot" />
        <span>Waiting for the next action</span>
      </div>
    );
  }

  return (
    <div className="action-bar">
      <div className="basic-actions">
        {legal.canFold && (
          <button disabled={pending} onClick={() => onAction({ type: "fold" })}>
            <FoldVertical size={16} /> Fold
          </button>
        )}
        {legal.canCheck && (
          <button disabled={pending} onClick={() => onAction({ type: "check" })}>
            <Check size={17} /> Check
          </button>
        )}
        {legal.canCall && (
          <button disabled={pending} onClick={() => onAction({ type: "call" })}>
            Call <strong>{legal.callAmount}</strong>
          </button>
        )}
      </div>
      {legal.canRaise && (
        <div className="raise-control">
          <div className="range-row">
            <span>Raise to</span>
            <strong>{raiseTo}</strong>
          </div>
          <input
            aria-label="Raise amount"
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={game.bigBlind}
            value={raiseTo}
            onChange={(event) => setRaiseTo(Number(event.target.value))}
          />
          <div className="raise-buttons">
            <button onClick={() => setRaiseTo(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, game.pot)))}>Pot</button>
            <button onClick={() => setRaiseTo(legal.maxRaiseTo)}>Max</button>
          </div>
        </div>
      )}
      <div className="commit-actions">
        {legal.canRaise && (
          <button className="primary-action" disabled={pending} onClick={() => onAction({ type: "raise", amount: raiseTo })}>
            Raise <span>{raiseTo}</span>
          </button>
        )}
        {legal.canAllIn && (
          <button className="allin-action" disabled={pending} onClick={() => onAction({ type: "all-in" })}>
            All in
          </button>
        )}
      </div>
    </div>
  );
}

function RoomCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const link = `${window.location.origin}/?code=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied by browser policy; the code is still visible to copy by hand.
    }
  };
  return (
    <button type="button" className="room-code-chip" onClick={copy}>
      <LockKeyhole size={12} /> Code {code} <span>{copied ? "Copied!" : "Copy invite"}</span>
    </button>
  );
}

function PokerTable({
  game,
  persistence,
  pending,
  error,
  onAction,
  onLeave,
  onLeaveSeat,
  profile,
  onCustomize,
}: {
  game: GameSnapshot;
  persistence: string;
  pending: boolean;
  error: string | null;
  onAction: (action: PlayerAction) => void;
  onLeave: () => void;
  onLeaveSeat: () => void;
  profile: PlayerProfile | null;
  onCustomize: () => void;
}) {
  const placements = ["seat-bottom", "seat-left", "seat-top", "seat-right"];
  const mySeatIndex = game.seats.findIndex((seat) => seat.isMine);
  const orderedSeats = mySeatIndex <= 0
    ? game.seats
    : game.seats.map((_, index) => game.seats[(mySeatIndex + index) % game.seats.length]);
  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="wordmark" onClick={onLeave} aria-label="Leave table">
          <span className="mark">R</span>
          <span>River Room<small>NO LIMIT HOLD’EM</small></span>
        </button>
        <div className="table-meta">
          <span><span className={clsx("live-dot", persistence === "memory" && "demo-dot")} />{persistence === "supabase" ? "Realtime" : "Demo table"}</span>
          {game.isPrivate && game.roomCode
            ? <RoomCodeChip code={game.roomCode} />
            : <span>Table {game.id.slice(0, 6).toUpperCase()}</span>}
          <span>Blinds {game.smallBlind}/{game.bigBlind}</span>
        </div>
        <div className="game-header-actions">
          {profile && <ProfileTrigger profile={profile} onClick={onCustomize} compact />}
          {game.isSeated && (
            <button className="give-up-seat-button" onClick={onLeaveSeat} title="Give up your seat; a bot takes over">
              Give up seat
            </button>
          )}
          <button className="leave-button" onClick={onLeave}>Leave table</button>
        </div>
      </header>

      <section className="game-content">
        <div className="table-area">
          <div className="poker-table-wrap">
            <div className="poker-rail">
              <div className="poker-felt">
                <div className="felt-texture" />
                <div className="pot-display">
                  <span>MAIN POT</span>
                  <strong><span className="chip-stack-icon" />{game.pot.toLocaleString()}</strong>
                </div>
                <div className="community-cards">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <PlayingCard
                      key={index}
                      card={game.community[index] ?? null}
                      ghost={!game.community[index]}
                    />
                  ))}
                </div>
                <span className="street-label">{game.street}</span>
              </div>
            </div>
            {orderedSeats.map((seat, index) => (
              <PlayerSeat key={seat.id} seat={seat} placement={placements[index]} />
            ))}
          </div>

          {error && <div className="table-toast"><X size={15} /> {error}</div>}
          <ActionBar key={game.version} game={game} pending={pending} onAction={onAction} />
        </div>

        <aside className="hand-panel">
          <div className="panel-heading">
            <div>
              <span>TABLE ACTIVITY</span>
              <strong>Hand #{game.handNumber}</strong>
            </div>
            <Clock3 size={17} />
          </div>
          <div className="activity-list">
            {game.log.map((entry) => (
              <div className={clsx("activity-item", `activity-${entry.kind}`)} key={entry.id}>
                <span className="activity-icon">{entry.kind === "win" ? "♛" : entry.kind === "deal" ? "◆" : "•"}</span>
                <div>
                  <p>{entry.text}</p>
                  <time>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
              </div>
            ))}
          </div>
          <div className="panel-footnote">Deck and hole cards secured server-side</div>
        </aside>
      </section>
    </main>
  );
}

export function PokerApp() {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [persistence, setPersistence] = useState("memory");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameId = game?.id;

  const loadProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load your profile.");
    setProfile(data.profile);
    setPersistence(data.persistence);
  }, []);

  const ingest = useCallback((data: { game: GameSnapshot; persistence: string }) => {
    setGame(data.game);
    setPersistence(data.persistence);
    setError(null);
  }, []);

  const refresh = useCallback(async (id: string) => {
    const response = await fetch(`/api/games/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not refresh the table.");
    ingest(data);
  }, [ingest]);

  const joinByCode = useCallback(async (code: string, name?: string) => {
    const response = await fetch("/api/games/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not join that table.");
    ingest(data);
    window.history.replaceState({}, "", `/?table=${data.game.id}`);
  }, [ingest]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tableId = params.get("table");
    const code = params.get("code");
    if (!tableId && !code) return;
    const timer = window.setTimeout(() => {
      const opened = tableId ? refresh(tableId) : joinByCode(code!);
      void opened.catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not open that table.");
        window.history.replaceState({}, "", "/");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh, joinByCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not load your profile.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!gameId || !url || !key) return;
    const supabase = createClient(url, key);
    let channel: RealtimeChannel | null = supabase
      .channel(`table:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_signals", filter: `game_id=eq.${gameId}` },
        () => void refresh(gameId),
      )
      .subscribe();
    return () => {
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [gameId, refresh]);

  // A fallback poll: keeps demo/memory mode (no Realtime) live, and is what
  // actually surfaces an idle-turn auto-fold/check to a player who is
  // waiting on someone else and has no other reason to re-fetch.
  useEffect(() => {
    if (!gameId) return;
    const interval = window.setInterval(() => void refresh(gameId), 5000);
    return () => window.clearInterval(interval);
  }, [gameId, refresh]);

  const quickPlay = async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/games/quick-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not find you a table.");
      ingest(data);
      window.history.pushState({}, "", `/?table=${data.game.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not find you a table.");
    } finally {
      setLoading(false);
    }
  };

  const hostPrivate = async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, isPrivate: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not host a table.");
      ingest(data);
      window.history.pushState({}, "", `/?table=${data.game.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not host a table.");
    } finally {
      setLoading(false);
    }
  };

  const joinWithCode = async (name: string, code: string) => {
    setLoading(true);
    setError(null);
    try {
      await joinByCode(code, name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join that table.");
    } finally {
      setLoading(false);
    }
  };

  const act = async (action: PlayerAction) => {
    if (!game || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "That action was not accepted.");
      ingest(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That action was not accepted.");
    } finally {
      setLoading(false);
    }
  };

  const leave = () => {
    setGame(null);
    setError(null);
    window.history.replaceState({}, "", "/");
  };

  const leaveSeat = async () => {
    if (!game) return;
    setLoading(true);
    try {
      await fetch(`/api/games/${game.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "leave-seat" }),
      });
    } catch {
      // Best effort: the seat still reverts to a bot server-side even if this
      // client never hears back, so there's nothing useful to show here.
    } finally {
      setLoading(false);
      leave();
    }
  };

  return (
    <div className="app-root">
      {!game && (
        <header className="lobby-header">
          <div className="wordmark">
            <span className="mark">R</span>
            <span>River Room<small>NO LIMIT HOLD’EM</small></span>
          </div>
          <div className="header-actions">
            <div className="header-status">No-limit Hold’em · 4-max</div>
            {profile && <ProfileTrigger profile={profile} onClick={() => setProfileOpen(true)} />}
          </div>
        </header>
      )}
      {game
        ? (
          <PokerTable
            game={game}
            persistence={persistence}
            pending={loading}
            error={error}
            onAction={act}
            onLeave={leave}
            onLeaveSeat={leaveSeat}
            profile={profile}
            onCustomize={() => setProfileOpen(true)}
          />
        )
        : (
          <Lobby
            key={profile?.updatedAt ?? "guest"}
            profile={profile}
            onQuickPlay={quickPlay}
            onHostPrivate={hostPrivate}
            onJoinCode={joinWithCode}
            loading={loading}
            error={error}
            onCustomize={() => setProfileOpen(true)}
          />
        )}
      {profileOpen && profile && (
        <ProfileModal
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={setProfile}
        />
      )}
    </div>
  );
}
