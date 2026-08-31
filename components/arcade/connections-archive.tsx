"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { ConnectionsBoard } from "@/components/arcade/connections-board";
import { tapSound } from "@/lib/audio/ui-sounds";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { FloorBackLink } from "@/components/arcade/floor-back-link";

/**
 * The Connections puzzle archive: every day since launch this player
 * missed, free to open and play. Structural twin of word-stack-archive.tsx
 * -- see that file's header for the two-state (list / selected board)
 * reasoning, which applies here unchanged.
 */

/** Mirrors lib/server/connections-service.ts's ConnectionsArchiveDay/Status; see word-stack-archive.tsx's note on why this is redeclared, not imported. */
type ConnectionsArchiveStatus = "not-started" | "active" | "won" | "lost";
interface ConnectionsArchiveDay {
  day: string;
  puzzleNumber: number;
  status: ConnectionsArchiveStatus;
}

const STATUS_ICON: Record<ConnectionsArchiveStatus, typeof CheckCircle2> = {
  won: CheckCircle2,
  lost: XCircle,
  active: Clock,
  "not-started": Circle,
};

const STATUS_LABEL: Record<ConnectionsArchiveStatus, string> = {
  won: "Solved",
  lost: "Missed",
  active: "In progress",
  "not-started": "Not played",
};

export function ConnectionsArchive() {
  useArcadeSound({ gameSounds: true });
  const [days, setDays] = useState<ConnectionsArchiveDay[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDay) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/arcade/connections/archive", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as ConnectionsArchiveDay[] | { error?: string } | null;
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
  }, [selectedDay]);

  if (selectedDay) {
    return <ConnectionsBoard day={selectedDay} onExit={() => setSelectedDay(null)} />;
  }

  return (
    <main className="bj-shell puzzle-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <div className="bj-back-row">
            <FloorBackLink />
          </div>
          <h1>Connections Archive</h1>
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
