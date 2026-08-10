"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shuffle } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ShareResultButton } from "@/components/arcade/share-result-button";
import { NextPuzzleCountdown } from "@/components/arcade/next-puzzle-countdown";
import { connectionsShareText, puzzleShareTitle } from "@/lib/arcade/puzzles/share";
import {
  CONNECTIONS_GROUP_SIZE,
  type ConnectionsSnapshot,
} from "@/lib/arcade/puzzles/connections";
import {
  alignSelectionInline,
  selectionKey,
  shuffleBoardOrder,
} from "@/lib/arcade/puzzles/board-order";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Connections.
 *
 * The groups live on the server and this file never learns them: the snapshot
 * carries the words still on the board and the groups already solved, and
 * nothing else. A wrong guess comes back as "one away" or plain wrong -- never
 * as per-word colours, which would turn four mistakes into a free solution.
 *
 * Same one-snapshot contract as the other arcade tables: every guess is a
 * request and the response replaces the board wholesale.
 *
 * ## Shuffle is local, and that is correct
 *
 * The shuffle button reorders `words` in component state without touching the
 * server. Tile order carries no information -- it is scrambled per player at
 * deal time -- so a round trip would spend a request to rearrange something
 * the server does not care about, and would cost the player their selection
 * for the length of it.
 *
 * The *first* press for a given selection seats those tiles together on the
 * top row (alignSelectionInline) instead of scattering them; pressing again
 * without changing the picks scrambles the whole board as before. Lining a
 * candidate group up is how you look at four words together before spending a
 * mistake on them, so it earns the first press; making it every press would
 * take the plain shuffle away. Changing the selection re-arms it.
 */

interface ConnectionsResponse {
  round: ConnectionsSnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
  error?: string;
  reason?: string;
}

const NOTICE_MS = 1800;

/** Level 0-3 as the board's four colours, matching the share matrix's yellow-to-purple ramp. */
const LEVEL_CLASS = ["cx-level-0", "cx-level-1", "cx-level-2", "cx-level-3"];

export function ConnectionsBoard() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [round, setRound] = useState<ConnectionsSnapshot | null>(null);
  const [meta, setMeta] = useState<{ day: string; puzzleNumber: number; nextPuzzleAt: number } | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  /** Local display order. Empty until a board arrives; reshuffled only by the button. */
  const [order, setOrder] = useState<string[]>([]);
  /** The selection whose tiles the button has already lined up, so the next press scrambles instead. */
  const [alignedKey, setAlignedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [shake, setShake] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  const flash = useCallback((message: string, wobble = true) => {
    setNotice(message);
    setShake(wobble);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      setShake(false);
    }, NOTICE_MS);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  /**
   * The tiles as they are shown: the player's own order, minus anything that
   * has since been solved, plus anything the server knows about that the local
   * order has not seen yet (only ever the first load).
   *
   * Derived during render rather than synchronised by an effect. `order` holds
   * *only* what the shuffle button chose, so there is nothing to keep in step
   * -- and the filtering has to be a projection rather than a replacement,
   * because assigning `round.words` wholesale would re-sort the survivors into
   * server order every time a group fell, which reads as the board jumping
   * under the player's hand.
   */
  const displayed = useMemo(() => {
    if (!round) return [];
    const live = new Set(round.words);
    const kept = order.filter((word) => live.has(word));
    const added = round.words.filter((word) => !kept.includes(word));
    return [...kept, ...added];
  }, [order, round]);

  /** A tile can be solved out from under a stale selection; never trust it raw. */
  const picked = useMemo(
    () => selection.filter((word) => displayed.includes(word)),
    [displayed, selection],
  );

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
        const data = (await response.json()) as Partial<ConnectionsResponse>;
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
          if (data.round !== undefined) setRound(data.round);
          if (data.reason === "rolled-over") {
            setRound(null);
            setSelection([]);
          }
          flash(data.error ?? "That did not go through.");
          return null;
        }

        setRound(data.round ?? null);
        // The board is returned so the caller can react to what its own
        // request produced -- "one away" belongs to the guess that earned it,
        // not to an effect watching state change afterwards.
        return data.round ?? null;
      } catch {
        flash("Could not reach the puzzle. Check your connection.");
        return null;
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [flash],
  );

  // Read-only GET first, then open a board if there is none -- visiting the
  // page must not consume the day's attempt.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/arcade/connections", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Partial<ConnectionsResponse>;
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
      await send("/api/arcade/connections", {});
    })();
    return () => {
      cancelled = true;
    };
  }, [send]);

  const finished = Boolean(round && round.status !== "active");
  const playable = Boolean(round) && !finished && !busy;

  const toggle = (word: string) => {
    if (!playable) return;
    setSelection((current) =>
      current.includes(word)
        ? current.filter((entry) => entry !== word)
        : current.length >= CONNECTIONS_GROUP_SIZE
          ? current
          : [...current, word],
    );
  };

  const submit = () => {
    if (!round || !playable || picked.length !== CONNECTIONS_GROUP_SIZE) return;
    const guess = [...picked];
    void (async () => {
      const next = await send("/api/arcade/connections/actions", {
        day: round.day,
        version: round.version,
        selection: guess,
      });
      // Cleared only on an accepted guess. A rejected selection -- a repeat --
      // stays put so the player can adjust one tile rather than rebuild it.
      if (!next) return;
      setSelection([]);
      // The one hint a wrong guess is allowed to give, announced by the guess
      // that earned it.
      if (next.status === "active" && next.lastVerdict === "one-away") flash("One away…");
    })();
  };

  const shuffle = () => {
    // Math.random is fine here and nowhere else in this app's game code: tile
    // order carries no information and decides nothing.
    const random = (max: number) => Math.floor(Math.random() * max);
    const key = selectionKey(picked);
    const aligning = picked.length > 0 && key !== alignedKey;
    setOrder(aligning ? alignSelectionInline(displayed, picked, random) : shuffleBoardOrder(displayed, random));
    // Armed per selection, not per round: press again on the same picks and
    // the board scrambles as it always did, but change a tile and the next
    // press lines that set up instead.
    setAlignedKey(picked.length > 0 ? key : null);
  };

  const shareText = round ? connectionsShareText(round, { link: shareLink() }) : null;
  const mistakesLeft = round ? round.mistakesAllowed - round.mistakes : 0;

  return (
    <main className="bj-shell puzzle-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <Link className="bj-back" href="/">← Back to the lobby</Link>
          <h1>Connections</h1>
          <p>
            {meta ? `Puzzle #${meta.puzzleNumber}` : "Loading…"} · Find the four groups of four
          </p>
        </div>
        {profile && (
          <div className="puzzle-player">
            <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
            <span className="bj-hand-who">
              <span className="bj-hand-label">{profile.displayName}</span>
              <span className="bj-hand-caption">
                {round ? `${round.revealed.filter((group) => group.solved).length}/4 groups` : "—"}
              </span>
            </span>
          </div>
        )}
      </header>

      <p className={clsx("puzzle-notice", notice && "puzzle-notice-on")} role="status" aria-live="polite">
        {notice}
      </p>

      <section className="cx-board" aria-busy={busy}>
        {/* Solved groups rise to the top as bars, which is what makes the
            board visibly shrink toward a solve. */}
        {round?.revealed.map((group) => (
          <div
            key={group.level}
            className={clsx("cx-group", LEVEL_CLASS[group.level], !group.solved && "cx-group-missed")}
          >
            <strong>{group.label}</strong>
            <span>{group.members.join(", ")}</span>
          </div>
        ))}

        <div className={clsx("cx-tiles", shake && "cx-tiles-shake")}>
          {displayed.map((word) => (
            <button
              key={word}
              type="button"
              className={clsx("cx-tile", picked.includes(word) && "cx-tile-on")}
              onClick={() => toggle(word)}
              disabled={!playable}
              aria-pressed={picked.includes(word)}
            >
              {word}
            </button>
          ))}
        </div>
      </section>

      {!finished && round && (
        <>
          <p className="cx-mistakes" aria-label={`${mistakesLeft} mistakes remaining`}>
            Mistakes remaining:
            <span className="cx-pips">
              {Array.from({ length: round.mistakesAllowed }, (_, index) => (
                <i key={index} className={clsx("cx-pip", index >= mistakesLeft && "cx-pip-spent")} />
              ))}
            </span>
          </p>

          <section className="cx-controls">
            <button type="button" className="cx-action" onClick={shuffle} disabled={!playable}>
              <Shuffle size={14} aria-hidden="true" /> Shuffle
            </button>
            <button
              type="button"
              className="cx-action"
              onClick={() => setSelection([])}
              disabled={!playable || picked.length === 0}
            >
              Deselect all
            </button>
            <button
              type="button"
              className="cx-action cx-action-submit"
              onClick={submit}
              disabled={!playable || picked.length !== CONNECTIONS_GROUP_SIZE}
            >
              Submit
            </button>
          </section>
        </>
      )}

      {finished && round && (
        <section className="puzzle-summary">
          <p className="puzzle-verdict">
            {round.status === "won"
              ? round.mistakes === 0
                ? "Perfect — all four, no mistakes."
                : `Solved with ${round.mistakes} mistake${round.mistakes === 1 ? "" : "s"}.`
              : "Out of mistakes. The groups are above."}
          </p>
          <pre className="puzzle-share-preview" aria-label="Your result">{shareText}</pre>
          {shareText && (
            <ShareResultButton
              text={shareText}
              title={puzzleShareTitle("connections", round.puzzleNumber)}
            />
          )}
          {meta && <NextPuzzleCountdown deadline={meta.nextPuzzleAt} />}
        </section>
      )}

      {!loaded && <p className="puzzle-loading">Loading today’s puzzle…</p>}
    </main>
  );
}

/** Origin-relative, so a share from a Preview deployment points at that deployment. */
function shareLink(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/games/connections`;
}
