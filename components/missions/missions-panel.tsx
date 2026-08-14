"use client";

import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { MissionToast } from "./mission-toast";
import { useMissions } from "./use-missions";

/**
 * The lobby's door into /challenges.
 *
 * This used to be the full daily/weekly list, rendered right here as eight
 * rows below the rank strip -- the same "big list stuck in a strip" shape the
 * arcade tile used to be before /games got its own route (see arcade-panel.tsx's
 * header). Same fix: a one-line summary and a link, with the catalogue moved
 * to its own page. Still the same slot and "renders nothing until it has
 * something to say" contract as RankStrip/FirstRunStrip -- see rank-strip.tsx.
 */
export function MissionsPanel() {
  const { data, justCompleted, clearCompleted } = useMissions();

  if (!data || (data.daily.length === 0 && data.weekly.length === 0)) return null;

  const dailyDone = data.daily.filter((mission) => mission.completed).length;
  const weeklyDone = data.weekly.filter((mission) => mission.completed).length;

  return (
    <Link className="missions-panel" href="/challenges" onClick={tapSound} aria-label="Challenges">
      <MissionToast queue={justCompleted} onQueued={clearCompleted} />

      <ClipboardList className="missions-panel-icon" size={18} aria-hidden="true" />
      <span className="missions-panel-copy">
        <strong>Challenges</strong>
        <small>
          {dailyDone}/{data.daily.length} today · {weeklyDone}/{data.weekly.length} this week
        </small>
      </span>
      <ChevronRight className="missions-panel-go" size={18} aria-hidden="true" />
    </Link>
  );
}
