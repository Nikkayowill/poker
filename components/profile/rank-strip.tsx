"use client";

import { useEffect, useRef, useState } from "react";
import { Flame, TrendingUp } from "lucide-react";
import type { ProgressionPayload } from "@/lib/progression/types";

/**
 * The lobby's rank readout: level, title, progress into the level, streak.
 *
 * Placed between the hub head and the hub grid rather than inside the grid, and
 * that is deliberate rather than aesthetic. `.hub-grid`'s four-column layout is
 * arithmetic -- the spans are chosen so no cell is left over, and CLAUDE.md
 * records that adding a tile reopens the hole a fourth panel was added to
 * close. A full-width strip above the grid cannot disturb any of it.
 *
 * Owns its own fetch, like components/social/friends-drawer.tsx, so nothing
 * about progression has to be lifted into poker-app.tsx.
 */

export function RankStrip() {
  const [data, setData] = useState<ProgressionPayload | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // Deferred through a timer rather than fired from the effect body, matching
    // the profile load in poker-app.tsx and the friends drawer: a fetch started
    // synchronously here sets state during the same commit.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/progression", { cache: "no-store" });
        if (!response.ok || !mounted.current) return;
        setData((await response.json()) as ProgressionPayload);
      } catch {
        // Silent. This is a readout beside a lobby full of working buttons --
        // an error banner over "you are level 4" is worse than no strip at all.
      }
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, []);

  // Renders nothing until it knows something. A skeleton here would push the
  // hub grid down and then move it back, on the one screen where the tiles'
  // position is the thing a returning player is reaching for.
  if (!data) return null;

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
