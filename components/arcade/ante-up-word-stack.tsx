"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins, Delete, CornerDownLeft } from "lucide-react";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { StakePicker } from "@/components/pvp/stake-picker";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { MIN_ANTE_UP_WAGER, type AnteUpWordStackSnapshot } from "@/lib/arcade/ante-up-word-stack";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Ante Up: Word Stack -- the other solo half of Ante Up, alongside Sudoku.
 *
 * Same wager step as ante-up-sudoku.tsx (StakePicker, floored at
 * MIN_ANTE_UP_WAGER, zero always allowed as free practice) but no difficulty
 * pick and no clock -- Word Stack's own loss condition (six guesses, no
 * solve) is what ends an attempt, and the payout multiplier is decided at
 * settlement off how many guesses the win took, not chosen up front. The grid
 * and keyboard reuse word-stack-board.tsx's own markup/CSS classes
 * (25-puzzles.css's .word-stack-*) wholesale, reading from the attempt
 * instead of the shared daily round -- same shapes, different source.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000] as const;
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

interface AnteUpWordStackResponse {
  attempt: AnteUpWordStackSnapshot | null;
  profile: PlayerProfile;
  error?: string;
  round?: AnteUpWordStackSnapshot;
}

export function AnteUpWordStack() {
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpWordStackSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";
  const canType = active && !busy;

  // Same guard duel-shell.tsx and ante-up-sudoku.tsx keep: true while the
  // player's own action is in flight, so nothing else stomps that response.
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const applyResponse = useCallback((data: Partial<AnteUpWordStackResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, []);

  /** The background read: the live attempt (or none), on mount only -- Word Stack has no clock to catch mid-flight. */
  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/ante-up-word-stack", { cache: "no-store" });
      const data = (await response.json()) as Partial<AnteUpWordStackResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped initial read is not worth a banner -- the lobby just renders empty.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  /** A player-initiated action: start, guess, resign. Every non-ok response is a real error, not ordinary play. */
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
      const data = (await response.json()) as Partial<AnteUpWordStackResponse>;
      if (!mounted.current) return false;
      if (!response.ok) {
        // A rejection still carries the true board when the guess didn't move
        // it on -- resync from it rather than leaving the client stale.
        if (data.round) setAttempt(data.round);
        setError(data.error ?? "That did not go through.");
        return false;
      }
      applyResponse(data);
      return true;
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
      return false;
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse]);

  // Initial read, deferred a tick -- the idiom every arcade table and the duel
  // shell share: a fetch fired straight from an effect body sets state during
  // the same commit.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const openAttempt = () => {
    setDraft("");
    void send("/api/ante-up-word-stack", { wager });
  };

  const type = useCallback(
    (letter: string) => {
      if (!canType || !attempt) return;
      setDraft((current) => (current.length >= attempt.wordLength ? current : current + letter));
    },
    [attempt, canType],
  );

  const backspace = useCallback(() => {
    if (!canType) return;
    setDraft((current) => current.slice(0, -1));
  }, [canType]);

  const submit = useCallback(() => {
    if (!attempt || !canType) return;
    if (draft.length !== attempt.wordLength) {
      setError(`A guess is ${attempt.wordLength} letters.`);
      return;
    }
    const guess = draft;
    void (async () => {
      const ok = await send("/api/ante-up-word-stack/actions", {
        action: "guess",
        version: attempt.version,
        guess,
      });
      // The draft is cleared only on an accepted guess -- one the dictionary
      // refused should still be sitting there to edit, not retyped from scratch.
      if (ok) {
        setDraft("");
        play("ui");
      }
    })();
  }, [attempt, canType, draft, play, send]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        submit();
        return;
      }
      if (event.key === "Backspace") {
        backspace();
        return;
      }
      if (/^[a-zA-Z]$/.test(event.key)) type(event.key.toLowerCase());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backspace, submit, type]);

  const resign = () => void send("/api/ante-up-word-stack/actions", { action: "resign" });
  const playAgain = () => { setAttempt(null); setDraft(""); setError(null); };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const canAfford = wager === 0 || (wager >= MIN_ANTE_UP_WAGER && balance >= wager);

  /**
   * The six rows: guesses already scored, then the row being typed (while
   * active), then empties. Same shape as word-stack-board.tsx's own `rows`.
   */
  const rows = useMemo(() => {
    if (!attempt) return [];
    const played = attempt.guesses.map((guess, index) => ({
      letters: guess.split(""),
      tiles: attempt.results[index] ?? [],
      state: "played" as const,
    }));
    const drafting = attempt.status === "active"
      ? [{
        letters: draft.padEnd(attempt.wordLength, " ").split("").map((c) => c.trim()),
        tiles: [] as AnteUpWordStackSnapshot["results"][number],
        state: "drafting" as const,
      }]
      : [];
    const blanks = Array.from(
      { length: Math.max(0, attempt.maxGuesses - played.length - drafting.length) },
      () => ({
        letters: Array(attempt.wordLength).fill(""),
        tiles: [] as AnteUpWordStackSnapshot["results"][number],
        state: "empty" as const,
      }),
    );
    return [...played, ...drafting, ...blanks];
  }, [attempt, draft]);

  // Out of guesses (six played, no solve) reads differently from giving up
  // early -- the attempt carries no separate status for it, so the guess
  // count is what tells the two apart, same as ante-up-sudoku's timed-out vs
  // gave-up split.
  const outOfGuesses = attempt !== null && attempt.status === "lost" && attempt.guesses.length >= attempt.maxGuesses;

  return (
    <main className="duel-shell ante-shell">
      <header className="floor-bar">
        <Link className="floor-back" href="/games" onClick={tapSound}>← Ante Up</Link>
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

      {!attempt ? (
        <div className="duel-lobby">
          <div className="floor-head">
            <div className="lobby-kicker">Ante Up</div>
            <h1>Word Stack, for Gold</h1>
            <p>Wager on your own vocabulary. Solve a fresh five-letter word before you run out of guesses.</p>
          </div>

          <section className="duel-panel">
            <h2 className="floor-section-head">Your wager</h2>
            <StakePicker
              ariaLabel="Wager"
              picks={STAKE_QUICK_PICKS}
              value={wager}
              min={0}
              leading={{ label: "Free", value: 0 }}
              onChange={(next) => { selectSound(); setWager(next); }}
            />
            <p className="duel-pot-note">
              {wager === 0
                ? "Free practice -- no payout on a win, but there's no fun in that."
                : wager < MIN_ANTE_UP_WAGER
                  ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                  : "Fewer guesses, bigger payout -- solve it fast and cash out big. Miss all six and the wager is gone."}
            </p>

            <button
              type="button"
              className="floor-play duel-open"
              disabled={busy || !loaded || !canAfford}
              onClick={() => { selectSound(); openAttempt(); }}
            >
              {!loaded ? "…" : !canAfford ? "Not enough Gold" : busy ? "Dealing…" : "Ante up"}
            </button>
          </section>
        </div>
      ) : (
        <div className="duel-match ante-match">
          <div className="duel-scoreline ante-scoreline">
            <span className="ante-clock" aria-live="polite">
              {attempt.guesses.length}/{attempt.maxGuesses} guesses
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && attempt.status === "won" && (
                <small>→ {attempt.payout.toLocaleString()}</small>
              )}
            </span>
          </div>

          <section className="word-stack-grid" aria-label="Guesses" aria-busy={busy}>
            {rows.map((row, rowIndex) => (
              <div key={rowIndex} className="word-stack-row">
                {Array.from({ length: attempt.wordLength }, (_, column) => (
                  <span
                    key={column}
                    className={clsx(
                      "word-stack-tile",
                      row.tiles[column] && `word-stack-tile-${row.tiles[column]}`,
                      row.letters[column] && row.state === "drafting" && "word-stack-tile-filled",
                    )}
                    style={row.state === "played" ? { animationDelay: `${column * 90}ms` } : undefined}
                  >
                    {row.letters[column] ?? ""}
                  </span>
                ))}
              </div>
            ))}
          </section>

          {settled ? (
            <div
              className={clsx(
                "duel-result",
                attempt.status === "won" && "duel-result-won",
              )}
            >
              <strong>
                {attempt.status === "won" ? "You solved it" : outOfGuesses ? "Out of guesses" : "Gave up"}
              </strong>
              <span>{attempt.guesses.length} {attempt.guesses.length === 1 ? "guess" : "guesses"} used</span>
              {attempt.status !== "won" && attempt.answer && (
                <span>The word was <strong>{attempt.answer.toUpperCase()}</strong></span>
              )}
              <span className="duel-result-gold">
                {attempt.status === "won"
                  ? attempt.wager > 0 ? `+${attempt.payout.toLocaleString()} Gold` : "Practice round -- no Gold at stake"
                  : attempt.wager > 0 ? `−${attempt.wager.toLocaleString()} Gold` : "Practice round -- nothing lost"}
              </span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <>
              <section className="word-stack-keyboard" aria-label="Keyboard">
                {KEY_ROWS.map((row, index) => (
                  <div key={row} className="word-stack-keyrow">
                    {index === 2 && (
                      <button
                        type="button"
                        className="word-stack-key word-stack-key-wide"
                        onClick={() => { selectSound(); submit(); }}
                        disabled={!canType}
                        aria-label="Submit guess"
                      >
                        <CornerDownLeft size={15} aria-hidden="true" />
                      </button>
                    )}
                    {row.split("").map((letter) => (
                      <button
                        key={letter}
                        type="button"
                        className={clsx(
                          "word-stack-key",
                          attempt.keyboard[letter] && `word-stack-key-${attempt.keyboard[letter]}`,
                        )}
                        onClick={() => { tapSound(); type(letter); }}
                        disabled={!canType}
                      >
                        {letter}
                      </button>
                    ))}
                    {index === 2 && (
                      <button
                        type="button"
                        className="word-stack-key word-stack-key-wide"
                        onClick={() => { tapSound(); backspace(); }}
                        disabled={!canType}
                        aria-label="Delete letter"
                      >
                        <Delete size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </section>
              <div className="duel-controls">
                <button type="button" className="duel-resign" disabled={busy} onClick={() => void resign()}>
                  Give up
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
