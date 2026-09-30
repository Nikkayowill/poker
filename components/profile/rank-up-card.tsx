"use client";

import { ChevronRight } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { FadeSwap } from "@/components/loading/fade-swap";
import { Skeleton } from "@/components/loading/skeleton";
import { RankJewel } from "./rank-jewel";
import { useProgression } from "./use-progression";

/**
 * The phone Play tab's rank card: the tier's jewel and name, rank points, and
 * how far the next tier is. Tapping it hands off to the Ante Up tab's solo
 * wagers, since that is the only way rank points move.
 *
 * Reuses the rank strip's classes so the two read as one family. The skeleton
 * is the card's own footprint, same rule as rank-strip.tsx.
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
  const { tier, nextTier, toNext } = progression;

  return (
    <button
      type="button"
      className="rank-strip rankup-card"
      aria-label={`Rank ${tier.name}, ${progression.points.toLocaleString()} rank points. Play solo wagers to climb.`}
      onClick={() => { tapSound(); onRankUp(); }}
    >
      <RankJewel tier={tier.id} size={56} />
      <div className="rank-body">
        <strong className="rank-name">{tier.name}</strong>
        <span className="rank-points">{progression.points.toLocaleString()} RP</span>
      </div>
      {nextTier && toNext !== null ? (
        <div className="rank-next-chip">
          <RankJewel tier={nextTier.id} size={22} shine={false} />
          <span>
            <strong>{toNext.toLocaleString()}</strong> to {nextTier.name}
          </span>
        </div>
      ) : (
        <div className="rank-next-chip rank-next-top">Top of the ladder</div>
      )}
      <ChevronRight className="rankup-chevron" size={18} aria-hidden="true" />
    </button>
  );
}
