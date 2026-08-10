"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { PlayingCard } from "@/components/table/playing-card";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { NextPuzzleCountdown } from "@/components/arcade/next-puzzle-countdown";
import { ShareResultButton } from "@/components/arcade/share-result-button";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  MEMORY_PAIRS,
  memoryOutcomeLabel,
  type MemorySnapshot,
} from "@/lib/arcade/puzzles/memory";
import { formatDuration } from "@/lib/arcade/puzzles/sudoku";
import { memoryShareText, puzzleShareTitle } from "@/lib/arcade/puzzles/share";

/**
 * Memory Match.
 *
 * Every face-down tile is genuinely absent from the payload -- `board[i]` is
 * null until the card is turned over or matched -- so each tap is a request
 * and the response is the card. That is the whole security model of the game
 * and it is also, conveniently, exactly how the game feels: you find out by
 * turning it over.
 *
 * The card backs are the player's own equipped cosmetic, which is the reason
 * the catalogue calls this "pair the card backs" -- it is the one board in the
 * arcade that is mostly made of them.
 */

interface MemoryResponse {
  round: MemorySnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
  error?: string;
}

export function MemoryBoard() {
  const [state, setState] = useState<MemoryResponse | null>(null);
  const [nextPuzzleAt, setNextPuzzleAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const play = useArcadeSound();
  const round = state?.round ?? null;
  const solved = round?.status === "solved";

  const send = useCallback(async (url: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const data = (await response.json()) as Partial<MemoryResponse>;
      if (!response.ok) {
        setError(data.error ?? "That did not go through. Try again.");
        if (data.round) setState((current) => (current ? { ...current, round: data.round! } : current));
        return;
      }
      setState(data as MemoryResponse);
      setNextPuzzleAt(Date.now() + (data.msUntilNextPuzzle ?? 0));
    } catch {
      setError("Could not reach the board. Check your connection.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void send("/api/arcade/memory"), 0);
    return () => window.clearTimeout(timer);
  }, [send]);

  useEffect(() => {
    if (!round || round.status !== "playing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [round]);

  /**
   * A matched pair is worth a sound; a miss is not. `lose` is null in the
   * manifest by design, so the alternative would be reaching for a stand-in.
   */
  const pairsHeard = useRef(0);
  useEffect(() => {
    if (!round) return;
    const pairs = round.matched.length / 2;
    if (pairs === pairsHeard.current) return;
    // A ref, not state: nothing renders from this, and holding it in state
    // would re-render the whole board to remember that a sound already played.
    // Written inside the effect, which is where a ref may be touched.
    const grew = pairs > pairsHeard.current;
    pairsHeard.current = pairs;
    if (grew) play(pairs === MEMORY_PAIRS ? "win" : "card");
  }, [round, play]);

  const deal = () => void send("/api/arcade/memory", {});

  const flip = (index: number) => {
    if (!round || busy || solved) return;
    if (round.matched.includes(index) || round.revealed.includes(index)) return;
    void send("/api/arcade/memory/actions", { version: round.version, index });
  };

  const elapsed = round ? round.elapsedMs ?? Math.max(0, now - Date.parse(round.startedAt)) : 0;
  const shareText = round ? memoryShareText(round, { link: "https://stackchips.app/games/memory" }) : null;

  return (
    <main className="bj-shell mm-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <Link className="bj-back" href="/">← Back to the lobby</Link>
          <h1>Memory Match</h1>
          <p>
            {state ? `#${state.puzzleNumber} · ` : ""}Eight pairs · One board a day · Resets at midnight UTC
          </p>
        </div>
        <div className="bj-header-meters">
          <span className="bj-meter">
            <small>Time</small>
            <strong>{round ? formatDuration(elapsed) : "—"}</strong>
          </span>
          <span className="bj-meter">
            <small>Turns</small>
            <strong>{round?.turns ?? 0}</strong>
          </span>
          <span className="bj-meter">
            <small>Pairs</small>
            <strong>
              {(round?.matched.length ?? 0) / 2}/{MEMORY_PAIRS}
            </strong>
          </span>
        </div>
      </header>

      <p className="bj-practice-note">
        Your board is shuffled for you alone — this is the one daily where a shared layout would end the
        game rather than make it fair, since a single screenshot would give it away. Everyone gets the same
        eight ranks and one attempt; what you post is your time and your turn count.
      </p>

      {error && (
        <p className="bj-error" role="alert">
          {error}
        </p>
      )}

      <section className="bj-felt hud-felt-plain mm-felt" aria-live="polite" aria-busy={busy}>
        {!round ? (
          <div className="sk-start">
            <p>Today&apos;s board is face down and waiting.</p>
            <button type="button" className="bj-action bj-action-deal" disabled={busy} onClick={deal}>
              {busy ? "Dealing…" : "Deal the board"}
            </button>
          </div>
        ) : (
          <>
            <div className="mm-grid" style={{ "--mm-columns": round.columns } as React.CSSProperties}>
              {round.board.map((card, index) => {
                const matched = round.matched.includes(index);
                const up = matched || round.revealed.includes(index);
                return (
                  <button
                    key={index}
                    type="button"
                    className={clsx("mm-tile", up && "mm-tile-up", matched && "mm-tile-matched")}
                    disabled={busy || up || solved}
                    aria-label={up && card ? `${card.rank} of ${card.suit}` : "Face-down card"}
                    onClick={() => flip(index)}
                  >
                    {/* Face-down draws the player's own equipped back, which is
                        what makes this board theirs. `card` really is null
                        until the server turns it over. */}
                    <PlayingCard card={card} back={state?.profile.equipped.cardBack} />
                  </button>
                );
              })}
            </div>

            <div className="bj-verdict">
              <span className={clsx("bj-verdict-chip", solved && "bj-verdict-win")}>
                {memoryOutcomeLabel(round)}
              </span>
            </div>

            {solved && (
              <div className="sk-done">
                <strong>
                  {formatDuration(round.elapsedMs ?? elapsed)} · {round.turns} turns
                  {round.turns === round.perfectTurns ? " · perfect" : ""}
                </strong>
                {shareText && (
                  <ShareResultButton
                    text={shareText}
                    title={puzzleShareTitle("memory", round.puzzleNumber)}
                  />
                )}
                {nextPuzzleAt !== null && <NextPuzzleCountdown deadline={nextPuzzleAt} />}
              </div>
            )}
          </>
        )}

        {state?.profile && (
          <div className="bj-hand-head mm-player-head">
            <ProfileAvatar profile={{ ...state.profile, avatarCosmetic: state.profile.equipped.avatar2d }} />
            <span className="bj-hand-who">
              <span className="bj-hand-label">{state.profile.displayName}</span>
              <span className="bj-hand-caption">
                {solved ? "Board cleared" : round ? "In progress" : "Not started"}
              </span>
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
