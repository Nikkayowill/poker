"use client";

import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { tapSound } from "@/lib/audio/ui-sounds";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";

interface OpenTableSummary {
  id: string;
  tier: StakesTier;
  humanCount: number;
  seatCount: number;
  handNumber: number;
}

/**
 * The drawer behind the hub's "Watch a table" tile: every public table
 * currently mid-hand, ranked liveliest-first (see listPublicPlayingGames in
 * game-store.ts). Reuses the .history-overlay/.history-drawer shell every
 * other drawer here narrows, per app/styles/CLAUDE.md's own convention for
 * that pair.
 *
 * No auth gate: GET /api/games (the list) and GET /api/games/[id] (the
 * table itself, via onWatch) are both open to any caller for a public
 * table, so a signed-out guest can browse and watch exactly like a
 * registered player.
 */
export function WatchTableDrawer({
  onClose,
  onWatch,
}: {
  onClose: () => void;
  onWatch: (gameId: string) => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const [tables, setTables] = useState<OpenTableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/games", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.error) throw new Error(data.error);
        setTables(data.tables ?? []);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not load tables.");
        setTables([]);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="history-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <aside className="history-drawer watch-table-drawer" role="dialog" aria-modal="true" aria-label="Watch a table">
        <div className="panel-heading">
          <div>
            <span>SPECTATE</span>
            <strong>Watch a table</strong>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={() => { tapSound(); onClose(); }} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="watch-table-list">
          {error && <p className="friends-error" role="alert">{error}</p>}

          {tables === null && !error && <p className="watch-table-empty">Loading tables…</p>}

          {tables !== null && tables.length === 0 && !error && (
            <p className="watch-table-empty">No public tables are playing right now.</p>
          )}

          {tables?.map((table) => (
            <button
              key={table.id}
              type="button"
              className="watch-table-row"
              onClick={() => { tapSound(); onWatch(table.id); }}
            >
              <span className="watch-table-row-main">
                <strong>{TIER_CONFIG[table.tier].label} Gold</strong>
                <small>Hand #{table.handNumber} · {table.humanCount}/{table.seatCount} seated</small>
              </span>
              <Eye size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
