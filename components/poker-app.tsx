"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowRight,
  Camera,
  Check,
  Coins,
  FoldVertical,
  History,
  LockKeyhole,
  Palette,
  RotateCcw,
  Save,
  Settings2,
  TimerReset,
  UsersRound,
  Upload,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ChangeEvent, FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import Image from "next/image";
import type { Card, GameSnapshot, PlayerAction, PublicSeat, Winner } from "@/lib/game/types";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { accountsEnabled, authClient } from "@/lib/auth/client";
import { avatarFace, avatarFigure, cosmeticById } from "@/lib/cosmetics/catalog";
import {
  atmosphere,
  FIRST_PERSON_SCALE,
  radiiForWidth,
  seatGeometry,
  seatZ,
} from "@/lib/game/table-geometry";
import { profileAccents } from "@/lib/profile/types";
import type { AvatarPreset, PlayerProfile } from "@/lib/profile/types";
import { playSound, setSoundEnabled } from "@/lib/audio/sound-effects";

const SOUND_STORAGE_KEY = "river-room:sound-enabled";

const suitPaths: Record<Exclude<Card["suit"], "clubs">, string> = {
  hearts:
    "M16 28.5C16 28.5 3 19.6 3 11.2C3 6.2 6.8 3 11 3C13.6 3 15.6 4.4 16 6.6C16.4 4.4 18.4 3 21 3C25.2 3 29 6.2 29 11.2C29 19.6 16 28.5 16 28.5Z",
  diamonds: "M16 2L29 16L16 30L3 16Z",
  spades:
    "M16 3C16 3 29 13.4 29 20.4C29 24.6 25.6 27 22.2 27C19.9 27 17.9 25.8 17 24C17.4 26.6 18.8 28.6 21 30H11C13.2 28.6 14.6 26.6 15 24C14.1 25.8 12.1 27 9.8 27C6.4 27 3 24.6 3 20.4C3 13.4 16 3 16 3Z",
};

function SuitGlyph({ suit }: { suit: Card["suit"] }) {
  if (suit === "clubs") {
    return (
      <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
        <circle cx="16" cy="10.5" r="6.6" />
        <circle cx="9.8" cy="19" r="6.6" />
        <circle cx="22.2" cy="19" r="6.6" />
        <path d="M13.6 20.5H18.4L21 29.5H11Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d={suitPaths[suit]} />
    </svg>
  );
}

const spokenRanks: Record<Card["rank"], string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  "10": "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

type AvatarView = Pick<PlayerProfile, "displayName" | "initials" | "avatarUrl" | "avatarPreset" | "accent">
  & { avatarCosmetic: string };

/** Artwork paths that 404'd this session, so we stop asking for them. */
const missingArtwork = new Set<string>();

function ProfileAvatar({
  profile,
  className,
  showTurn = false,
}: {
  profile: AvatarView;
  className?: string;
  showTurn?: boolean;
}) {
  const [, forceRerender] = useState(0);
  // The head crop, not the figure: this is always drawn as a small circle.
  const declared = cosmeticById(profile.avatarCosmetic) ? avatarFace(profile.avatarCosmetic) : null;
  // Six seats can wear the same avatar, so remember a missing file once
  // rather than firing a failed request per seat, per render.
  const artwork = declared && !missingArtwork.has(declared) ? declared : null;
  return (
    <span
      className={clsx(
        "profile-avatar",
        className,
        profile.avatarUrl ? "has-avatar-image" : "has-avatar-figure",
      )}
      style={{
        "--avatar-accent": profile.accent,
        ...(profile.avatarUrl ? { backgroundImage: `url("${profile.avatarUrl}")` } : {}),
      } as React.CSSProperties}
      role="img"
      aria-label={`${profile.displayName}'s avatar`}
    >
      {/* An uploaded photo wins outright. Otherwise the monogram is always
          rendered underneath and the artwork lays over it, so a file that is
          missing, still loading, or slow never leaves an empty disc where a
          player should be -- no dependency on an error firing in time. */}
      {!profile.avatarUrl && (
        <>
          <span className="avatar-initials">{profile.initials}</span>
          {artwork && (
            <Image
              src={artwork}
              alt=""
              fill
              sizes="72px"
              className="avatar-art"
              onError={() => {
                missingArtwork.add(artwork);
                forceRerender((n) => n + 1);
              }}
            />
          )}
        </>
      )}
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
      <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />
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

function isSameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function GoldBadge({
  profile,
  onClaimed,
}: {
  profile: PlayerProfile;
  onClaimed: (profile: PlayerProfile) => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);
  const canClaim = !profile.lastDailyClaimAt || !isSameUtcDay(new Date(profile.lastDailyClaimAt), new Date());

  const claim = async () => {
    if (claiming || !canClaim) return;
    setClaiming(true);
    try {
      const response = await fetch("/api/profile/gold/claim", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not claim your daily Gold.");
      onClaimed(data.profile);
      setJustClaimed(true);
      window.setTimeout(() => setJustClaimed(false), 900);
    } catch {
      // Best-effort: the button simply stays available so they can try again.
    } finally {
      setClaiming(false);
    }
  };

  // An unlimited profile is never charged and never credited, so a running
  // total would be a number that never means anything -- and a daily claim
  // would top up a balance that is already irrelevant.
  if (profile.unlimitedGold) {
    return (
      <div className="gold-badge">
        <span className="gold-balance">
          <Coins size={14} />
          <span>Gold: </span>
          <strong title="This profile plays for free">Unlimited</strong>
        </span>
      </div>
    );
  }

  return (
    <div className={clsx("gold-badge", justClaimed && "gold-badge-claimed")}>
      <span className="gold-balance">
        <Coins size={14} />
        <span>Gold: </span>
        <strong>{(profile.goldBalance ?? 0).toLocaleString()}</strong>
      </span>
      <button
        type="button"
        className="gold-claim-button"
        disabled={!profile.isRegistered || !canClaim || claiming}
        title={profile.isRegistered ? undefined : "Save your progress to unlock the daily reward"}
        onClick={claim}
      >
        {!profile.isRegistered
          ? "Save to claim"
          : canClaim ? "Claim daily Gold" : "Claimed today"}
      </button>
    </div>
  );
}

function PlayingCard({
  card,
  small = false,
  large = false,
  ghost = false,
}: {
  card: Card | null;
  small?: boolean;
  large?: boolean;
  ghost?: boolean;
}) {
  const sizeClass = large ? "card-large" : small ? "card-small" : null;
  if (ghost) return <div className={clsx("playing-card card-ghost", sizeClass)} />;
  if (!card) {
    return (
      <div className={clsx("playing-card card-back", sizeClass)} aria-label="Hidden card">
        <span className="card-back-emblem">
          <span>R</span>
        </span>
      </div>
    );
  }
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <div
      className={clsx("playing-card", sizeClass, red && "card-red")}
      aria-label={`${spokenRanks[card.rank]} of ${card.suit}`}
    >
      <span className="card-index card-index-top">
        <span className="card-index-rank">{card.rank}</span>
        <span className="card-index-glyph"><SuitGlyph suit={card.suit} /></span>
      </span>
      <span className="card-suit-large"><SuitGlyph suit={card.suit} /></span>
      <span className="card-index card-index-bottom">
        <span className="card-index-rank">{card.rank}</span>
        <span className="card-index-glyph"><SuitGlyph suit={card.suit} /></span>
      </span>
    </div>
  );
}

/**
 * A player at the table, drawn as the whole cut-out figure rather than a disc.
 *
 * This is what the artwork is for: half-body, hands on a rail. A circular crop
 * throws away the posture and the hands and leaves a headshot that could
 * belong to any product. Sitting the figure at the seat, with the table's own
 * rail crossing it at the elbows, is the entire difference between a board
 * game with portraits on it and a room with people in it.
 */
function SeatFigure({ seat, active }: { seat: PublicSeat; active: boolean }) {
  const [, forceRerender] = useState(0);
  const declared = seat.avatarCosmetic ? avatarFigure(seat.avatarCosmetic) : null;
  const artwork = declared && !missingArtwork.has(declared) ? declared : null;

  return (
    <div className={clsx("seat-figure", active && "seat-figure-active")}>
      {/* An uploaded photo has no cut-out to stand up, so it stays a disc
          where the head would be rather than being stretched into a body. */}
      {seat.avatarUrl
        ? (
          <span
            className="seat-figure-photo"
            style={{ backgroundImage: `url("${seat.avatarUrl}")` }}
            role="img"
            aria-label={`${seat.name}'s avatar`}
          />
        )
        : (
          <>
            {/* The monogram sits underneath and the figure lays over it, so a
                file that is missing or still loading never leaves a hole where
                a player should be. */}
            <span className="seat-figure-fallback" aria-hidden={artwork ? "true" : undefined}>
              {seat.initials}
            </span>
            {artwork && (
              <Image
                src={artwork}
                alt=""
                fill
                sizes="180px"
                className="seat-figure-art"
                onError={() => {
                  missingArtwork.add(artwork);
                  forceRerender((n) => n + 1);
                }}
              />
            )}
          </>
        )}
    </div>
  );
}

const PlayerSeat = memo(function PlayerSeat({
  seat,
  placement,
  handNumber,
  secondsRemaining,
  winAmount,
  elementRef,
  seatStyle,
}: {
  seat: PublicSeat;
  placement: string;
  handNumber: number;
  secondsRemaining: number;
  winAmount?: number;
  elementRef?: (el: HTMLElement | null) => void;
  /** Computed ellipse position, perspective scale and stacking order. */
  seatStyle?: React.CSSProperties;
}) {
  const folded = seat.status === "folded" || seat.status === "out";
  const isWinner = winAmount !== undefined;
  return (
    <article
      ref={elementRef}
      className={clsx(
        "player-seat",
        placement,
        seat.isCurrent && "seat-current",
        seat.isSmallBlind && "seat-small-blind",
        seat.isBigBlind && "seat-big-blind",
        folded && "seat-muted",
        isWinner && "seat-winner",
      )}
      style={{ "--seat-accent": seat.accent, ...seatStyle } as React.CSSProperties}
    >
      {isWinner && (
        <span className="winner-badge" aria-label={`${seat.name} won the hand`}>
          <span aria-hidden="true">♛</span> Winner
        </span>
      )}
      <div className={clsx("seat-cards", seat.isMine && "own-cards", isWinner && "winning-cards")}>
        {/* Once folded, this seat's cards live only in the transient
            MuckDrift overlay (see PokerTable) -- not here -- so they read as
            having actually left the table instead of sitting dimmed at the
            seat for the rest of the hand. */}
        {!folded && seat.holeCards.map((card, index) => (
          <span
            className="dealt-card-shell"
            key={`${handNumber}-${index}`}
            style={{ animationDelay: `${160 + seat.position * 115 + index * 460}ms` }}
          >
            <PlayingCard card={card} small={!seat.isMine} large={seat.isMine} />
          </span>
        ))}
      </div>
      <SeatFigure seat={seat} active={seat.isCurrent} />
      {/* Name over stack on one flat plate, tucked under the figure's hands --
          the nameplate every poker client uses, because it is read at a glance
          and nothing about it should compete with the felt. */}
      <div className="seat-plate">
        <div className="seat-name-row">
          <strong>{seat.name}</strong>
          {!seat.isHuman && <span className="ai-badge">AI</span>}
          {seat.isMine && <span className="you-chip">You</span>}
          {seat.isSmallBlind && <span className="blind-label">SB</span>}
          {seat.isBigBlind && <span className="blind-label">BB</span>}
        </div>
        <span
          className={clsx("seat-stack", isWinner && "seat-stack-win")}
          aria-label={`${seat.stack.toLocaleString()} chips`}
        >
          <span className="chip-dot" />
          <strong>{seat.stack.toLocaleString()}</strong>
        </span>
      </div>
      {/* Below the plate, not inside it: what you are holding is a different
          kind of fact from who you are and what you have left. */}
      {seat.isMine && seat.handLabel && (
        <span className="hand-strength" aria-live="polite">
          {seat.handLabel}
        </span>
      )}
      {seat.lastAction && <span className="action-pill">{seat.lastAction}</span>}
      {seat.status === "folded" && <span className="status-pill">Folded</span>}
      {seat.status === "all-in" && <span className="status-pill all-in">All in</span>}
      {seat.streetBet > 0 && <span className="table-bet">{seat.streetBet}</span>}
      {isWinner && <span className="win-amount-float">+{winAmount.toLocaleString()}</span>}
      {seat.isCurrent && (
        <div className="seat-turn-status" aria-live="polite">
          <span>{seat.isMine ? "YOUR TURN" : seat.isHuman ? "THINKING" : "AI THINKING"}</span>
          <strong>{secondsRemaining}s</strong>
        </div>
      )}
    </article>
  );
}, (previous, next) => (
  previous.seat === next.seat
  && previous.placement === next.placement
  && previous.handNumber === next.handNumber
  && previous.secondsRemaining === next.secondsRemaining
  && previous.winAmount === next.winAmount
  && previous.seatStyle === next.seatStyle
));

function Lobby({
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
}) {
  const [name, setName] = useState(profile?.displayName ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [buyInMode, setBuyInMode] = useState<"join" | "host" | null>(null);
  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.trim().length === 6) onJoinCode(name.trim() || "You", joinCode.trim());
  };
  // Below the cheapest buy-in there is no seat in the house they can take,
  // so offer the recovery grant rather than letting them hit a dead end.
  const needsTopUp = Boolean(
    profile && !profile.unlimitedGold && (profile.goldBalance ?? 0) < TIER_CONFIG.micro.minBuyIn,
  );
  // Only nudge a guest once they have actually played -- a profile still
  // sitting on its untouched starting balance has nothing worth saving yet,
  // and prompting then is asking for a signup with no reason behind it.
  const showSavePrompt = Boolean(
    accountsEnabled() && profile && !profile.isRegistered && profile.lastDailyClaimAt === null
    && profile.goldBalance !== 2000,
  );
  return (
    <main className="lobby">
      <section className="hero">
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
          <div className="save-progress-notice" role="status">
            <span>
              You&rsquo;re playing as a guest. Save your progress to keep your Gold and claim
              daily rewards.
            </span>
            <button type="button" className="secondary-action" onClick={onSaveProgress}>
              Save progress
            </button>
          </div>
        )}
        {needsTopUp && (
          <div className="broke-notice" role="status">
            <span>
              You&rsquo;re below the {TIER_CONFIG.micro.minBuyIn.toLocaleString()} Gold minimum for the
              cheapest seat.
            </span>
            <button type="button" className="secondary-action" disabled={loading} onClick={onClaimBackstop}>
              Claim a top-up
            </button>
          </div>
        )}
        <div className="lobby-kicker">River Room · 6-max</div>
        <h1>No-limit Hold’em.<br /><em>Nothing extra.</em></h1>
        <p>
          Pick your stakes, choose a buy-in, and take a seat. Start a quick
          table or open a private room for friends.
        </p>
        <div className="start-form">
          <div className="form-label-row">
            <label htmlFor="player-name">Enter Your Player Name</label>
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
            <button
              type="button"
              className="primary-action"
              disabled={loading || !sessionReady}
              onClick={() => setBuyInMode("join")}
            >
              {!sessionReady
                ? "Preparing your seat…"
                : loading
                  ? "Joining table…"
                  : <>Join table <ArrowRight size={17} /></>}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={loading || !sessionReady}
              onClick={() => setBuyInMode("host")}
            >
              <UsersRound size={15} /> Private table
            </button>
          </div>
          {error && <p className="form-error"><X size={14} /> {error}</p>}
        </div>
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
            <button type="submit" disabled={loading || !sessionReady || joinCode.trim().length !== 6}>Join</button>
          </div>
        </form>
        <div className="table-facts" aria-label="Table details">
          <span><strong>6</strong> seats</span>
          <span><strong>3</strong> stakes tiers</span>
          <span><strong>500 – 40,000</strong> buy-in</span>
        </div>
      </section>
      <aside className="lobby-preview">
        <div className="preview-heading">
          <span>No limit · 6-max</span>
        </div>
        <div className="mini-table">
          <span className="mini-seat mini-top">RV</span>
          <span className="mini-seat mini-upper-left">MA</span>
          <span className="mini-seat mini-upper-right">PR</span>
          <span className="mini-seat mini-lower-left">TH</span>
          <span className="mini-seat mini-lower-right">WR</span>
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
          onConfirm={(tier, buyIn) => {
            if (buyInMode === "host") onHostPrivate(name.trim() || "You", tier, buyIn);
            else onQuickPlay(name.trim() || "You", tier, buyIn);
          }}
        />
      )}
    </main>
  );
}

function AuthButton({
  profile,
  onSignIn,
  onSignOut,
}: {
  profile: PlayerProfile | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const available = accountsEnabled();
  if (profile?.isRegistered) {
    return (
      <button type="button" className="auth-button" onClick={onSignOut}>
        Sign out
      </button>
    );
  }
  return (
    <button
      type="button"
      className="auth-button auth-button-save"
      onClick={onSignIn}
      disabled={!available}
      title={available ? "Sign in with Google to save your progress" : "Sign-in is unavailable until Supabase is configured"}
    >
      Sign in
    </button>
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
  // Legacy field: still sent so the existing column stays populated, but the
  // layered avatar has replaced it as what players actually choose.
  const [avatarPreset] = useState<AvatarPreset>(profile.avatarPreset);
  const [accent, setAccent] = useState(profile.accent);
  const [previewUrl, setPreviewUrl] = useState<string | null>(profile.avatarUrl);
  const [usingUpload, setUsingUpload] = useState(Boolean(profile.avatarUrl));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [idCopied, setIdCopied] = useState(false);
  const copyPlayerId = async () => {
    try {
      await navigator.clipboard.writeText(profile.id);
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 1800);
    } catch {
      // Clipboard access can be denied by browser policy; the id is still visible to copy by hand.
    }
  };

  const preview: AvatarView = {
    displayName: displayName || "Player",
    initials: (displayName || "P").slice(0, 2).toUpperCase(),
    avatarUrl: usingUpload ? previewUrl : null,
    avatarPreset,
    accent,
    avatarCosmetic: profile.equipped.avatar,
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
              <span>{usingUpload ? "Personal photo" : "Your table look"}</span>
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

          <p className="avatar-hint">
            Avatars are chosen in the <Link href="/collection">Collection</Link>. Upload a photo
            above to use your own instead.
          </p>

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

          <div className="player-id-row">
            <span>
              <small>Player ID</small>
              <code>{profile.id}</code>
            </span>
            <button type="button" onClick={copyPlayerId}>
              {idCopied ? "Copied!" : "Copy"}
            </button>
          </div>

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

/**
 * Picks a stakes tier (unless locked, e.g. rebuying at an already-seated
 * table) and a buy-in amount within that tier's range -- reused for
 * quick-play, hosting a private table, and rebuying after busting.
 * Resolves to (tier, buyIn); the caller decides what request that becomes.
 */
function BuyInModal({
  title,
  description,
  goldBalance,
  unlimitedGold,
  lockedTier,
  confirmLabel,
  pending,
  onClose,
  onConfirm,
  onBuyGold,
}: {
  title: string;
  description: string;
  goldBalance: number;
  unlimitedGold: boolean;
  lockedTier?: StakesTier;
  confirmLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (tier: StakesTier, buyIn: number) => void;
  onBuyGold?: () => void;
}) {
  const [tier, setTier] = useState<StakesTier>(lockedTier ?? "micro");
  const config = TIER_CONFIG[tier];
  const affordableMax = unlimitedGold ? config.maxBuyIn : Math.min(config.maxBuyIn, goldBalance);
  const [buyIn, setBuyIn] = useState(() => Math.max(config.minBuyIn, Math.min(affordableMax, config.maxBuyIn)));

  const selectTier = (next: StakesTier) => {
    if (lockedTier) return;
    const nextConfig = TIER_CONFIG[next];
    const nextAffordableMax = unlimitedGold ? nextConfig.maxBuyIn : Math.min(nextConfig.maxBuyIn, goldBalance);
    setTier(next);
    setBuyIn(Math.max(nextConfig.minBuyIn, Math.min(nextAffordableMax, nextConfig.maxBuyIn)));
  };

  const canAfford = (candidate: StakesTier) => unlimitedGold || goldBalance >= TIER_CONFIG[candidate].minBuyIn;
  const affordableNow = canAfford(tier) && buyIn <= affordableMax;

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="profile-modal buyin-modal" role="dialog" aria-modal="true" aria-labelledby="buyin-title">
        <header className="profile-modal-header">
          <div>
            <span>BUY-IN</span>
            <h2 id="buyin-title">{title}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="buyin-body">
          <p className="buyin-description">{description}</p>

          {!lockedTier && (
            <div className="tier-grid">
              {STAKES_TIERS.map((candidate) => {
                const candidateConfig = TIER_CONFIG[candidate];
                const affordable = canAfford(candidate);
                return (
                  <button
                    type="button"
                    key={candidate}
                    className={clsx("tier-card", tier === candidate && "selected", !affordable && "unaffordable")}
                    disabled={!affordable}
                    onClick={() => selectTier(candidate)}
                  >
                    <strong>{candidateConfig.label}</strong>
                    <span>{candidateConfig.smallBlind} / {candidateConfig.bigBlind} blinds</span>
                    <small>
                      {affordable
                        ? `${candidateConfig.minBuyIn.toLocaleString()} – ${candidateConfig.maxBuyIn.toLocaleString()}`
                        : `Need ${candidateConfig.minBuyIn.toLocaleString()}+ Gold`}
                    </small>
                  </button>
                );
              })}
            </div>
          )}

          <div className="buyin-amount">
            <div className="range-row">
              <span>Buy in for</span>
              <strong>{buyIn.toLocaleString()} chips</strong>
            </div>
            <input
              aria-label="Buy-in amount"
              type="range"
              min={config.minBuyIn}
              max={Math.max(config.minBuyIn, affordableMax)}
              step={config.bigBlind}
              value={Math.min(buyIn, Math.max(config.minBuyIn, affordableMax))}
              onChange={(event) => setBuyIn(Number(event.target.value))}
              disabled={!canAfford(tier)}
            />
            <div className="buyin-gold-row">
              <span>Gold balance</span>
              <strong>{unlimitedGold ? "Unlimited" : goldBalance.toLocaleString()}</strong>
            </div>
            {!unlimitedGold && (
              <div className="buyin-gold-row">
                <span>Remaining after buy-in</span>
                <strong>{Math.max(0, goldBalance - buyIn).toLocaleString()}</strong>
              </div>
            )}
          </div>

          <footer className="buyin-footer">
            {lockedTier && onBuyGold && !unlimitedGold && (
              <button className="secondary-action" type="button" disabled={pending} onClick={onBuyGold}>
                Buy Gold for rebuy
              </button>
            )}
            <button
              className="primary-action"
              type="button"
              disabled={pending || !affordableNow}
              onClick={() => onConfirm(tier, buyIn)}
            >
              {pending ? "Please wait…" : confirmLabel}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

function TurnProgressBar({ remainingFraction }: { remainingFraction: number }) {
  return (
    <div className="turn-progress-track">
      <div
        className={clsx("turn-progress-fill", remainingFraction <= 0.25 && "progress-critical")}
        style={{ transform: `scaleX(${remainingFraction})` }}
      />
    </div>
  );
}

function ActionBar({
  game,
  pending,
  onAction,
  onLeave,
  secondsRemaining,
  remainingFraction,
  profile,
  onPurchaseRebuy,
}: {
  game: GameSnapshot;
  pending: boolean;
  onAction: (action: PlayerAction) => void;
  onLeave: () => void;
  secondsRemaining: number;
  remainingFraction: number;
  profile: PlayerProfile | null;
  onPurchaseRebuy: () => void;
}) {
  const legal = game.legalActions;
  const currentSeat = game.seats.find((seat) => seat.isCurrent);
  const mySeat = game.seats.find((seat) => seat.isMine);
  const [showRebuyModal, setShowRebuyModal] = useState(false);
  const [raiseTo, setRaiseTo] = useState(legal?.minRaiseTo ?? 0);
  const potPreset = (fraction: number) => {
    if (!legal) return 0;
    const target = Math.round(game.pot * fraction);
    return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, target));
  };
  // Purely a visual beat -- the real action always dispatches synchronously,
  // right here, on click. This only guarantees the pressed look is visible
  // for a minimum stretch so a fast round trip doesn't make the button feel
  // like it never registered the tap.
  const [pressedAction, setPressedAction] = useState<PlayerAction["type"] | null>(null);
  const dispatch = (action: PlayerAction) => {
    onAction(action);
    setPressedAction(action.type);
    window.setTimeout(() => setPressedAction((current) => (current === action.type ? null : current)), 150);
  };

  if (game.status === "complete") {
    if (!game.isSeated) {
      return (
        <div className="action-bar hand-complete busted-player">
          <div>
            <span className="action-kicker">Seat closed</span>
            <strong>You’re out of chips. Start a fresh table when you’re ready.</strong>
          </div>
          <button className="primary-action" onClick={onLeave}>
            Return to lobby
          </button>
        </div>
      );
    }
    if (mySeat?.stack === 0) {
      return (
        <div className="action-bar hand-complete busted-player">
          <div>
            <span className="action-kicker">Stack exhausted</span>
            <strong>You’re out of chips. Rebuy to keep playing, or close your seat.</strong>
          </div>
          <div className="busted-actions">
            <button
              className="secondary-action"
              disabled={pending}
              onClick={() => onAction({ type: "next-hand" })}
            >
              Close seat
            </button>
            <button
              className="primary-action"
              disabled={pending}
              onClick={() => setShowRebuyModal(true)}
            >
              Rebuy
            </button>
          </div>
          {showRebuyModal && (
            <BuyInModal
              title="Rebuy"
              description={`Buy back in at this table's ${TIER_CONFIG[game.tier].label} stakes.`}
              goldBalance={profile?.goldBalance ?? 0}
              unlimitedGold={profile?.unlimitedGold ?? false}
              lockedTier={game.tier}
              confirmLabel="Rebuy"
              pending={pending}
              onClose={() => setShowRebuyModal(false)}
              onBuyGold={onPurchaseRebuy}
              onConfirm={(_tier, buyIn) => onAction({ type: "rebuy", amount: buyIn })}
            />
          )}
        </div>
      );
    }
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
        <span className="waiting-copy">
          <strong>{currentSeat ? `${currentSeat.name} is thinking` : "Waiting for the next hand"}</strong>
          <small>{currentSeat?.isHuman ? "Player decision" : "AI decision is being made server-side"}</small>
        </span>
        {currentSeat && <span className="waiting-countdown">{secondsRemaining}s</span>}
        {currentSeat && <TurnProgressBar remainingFraction={remainingFraction} />}
      </div>
    );
  }

  return (
    <div className="action-bar action-bar-your-turn">
      <TurnProgressBar remainingFraction={remainingFraction} />
      <div className="turn-tools">
        <div className={clsx("action-countdown", secondsRemaining <= 5 && "countdown-critical")}>
          <span>Your turn</span>
          <strong>{secondsRemaining}</strong>
          <small>seconds</small>
        </div>
        <button
          type="button"
          className="time-card-button"
          disabled={pending || !mySeat || mySeat.timeCardsRemaining <= 0}
          onClick={() => onAction({ type: "use-time-card" })}
          title="Add 20 seconds to this turn"
        >
          <TimerReset size={16} />
          <span>+20s</span>
          <span className="time-card-stack" aria-label={`${mySeat?.timeCardsRemaining ?? 0} time cards remaining`}>
            {[0, 1, 2].map((index) => (
              <i key={index} className={index < (mySeat?.timeCardsRemaining ?? 0) ? "available" : ""} />
            ))}
          </span>
        </button>
      </div>
      <div className="basic-actions">
        {legal.canFold && (
          <button
            className={clsx(pressedAction === "fold" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "fold" })}
            aria-label="Fold"
          >
            <FoldVertical size={16} /> Fold
          </button>
        )}
        {legal.canCheck && (
          <button
            className={clsx(pressedAction === "check" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "check" })}
            aria-label="Check"
          >
            <Check size={17} /> Check
          </button>
        )}
        {legal.canCall && (
          <button
            className={clsx(pressedAction === "call" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "call" })}
            aria-label={`Call ${legal.callAmount} chips`}
          >
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
            <button type="button" onClick={() => setRaiseTo(legal.minRaiseTo)}>Min</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(0.5))}>½ Pot</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(2 / 3))}>⅔ Pot</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(1))}>Pot</button>
            <button type="button" className="allin-preset" onClick={() => setRaiseTo(legal.maxRaiseTo)}>All-in</button>
          </div>
        </div>
      )}
      <div className="commit-actions">
        {legal.canRaise && (
          <button
            className={clsx("primary-action", pressedAction === "raise" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "raise", amount: raiseTo })}
            aria-label={`Raise to ${raiseTo} chips`}
          >
            Raise to <span>{raiseTo}</span>
          </button>
        )}
        {legal.canAllIn && (
          <button
            className={clsx("allin-action", pressedAction === "all-in" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "all-in" })}
            aria-label="Go all in"
          >
            All in
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Animates chips flying from the pot to each winning seat. Measures real
 * screen positions (rather than hardcoded per-placement offsets) so the
 * trajectory stays correct across every responsive breakpoint. Keyed by hand
 * number from the parent, so it mounts fresh — and animates — exactly once
 * per completed hand.
 */
function PotFunnel({
  winners,
  potRef,
  seatRefs,
}: {
  winners: Winner[];
  potRef: React.RefObject<HTMLDivElement | null>;
  seatRefs: React.RefObject<Record<string, HTMLElement | null>>;
}) {
  const [vectors, setVectors] = useState<Array<{ seatId: string; dx: number; dy: number }>>([]);

  useEffect(() => {
    const potRect = potRef.current?.getBoundingClientRect();
    if (!potRect) return;
    const potCenterX = potRect.left + potRect.width / 2;
    const potCenterY = potRect.top + potRect.height / 2;
    const next: Array<{ seatId: string; dx: number; dy: number }> = [];
    winners.forEach((winner) => {
      const seatEl = seatRefs.current[winner.seatId];
      if (!seatEl) return;
      const stashEl = seatEl.querySelector<HTMLElement>(".seat-stack") ?? seatEl;
      const seatRect = stashEl.getBoundingClientRect();
      next.push({
        seatId: winner.seatId,
        dx: seatRect.left + seatRect.width / 2 - potCenterX,
        dy: seatRect.top + seatRect.height / 2 - potCenterY,
      });
    });
    setVectors(next);
    // Deliberately runs once on mount: this component remounts (a fresh
    // measurement) via its `key={handNumber}` in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {vectors.flatMap((vector) =>
        Array.from({ length: 12 }, (_, index) => {
          const spreadX = ((index % 5) - 2) * 5;
          const spreadY = ((index * 7) % 13) - 6;
          return (
            <span
              key={`${vector.seatId}-${index}`}
              className={`pot-chip-flight chip-color-${index % 5}`}
              style={{
                "--funnel-dx": `${vector.dx + spreadX}px`,
                "--funnel-dy": `${vector.dy + spreadY}px`,
                "--shuffle-x": `${((index * 11) % 31) - 15}px`,
                "--shuffle-y": `${-12 - ((index * 5) % 18)}px`,
                "--chip-delay": `${index * 34}ms`,
              } as React.CSSProperties}
              aria-hidden="true"
            />
          );
        }),
      )}
    </>
  );
}

/**
 * A handful of chips flying from an acting seat to the pot. Renders as a
 * sibling of the seats (inside .poker-table-wrap, not .poker-felt) so the
 * felt's overflow:hidden never clips a seat that sits outside its oval --
 * the same reason the seats themselves live at that level. Self-removes
 * via `onDone` once its animation finishes, so no DOM nodes or timers
 * accumulate across a hand.
 */
function ChipFlight({
  id,
  seatId,
  tableWrapRef,
  potRef,
  seatRefs,
  onDone,
}: {
  id: string;
  seatId: string;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  potRef: React.RefObject<HTMLDivElement | null>;
  seatRefs: React.RefObject<Record<string, HTMLElement | null>>;
  onDone: (id: string) => void;
}) {
  const [layout, setLayout] = useState<{ originX: number; originY: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const wrapRect = tableWrapRef.current?.getBoundingClientRect();
    const potRect = potRef.current?.getBoundingClientRect();
    const seatEl = seatRefs.current[seatId];
    if (!wrapRect || !potRect || !seatEl) {
      onDone(id);
      return;
    }
    const seatRect = seatEl.getBoundingClientRect();
    setLayout({
      originX: seatRect.left + seatRect.width / 2 - wrapRect.left,
      originY: seatRect.top + seatRect.height / 2 - wrapRect.top,
      dx: potRect.left + potRect.width / 2 - (seatRect.left + seatRect.width / 2),
      dy: potRect.top + potRect.height / 2 - (seatRect.top + seatRect.height / 2),
    });
    const timer = window.setTimeout(() => onDone(id), 560);
    return () => window.clearTimeout(timer);
    // Deliberately runs once on mount: this flight is a one-shot event keyed
    // by its own id, not something that reacts to later layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!layout) return null;

  return (
    <>
      {Array.from({ length: 3 }, (_, index) => (
        <span
          key={index}
          className={`seat-chip-flight chip-color-${index % 5}`}
          style={{
            left: `${layout.originX}px`,
            top: `${layout.originY}px`,
            "--flight-dx": `${layout.dx}px`,
            "--flight-dy": `${layout.dy}px`,
            "--flight-delay": `${index * 30}ms`,
          } as React.CSSProperties}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/**
 * Bridges a seat's cards from "visible at the seat" to "gone" the moment it
 * folds, so the disappearance (PlayerSeat stops rendering them once
 * `folded`) reads as the cards actually leaving rather than an instant cut.
 * Renders whatever the seat's own `holeCards` already were at the moment of
 * folding -- real cards for the local player (whose own hand always stays
 * visible to them, fold or not), already-masked nulls/card-backs for any
 * other seat -- so it can never surface hidden information itself.
 */
function MuckDrift({
  id,
  seatId,
  cards,
  isMine,
  tableWrapRef,
  potRef,
  seatRefs,
  onDone,
}: {
  id: string;
  seatId: string;
  cards: Array<Card | null>;
  isMine: boolean;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  potRef: React.RefObject<HTMLDivElement | null>;
  seatRefs: React.RefObject<Record<string, HTMLElement | null>>;
  onDone: (id: string) => void;
}) {
  const [layout, setLayout] = useState<{ originX: number; originY: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const wrapRect = tableWrapRef.current?.getBoundingClientRect();
    const potRect = potRef.current?.getBoundingClientRect();
    const seatEl = seatRefs.current[seatId];
    if (!wrapRect || !potRect || !seatEl) {
      onDone(id);
      return;
    }
    const seatRect = seatEl.getBoundingClientRect();
    setLayout({
      originX: seatRect.left + seatRect.width / 2 - wrapRect.left,
      originY: seatRect.top + seatRect.height / 2 - wrapRect.top,
      dx: potRect.left + potRect.width / 2 - (seatRect.left + seatRect.width / 2),
      dy: potRect.top + potRect.height / 2 - (seatRect.top + seatRect.height / 2),
    });
    const timer = window.setTimeout(() => onDone(id), 560);
    return () => window.clearTimeout(timer);
    // One-shot: a self-contained event keyed by its own id, not something
    // that should react to later layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!layout) return null;

  return (
    <div
      className="muck-drift"
      style={{
        left: `${layout.originX}px`,
        top: `${layout.originY}px`,
        "--muck-dx": `${layout.dx}px`,
        "--muck-dy": `${layout.dy}px`,
      } as React.CSSProperties}
      aria-hidden="true"
    >
      {cards.map((card, index) => (
        <span className="muck-drift-card" key={index}>
          <PlayingCard card={card} small={!isMine} large={isMine} />
        </span>
      ))}
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

function HandHistoryDrawer({
  log,
  handNumber,
  onClose,
}: {
  log: GameSnapshot["log"];
  handNumber: number;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="history-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside className="history-drawer" role="dialog" aria-modal="true" aria-label="Hand history">
        <div className="panel-heading">
          <div>
            <span>TABLE ACTIVITY</span>
            <strong>Hand #{handNumber}</strong>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close hand history"><X size={16} /></button>
        </div>
        <div className="activity-list">
          {log.length === 0 && <p className="activity-empty">Nothing has happened yet.</p>}
          {log.map((entry) => (
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
    </div>
  );
}

/**
 * A seat's width, as a fraction of the table's width and of its height.
 * Everything about a seat is measured from this -- the figure, where its cards
 * sit at the hands, how far a bet travels -- so the whole ring scales with the
 * table instead of each piece needing its own breakpoint.
 *
 * Both bounds are needed. A figure is square, so on a landscape phone, where
 * the table is squeezed to 740x247, sizing off width alone gave each seat 64%
 * of the table's height and the ring closed over the board.
 */
const SEAT_WIDTH_RATIO = 0.17;
const SEAT_HEIGHT_RATIO = 0.3;

function seatWidthFor(table: { width: number; height: number }): number {
  return Math.round(Math.min(table.width * SEAT_WIDTH_RATIO, table.height * SEAT_HEIGHT_RATIO));
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
  onProfileChange,
  connectionState,
  soundEnabled,
  onToggleSound,
  onPurchaseRebuy,
  onSignIn,
  onSignOut,
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
  onProfileChange: (profile: PlayerProfile) => void;
  connectionState: ConnectionState;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onPurchaseRebuy: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showOrientationHint, setShowOrientationHint] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    window.requestAnimationFrame(() => historyButtonRef.current?.focus());
  }, []);
  // The ring's horizontal radius depends on how much width there is to
  // spend, so the geometry has to recompute when the window changes.
  const [viewportWidth, setViewportWidth] = useState(1280);
  useEffect(() => {
    const measure = () => setViewportWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  // A seat is sized off the table, not the window. The table is capped by the
  // height left over as well as by width, so a short landscape phone can shrink
  // it to a third of its desktop width while the viewport is still wide --
  // seats measured against the viewport stayed huge and buried the board.
  const [tableSize, setTableSize] = useState({ width: 850, height: 494 });
  // How far the foreground player hangs below the felt.
  //
  // This cannot be a constant. The gap between the bottom of the table and the
  // top of the action bar is not proportional to anything: the table is capped
  // by width on a desktop and by leftover height on a short one, so the same
  // overhang that looks right on a desktop (118px of room) slides your own
  // nameplate under the buttons on a tablet (53px). Measured, it is right
  // everywhere and needs no breakpoint.
  const [foregroundDrop, setForegroundDrop] = useState(44);
  // The room left for the foreground figure: from the bottom of the community
  // cards to the top of the action bar. Your own head must not cover the board.
  const [boardToBar, setBoardToBar] = useState(298);
  const actionLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = tableWrapRef.current;
    const bar = actionLayerRef.current;
    if (!wrap || !bar) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      setTableSize({ width: rect.width, height: rect.height });
      const barTop = bar.getBoundingClientRect().top;
      setForegroundDrop(Math.max(0, Math.round(barTop - rect.bottom - 6)));
      const board = wrap.querySelector(".community-cards");
      if (board) setBoardToBar(Math.max(0, Math.round(barTop - board.getBoundingClientRect().bottom)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const portraitPhone = window.matchMedia("(max-width: 600px) and (orientation: portrait)");
    const updateHint = () => setShowOrientationHint(portraitPhone.matches);
    updateHint();
    portraitPhone.addEventListener("change", updateHint);
    const timer = window.setTimeout(() => setShowOrientationHint(false), 6500);
    return () => {
      portraitPhone.removeEventListener("change", updateHint);
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!game.turnDeadlineAt || game.currentPlayer === null) return;
    const initialTick = window.setTimeout(() => setClockNow(Date.now()), 0);
    const interval = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(interval);
    };
  }, [game.turnDeadlineAt, game.currentPlayer]);
  const deadline = Date.parse(game.turnDeadlineAt ?? "");
  const startedAt = Date.parse(game.turnStartedAt ?? "");
  const secondsRemaining = Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - clockNow) / 1000))
    : 0;
  const turnDurationMs = Number.isFinite(deadline) && Number.isFinite(startedAt) ? deadline - startedAt : 0;
  const remainingFraction = turnDurationMs > 0
    ? Math.max(0, Math.min(1, (deadline - clockNow) / turnDurationMs))
    : 0;
  const mySeatIndex = game.seats.findIndex((seat) => seat.isMine);
  const orderedSeats = mySeatIndex <= 0
    ? game.seats
    : game.seats.map((_, index) => game.seats[(mySeatIndex + index) % game.seats.length]);
  const potRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef<Record<string, HTMLElement | null>>({});
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const showFunnel = game.status === "complete" && game.winners.length > 0;

  const dealerSeatId = game.seats.find((seat) => seat.isDealer)?.id ?? null;
  const [dealerVector, setDealerVector] = useState<{ dx: number; dy: number } | null>(null);
  const dealerMeasuredOnceRef = useRef(false);
  const [dealerAnimated, setDealerAnimated] = useState(false);
  const measureDealer = useCallback(() => {
    const anchorEl = potRef.current;
    const seatEl = dealerSeatId ? seatRefs.current[dealerSeatId] : null;
    if (!anchorEl || !seatEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const seatRect = seatEl.getBoundingClientRect();
    setDealerVector({
      dx: seatRect.left + seatRect.width / 2 - (anchorRect.left + anchorRect.width / 2),
      dy: seatRect.top + seatRect.height / 2 - (anchorRect.top + anchorRect.height / 2),
    });
    if (!dealerMeasuredOnceRef.current) {
      dealerMeasuredOnceRef.current = true;
      // Skip the glide transition for this first placement (mount, refresh,
      // reconnect) -- only actual dealer-seat changes between hands should
      // animate. Arming on the next frame keeps this snap-into-place paint
      // free of a transition rather than racing the style application.
      window.requestAnimationFrame(() => setDealerAnimated(true));
    }
  }, [dealerSeatId]);
  // Opponents ring the table on a projected ellipse. Slot 0 is the near edge
  // where the local player sits; they are drawn in the foreground instead, so
  // the ring geometry for slot 0 is simply unused.
  const ringGeometry = useMemo(
    () => orderedSeats.map((_, index) => {
      const geometry = seatGeometry(index, orderedSeats.length, radiiForWidth(viewportWidth));
      const haze = atmosphere(geometry.depth);
      return {
        left: `${geometry.x}%`,
        top: `${geometry.y}%`,
        "--seat-depth": geometry.scale,
        "--seat-haze": `brightness(${haze.brightness.toFixed(3)}) saturate(${haze.saturate.toFixed(3)}) blur(${haze.blur.toFixed(2)}px)`,
        // 0 at the far rail, 1 nearest. Everything that should fall off with
        // distance but is not the figure itself derives from this.
        "--seat-near": geometry.depth.toFixed(3),
        // Depth order for the figure; the plate derives a much higher one from
        // it so no nameplate is ever hidden behind a neighbour's shoulder.
        "--seat-z": seatZ(geometry.depth),
        // The direction from this seat toward the pot, as a bare unit vector.
        // Anything that hangs off a seat picks its own distance in CSS and
        // multiplies -- bets travel inward, the turn timer outward -- which
        // keeps the per-breakpoint distances alongside every other breakpoint
        // rule rather than stranded in here.
        "--seat-dx": geometry.towardPot.x.toFixed(3),
        "--seat-dy": geometry.towardPot.y.toFixed(3),
      } as React.CSSProperties;
    }),
    [orderedSeats, viewportWidth],
  );

  // Your own portrait, sized off the one geometric fact that does apply to a
  // player sitting at the camera: it has to out-scale the nearest seat on the
  // ring. Deliberately not --seat-depth, which scales the whole seat box --
  // your cards are already sized by hand and must not move.
  const firstPersonStyle = useMemo(
    () => ({ "--portrait-scale": FIRST_PERSON_SCALE, "--seat-z": 150 }) as React.CSSProperties,
    [],
  );

  const seatOrderKey = orderedSeats.map((seat) => seat.id).join(",");
  useEffect(() => {
    measureDealer();
  }, [measureDealer, seatOrderKey, historyOpen]);
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => measureDealer());
    observer.observe(wrap);
    window.addEventListener("orientationchange", measureDealer);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measureDealer);
    };
  }, [measureDealer]);

  // Chips fly from a seat to the pot only for an authoritative *increase* in
  // that seat's committed-this-street amount versus the last snapshot on the
  // same hand/street. Comparing against an empty baseline whenever the hand
  // or street changes (rather than the stale prior-street value) means a
  // street reset never reads as a contribution, while a freshly posted
  // blind still does. A null baseline -- true on mount and forced on any
  // disconnect -- skips flight generation entirely for that one snapshot,
  // so neither initial hydration nor a reconnect ever replays history.
  const streetBetsRef = useRef<{ handNumber: number; street: string; bets: Record<string, number> } | null>(null);
  const [chipFlights, setChipFlights] = useState<Array<{ id: string; seatId: string }>>([]);
  useEffect(() => {
    if (connectionState !== "connected") {
      streetBetsRef.current = null;
    }
  }, [connectionState]);
  useEffect(() => {
    const prev = streetBetsRef.current;
    const sameStreet = prev !== null && prev.handNumber === game.handNumber && prev.street === game.street;
    const baseline = sameStreet ? prev!.bets : {};
    if (prev !== null) {
      const arrivals = game.seats
        .filter((seat) => seat.streetBet > (baseline[seat.id] ?? 0))
        .map((seat) => ({ id: `${game.handNumber}-${game.street}-${seat.id}-${seat.streetBet}`, seatId: seat.id }));
      if (arrivals.length) {
        setChipFlights((current) => [...current, ...arrivals]);
      }
    }
    streetBetsRef.current = {
      handNumber: game.handNumber,
      street: game.street,
      bets: Object.fromEntries(game.seats.map((seat) => [seat.id, seat.streetBet])),
    };
  }, [game.seats, game.handNumber, game.street]);
  const removeChipFlight = useCallback((id: string) => {
    setChipFlights((current) => current.filter((flight) => flight.id !== id));
  }, []);

  // Same shape of guard as the chip-flight tracker above: a null baseline
  // (mount, or forced on any non-connected state) skips detection for that
  // snapshot, so a fresh hand's seats resetting to "active" is never misread
  // as an un-fold, and nothing replays after a refresh or reconnect.
  const foldStatusRef = useRef<Record<string, boolean> | null>(null);
  const [muckDrifts, setMuckDrifts] = useState<
    Array<{ id: string; seatId: string; cards: Array<Card | null>; isMine: boolean }>
  >([]);
  useEffect(() => {
    if (connectionState !== "connected") {
      foldStatusRef.current = null;
    }
  }, [connectionState]);
  useEffect(() => {
    const prev = foldStatusRef.current;
    if (prev !== null) {
      const newlyFolded = game.seats.filter((seat) => seat.status === "folded" && !prev[seat.id]);
      if (newlyFolded.length) {
        setMuckDrifts((current) => [
          ...current,
          ...newlyFolded.map((seat) => ({
            id: `${game.handNumber}-${seat.id}-muck`,
            seatId: seat.id,
            cards: seat.holeCards,
            isMine: seat.isMine,
          })),
        ]);
      }
    }
    foldStatusRef.current = Object.fromEntries(game.seats.map((seat) => [seat.id, seat.status === "folded"]));
  }, [game.seats, game.handNumber]);
  const removeMuckDrift = useCallback((id: string) => {
    setMuckDrifts((current) => current.filter((drift) => drift.id !== id));
  }, []);

  // A silent auto-fold/check is easy to miss on a first turn; call it out
  // explicitly instead of only leaving a trace in the activity log. Derived
  // during render (React's "adjusting state" pattern) rather than in an
  // effect, since it only needs to react to game.log changing, not to
  // synchronize with anything external.
  const [timeoutFlash, setTimeoutFlash] = useState<string | null>(null);
  const [lastSeenLogId, setLastSeenLogId] = useState<string | null>(null);
  const latestLogId = game.log[0]?.id ?? null;
  if (latestLogId !== lastSeenLogId) {
    const previouslyObserved = lastSeenLogId !== null;
    setLastSeenLogId(latestLogId);
    const entry = game.log[0];
    const mySeat = game.seats.find((seat) => seat.isMine);
    if (previouslyObserved && entry && mySeat && entry.text.startsWith(`${mySeat.name} ran out of time`)) {
      setTimeoutFlash(
        mySeat.lastAction === "Timed out · Check"
          ? "Time's up — you checked automatically."
          : "Time's up — you folded automatically.",
      );
    }
  }
  useEffect(() => {
    if (!timeoutFlash) return;
    const timer = window.setTimeout(() => setTimeoutFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [timeoutFlash]);
  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="wordmark" onClick={onLeave} aria-label="Leave table">
          <span className="mark">R</span>
          <span>River Room<small>NO LIMIT HOLD’EM</small></span>
        </button>
        <div className="table-meta">
          <span>
            <span className={clsx(
              "live-dot",
              persistence === "memory" && "demo-dot",
              connectionState !== "connected" && "connection-dot-warning",
            )} />
            {connectionState === "offline"
              ? "Offline"
              : connectionState === "reconnecting"
                ? "Reconnecting"
                : persistence === "supabase" ? "Realtime" : "Demo table"}
          </span>
          {game.isPrivate && game.roomCode
            ? <RoomCodeChip code={game.roomCode} />
            : <span>Table {game.id.slice(0, 6).toUpperCase()}</span>}
          <span>Blinds {game.smallBlind}/{game.bigBlind}</span>
        </div>
        <div className="game-header-actions">
          {profile && <GoldBadge profile={profile} onClaimed={onProfileChange} />}
          <AuthButton profile={profile} onSignIn={onSignIn} onSignOut={onSignOut} />
          {profile && <ProfileTrigger profile={profile} onClick={onCustomize} compact />}
          <button
            ref={historyButtonRef}
            className="history-toggle"
            onClick={() => setHistoryOpen(true)}
            aria-label="Open hand history"
            aria-haspopup="dialog"
          >
            <History size={15} /> <span>History</span>
          </button>
          <button
            type="button"
            className="sound-toggle"
            onClick={onToggleSound}
            aria-label={soundEnabled ? "Mute sound effects" : "Enable sound effects"}
            title={soundEnabled ? "Mute sound effects" : "Enable sound effects"}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          {game.isSeated && (
            <button className="give-up-seat-button" onClick={onLeaveSeat} title="Give up your seat; a bot takes over">
              Give up seat
            </button>
          )}
          <button className="leave-button" onClick={onLeave}>Leave table</button>
        </div>
      </header>

      {showOrientationHint && (
        <button
          type="button"
          className="orientation-hint"
          onClick={() => setShowOrientationHint(false)}
          aria-label="Dismiss landscape orientation suggestion"
        >
          <span aria-hidden="true">↻</span>
          Rotate for a wider table
          <small>Portrait still works</small>
        </button>
      )}

      <section className="game-content">
        <div className="table-area">
          <div
            className="poker-table-wrap"
            ref={tableWrapRef}
            style={{
              "--seat-width": `${seatWidthFor(tableSize)}px`,
              "--foreground-drop": `${foregroundDrop}px`,
              "--board-to-bar": `${boardToBar}px`,
            } as React.CSSProperties}
          >
            <div className="poker-rail">
              <div className="poker-felt">
                <div className="felt-texture" />
                <div className={clsx("pot-display", showFunnel && "pot-display-paid")} ref={potRef}>
                  <span>MAIN POT</span>
                  <strong><span className="chip-stack-icon" />{game.pot.toLocaleString()}</strong>
                </div>
                {showFunnel && <PotFunnel key={game.handNumber} winners={game.winners} potRef={potRef} seatRefs={seatRefs} />}
                <div className="community-cards">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <span
                      className={clsx("community-card-shell", game.community[index] && "community-card-revealed")}
                      key={`${game.handNumber}-${index}`}
                      style={{
                        "--community-delay": `${index < 3 ? index * 110 : 0}ms`,
                      } as React.CSSProperties}
                    >
                      {game.community[index]
                        ? (
                          <span className="community-card-flipper">
                            <span className="community-card-backface" aria-hidden="true">
                              <PlayingCard card={null} />
                            </span>
                            <span className="community-card-face">
                              <PlayingCard card={game.community[index]} />
                            </span>
                          </span>
                        )
                        : <PlayingCard card={null} ghost />}
                    </span>
                  ))}
                </div>
                <span className="street-label">{game.street}</span>
              </div>
            </div>
            {dealerSeatId && (
              <div
                className={clsx(
                  "dealer-puck",
                  dealerVector && "dealer-puck-visible",
                  dealerAnimated && "dealer-puck-animated",
                )}
                style={{
                  "--puck-dx": `${dealerVector?.dx ?? 0}px`,
                  "--puck-dy": `${dealerVector?.dy ?? 0}px`,
                } as React.CSSProperties}
                aria-hidden="true"
              >
                <span>D</span>
              </div>
            )}
            {chipFlights.map((flight) => (
              <ChipFlight
                key={flight.id}
                id={flight.id}
                seatId={flight.seatId}
                tableWrapRef={tableWrapRef}
                potRef={potRef}
                seatRefs={seatRefs}
                onDone={removeChipFlight}
              />
            ))}
            {muckDrifts.map((drift) => (
              <MuckDrift
                key={drift.id}
                id={drift.id}
                seatId={drift.seatId}
                cards={drift.cards}
                isMine={drift.isMine}
                tableWrapRef={tableWrapRef}
                potRef={potRef}
                seatRefs={seatRefs}
                onDone={removeMuckDrift}
              />
            ))}
            {orderedSeats.map((seat, index) => (
              <PlayerSeat
                key={seat.id}
                seat={seat}
                // The local player leaves the ring and becomes the
                // foreground. Still a PlayerSeat, so its seat ref stays
                // registered and chip flights, the muck drift and the dealer
                // puck keep measuring the right spot.
                placement={seat.isMine ? "seat-first-person" : "seat-ring"}
                seatStyle={seat.isMine ? firstPersonStyle : ringGeometry[index]}
                handNumber={game.handNumber}
                secondsRemaining={seat.isCurrent ? secondsRemaining : 0}
                winAmount={showFunnel ? game.winners.find((winner) => winner.seatId === seat.id)?.amount : undefined}
                elementRef={(el) => { seatRefs.current[seat.id] = el; }}
              />
            ))}
          </div>
        </div>

        <div className="action-layer" ref={actionLayerRef}>
          {error && <div className="table-toast"><X size={15} /> {error}</div>}
          {!error && timeoutFlash && (
            <div className="timeout-toast"><TimerReset size={14} /> {timeoutFlash}</div>
          )}
          <ActionBar
            key={game.version}
            game={game}
            pending={pending || connectionState !== "connected"}
            onAction={onAction}
            onLeave={onLeave}
            secondsRemaining={secondsRemaining}
            remainingFraction={remainingFraction}
            profile={profile}
            onPurchaseRebuy={onPurchaseRebuy}
          />
        </div>
      </section>

      {connectionState !== "connected" && (
        <div className="connection-overlay" role="status" aria-live="assertive">
          <span className="waiting-dot" />
          <strong>
            {connectionState === "offline"
              ? "You’re offline — gameplay is paused"
              : "Reconnecting to the table…"}
          </strong>
          <small>Your controls will unlock after the latest server state arrives.</small>
        </div>
      )}

      {historyOpen && (
        <HandHistoryDrawer log={game.log} handNumber={game.handNumber} onClose={closeHistory} />
      )}
    </main>
  );
}

type ConnectionState = "connected" | "reconnecting" | "offline";
const MAX_ADVANCE_RETRIES = 3;
const ADVANCE_RETRY_BASE_MS = 300;

export function PokerApp() {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [persistence, setPersistence] = useState("memory");
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connected");
  const [cashOutNotice, setCashOutNotice] = useState<number | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const gameId = game?.id;
  const gameVersionRef = useRef(game?.version ?? 0);
  const previousGameRef = useRef<GameSnapshot | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
    const enabled = stored !== "false";
    setSoundEnabled(enabled);
    const timer = window.setTimeout(() => setSoundEnabledState(enabled), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabledState((current) => {
      const next = !current;
      setSoundEnabled(next);
      window.localStorage.setItem(SOUND_STORAGE_KEY, String(next));
      if (next) playSound("ui");
      return next;
    });
  }, []);

  useEffect(() => {
    const current = game;
    const previous = previousGameRef.current;
    previousGameRef.current = current;
    if (!current || !previous || current.id !== previous.id || current.version <= previous.version) return;

    if (current.handNumber > previous.handNumber) {
      playSound("deal");
    } else {
      const revealedCommunity = current.community.length - previous.community.length;
      if (revealedCommunity === 3 && previous.community.length === 0) playSound("flop");
      else if (revealedCommunity > 0) playSound("card");

      const chipsMoved = current.seats.some((seat) => {
        const priorSeat = previous.seats.find((candidate) => candidate.id === seat.id);
        return priorSeat && seat.streetBet > priorSeat.streetBet;
      });
      if (chipsMoved) playSound("chips");
    }

    if (current.status === "complete" && previous.status !== "complete") {
      const mineWon = current.winners.some((winner) =>
        current.seats.some((seat) => seat.isMine && seat.id === winner.seatId),
      );
      playSound(mineWon ? "win" : "lose");
    }

    const latestLog = current.log[0];
    if (latestLog && latestLog.id !== previous.log[0]?.id && latestLog.text.includes("ran out of time")) {
      playSound("timeout");
    }
  }, [game]);
  useEffect(() => {
    gameVersionRef.current = game?.version ?? 0;
  }, [game?.version]);

  const loadProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load your profile.");
    setProfile(data.profile);
    setPersistence(data.persistence);
  }, []);

  const ingest = useCallback((data: { game: GameSnapshot; persistence: string; profile?: PlayerProfile }) => {
    setGame((current) => (
      current && current.id === data.game.id && current.version > data.game.version
        ? current
        : data.game
    ));
    setPersistence(data.persistence);
    setConnectionState("connected");
    setError(null);
    // Present whenever the action spent or credited Gold (a buy-in, a
    // rebuy), so the navbar balance updates without a separate profile
    // re-fetch.
    if (data.profile) setProfile(data.profile);
  }, []);

  const refresh = useCallback(async (id: string) => {
    const response = await fetch(`/api/games/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not refresh the table.");
    ingest(data);
    return data as { game: GameSnapshot; persistence: string };
  }, [ingest]);

  const advanceTable = useCallback(async (id: string) => {
    const response = await fetch(`/api/games/${id}/advance`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not advance the table.");
    ingest(data);
    return data as { game: GameSnapshot; persistence: string; retryAfterMs: number | null };
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
    playSound("deal");
    window.history.replaceState({}, "", `/?table=${data.game.id}`);
  }, [ingest]);

  useEffect(() => {
    const markOffline = () => setConnectionState("offline");
    const reconnect = () => {
      setConnectionState("reconnecting");
      if (gameId) {
        void refresh(gameId).catch(() => setConnectionState("reconnecting"));
      }
    };
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", reconnect);
    if (!window.navigator.onLine) markOffline();
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", reconnect);
    };
  }, [gameId, refresh]);

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
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");
    if (payment !== "success" || !sessionId) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/stripe/checkout-session/verify?session_id=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not verify the payment.");
          if (data.profile) setProfile(data.profile);
          setAuthNotice(data.paid ? "Payment received — your rebuy Gold is ready." : "Payment is still processing.");
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not verify the payment."))
        .finally(() => {
          params.delete("payment");
          params.delete("session_id");
          const query = params.toString();
          window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile()
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : "Could not load your profile.");
        })
        .finally(() => setProfileLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  useEffect(() => {
    if (!("serviceWorker" in window.navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void window.navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is an enhancement; normal online play remains available.
      });
      return;
    }

    // A development service worker can serve stale shell responses while Fast
    // Refresh is rebuilding. Keep npm run dev as a plain network experience.
    void window.navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    });
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!gameId || !url || !key) return;
    const supabase = createClient(url, key);
    let disposed = false;
    let refreshRunning = false;
    let pendingVersion = gameVersionRef.current;

    const refreshLatest = () => {
      if (disposed || refreshRunning) return;
      refreshRunning = true;
      void (async () => {
        try {
          while (!disposed) {
            const requestedVersion = pendingVersion;
            const data = await refresh(gameId);
            if (data.game.version >= pendingVersion) break;
            if (pendingVersion <= requestedVersion) break;
          }
        } catch {
          setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
        } finally {
          refreshRunning = false;
        }
      })();
    };

    let channel: RealtimeChannel | null = supabase
      .channel(`table:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_signals", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const version = Number((payload.new as { version?: unknown }).version);
          if (
            !Number.isFinite(version)
            || version <= Math.max(pendingVersion, gameVersionRef.current)
          ) return;
          pendingVersion = version;
          refreshLatest();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnectionState("connected");
        if (
          status === "CHANNEL_ERROR"
          || status === "TIMED_OUT"
          || status === "CLOSED"
        ) {
          setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
        }
      });
    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [gameId, refresh]);

  // Supabase Realtime delivers actions immediately, so persistent tables only
  // need one deadline-aligned advance request for the current bot/human timer.
  // In-memory development has no Realtime channel and keeps a modest fallback
  // poll so multiple local browsers still stay synchronized.
  useEffect(() => {
    if (!gameId || !game?.isSeated) return;
    // Every seated browser used to schedule the same deadline advance. That
    // is safe at the database layer, but it creates N competing RPCs and
    // serialization work for every bot turn. Elect one browser per table:
    // the player whose turn it is when the actor is human, otherwise the
    // lowest-position human. Realtime state changes naturally re-elect the
    // next browser when that seat leaves.
    const currentSeat = game.seats.find((seat) => seat.isCurrent);
    const humanSeats = game.seats
      .filter((seat) => seat.isHuman)
      .sort((a, b) => a.position - b.position);
    const timerLeader = currentSeat?.isHuman ? currentSeat : humanSeats[0];
    if (!timerLeader?.isMine) return;

    const advanceClock = () => {
      if (!window.navigator.onLine) {
        setConnectionState("offline");
        return;
      }
      void advanceTable(gameId).catch(() => setConnectionState("reconnecting"));
    };

    if (persistence === "memory") {
      const interval = window.setInterval(advanceClock, 1500);
      return () => window.clearInterval(interval);
    }

    // Realtime refreshes are strictly read-only. Only a seated player may ask
    // the dedicated endpoint to resolve an expired server-authored deadline.
    const deadline = Date.parse(game?.turnDeadlineAt ?? "");
    if (!Number.isFinite(deadline)) return;
    let disposed = false;
    let timeout: number;
    let retryAttempt = 0;
    const runAdvance = () => {
      if (!window.navigator.onLine) {
        setConnectionState("offline");
        return;
      }
      void advanceTable(gameId)
        .then((data) => {
          if (
            !disposed
            && data.game.version === game.version
            && typeof data.retryAfterMs === "number"
            && data.retryAfterMs > 0
          ) {
            timeout = window.setTimeout(runAdvance, Math.max(200, data.retryAfterMs + 120));
          }
        })
        .catch(() => {
          if (disposed) return;
          setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
          if (!window.navigator.onLine || retryAttempt >= MAX_ADVANCE_RETRIES) return;
          const retryDelay = ADVANCE_RETRY_BASE_MS * (2 ** retryAttempt);
          retryAttempt += 1;
          timeout = window.setTimeout(runAdvance, retryDelay);
        });
    };
    timeout = window.setTimeout(runAdvance, Math.max(200, deadline - Date.now() + 120));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
    };
  }, [advanceTable, game?.isSeated, game?.seats, game?.turnDeadlineAt, game?.version, gameId, persistence]);

  const quickPlay = async (name: string, tier: StakesTier, buyIn: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/games/quick-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tier, buyIn }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not find you a table.");
      ingest(data);
      playSound("deal");
      window.history.pushState({}, "", `/?table=${data.game.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not find you a table.");
    } finally {
      setLoading(false);
    }
  };

  const hostPrivate = async (name: string, tier: StakesTier, buyIn: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, isPrivate: true, tier, buyIn }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not host a table.");
      ingest(data);
      playSound("deal");
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

  const purchaseRebuy = async () => {
    if (!game || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: game.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start rebuy checkout.");
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start rebuy checkout.");
      setLoading(false);
    }
  };

  const act = async (action: PlayerAction) => {
    if (!game || loading) return;
    const actionSound: Partial<Record<PlayerAction["type"], Parameters<typeof playSound>[0]>> = {
      fold: "fold",
      check: "check",
      call: "call",
      raise: "raise",
      "all-in": "all-in",
      "use-time-card": "time-card",
      "next-hand": "ui",
      "leave-seat": "ui",
      rebuy: "ui",
    };
    const effect = actionSound[action.type];
    if (effect) playSound(effect);
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
    const tableId = game.id;
    setLoading(true);
    // Drop the table view up front rather than after the round trip: the
    // player has already decided to go, and it stops the refresh poll from
    // racing the seat release -- once they are no longer seated, a poll
    // against a private table is correctly rejected.
    leave();
    try {
      const response = await fetch(`/api/games/${tableId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "leave-seat" }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.profile) setProfile(data.profile);
      // Chips only become Gold when the player stands up, so this is the one
      // moment the loop is visible. Say it plainly instead of leaving them to
      // spot the balance change in the navbar. Unlimited profiles are neither
      // charged nor paid, so there is no balance change to announce.
      if (
        response.ok
        && typeof data?.cashedOut === "number"
        && data.cashedOut > 0
        && !data?.profile?.unlimitedGold
      ) {
        setCashOutNotice(data.cashedOut);
      }
    } catch {
      // Best effort: the seat still reverts to a bot server-side even if this
      // client never hears back, so there's nothing useful to show here.
    } finally {
      setLoading(false);
    }
  };

  const claimBackstop = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/gold/backstop", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not top up your Gold.");
      setProfile(data.profile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not top up your Gold.");
    } finally {
      setLoading(false);
    }
  };

  // Completes a sign-in: Supabase has redirected back with a session, so
  // hand its access token to the server, which verifies it and either links
  // this guest profile or restores the one the account already owns.
  const linkAccount = useCallback(async (accessToken: string) => {
    try {
      const response = await fetch("/api/auth/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save your progress.");
      setProfile(data.profile);
      setAuthNotice(data.restored ? "Welcome back — your progress is restored." : "Progress saved to your account.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your progress.");
    }
  }, []);

  useEffect(() => {
    const client = authClient();
    if (!client) return;
    // Fires on the redirect back from the provider, and again on refresh
    // while a session is cached, which is what keeps a returning player
    // signed in without a second trip through the provider.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) void linkAccount(session.access_token);
    });
    return () => data.subscription.unsubscribe();
  }, [linkAccount]);

  const signIn = async () => {
    const client = authClient();
    if (!client) return;
    setError(null);
    const { error: signInError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (signInError) setError("Could not open Google sign-in. Try again.");
  };

  const signOut = async () => {
    setError(null);
    // Clear the provider session and the session cookie. The cookie is the
    // credential the server trusts, so skipping it would leave this browser
    // still holding the signed-in profile while the UI claimed otherwise.
    await authClient()?.auth.signOut().catch(() => {});
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
    setGame(null);
    setAuthNotice("Signed out. This browser is a guest again.");
    await loadProfile().catch(() => {});
  };

  /** Leaving the table while still seated cashes out first, so chips are never stranded. */
  const leaveTable = () => {
    if (game?.isSeated) {
      void leaveSeat();
      return;
    }
    leave();
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
            <div className="header-status">No-limit Hold’em · 6-max</div>
            {profile && <GoldBadge profile={profile} onClaimed={setProfile} />}
            <AuthButton profile={profile} onSignIn={() => void signIn()} onSignOut={() => void signOut()} />
            <Link className="auth-button" href="/collection">Collection</Link>
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
            onLeave={leaveTable}
            onLeaveSeat={leaveSeat}
            profile={profile}
            onCustomize={() => setProfileOpen(true)}
            onProfileChange={setProfile}
            connectionState={connectionState}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            onPurchaseRebuy={purchaseRebuy}
            onSignIn={() => void signIn()}
            onSignOut={() => void signOut()}
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
            sessionReady={!profileLoading}
            error={error}
            cashOutNotice={cashOutNotice}
            onDismissCashOut={() => setCashOutNotice(null)}
            onClaimBackstop={claimBackstop}
            authNotice={authNotice}
            onDismissAuthNotice={() => setAuthNotice(null)}
            onSaveProgress={signIn}
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
