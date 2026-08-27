"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins, Delete, CornerDownLeft } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ShareResultButton } from "@/components/arcade/share-result-button";
import { NextPuzzleCountdown } from "@/components/arcade/next-puzzle-countdown";
import { StakePicker } from "@/components/pvp/stake-picker";
import { puzzleShareTitle, wordStackShareText } from "@/lib/arcade/puzzles/share";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import {
  WORD_STACK_MAX_GUESSES,
  WORD_STACK_WORD_LENGTH,
  type WordStackSnapshot,
  type WordStackTile,
} from "@/lib/arcade/puzzles/word-stack";
import { MIN_ANTE_UP_WAGER } from "@/lib/arcade/ante-up-word-stack";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Daily Word Stack.
 *
 * The rules live in lib/arcade/puzzles/word-stack.ts and the answer lives on the
 * server. This file holds one snapshot and replaces it wholesale with whatever
 * the API returns, because every guess is a request and the response is the
 * new truth, the same contract blackjack-table.tsx uses.
 *
 * The client cannot score a guess and does not try: `snapshot.answer` is null
 * until the board is over, so the tiles come back coloured from the server or
 * not at all. That's the whole reason this isn't a static page.
 *
 * The board still opens once and stays open for the day (one shared word,
 * one shareable grid). The wager choice sits before the board opens rather
 * than as a link offered only after it's finished: `round === null` after
 * the initial read is the "not opened yet" state, and it renders a wager
 * step (Free is always a choice) instead of auto-opening; see startBoard.
 *
 * The on-screen keyboard is not decoration. A phone will not raise its
 * keyboard for a page with no focused input, and making the board a real
 * <input> means the OS keyboard covering the grid, autocorrect rewriting
 * guesses and a caret to fight with. So letters are buttons, and a physical
 * keyboard is handled separately with a window listener. Both paths funnel
 * into the same three actions.
 */

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000] as const;

interface WordStackResponse {
  round: (WordStackSnapshot & { wager: number; payout: number }) | null;
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
  useArcadeSound({ gameSounds: true });
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [round, setRound] = useState<(WordStackSnapshot & { wager: number; payout: number }) | null>(null);
  const [meta, setMeta] = useState<{ day: string; puzzleNumber: number; nextPuzzleAt: number } | null>(null);
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
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

  // Read-only first: visiting a page must not consume the day's attempt.
  // If today's board already exists (any status), it loads straight in; if
  // not, the wager step below is what actually opens one, on the player's
  // own click.
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
      setRound(data.round ?? null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startBoard = useCallback(() => {
    void send("/api/arcade/word-stack", { wager });
  }, [send, wager]);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const canAffordWager = balance >= wager;

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
   * empties. Built here rather than in the markup so the row index, which
   * decides the reveal animation and the shake, is unambiguous.
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
          <Link className="bj-back" href="/games" onClick={tapSound}>← Ante Up</Link>
          <h1>Daily Word Stack</h1>
          <p>
            {meta ? `Puzzle #${meta.puzzleNumber}` : "Loading…"} · Six guesses · One word a day for everyone
          </p>
        </div>
        {profile && (
          <div className="puzzle-player">
            <span className="gold-balance">
              <Coins size={13} aria-hidden="true" />
              <strong>{profile.unlimitedGold ? "Unlimited" : profile.goldBalance.toLocaleString()}</strong>
            </span>
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

      {loaded && !round && (
        <section className="puzzle-summary">
          <p className="puzzle-verdict">Wager Gold on today&apos;s word, or play free.</p>
          <StakePicker
            ariaLabel="Wager"
            picks={STAKE_QUICK_PICKS}
            value={wager}
            min={0}
            leading={{ label: "Free", value: 0 }}
            onChange={(next) => { selectSound(); setWager(next); }}
          />
          <p className="puzzle-verdict">
            {wager === 0
              ? "Free daily play — no Gold at stake."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : "Fewer guesses, bigger payout — miss all six and the wager is gone."}
          </p>
          <button
            type="button"
            className="puzzle-share-button"
            disabled={busy || (wager > 0 && wager < MIN_ANTE_UP_WAGER) || (wager > 0 && !canAffordWager)}
            onClick={() => { selectSound(); startBoard(); }}
          >
            <Coins size={15} aria-hidden="true" />
            {busy ? "Dealing…" : wager > 0 && !canAffordWager ? "Not enough Gold" : wager === 0 ? "Play free" : "Ante up"}
          </button>
        </section>
      )}

      {round && (
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
      )}

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
          {round.wager > 0 && (
            <p className="puzzle-verdict">
              {round.status === "won"
                ? <strong>+{round.payout.toLocaleString()} Gold</strong>
                : <strong>−{round.wager.toLocaleString()} Gold</strong>}
            </p>
          )}
          {/* The grid, exactly as it will be posted. Showing it is what makes
              the button read as "send this" rather than "send something". */}
          <pre className="puzzle-share-preview" aria-label="Your result">{shareText}</pre>
          {shareText && (
            <ShareResultButton text={shareText} title={puzzleShareTitle("word-stack", round.puzzleNumber)} />
          )}
          {meta && <NextPuzzleCountdown deadline={meta.nextPuzzleAt} />}
        </section>
      )}

      {round && !finished && (
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
 * The link appended to a shared result. Read off the running origin rather
 * than hardcoded, so a share from a Preview deployment points at that
 * deployment instead of sending a reviewer to production.
 */
function shareLink(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/games/word-stack`;
}
