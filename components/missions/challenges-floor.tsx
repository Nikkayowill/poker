"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import clsx from "clsx";
import type { MissionView } from "@/lib/missions/types";
import { tapSound } from "@/lib/audio/ui-sounds";
import { MissionToast } from "./mission-toast";
import { useMissions } from "./use-missions";

/**
 * The challenges floor: the daily/weekly missions catalogue, on its own route.
 *
 * This is the page the lobby's missions strip used to try to be -- eight rows
 * of title/description/progress bar do not belong stacked above the hub grid,
 * the same reasoning arcade-floor.tsx's header gives for /games. The lobby
 * keeps a compact "3/4 today" door (missions-panel.tsx); this is what it opens.
 *
 * Fetches its own missions rather than taking them as a prop, matching
 * arcade-floor.tsx's wallet fetch: this route does not mount PokerApp, so
 * there is nothing to receive them from.
 */
export function ChallengesFloor() {
  const { data, justCompleted, clearCompleted } = useMissions();

  return (
    <main className="floor-shell">
      <header className="floor-bar">
        <Link className="floor-back" href="/" onClick={tapSound}>← The floor</Link>
      </header>

      <div className="floor-head">
        <div className="lobby-kicker">Challenges</div>
        <h1>Daily and weekly objectives.</h1>
        <p>Gold credits itself the moment one completes -- nothing here to claim.</p>
      </div>

      <MissionToast queue={justCompleted} onQueued={clearCompleted} />

      {!data ? null : (
        <div className="challenges-groups">
          {data.daily.length > 0 && (
            <section className="floor-section missions-group" aria-labelledby="challenges-daily">
              <h2 className="floor-section-head" id="challenges-daily">
                Today · resets {resetLabel(data.daily[0].periodEnd)}
              </h2>
              <ul className="missions-list">
                {data.daily.map((mission) => <MissionRow key={mission.code} mission={mission} />)}
              </ul>
            </section>
          )}

          {data.weekly.length > 0 && (
            <section className="floor-section missions-group" aria-labelledby="challenges-weekly">
              <h2 className="floor-section-head" id="challenges-weekly">
                This week · resets {resetLabel(data.weekly[0].periodEnd)}
              </h2>
              <ul className="missions-list">
                {data.weekly.map((mission) => <MissionRow key={mission.code} mission={mission} />)}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

/** "in 6h" / "in 3d" -- coarse on purpose, this is a period boundary, not a countdown. */
function resetLabel(periodEndIso: string): string {
  const ms = new Date(periodEndIso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.ceil(hours / 24)}d`;
}

function MissionRow({ mission }: { mission: MissionView }) {
  const ratio = mission.target > 0 ? Math.min(1, mission.progress / mission.target) : 0;

  return (
    <li className={clsx("mission-row", mission.completed && "mission-row-complete")}>
      <div className="mission-row-head">
        <span className="mission-row-title">{mission.title}</span>
        <span className="mission-row-reward">+{mission.rewardGold.toLocaleString()}</span>
      </div>

      <p className="mission-row-desc">{mission.description}</p>

      {/* aria-hidden: the same numbers are stated in words right below it,
          same reasoning as .rank-track in rank-strip.tsx. */}
      <div className="mission-track" aria-hidden="true">
        <div className="mission-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>

      <small className="mission-row-progress">
        {mission.completed
          ? <><Check size={11} aria-hidden="true" /> Complete</>
          : `${mission.progress.toLocaleString()} / ${mission.target.toLocaleString()}`}
      </small>
    </li>
  );
}
