"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins, HelpCircle, Shuffle } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ShareResultButton } from "@/components/arcade/share-result-button";
import { NextPuzzleCountdown } from "@/components/arcade/next-puzzle-countdown";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { maxAnteUpWager } from "@/lib/arcade/ante-up-stakes";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import { connectionsShareText, puzzleShareTitle } from "@/lib/arcade/puzzles/share";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import {
  CONNECTIONS_GROUP_SIZE,
  type ConnectionsSnapshot,
} from "@/lib/arcade/puzzles/connections";
import {
  alignSelectionInline,
  selectionKey,
  shuffleBoardOrder,
} from "@/lib/arcade/puzzles/board-order";
import { MIN_ANTE_UP_WAGER } from "@/lib/arcade/ante-up-connections";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Connections.
 *
 * The groups live on the server and this file never learns them: the snapshot
 * carries the words still on the board and the groups already solved, and
 * nothing else. A wrong guess comes back as "one away" or plain wrong, never
 * as per-word colours, which would turn four mistakes into a free solution.
 *
 * Same one-snapshot contract as the other arcade tables: every guess is a
 * request and the response replaces the board wholesale.
 *
 * Shuffle is local: the button reorders `words` in component state without
 * touching the server. Tile order carries no information (it's scrambled per
 * player at deal time), so a round trip would spend a request to rearrange
 * something the server doesn't care about, and would cost the player their
 * selection for the length of it.
 *
 * The first press for a given selection seats those tiles together on the
 * top row (alignSelectionInline) instead of scattering them; pressing again
 * without changing the picks scrambles the whole board as before. Lining a
 * candidate group up is how you look at four words together before spending a
 * mistake on them, so it earns the first press; making it every press would
 * take the plain shuffle away. Changing the selection re-arms it.
 *
 * The wager gates opening rather than trailing it, matching word-stack-board.tsx:
 * `round === null` after the initial read no longer auto-opens today's board.
 * It renders a wager step (Free is always a choice) that opens it on the
 * player's own click. See startBoard.
 */

interface ConnectionsResponse {
  round: (ConnectionsSnapshot & { wager: number; payout: number }) | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
  error?: string;
  reason?: string;
}

const NOTICE_MS = 1800;
/** Capped by the game's flat ceiling in StakePicker; see lib/arcade/ante-up-stakes.ts. */
const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000, 25_000] as const;

/** Level 0-3 as the board's four colours, matching the share matrix's yellow-to-purple ramp. */
const LEVEL_CLASS = ["cx-level-0", "cx-level-1", "cx-level-2", "cx-level-3"];

export function ConnectionsBoard() {
  // Applies the player's stored mute on a route where PokerApp is not
  // mounted. The flag it sets is module-global, which is what lets the JSX
  // below call the chrome cues directly. See lib/audio/ui-sounds.ts.
  useArcadeSound({ gameSounds: true });
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [round, setRound] = useState<(ConnectionsSnapshot & { wager: number; payout: number }) | null>(null);
  const [meta, setMeta] = useState<{ day: string; puzzleNumber: number; nextPuzzleAt: number } | null>(null);
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [selection, setSelection] = useState<string[]>([]);
  /** Local display order. Empty until a board arrives; reshuffled only by the button. */
  const [order, setOrder] = useState<string[]>([]);
  /** The selection whose tiles the button has already lined up, so the next press scrambles instead. */
  const [alignedKey, setAlignedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [shake, setShake] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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
   * only what the shuffle button chose, so there is nothing to keep in step,
   * and the filtering has to be a projection rather than a replacement:
   * assigning `round.words` wholesale would re-sort the survivors into server
   * order every time a group fell, which reads as the board jumping under the
   * player's hand.
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
        // request produced: "one away" belongs to the guess that earned it,
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

  // Read-only GET first: visiting the page must not consume the day's
  // attempt. If today's board already exists (any status), it loads
  // straight in; if not, the wager step below opens one, on the player's
  // own click.
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
      setRound(data.round ?? null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startBoard = useCallback(() => {
    void send("/api/arcade/connections", { wager });
  }, [send, wager]);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(round?.wager ?? 0, round?.payout ?? 0);
  const ceiling = maxAnteUpWager("connections", null);
  const canAffordWager = balance >= wager;
  const overCeiling = wager > ceiling;
  // Kept apart from canAffordWager on purpose: they are different
  // refusals and used to share the "Not enough Gold" label, which is the
  // wrong thing to tell a player who has plenty and simply staked too much.
  const canStart = !overCeiling && canAffordWager;
  // The specific "you're short" case the button's "Not enough Gold" label
  // covers -- overCeiling has its own message ("Over the cap") and gets its
  // own refusal first, so this must not also fire for that case.
  const insufficientGold = wager > 0 && !overCeiling && !canAffordWager;

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
      // Cleared only on an accepted guess. A rejected selection, like a
      // repeat, stays put so the player can adjust one tile rather than
      // rebuild it.
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
          <div className="bj-back-row">
            <Link className="bj-back" href="/games" onClick={tapSound}>← Ante Up</Link>
            <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
              <HelpCircle size={13} aria-hidden="true" /> How to play
            </button>
          </div>
          <h1>Connections</h1>
          <p>
            {meta ? `Puzzle #${meta.puzzleNumber}` : "Loading…"} · Find the four groups of four
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
                {round ? `${round.revealed.filter((group) => group.solved).length}/4 groups` : "—"}
              </span>
            </span>
          </div>
        )}
      </header>

      {showHelp && (
        <HowToPlayModal title="Connections" onClose={() => setShowHelp(false)}>
          <p>
            Find the four hidden groups of four among sixteen words. Select four tiles and
            submit a guess; a wrong one costs a mistake and, if three of your four share a
            group, tells you &ldquo;one away&rdquo; without saying which. Find all four groups
            before you run out of mistakes and you win.
          </p>
          <p>
            It&apos;s one shared puzzle a day for everyone, so there&apos;s exactly one wagered
            attempt allowed — choose your wager, or play free, before it opens. A clean solve
            with no mistakes pays the most; scraping it on your last life pays back less than you
            staked, and running out of mistakes loses the wager outright. Whatever you wager, the
            payout it can earn is locked in the moment the round opens.
          </p>
        </HowToPlayModal>
      )}

      <p className={clsx("puzzle-notice", notice && "puzzle-notice-on")} role="status" aria-live="polite">
        {notice}
      </p>

      {loaded && !round && (
        <section className="puzzle-summary">
          <p className="puzzle-verdict">Wager Gold on today&apos;s puzzle, or play free.</p>
          <StakePicker
            ariaLabel="Wager"
            picks={STAKE_QUICK_PICKS}
            value={wager}
            min={0}
            max={ceiling}
            leading={{ label: "Free", value: 0 }}
            onChange={(next) => { selectSound(); setWager(next); }}
          />
          <p className="puzzle-verdict">
            {wager === 0
              ? "Free daily play — no Gold at stake."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : overCeiling
                  ? `Connections caps at ${ceiling.toLocaleString()} Gold a wager.`
                  : "A clean solve pays out the most. Solving on your last life pays back less than you staked, and running out of mistakes loses the wager outright."}
          </p>
          <button
            type="button"
            className="puzzle-share-button"
            disabled={busy || (wager > 0 && wager < MIN_ANTE_UP_WAGER) || (wager > 0 && !canStart)}
            onClick={() => { selectSound(); startBoard(); }}
          >
            <Coins size={15} aria-hidden="true" />
            {busy
              ? "Dealing…"
              : wager > 0 && overCeiling
                ? "Over the cap"
                : wager > 0 && !canAffordWager
                  ? "Not enough Gold"
                  : wager === 0
                    ? "Play free"
                    : "Ante up"}
          </button>
          {insufficientGold && <GoldShortfallHint needed={wager} compact />}
        </section>
      )}

      {round && (
        <section className="cx-board" aria-busy={busy}>
          {/* Solved groups rise to the top as bars, which is what makes the
              board visibly shrink toward a solve. */}
          {round.revealed.map((group) => (
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
                onClick={() => { tapSound(); toggle(word); }}
                disabled={!playable}
                aria-pressed={picked.includes(word)}
              >
                {word}
              </button>
            ))}
          </div>
        </section>
      )}

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
            <button type="button" className="cx-action" onClick={() => { selectSound(); shuffle(); }} disabled={!playable}>
              <Shuffle size={14} aria-hidden="true" /> Shuffle
            </button>
            <button
              type="button"
              className="cx-action"
              onClick={() => { tapSound(); setSelection([]); }}
              disabled={!playable || picked.length === 0}
            >
              Deselect all
            </button>
            <button
              type="button"
              className="cx-action cx-action-submit"
              onClick={() => { selectSound(); submit(); }}
              disabled={!playable || picked.length !== CONNECTIONS_GROUP_SIZE}
            >
              Submit
            </button>
          </section>
        </>
      )}

      {finished && round && (
        <section className="puzzle-summary">
          <WinCelebration active={round.status === "won" && result.profited} amount={result.net} />
          <p className="puzzle-verdict">
            {round.status === "won"
              ? round.mistakes === 0
                ? "Perfect — all four, no mistakes."
                : `Solved with ${round.mistakes} mistake${round.mistakes === 1 ? "" : "s"}.`
              : "Out of mistakes. The groups are above."}
          </p>
          {round.wager > 0 && (
            <p className="puzzle-verdict"><strong>{result.label}</strong></p>
          )}
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
