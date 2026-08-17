"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import clsx from "clsx";
import { ACHIEVEMENT_CATEGORY_LABELS, type AchievementCategory, type AchievementView } from "@/lib/achievements/types";
import { cosmeticById } from "@/lib/cosmetics/catalog";
import { tapSound } from "@/lib/audio/ui-sounds";
import { AchievementToast } from "./achievement-toast";
import { useAchievements } from "./use-achievements";

/**
 * The achievements floor: every lifetime milestone, grouped by category, on
 * its own route -- the "Coming" card components/rewards/rewards-hub.tsx used
 * to show now opens this. Same floor-shell/floor-bar/floor-head shell as
 * challenges-floor.tsx, and the same .missions-list/.mission-row classes --
 * an achievement row and a mission row read the same way (title, reward,
 * description, progress bar), so there is nothing achievement-specific to
 * style beyond the reward line's optional cosmetic.
 *
 * Unlike missions, tiers are cumulative and permanent: a crossed tier stays
 * checked forever (no "resets in..." copy anywhere, because nothing resets),
 * and a locked tier still shows real progress toward it.
 */
export function AchievementsFloor() {
  const { data, justUnlocked, clearUnlocked } = useAchievements();

  const byCategory = data ? groupByCategory(data.achievements) : null;

  return (
    <main className="floor-shell">
      <header className="floor-bar">
        <Link className="floor-back" href="/" onClick={tapSound}>← The floor</Link>
        {data && (
          <span className="gold-balance floor-wallet">
            <strong>{data.unlockedCount} / {data.totalCount}</strong>
          </span>
        )}
      </header>

      <div className="floor-head">
        <div className="lobby-kicker">Achievements</div>
        <h1>Lifetime milestones.</h1>
        <p>Permanent Gold and cosmetic rewards for hitting a threshold -- nothing here ever resets.</p>
      </div>

      <AchievementToast queue={justUnlocked} onQueued={clearUnlocked} />

      {byCategory && (
        <div className="challenges-groups">
          {byCategory.map(([category, achievements]) => (
            <section key={category} className="floor-section missions-group" aria-labelledby={`achievements-${category}`}>
              <h2 className="floor-section-head" id={`achievements-${category}`}>
                {ACHIEVEMENT_CATEGORY_LABELS[category]}
              </h2>
              <ul className="missions-list">
                {achievements.map((achievement) => (
                  <AchievementRow
                    key={achievement.code}
                    achievement={achievement}
                    isNext={isNextTarget(achievement, achievements)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function groupByCategory(achievements: AchievementView[]): [AchievementCategory, AchievementView[]][] {
  const groups = new Map<AchievementCategory, AchievementView[]>();
  for (const achievement of achievements) {
    const bucket = groups.get(achievement.category) ?? [];
    bucket.push(achievement);
    groups.set(achievement.category, bucket);
  }
  for (const bucket of groups.values()) bucket.sort((a, b) => a.tier - b.tier);
  return [...groups.entries()];
}

/** The lowest not-yet-unlocked tier in a category is the one worth calling out. */
function isNextTarget(achievement: AchievementView, categoryAchievements: AchievementView[]): boolean {
  if (achievement.unlocked) return false;
  const firstLocked = categoryAchievements.find((candidate) => !candidate.unlocked);
  return firstLocked?.code === achievement.code;
}

function AchievementRow({ achievement, isNext }: { achievement: AchievementView; isNext: boolean }) {
  const ratio = achievement.threshold > 0 ? Math.min(1, achievement.progress / achievement.threshold) : 0;
  const cosmeticName = achievement.rewardCosmeticId ? cosmeticById(achievement.rewardCosmeticId)?.name : null;

  return (
    <li
      className={clsx(
        "mission-row",
        achievement.unlocked && "mission-row-complete",
        isNext && "mission-row-next",
      )}
    >
      <div className="mission-row-head">
        <span className="mission-row-title">{achievement.title}</span>
        <span className="mission-row-reward">
          +{achievement.rewardGold.toLocaleString()}
          {cosmeticName ? ` + ${cosmeticName}` : ""}
        </span>
      </div>

      <p className="mission-row-desc">{achievement.description}</p>

      {/* aria-hidden: the same numbers are stated in words right below it,
          same reasoning as .mission-track in challenges-floor.tsx. */}
      <div className="mission-track" aria-hidden="true">
        <div className="mission-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>

      <small className="mission-row-progress">
        {achievement.unlocked
          ? <><Check size={11} aria-hidden="true" /> Unlocked</>
          : `${achievement.progress.toLocaleString()} / ${achievement.threshold.toLocaleString()}`}
      </small>
    </li>
  );
}
