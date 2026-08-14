/**
 * The missions wire contract, shared rather than server-only.
 *
 * lib/server/mission-store.ts carries `import "server-only"`, so the lobby
 * panel cannot import its shapes from there without risking the service-role
 * client in the browser bundle. Same reasoning, same split, as
 * lib/progression/types.ts.
 */

export type MissionCadence = "daily" | "weekly";

/** A row out of the mission_definitions catalog. */
export interface MissionDefinition {
  code: string;
  cadence: MissionCadence;
  /** What lib/missions/events.ts's signals key on. See mission-store.ts. */
  metric: string;
  target: number;
  rewardGold: number;
  /** True only for a metric that should count at most once per UTC day. */
  dedupeDaily: boolean;
  title: string;
  description: string;
  sortOrder: number;
}

/** One mission, from one player's point of view, for the period in progress. */
export interface MissionView {
  code: string;
  cadence: MissionCadence;
  title: string;
  description: string;
  progress: number;
  target: number;
  rewardGold: number;
  completed: boolean;
  /** ISO instant the current period ends, so the UI can show "resets in 6h". */
  periodEnd: string;
}

export interface MissionsPayload {
  daily: MissionView[];
  weekly: MissionView[];
}
