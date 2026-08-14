"use client";

import { Check } from "lucide-react";
import clsx from "clsx";
import type { MissionView } from "@/lib/missions/types";
import { MissionToast } from "./mission-toast";
import { useMissions } from "./use-missions";

/**
 * The lobby's daily/weekly objectives: a full-width strip beneath the rank
 * strip, same slot and same "renders nothing until it has something to say"
 * contract as RankStrip and FirstRunStrip -- `.hub-grid`'s column spans are
 * arithmetic, and a strip that appears late or empty would push the tiles
 * down and then pull them back.
 *
 * Rewards auto-credit server-side the instant a mission completes -- there
 * is no claim button here to wire up. This panel is a pure readout plus the
 * toast that announces a completion it just polled into view.
 */
export function MissionsPanel() {
  const { data, justCompleted, clearCompleted } = useMissions();

  if (!data || (data.daily.length === 0 && data.weekly.length === 0)) return null;

  return (
    <section className="missions-panel" aria-label="Missions">
      <MissionToast queue={justCompleted} onQueued={clearCompleted} />

      {data.daily.length > 0 && (
        <div className="missions-group">
          <h2 className="missions-kicker">Today</h2>
          <ul className="missions-list">
            {data.daily.map((mission) => <MissionRow key={mission.code} mission={mission} />)}
          </ul>
        </div>
      )}

      {data.weekly.length > 0 && (
        <div className="missions-group">
          <h2 className="missions-kicker">This week</h2>
          <ul className="missions-list">
            {data.weekly.map((mission) => <MissionRow key={mission.code} mission={mission} />)}
          </ul>
        </div>
      )}
    </section>
  );
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
