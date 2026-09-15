/**
 * The /api/hub wire contract, shared rather than server-only.
 *
 * Same split as lib/missions/types.ts and lib/achievements/types.ts: the
 * stores behind each section carry `import "server-only"`, so the client
 * poller cannot reach their shapes without risking the service-role client in
 * the browser bundle.
 */

import type { AchievementsPayload } from "@/lib/achievements/types";
import type { MissionsPayload } from "@/lib/missions/types";
import type { NotificationsPayload } from "@/lib/notifications/types";
import type { HeadsUpTable } from "@/components/heads-up/heads-up-shell";
import type { PendingTableInvite } from "@/lib/social/types";

/**
 * Every section the hub can answer for. The order is the catalog the route
 * filters caller-supplied `include` against, so a new section is added here
 * and nowhere else.
 */
export const HUB_SECTIONS = [
  "notifications",
  "missions",
  "achievements",
  "invites",
  "headsUp",
] as const;

export type HubSection = (typeof HUB_SECTIONS)[number];

/**
 * Every field optional: a response carries exactly the sections that request
 * asked for, and a consumer reading a section it did not subscribe to is a
 * bug the type should catch rather than paper over with an empty default.
 */
export interface HubPayload {
  notifications?: NotificationsPayload;
  missions?: MissionsPayload;
  achievements?: AchievementsPayload;
  invites?: { invites: PendingTableInvite[]; ttlMs: number };
  headsUp?: { invites: HeadsUpTable[] };
}
