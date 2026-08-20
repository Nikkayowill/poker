"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Delete, CornerDownLeft } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ShareResultButton } from "@/components/arcade/share-result-button";
import { NextPuzzleCountdown } from "@/components/arcade/next-puzzle-countdown";
import { puzzleShareTitle, wordStackShareText } from "@/lib/arcade/puzzles/share";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import {
  WORD_STACK_MAX_GUESSES,
  WORD_STACK_WORD_LENGTH,
  type WordStackSnapshot,
  type WordStackTile,
} from "@/lib/arcade/puzzles/word-stack";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Daily Word Stack.
 *
 * The rules live in lib/arcade/puzzles/word-stack.ts and the answer lives on the
 * server. This file holds one snapshot and replaces it wholesale with whatever
 * the API returns, because every guess is a request and the response is the
 * new truth -- the same contract blackjack-table.tsx uses.
 *
 * The client cannot score a guess and does not try: `snapshot.answer` is null
 * until the board is over, so the tiles come back coloured from the server or
 * not at all. That is the whole reason this is not a static page.
 *
 * ## The on-screen keyboard is not decoration
 *
 * A phone will not raise its keyboard for a page with no focused input, and
 * making the board a real <input> means the OS keyboard covering the grid,
 * autocorrect rewriting guesses and a caret to fight with. So letters are
 * buttons, and a physical keyboard is handled separately with a window
 * listener. Both paths funnel into the same three actions.
 */

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

interface WordStackResponse {
  round: WordStackSnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
  error?: string;
  reason?: string;
}

/** How long a transient message ("Not in the word list") stays up. */
const NOTICE_MS = 1800;

export function WordStackBoard() {
  // Applies the player's stored mute on a route where PokerApp is not
  // mounted. The flag it sets is module-global, which is what lets the JSX
  // below call the chrome cues directly. See lib/audio/ui-sounds.ts.
  useArcadeSound();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [round, setRound] = useState<WordStackSnapshot | null>(null);
  const [meta, setMeta] = useState<{ day: string; puzzleNumber: number; nextPuzzleAt: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** Set on the row that was just rejected, so it can shake without a state machine. */
  const [shake, setShake] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    setShake(true);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      setShake(false);
    }, NOTICE_MS);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  const send = useCallback(
    async (url: string, body?: unknown) => {
      setBusy(true);
      try {
        const response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          cache: "no-store",
          ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        });
        const data = (await response.json()) as Partial<WordStackResponse>;
        if (data.profile) setProfile(data.profile);
        if (data.day) {
          setMeta({
            day: data.day,
            puzzleNumber: data.puzzleNumber ?? 0,
            // Absolute instant, resolved here rather than in the
            // countdown: this is the moment the server's remaining-ms was
            // accurate, and reading the clock during render is impure.
            nextPuzzleAt: Date.now() + (data.msUntilNextPuzzle ?? 0),
          });
        }

        if (!response.ok) {
          // A rejection carries the true board when there is one, so a client
          // that fell behind resyncs from the error rather than staying stuck.
          if (data.round !== undefined) setRound(data.round);
          // A rolled-over board is the one case where the whole page is stale.
          if (data.reason === "rolled-over") {
            setRound(null);
            setDraft("");
          }
          flash(data.error ?? "That did not go through.");
          return false;
        }

        setRound(data.round ?? null);
        return true;
      } catch {
        flash("Could not reach the puzzle. Check your connection.");
        return false;
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [flash],
  );

  // Read first, then open a board if there is none. The GET is deliberately
  // read-only server-side -- visiting a page must not consume the day's
  // attempt -- so opening costs one extra request on the first visit of a day.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/arcade/word-stack", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Partial<WordStackResponse>;
      if (cancelled) return;
      if (data.profile) setProfile(data.profile);
      if (data.day) {
        setMeta({
          day: data.day,
          puzzleNumber: data.puzzleNumber ?? 0,
          nextPuzzleAt: Date.now() + (data.msUntilNextPuzzle ?? 0),
        });
      }
      if (data.round) {
        setRound(data.round);
        setLoaded(true);
        return;
      }
      await send("/api/arcade/word-stack", {});
    })();
    return () => {
      cancelled = true;
    };
  }, [send]);

  const finished = Boolean(round && round.status !== "active");
  const canType = Boolean(round) && !finished && !busy;

  const submit = useCallback(() => {
    if (!round || !canType) return;
    if (draft.length !== WORD_STACK_WORD_LENGTH) {
      flash(`A guess is ${WORD_STACK_WORD_LENGTH} letters.`);
      return;
    }
    const guess = draft;
    void (async () => {
      const ok = await send("/api/arcade/word-stack/actions", {
        day: round.day,
        version: round.version,
        guess,
      });
      // The draft is cleared only on an accepted guess: a word the dictionary
      // refused should still be sitting there to edit, not retyped from scratch.
      if (ok) setDraft("");
    })();
  }, [canType, draft, flash, round, send]);

  const type = useCallback(
    (letter: string) => {
      if (!canType) return;
      setDraft((current) => (current.length >= WORD_STACK_WORD_LENGTH ? current : current + letter));
    },
    [canType],
  );

  const backspace = useCallback(() => {
    if (!canType) return;
    setDraft((current) => current.slice(0, -1));
  }, [canType]);

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

  /**
   * The six rows: guesses already scored, then the row being typed, then
   * empties. Built here rather than in the markup so the row index -- which
   * decides the reveal animation and the shake -- is unambiguous.
   */
  const rows = useMemo(() => {
    const played = (round?.guesses ?? []).map((guess, index) => ({
      letters: guess.split(""),
      tiles: round?.results[index] ?? [],
      state: "played" as const,
    }));
    const drafting =
      round && !finished
        ? [{
          letters: draft.padEnd(WORD_STACK_WORD_LENGTH, " ").split("").map((c) => c.trim()),
          tiles: [] as WordStackTile[],
          state: "drafting" as const,
        }]
        : [];
    const blanks = Array.from(
      { length: Math.max(0, WORD_STACK_MAX_GUESSES - played.length - drafting.length) },
      () => ({ letters: Array(WORD_STACK_WORD_LENGTH).fill(""), tiles: [] as WordStackTile[], state: "empty" as const }),
    );
    return [...played, ...drafting, ...blanks];
  }, [draft, finished, round]);

  const shareText = round ? wordStackShareText(round, { link: shareLink() }) : null;

  return (
    <main className="bj-shell puzzle-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <Link className="bj-back" href="/" onClick={tapSound}>← Back to the lobby</Link>
          <h1>Daily Word Stack</h1>
          <p>
            {meta ? `Puzzle #${meta.puzzleNumber}` : "Loading…"} · Six guesses · One word a day for everyone
          </p>
        </div>
        {profile && (
          <div className="puzzle-player">
            <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
            <span className="bj-hand-who">
              <span className="bj-hand-label">{profile.displayName}</span>
              <span className="bj-hand-caption">
                {round ? `${round.guesses.length}/${round.maxGuesses} guesses` : "—"}
              </span>
            </span>
          </div>
        )}
      </header>

      {/* Always mounted so a message is announced as a change rather than as
          new content, and so the grid never shifts when one appears. */}
      <p className={clsx("puzzle-notice", notice && "puzzle-notice-on")} role="status" aria-live="polite">
        {notice}
      </p>

      <section className="word-stack-grid" aria-label="Guesses" aria-busy={busy}>
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={clsx(
              "word-stack-row",
              row.state === "drafting" && shake && "word-stack-row-shake",
            )}
          >
            {Array.from({ length: WORD_STACK_WORD_LENGTH }, (_, column) => (
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

      {finished && round && (
        <section className="puzzle-summary">
          <p className="puzzle-verdict">
            {round.status === "won"
              ? `Solved in ${round.guesses.length}.`
              : "Out of guesses."}
            {round.answer && round.status === "lost" && (
              <em> The word was <strong>{round.answer.toUpperCase()}</strong>.</em>
            )}
          </p>
          {/* The grid, exactly as it will be posted. Showing it is what makes
              the button read as "send this" rather than "send something". */}
          <pre className="puzzle-share-preview" aria-label="Your result">{shareText}</pre>
          {shareText && (
            <ShareResultButton text={shareText} title={puzzleShareTitle("word-stack", round.puzzleNumber)} />
          )}
          {meta && <NextPuzzleCountdown deadline={meta.nextPuzzleAt} />}
        </section>
      )}

      {!finished && (
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
                    round?.keyboard[letter] && `word-stack-key-${round.keyboard[letter]}`,
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
      )}

      {!loaded && <p className="puzzle-loading">Loading today’s puzzle…</p>}
    </main>
  );
}

/**
 * The link appended to a shared result.
 *
 * Read off the running origin rather than hardcoded, so a share from a Preview
 * deployment points at that deployment instead of sending a reviewer to
 * production.
 */
function shareLink(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/games/word-stack`;
}
