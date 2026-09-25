/**
 * The discrete visual stage a traveler's own zone should show, derived from
 * story progress alone -- same posture ../sectors.ts's `sectorOvergrowth`
 * already takes for a district's wild growth: this is pure, and a renderer
 * paints exactly what it says and nothing else.
 *
 * Deliberately ONE small ladder shared by every traveler rather than a
 * bespoke per-traveler enum -- the smallest change that turns progress into
 * a paintable signal (docs/stackacres-direction.md's own "smallest change
 * that preserves the architecture" principle). No renderer reads this yet:
 * wiring one concrete prop/variant pair to it is a follow-up once the live
 * scene's actual prop system has been checked fresh (Phaser vs. canvas vs.
 * React-DOM prop painters have drifted across worktrees; see this file's
 * companion PRs).
 */

import { isTravelerDone, type StoredTravelerStory } from "./state";
import type { TravelerId } from "./travelers";

export const TRAVELER_VISUAL_STATES = ["absent", "arrived", "under-way", "home"] as const;

export type TravelerVisualState = (typeof TRAVELER_VISUAL_STATES)[number];

/**
 * `absent` before the player has met them, `arrived` right after (their
 * first quest still open), `under-way` once at least one quest of their
 * line has turned in, `home` once the whole line is finished. Never reads a
 * clock or a store -- same "derived, not stored" posture `./unlocks.ts`
 * already commits to for a traveler's own unlock.
 */
export function travelerVisualState(entry: StoredTravelerStory, id: TravelerId): TravelerVisualState {
  if (!entry.met) return "absent";
  if (isTravelerDone(entry, id)) return "home";
  if (entry.questIndex >= 1) return "under-way";
  return "arrived";
}
