"use client";

import { Flame, TrendingUp } from "lucide-react";
import type { ProgressionPayload } from "@/lib/progression/types";
import { FadeSwap } from "@/components/loading/fade-swap";
import { Skeleton } from "@/components/loading/skeleton";
import { useProgression } from "./use-progression";

/**
 * The lobby's rank readout: level, title, progress into the level, streak.
 *
 * Placed between the hub head and the hub grid rather than inside the grid, and
 * that is deliberate rather than aesthetic. `.hub-grid`'s four-column layout is
 * arithmetic -- the spans are chosen so no cell is left over, and CLAUDE.md
 * records that adding a tile reopens the hole a fourth panel was added to
 * close. A full-width strip above the grid cannot disturb any of it.
 *
 * Fetch lives in `useProgression`, shared with the 3D table's corner HUD --
 * both are a level/XP/streak readout beside a screen full of working
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
    <div className="rank-strip" aria-hidden="true">
      <Skeleton className="skeleton-rank-badge" />
      <div className="rank-body">
        <Skeleton className="skeleton-rank-line" />
        <Skeleton className="skeleton-rank-track" />
        <Skeleton className="skeleton-rank-next" />
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
  const atCap = progression.levelSpan === 0;

  return (
    <section className="rank-strip" aria-label="Your rank">
      <div className="rank-badge" aria-hidden="true">{progression.level}</div>

      <div className="rank-body">
        <div className="rank-line">
          <strong>{progression.title}</strong>
          <span className="rank-level">Level {progression.level}</span>
        </div>

        {/* aria-hidden on the bar because the same numbers are stated in words
            immediately below it; a screen reader should hear one of them. */}
        <div className="rank-track" aria-hidden="true">
          <div className="rank-fill" style={{ width: `${Math.round(progression.ratio * 100)}%` }} />
        </div>

        <small className="rank-next">
          {atCap
            ? "Top rank reached."
            : (
              <>
                {progression.intoLevel.toLocaleString()} / {progression.levelSpan.toLocaleString()} XP
                {progression.nextTitle && (
                  <> · <TrendingUp size={11} aria-hidden="true" /> {progression.nextTitle} at {progression.nextTitleLevel}</>
                )}
              </>
            )}
        </small>
      </div>

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
  );
}
