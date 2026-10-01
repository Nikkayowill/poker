import "server-only";

import {
  mayVisit,
  type ShowcaseReactionCounts,
  type ShowcaseReactionId,
  type StackAcresShowcase,
  type VisitorStanding,
} from "@/lib/stackacres/showcase";
import { areFriends, isBlockedEitherWay } from "./friends-store";
import {
  ShowcaseRequestError,
  projectFarmShowcase,
  requireShowcaseViewer,
} from "./stackacres-showcase-service";
import {
  countFarmReactions,
  insertFarmReaction,
  listViewerReactions,
  readFarmVisibility,
} from "./stackacres-showcase-store";

/**
 * The gate on Visitor Mode: whether this player may look at that farm, and
 * the two things they may do once they are in.
 *
 * WHY THIS IS NOT IN lib/server/stackacres-showcase-service.ts. Deciding who
 * may look needs the social graph, and farm server code reaches the rest of
 * the app only through the wallet -- eslint.config.mjs enforces it on
 * `lib/server/stackacres-*`, so that StackAcres can move to its own database
 * later without untangling it. So the dependency points this way instead: the
 * farm knows how to project itself and nothing about friendship; this module
 * knows about friendship and asks the farm for a projection.
 *
 * EVERY ROUTE GOES THROUGH HERE. The two exports below are the only way in,
 * and both of them start with the same `requireStanding`, so a snapshot and a
 * reaction can never disagree about who is allowed -- a compliment landing on
 * a farm its sender could not open would be the hole that matters.
 *
 * EVERY REFUSAL IS THE SAME 404. A private farm, a stranger's friends-only
 * farm, a block in either direction and a profile id that never existed all
 * answer identically. Anything else would turn this into an endpoint that
 * tells whoever holds a profile id whether that player farms and whether they
 * have been blocked. The viewer's own farm is the one thing never refused.
 */

const NO_SUCH_FARM = "That farm isn't open to visitors.";

function notFound(): ShowcaseRequestError {
  return new ShowcaseRequestError(NO_SUCH_FARM, 404);
}

/**
 * Where the viewer stands with this farm, or a refusal.
 *
 * Blocks are checked before the setting and answer the same 404: a block is
 * the strongest "no" in the app and must not be distinguishable from the farm
 * simply not being open.
 */
async function requireStanding(viewerId: string, farmProfileId: string): Promise<VisitorStanding> {
  if (viewerId === farmProfileId) return { own: true, friend: false };
  if (await isBlockedEitherWay(viewerId, farmProfileId)) throw notFound();

  const [visibility, friend] = await Promise.all([
    readFarmVisibility(farmProfileId),
    areFriends(viewerId, farmProfileId),
  ]);
  const standing: VisitorStanding = { own: false, friend };
  if (!mayVisit(visibility, standing)) throw notFound();
  return standing;
}

export async function readFarmShowcase(
  token: string,
  farmProfileId: string,
  now: Date,
): Promise<StackAcresShowcase> {
  const viewer = await requireShowcaseViewer(token);
  const standing = await requireStanding(viewer.id, farmProfileId);

  const [reactions, sent] = await Promise.all([
    countFarmReactions(farmProfileId),
    listViewerReactions(farmProfileId, viewer.id),
  ]);
  const showcase = await projectFarmShowcase(farmProfileId, reactions, sent, standing.own, now);
  if (!showcase) throw notFound();
  return showcase;
}

/**
 * Leaves one compliment on somebody's farm.
 *
 * Nobody reacts to their own farm, and a reaction already left is reported as
 * landed rather than as an error -- the once-only rule is the table's primary
 * key, not a check here (see lib/server/stackacres-showcase-store.ts).
 *
 * Moves no Gold, changes nothing about the farm, and notifies nobody. It adds
 * one row the owner sees next time they open their own setting.
 */
export async function reactToFarmShowcase(
  token: string,
  farmProfileId: string,
  reaction: ShowcaseReactionId,
): Promise<{ reactions: ShowcaseReactionCounts; sent: ShowcaseReactionId[]; counted: boolean }> {
  const viewer = await requireShowcaseViewer(token);
  const standing = await requireStanding(viewer.id, farmProfileId);
  if (standing.own) {
    throw new ShowcaseRequestError("You can't leave a reaction on your own farm.", 400);
  }

  const counted = await insertFarmReaction(farmProfileId, viewer.id, reaction);
  const [reactions, sent] = await Promise.all([
    countFarmReactions(farmProfileId),
    listViewerReactions(farmProfileId, viewer.id),
  ]);
  return { reactions, sent, counted };
}
