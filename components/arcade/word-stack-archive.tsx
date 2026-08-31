"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { WordStackBoard } from "@/components/arcade/word-stack-board";
import { tapSound } from "@/lib/audio/ui-sounds";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { FloorBackLink } from "@/components/arcade/floor-back-link";

/**
 * Mirrors lib/server/word-stack-service.ts's WordStackArchiveDay/Status.
 * Declared locally rather than imported: that module is `server-only`, and
 * every client component in this app that consumes a server-side shape
 * redeclares it rather than importing from a server-only file, the same
 * convention word-stack-board.tsx's own WordStackResponse follows.
 */
type WordStackArchiveStatus = "not-started" | "active" | "won" | "lost";
interface WordStackArchiveDay {
  day: string;
  puzzleNumber: number;
  status: WordStackArchiveStatus;
}

/**
 * The Word Stack puzzle archive: every day since launch this player missed,
 * free to open and play.
 *
 * Two-state page rather than its own route per day: `selectedDay === null`
 * shows the list (this file's own job); picking a day swaps in
 * WordStackBoard itself with that day passed through as a prop, so the
 * actual play surface -- typing, scoring, the share grid -- is not
 * duplicated here. See word-stack-board.tsx's header for the archive-mode
 * contract that makes that reuse possible.
 */

const STATUS_ICON: Record<WordStackArchiveStatus, typeof CheckCircle2> = {
  won: CheckCircle2,
  lost: XCircle,
  active: Clock,
  "not-started": Circle,
};

const STATUS_LABEL: Record<WordStackArchiveStatus, string> = {
  won: "Solved",
  lost: "Missed",
  active: "In progress",
  "not-started": "Not played",
};

export function WordStackArchive() {
  useArcadeSound({ gameSounds: true });
  const [days, setDays] = useState<WordStackArchiveDay[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDay) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/arcade/word-stack/archive", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as WordStackArchiveDay[] | { error?: string } | null;
        if (cancelled) return;
        if (!response.ok || !Array.isArray(data)) {
          setError((data as { error?: string } | null)?.error ?? "Could not load the archive.");
          return;
        }
        setDays(data);
      } catch {
        if (!cancelled) setError("Could not reach the archive. Check your connection.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-fetches on returning from a played day, so a just-finished day's
    // status updates in the list without a full page reload.
  }, [selectedDay]);

  if (selectedDay) {
    return <WordStackBoard day={selectedDay} onExit={() => setSelectedDay(null)} />;
  }

  return (
    <main className="bj-shell puzzle-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <div className="bj-back-row">
            <FloorBackLink />
          </div>
          <h1>Word Stack Archive</h1>
          <p>Every day you missed, free to play.</p>
        </div>
      </header>

      {error && <p className="puzzle-notice puzzle-notice-on">{error}</p>}

      {!days && !error && <p className="puzzle-loading">Loading the archive…</p>}

      {days && days.length === 0 && <p className="puzzle-loading">Nothing missed yet — check back tomorrow.</p>}

      {days && days.length > 0 && (
        <ul className="puzzle-archive-list">
          {days.map((entry) => {
            const Icon = STATUS_ICON[entry.status];
            return (
              <li key={entry.day}>
                <button
                  type="button"
                  className={`puzzle-archive-row puzzle-archive-row-${entry.status}`}
                  onClick={() => { tapSound(); setSelectedDay(entry.day); }}
                >
                  <span className="puzzle-archive-row-main">
                    <strong>Puzzle #{entry.puzzleNumber}</strong>
                    <span className="puzzle-archive-row-day">{entry.day}</span>
                  </span>
                  <span className="puzzle-archive-row-status">
                    <Icon size={15} aria-hidden="true" />
                    {STATUS_LABEL[entry.status]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
