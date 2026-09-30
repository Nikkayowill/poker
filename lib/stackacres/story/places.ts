/**
 * Named spots a quest can send the player to, distinct from
 * ../secrets.ts's `HiddenZoneId` on purpose: a hidden zone rolls a
 * probabilistic once-a-day discovery chance, which is wrong for a quest
 * objective that has to be deterministically completable the moment the
 * player gets there. A quest place always registers a visit; nothing here
 * rolls, throttles, or hands out an item.
 *
 * Same tap-a-tagged-spot posture ../secrets.ts's hidden zones already use
 * (see stackacres-service.ts's `tapStackAcresSecretZone` and
 * components/arcade/stackacres-td/scene.ts's `case "secret"` dispatch): the
 * server trusts a client-reported id rather than tracking farmer position
 * itself, which is the existing trust boundary for every tap on this map.
 */

import type { WorldRect } from "../world";
import { yardRect } from "../yard";

export const QUEST_PLACE_IDS = ["ray_porch"] as const;

export type QuestPlaceId = (typeof QUEST_PLACE_IDS)[number];

/** Whether a string off the wire names a real quest place. Same reasoning as
 *  ../secrets.ts's `isHiddenZoneId`: the route's zod enum is built from
 *  `QUEST_PLACE_IDS` directly, this is for a caller that already has a bare
 *  string. */
export function isQuestPlaceId(value: string): value is QuestPlaceId {
  return (QUEST_PLACE_IDS as readonly string[]).includes(value);
}

export interface QuestPlaceDef {
  readonly id: QuestPlaceId;
  readonly label: string;
  readonly bounds: WorldRect;
}

/**
 * A 22-unit box south of Ray's own house, clear of RAY_HOUSE_FOOTPRINT
 * (yardRect(72, -133, 90, 44)), BARN_FOOTPRINT (yardRect(63, -25, 74, 62)),
 * every hidden zone, and every district's own grow area -- places.test.ts
 * holds that disjointness the same way secrets.test.ts holds it for the
 * hidden zones.
 */
export const QUEST_PLACES: readonly QuestPlaceDef[] = [
  {
    id: "ray_porch",
    label: "Ray's Porch",
    bounds: yardRect(80, -60, 22, 22),
  },
];

/** Which quest place a tapped ground point lands on, or null anywhere else.
 *  Same plain AABB-loop pattern as ../secrets.ts's `hiddenZoneAt`. */
export function questPlaceAt(x: number, y: number): QuestPlaceDef | null {
  for (const place of QUEST_PLACES) {
    const b = place.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return place;
  }
  return null;
}
