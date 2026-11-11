import type { Doing } from "./npc-routine";

export type Motive = "work" | "rest" | "social" | "observe";

export interface Needs {
  /** 0 means spent, 1 means fresh. */
  energy: number;
  /** 0 means socially satisfied, 1 means they would welcome company. */
  social: number;
}

export interface MotiveContext {
  needs: Needs;
  doing: Doing;
  night: boolean;
  nearbyPeople: number;
  farmerNearby: boolean;
  behindMs: number;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Chooses the small thing an NPC wants to do between scheduled actions.
 *
 * This is deliberately not a planner. The daily routine still owns destinations and chores; this only
 * chooses whether an interruptible moment reads as work, a breather, company, or a glance around.
 */
export function chooseMotive(context: MotiveContext): Motive {
  const { needs, doing, night, nearbyPeople, farmerNearby, behindMs } = context;
  if (night) return "rest";
  if (behindMs > 3000) return "work";

  const scores: Record<Motive, number> = {
    work: doing === "walk" ? 0.75 : doing === "idle" ? 0.05 : 0.65,
    rest: (1 - clamp(needs.energy)) * 1.25 + (doing === "fish" ? 0.15 : 0),
    social: clamp(needs.social) * 0.9 + Math.min(nearbyPeople, 2) * 0.16 + (farmerNearby ? 0.12 : 0),
    observe: 0.2 + (farmerNearby ? 0.28 : 0) + Math.min(nearbyPeople, 2) * 0.08,
  };

  // Stable priority breaks ties without random-looking frame-to-frame changes.
  return (["rest", "social", "observe", "work"] as Motive[]).reduce((best, motive) => (scores[motive] > scores[best] ? motive : best));
}
