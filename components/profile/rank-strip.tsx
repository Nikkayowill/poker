"use client";

import { Flame } from "lucide-react";
import type { ProgressionPayload } from "@/lib/progression/types";
import { FadeSwap } from "@/components/loading/fade-swap";
import { Skeleton } from "@/components/loading/skeleton";
import { RankJewel } from "./rank-jewel";
import { SoloEarningsPanel } from "./solo-earnings-panel";
import { useProgression } from "./use-progression";

/**
 * The lobby's rank readout: the tier's jewel and name, rank points, how far
 * the next tier is, streak. There are no levels; the tier is the rank.
 *
 * Placed between the hub head and the hub grid rather than inside the grid, and
 * that is deliberate rather than aesthetic. `.hub-grid`'s four-column layout is
 * arithmetic -- the spans are chosen so no cell is left over, and CLAUDE.md
 * records that adding a tile reopens the hole a fourth panel was added to
 * close. A full-width strip above the grid cannot disturb any of it.
 *
 * Fetch lives in `useProgression`, shared with the 3D table's corner HUD --
 * both are a rank/streak readout beside a screen full of working
 * controls, and both fail the same way (silently).
 *
 * Used to `return null` until data existed, on the reasoning that a skeleton
 * would push the hub grid down and then move it back. That reasoning had it
 * backwards -- a skeleton sized to this section's own real footprint
 * reserves the space from the first frame, so nothing moves when the real
 * strip swaps in. `RankStripSkeleton` below is that footprint; `FadeSwap`
 * crossfades the two once `useProgression` resolves.
 */

function RankStripSkeleton() {
  return (
    <div className="rank-stack" aria-hidden="true">
      <div className="rank-strip">
        <Skeleton className="skeleton-rank-badge" />
        <div className="rank-body">
          <Skeleton className="skeleton-rank-line" />
          <Skeleton className="skeleton-rank-next" />
        </div>
      </div>
      <div className="earnings-strip">
        <Skeleton className="skeleton-earnings" />
      </div>
    </div>
  );
}

export function RankStrip() {
  const data = useProgression();

  return (
    <FadeSwap ready={data !== null} skeleton={<RankStripSkeleton />}>
      {data && <RankStripContent data={data} />}
    </FadeSwap>
  );
}

function RankStripContent({ data }: { data: ProgressionPayload }) {
  const { progression, daily } = data;
  const { tier, nextTier, toNext } = progression;

  return (
    <div className="rank-stack">
      <section className="rank-strip" aria-label={`Your rank: ${tier.name}`}>
        <RankJewel tier={tier.id} size={56} />

        <div className="rank-body">
          <strong className="rank-name">{tier.name}</strong>
          <span className="rank-points">{progression.points.toLocaleString()} RP</span>
        </div>

        {nextTier && toNext !== null ? (
          <div className="rank-next-chip" title={`${toNext.toLocaleString()} rank points to ${nextTier.name}`}>
            <RankJewel tier={nextTier.id} size={22} shine={false} />
            <span>
              <strong>{toNext.toLocaleString()}</strong> to {nextTier.name}
            </span>
          </div>
        ) : (
          <div className="rank-next-chip rank-next-top">Top of the ladder</div>
        )}

        {/* Only once there is a streak to show. A "0 day streak" is a scolding,
            not a reward, and the daily claim in the player menu is already where
            a player who has not claimed is told to. */}
        {daily.streak > 0 && (
          <div className="rank-streak" title={`Daily grant x${daily.multiplier}`}>
            <Flame size={14} aria-hidden="true" />
            <strong>{daily.streak}</strong>
            <small>day{daily.streak === 1 ? "" : "s"}</small>
          </div>
        )}
      </section>
      <SoloEarningsPanel summary={progression.soloEarnings} rank={progression} />
    </div>
  );
}
