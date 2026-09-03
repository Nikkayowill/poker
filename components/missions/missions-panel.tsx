"use client";

import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { FadeSwap } from "@/components/loading/fade-swap";
import { Skeleton } from "@/components/loading/skeleton";
import { MissionToast } from "./mission-toast";
import { useMissions, type MissionsState } from "./use-missions";

/**
 * The lobby's door into /challenges.
 *
 * This used to be the full daily/weekly list, rendered right here as eight
 * rows below the rank strip -- the same "big list stuck in a strip" shape the
 * arcade tile used to be before /games got its own route (see arcade-panel.tsx's
 * header). Same fix: a one-line summary and a link, with the catalogue moved
 * to its own page.
 *
 * `ready` (has the first fetch landed) and "has anything to show" are two
 * different questions -- the skeleton below only answers the first. A
 * player with genuinely no missions still sees nothing once ready, same as
 * before; what changed is that a player who DOES have missions no longer
 * watches them pop in from nothing (see rank-strip.tsx's FadeSwap for the
 * same fix applied there first).
 */
function MissionsPanelSkeleton() {
  return (
    <div className="missions-panel" aria-hidden="true">
      <Skeleton className="skeleton-missions-icon" />
      <span className="missions-panel-copy">
        <Skeleton className="skeleton-missions-line" />
      </span>
    </div>
  );
}

export function MissionsPanel() {
  const missions = useMissions();
  const { data } = missions;
  const hasMissions = Boolean(data && (data.daily.length > 0 || data.weekly.length > 0));

  return (
    <FadeSwap ready={data !== null} skeleton={<MissionsPanelSkeleton />}>
      {hasMissions && <MissionsPanelContent missions={missions} />}
    </FadeSwap>
  );
}

function MissionsPanelContent({ missions }: { missions: MissionsState }) {
  const { data, justCompleted, clearCompleted } = missions;
  if (!data) return null;

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
