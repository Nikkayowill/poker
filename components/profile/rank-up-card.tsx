"use client";

import { ArrowRight } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { FadeSwap } from "@/components/loading/fade-swap";
import { Skeleton } from "@/components/loading/skeleton";
import { useProgression } from "./use-progression";

/**
 * The phone Play tab's rank card: title, level, rank point progress, and a
 * "Rank Up" cue. Tapping it hands off to the Ante Up tab's solo wagers, since
 * that is the only way rank points move.
 *
 * Reuses the rank strip's badge and bar classes so the two read as one family.
 * The skeleton is the card's own footprint, same rule as rank-strip.tsx.
 */
export function RankUpCard({ onRankUp }: { onRankUp: () => void }) {
  const data = useProgression();

  return (
    <FadeSwap ready={data !== null} skeleton={<Skeleton className="skeleton-rankup" />}>
      {data && <RankUpContent progression={data.progression} onRankUp={onRankUp} />}
    </FadeSwap>
  );
}

function RankUpContent({
  progression,
  onRankUp,
}: {
  progression: NonNullable<ReturnType<typeof useProgression>>["progression"];
  onRankUp: () => void;
}) {
  const atCap = progression.levelSpan === 0;

  return (
    <button
      type="button"
      className="rank-strip rankup-card"
      onClick={() => { tapSound(); onRankUp(); }}
    >
      <div className="rank-badge" aria-hidden="true">{progression.level}</div>
      <div className="rank-body">
        <div className="rank-line">
          <strong>{progression.title}</strong>
          <span className="rank-level">Level {progression.level}</span>
        </div>
        <div className="rank-track" aria-hidden="true">
          <div className="rank-fill" style={{ width: `${Math.round(progression.ratio * 100)}%` }} />
        </div>
        <small className="rank-next">
          {atCap
            ? "Top rank reached."
            : `${progression.intoLevel.toLocaleString()} / ${progression.levelSpan.toLocaleString()} rank points`}
        </small>
      </div>
      <span className="rankup-cue">
        Rank Up <ArrowRight size={14} aria-hidden="true" />
      </span>
    </button>
  );
}
