"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { StakePicker } from "@/components/pvp/stake-picker";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { MIN_ANTE_UP_WAGER, type AnteUpConnectionsSnapshot } from "@/lib/arcade/ante-up-connections";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Ante Up: Connections -- the Connections half of Ante Up.
 *
 * Same wager-step/shell/busy/error/mounted-ref posture as ante-up-sudoku.tsx
 * (see that file's header) but with no clock and no difficulty axis -- just a
 * wager -- and the play surface itself reuses connections-board.tsx's markup
 * and interaction model wholesale (the .cx-* classes from 25-puzzles.css): tap
 * up to four words, submit as a selection, "one away" surfaces as a soft
 * transient flash rather than a hard error.
 *
 * A rejected selection (a repeat, most commonly) comes back as an ordinary
 * 400 with the board attached, not a failure worth a banner -- mirrors how
 * connections-board.tsx's own submit() treats its equivalent case: the board
 * updates from whatever came back, the flash carries the message, and the
 * picks stay put so the player can adjust one tile instead of rebuilding the
 * whole group.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000] as const;
const NOTICE_MS = 1800;

/** Level 0-3 as the board's four colours -- same ramp connections-board.tsx uses. */
const LEVEL_CLASS = ["cx-level-0", "cx-level-1", "cx-level-2", "cx-level-3"];

interface AnteUpConnectionsResponse {
  attempt: AnteUpConnectionsSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

type ActionResponse = Partial<AnteUpConnectionsResponse> & { round?: AnteUpConnectionsSnapshot };

export function AnteUpConnections() {
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpConnectionsSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  // Same guard duel-shell.tsx/ante-up-sudoku.tsx keep: true only while unmounted, so a
  // response landing after navigation away cannot set state on a dead component.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  const flash = useCallback((message: string, wobble = false) => {
    setNotice(message);
    setShake(wobble);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      setShake(false);
    }, NOTICE_MS);
  }, []);

  const applyResponse = useCallback((data: Partial<AnteUpConnectionsResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, []);

  /** The one-shot initial read -- no clock here, so there is nothing to poll. */
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/ante-up-connections", { cache: "no-store" });
      const data = (await response.json()) as Partial<AnteUpConnectionsResponse>;
      if (!mounted.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped initial read is not worth a banner -- the lobby step still renders.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  /** A player-initiated POST. Returns the parsed body regardless of ok, so callers can react either way. */
  const post = useCallback(async (url: string, body: unknown): Promise<{ ok: boolean; data: ActionResponse | null }> => {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ActionResponse;
      return { ok: response.ok, data };
    } catch {
      return { ok: false, data: null };
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  // Initial read, deferred a tick -- same idiom every arcade table shares: a
  // fetch fired straight from an effect body sets state during the same commit.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const start = () => {
    setSelection([]);
    setError(null);
    void (async () => {
      const { ok, data } = await post("/api/ante-up-connections", { wager });
      if (!mounted.current) return;
      if (!ok || !data) {
        setError(data?.error ?? "Could not reach the table. Check your connection.");
        return;
      }
      applyResponse(data);
    })();
  };

  const resign = () => {
    setError(null);
    void (async () => {
      const { ok, data } = await post("/api/ante-up-connections/actions", { action: "resign" });
      if (!mounted.current) return;
      if (!ok || !data) {
        setError(data?.error ?? "Could not reach the table. Check your connection.");
        return;
      }
      applyResponse(data);
    })();
  };

  const toggle = (word: string) => {
    if (!active || busy || !attempt) return;
    setSelection((current) =>
      current.includes(word)
        ? current.filter((entry) => entry !== word)
        : current.length >= attempt.groupSize
          ? current
          : [...current, word],
    );
  };

  const submit = () => {
    if (!attempt || !active || busy || selection.length !== attempt.groupSize) return;
    const picks = [...selection];
    void (async () => {
      const { ok, data } = await post("/api/ante-up-connections/actions", {
        action: "guess",
        version: attempt.version,
        selection: picks,
      });
      if (!mounted.current) return;
      if (!ok || !data) {
        // A repeat (or any other rejected selection) is ordinary play, same
        // treatment connections-board.tsx's own submit gives it -- a soft
        // flash, the board updates if one came back, the picks stay put.
        if (data?.round) setAttempt(data.round);
        flash(data?.error ?? "Could not reach the table. Check your connection.");
        return;
      }
      applyResponse(data);
      setSelection([]);
      if (data.attempt?.status === "active") {
        if (data.attempt.lastVerdict === "one-away") flash("One away…");
        else if (data.attempt.lastVerdict === "wrong") flash("Not a group.", true);
        else play("ui");
      }
    })();
  };

  const playAgain = () => {
    setAttempt(null);
    setSelection([]);
    setNotice(null);
  };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const canAfford = wager === 0 || (wager >= MIN_ANTE_UP_WAGER && balance >= wager);
  const mistakesLeft = attempt ? attempt.mistakesAllowed - attempt.mistakes : 0;

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
            <h1>Connections, for Gold</h1>
            <p>Wager on your own eye for a hidden category. Find all four groups before you run out of mistakes.</p>
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
                  : "A clean solve pays out the most -- the payout only shrinks as mistakes add up, and running out of mistakes forfeits the wager."}
            </p>

            <button
              type="button"
              className="floor-play duel-open"
              disabled={busy || !loaded || !canAfford}
              onClick={() => { selectSound(); start(); }}
            >
              {!loaded ? "…" : !canAfford ? "Not enough Gold" : busy ? "Dealing…" : "Ante up"}
            </button>
          </section>
        </div>
      ) : (
        <div className="duel-match ante-match">
          <div className="duel-scoreline ante-scoreline">
            <span className="ante-clock" aria-live="polite">
              {settled
                ? `${attempt.mistakes} ${attempt.mistakes === 1 ? "mistake" : "mistakes"}`
                : `${mistakesLeft} ${mistakesLeft === 1 ? "mistake" : "mistakes"} left`}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {attempt.payout.toLocaleString()}</small>}
            </span>
          </div>

          {!settled ? (
            <>
              <section className="cx-board" aria-busy={busy}>
                {attempt.revealed.map((group) => (
                  <div key={group.level} className={clsx("cx-group", LEVEL_CLASS[group.level])}>
                    <strong>{group.label}</strong>
                    <span>{group.members.join(", ")}</span>
                  </div>
                ))}

                <div className={clsx("cx-tiles", shake && "cx-tiles-shake")}>
                  {attempt.words.map((word) => (
                    <button
                      key={word}
                      type="button"
                      className={clsx("cx-tile", selection.includes(word) && "cx-tile-on")}
                      onClick={() => { tapSound(); toggle(word); }}
                      disabled={!active || busy}
                      aria-pressed={selection.includes(word)}
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </section>

              <p className={clsx("puzzle-notice", notice && "puzzle-notice-on")} role="status" aria-live="polite">
                {notice}
              </p>

              <p className="cx-mistakes" aria-label={`${mistakesLeft} mistakes remaining`}>
                Mistakes remaining:
                <span className="cx-pips">
                  {Array.from({ length: attempt.mistakesAllowed }, (_, index) => (
                    <i key={index} className={clsx("cx-pip", index >= mistakesLeft && "cx-pip-spent")} />
                  ))}
                </span>
              </p>

              <section className="cx-controls">
                <button
                  type="button"
                  className="cx-action"
                  onClick={() => { tapSound(); setSelection([]); }}
                  disabled={busy || selection.length === 0}
                >
                  Deselect all
                </button>
                <button
                  type="button"
                  className="cx-action cx-action-submit"
                  onClick={() => { selectSound(); submit(); }}
                  disabled={busy || selection.length !== attempt.groupSize}
                >
                  Submit
                </button>
              </section>

              <div className="duel-controls">
                <button type="button" className="duel-resign" disabled={busy} onClick={() => resign()}>
                  Give up
                </button>
              </div>
            </>
          ) : (
            <div className={clsx("duel-result", attempt.status === "won" && "duel-result-won")}>
              <strong>{attempt.status === "won" ? "All four found" : "Out of mistakes"}</strong>
              <span>{attempt.mistakes} {attempt.mistakes === 1 ? "mistake" : "mistakes"}</span>
              <span className="duel-result-gold">
                {attempt.status === "won"
                  ? attempt.wager > 0 ? `+${attempt.payout.toLocaleString()} Gold` : "Practice round -- no Gold at stake"
                  : attempt.wager > 0 ? `−${attempt.wager.toLocaleString()} Gold` : "Practice round -- nothing lost"}
              </span>

              {attempt.revealed.length > 0 && (
                <div className="cx-board">
                  {attempt.revealed.map((group) => (
                    <div
                      key={group.level}
                      className={clsx("cx-group", LEVEL_CLASS[group.level], !group.solved && "cx-group-missed")}
                    >
                      <strong>{group.label}</strong>
                      <span>{group.members.join(", ")}</span>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
