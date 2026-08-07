"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import {
  METER_ROLL_MS,
  celebrationTier,
  formatSigned,
  meterValue,
  sessionTone,
  type CelebrationTier,
} from "@/lib/arcade/hud";

/**
 * The furniture every arcade machine is built out of.
 *
 * Blackjack and Hi-Lo share a shell by both writing `.bj-*` class names, which
 * worked for two pages and would be an unmaintainable convention at eight. The
 * markup lives here instead, so a change to the cabinet is one edit rather
 * than eight, and so the four new machines cannot quietly diverge into four
 * products the way `24-hi-lo.css`'s header warns about.
 *
 * The class names stay `.bj-*` wherever a rule already exists for them --
 * 23-blackjack.css is the shell, and renaming 300 lines of working CSS to make
 * this file read better would be churn with a real regression surface. New
 * behaviour takes new `.hud-*` names in 28-arcade-hud.css.
 *
 * All of the arithmetic is in lib/arcade/hud.ts, where `npm test` can see it.
 */

/* ------------------------------------------------------------------ meters */

/**
 * A number that rolls to its new value instead of jumping.
 *
 * This is the single most "casino machine" thing on the page and it is nearly
 * free: a win that snaps the balance from 1,000 to 5,000 reads as a data
 * update, and the same win rolled over half a second reads as being paid.
 *
 * The roll restarts from wherever it currently is rather than from the last
 * settled value, so a second win landing mid-roll continues smoothly instead
 * of snapping backwards to re-run.
 */
export function CreditMeter({ value, className }: { value: number; className?: string }) {
  const nodeRef = useRef<HTMLSpanElement | null>(null);
  /** What the element currently reads, so an interrupted roll resumes from there. */
  const shownRef = useRef(value);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const from = shownRef.current;
    if (from === value) {
      node.textContent = value.toLocaleString();
      return;
    }

    const write = (amount: number) => {
      shownRef.current = amount;
      node.textContent = amount.toLocaleString();
    };

    // A meter that rolls is motion for its own sake, which is exactly what
    // this query is for. Snap, and the number is still correct.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      write(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const next = meterValue(from, value, now - start, METER_ROLL_MS);
      write(next);
      // meterValue lands exactly on the target, so this terminates rather
      // than holding the frame loop awake forever a Gold short.
      if (next !== value) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  // The digits are written straight to the DOM rather than held in state. Not
  // a micro-optimisation: a roll is sixty updates a second, and pushing each
  // one through React would re-render the whole header meter row for every
  // frame of an animation that is purely visual. The same reasoning moved the
  // turn clock out of React in components/table/use-fuse.ts.
  //
  // The server-rendered text is the true value, so a page that never hydrates
  // still shows the right number rather than a blank.
  return (
    <span ref={nodeRef} className={className}>
      {value.toLocaleString()}
    </span>
  );
}

/**
 * The header readouts: balance, session, rounds played.
 *
 * `loaded` is separate from a zero balance on purpose. An unloaded wallet is
 * an empty one (toArcadeWallet never fails open), which keeps the gates shut
 * for the length of one fetch -- correct, but it must not be *worded* as a
 * verdict before the balance has arrived, so this prints an em dash.
 */
export function ArcadeMeters({
  loaded,
  goldBalance,
  unlimitedGold,
  sessionNet,
  roundsPlayed,
  extra,
}: {
  loaded: boolean;
  goldBalance: number;
  unlimitedGold: boolean;
  sessionNet: number;
  roundsPlayed: number;
  /** One more readout, where a machine has something worth standing beside these. */
  extra?: { label: string; value: ReactNode };
}) {
  const tone = sessionTone(sessionNet);
  return (
    <div className="bj-header-meters">
      <span className="bj-meter hud-meter-gold">
        <small>Credits</small>
        <span className="gold-balance">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {!loaded ? "—" : unlimitedGold ? "Unlimited" : <CreditMeter value={goldBalance} />}
          </strong>
        </span>
      </span>
      <span className={clsx("bj-meter", tone === "up" && "bj-meter-up", tone === "down" && "bj-meter-down")}>
        <small>Session</small>
        <strong>{formatSigned(sessionNet)}</strong>
      </span>
      <span className="bj-meter">
        <small>Rounds</small>
        <strong>{roundsPlayed}</strong>
      </span>
      {extra && (
        <span className="bj-meter">
          <small>{extra.label}</small>
          <strong>{extra.value}</strong>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ header */

export function ArcadeHeader({
  title,
  rules,
  children,
}: {
  title: string;
  /** The house rules, in one line. A player should not have to find these. */
  rules: string;
  children?: ReactNode;
}) {
  return (
    <header className="bj-header">
      <div className="bj-header-copy">
        <Link className="bj-back" href="/">← Back to the lobby</Link>
        <h1>{title}</h1>
        <p>{rules}</p>
      </div>
      {children}
    </header>
  );
}

/* ------------------------------------------------------------------- seats */

/**
 * One avatar with a name and a line under it -- the house on one side of the
 * felt, the player on the other.
 *
 * Both machines that already exist render this shape by hand; every new one
 * uses this, which is what stops the dealer's row and the player's row from
 * drifting out of alignment as pages are added.
 */
export function ArcadeSeat({
  avatar,
  name,
  caption,
  className,
}: {
  avatar: ReactNode;
  name: string;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("bj-hand-head", className)}>
      {avatar}
      <span className="bj-hand-who">
        <span className="bj-hand-label">{name}</span>
        {caption != null && <span className="bj-hand-caption">{caption}</span>}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- verdicts */

/**
 * What just happened, and what it was worth.
 *
 * The tier drives the animation rather than the raw amount, so a twenty-to-one
 * hit at the cheapest stake gets the treatment a twenty-to-one hit deserves --
 * see the note on `celebrationTier`. A push is called out as its own thing:
 * getting your stake back is a real outcome and is emphatically not a win.
 */
export function ArcadeVerdict({
  label,
  netGold,
  stake,
  idle,
}: {
  label: string | null;
  /** Null while the round is still live. */
  netGold: number | null;
  stake: number;
  idle: string;
}) {
  const tier: CelebrationTier | null = netGold === null ? null : celebrationTier(netGold, stake);

  return (
    <div className="bj-verdict">
      {tier && label !== null ? (
        <span
          // `key` on the label so a second identical result still replays the
          // animation -- two straights in a row must not look like one.
          key={`${label}:${netGold}`}
          className={clsx(
            "bj-verdict-chip",
            `hud-verdict-${tier}`,
            netGold !== null && netGold > 0 && "bj-verdict-win",
            netGold !== null && netGold < 0 && "bj-verdict-loss",
          )}
        >
          {label}
          <em>{netGold === 0 ? "Stake back" : formatSigned(netGold ?? 0)}</em>
        </span>
      ) : (
        <span className="bj-verdict-idle">{idle}</span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- last seen */

export interface HistoryChip {
  key: string;
  label: string;
  tone: "win" | "loss" | "push" | "neutral";
  /** Overrides the tone's colour -- roulette's reds and blacks are the number's, not the result's. */
  style?: React.CSSProperties;
}

/**
 * The last few results, newest first.
 *
 * Every real casino puts this somewhere -- the roulette marquee, baccarat's
 * bead plate -- and it is the cheapest thing on this page that makes a machine
 * feel like a place rather than a form. It reads only from results the player
 * has already been shown, so it can carry no information the round did not.
 */
export function ArcadeHistoryStrip({ items, empty }: { items: HistoryChip[]; empty: string }) {
  return (
    <div className="hud-history" aria-label="Recent results">
      {items.length === 0 ? (
        <span className="hud-history-empty">{empty}</span>
      ) : (
        items.map((item) => (
          <span key={item.key} className={clsx("hud-history-chip", `hud-history-${item.tone}`)} style={item.style}>
            {item.label}
          </span>
        ))
      )}
    </div>
  );
}

/* --------------------------------------------------------------- the note */

/** The two things a player must not have to discover: the Gold is real, and the house rule that shapes the odds. */
export function ArcadeStakeNote({ children }: { children: ReactNode }) {
  return <p className="bj-practice-note">{children}</p>;
}

export function ArcadeError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="bj-error" role="alert">
      {message}
    </p>
  );
}
