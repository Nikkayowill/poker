import "server-only";

import { chapterViews } from "@/lib/stackacres/chapters";
import { isPlaced } from "@/lib/stackacres/empire-buildings";
import { emptyInventory } from "@/lib/stackacres/inventory";
import type { MachineKind } from "@/lib/stackacres/machines";
import { stackacresMilestone } from "@/lib/stackacres/shop-locks";
import {
  farmLevelFromMilestone,
  favoriteProduction,
  type FarmVisibility,
  type ShowcaseReactionCounts,
  type ShowcaseReactionId,
  type StackAcresShowcase,
} from "@/lib/stackacres/showcase";
import { ArcadeRequestError } from "./arcade-request";
import { findProfileBySessionToken, getProfileById, getPublicProfilesByIds } from "./profile-store";
import { readStackAcresViewByProfile, type StackAcresView } from "./stackacres-service";
import {
  countFarmReactions,
  readFarmVisibility,
  writeFarmVisibility,
} from "./stackacres-showcase-store";

/**
 * The farm's half of Visitor Mode: the owner's own setting, and the
 * projection that turns their farm into what a visitor may see.
 *
 * WHO IS ALLOWED IN IS NOT DECIDED HERE. That needs the social graph, and
 * farm server code reaches the rest of the app only through the wallet (see
 * eslint.config.mjs's own rule on `lib/server/stackacres-*`), so the gate
 * lives one module out in lib/server/farm-showcase-visits.ts and that module
 * is the only caller of `projectFarmShowcase` below. Nothing in this file can
 * answer "may this person look", and nothing in it tries.
 *
 * WHAT MAKES THE PROJECTION SAFE is that it is written as a literal. A new
 * field on `StackAcresView` is invisible to it, so tomorrow's addition to the
 * farm cannot leak by nobody remembering to strip it out.
 *
 * NO GOLD MOVES IN THIS FILE, and none should: looking at a farm is free and
 * a reaction pays nobody. See docs/stackacres-direction.md's rule that every
 * feature says where Gold enters and leaves before it is written.
 */

export class ShowcaseRequestError extends ArcadeRequestError<never> {
  readonly name = "ShowcaseRequestError";
}

/** The caller's own profile, which must already exist -- a read never mints
 *  one (lib/server/session-minting.test.ts's rule). */
export async function requireShowcaseViewer(token: string): Promise<{ id: string }> {
  const viewer = await findProfileBySessionToken(token);
  if (!viewer) throw new ShowcaseRequestError("Sign in to visit a farm.", 401);
  return viewer;
}

/* ------------------------------------------------------------------ */
/* The owner's own setting                                             */
/* ------------------------------------------------------------------ */

export interface ShowcaseSettings {
  visibility: FarmVisibility;
  /** The compliments left on this farm so far, for the owner to see. */
  reactions: ShowcaseReactionCounts;
}

export async function readShowcaseSettings(token: string): Promise<ShowcaseSettings> {
  const viewer = await requireShowcaseViewer(token);
  const [visibility, reactions] = await Promise.all([
    readFarmVisibility(viewer.id),
    countFarmReactions(viewer.id),
  ]);
  return { visibility, reactions };
}

export async function setShowcaseVisibility(
  token: string,
  visibility: FarmVisibility,
): Promise<ShowcaseSettings> {
  const viewer = await requireShowcaseViewer(token);
  await writeFarmVisibility(viewer.id, visibility);
  return { visibility, reactions: await countFarmReactions(viewer.id) };
}

/* ------------------------------------------------------------------ */
/* The projection                                                      */
/* ------------------------------------------------------------------ */

function project(
  view: StackAcresView,
  owner: StackAcresShowcase["owner"],
  reactions: ShowcaseReactionCounts,
  sent: ShowcaseReactionId[],
  own: boolean,
): StackAcresShowcase {
  const built = new Set<MachineKind>(view.machines.map((machine) => machine.kind));
  // A chapter is done when its buildings are up, and nothing else -- the Gold
  // and materials in a `ChapterView`'s steps are only there to draw the
  // owner's own "how close am I" bars, and are not read here. Passing an empty
  // purse keeps this on the one function that decides what "done" means
  // instead of restating the rule with a different bug in it.
  const chapters = chapterViews(built, { gold: 0, inventory: emptyInventory() });
  const current = chapters.find((chapter) => !chapter.done) ?? null;

  return {
    owner,
    stats: {
      farmLevel: farmLevelFromMilestone(
        stackacresMilestone({
          sectors: view.sectors,
          influence: view.influence,
          greenhouseBuilt: view.greenhouseBuilt,
          cropFieldsUnlocked: view.cropFieldsUnlocked,
        }),
      ),
      chapter: current ? { number: current.chapter.number, title: current.chapter.title } : null,
      chaptersDone: chapters.filter((chapter) => chapter.done).length,
      favoriteProduction: favoriteProduction(view.units),
    },
    world: {
      units: view.units,
      soilTiles: view.soilTiles,
      fences: [...view.fences],
      guardDogs: [...view.guardDogs],
      // Placed only. A building in storage stands nowhere, so there is
      // nothing for the map to draw and nothing to tell a visitor about.
      empireBuildings: view.empire.buildings.filter(isPlaced),
      woodNodes: [...view.woodNodes],
      stoneNodes: [...view.stoneNodes],
      forageNodes: [...view.forageNodes],
      landObstacles: [...view.landObstacles],
      // The floor and the crew only. The till and what it has collected are
      // this player's money and have no field to travel in.
      grocery: view.grocery?.owned
        ? { layout: [...view.grocery.layout], staff: [...view.grocery.staff] }
        : null,
      clock: view.clock,
    },
    reactions,
    sent,
    own,
  };
}

/**
 * One farm, as a visitor who has ALREADY BEEN LET IN may see it.
 *
 * Takes no session token and makes no decision about access: its caller
 * (lib/server/farm-showcase-visits.ts) has done that, and calling this
 * without doing it first would hand out a farm the viewer was never allowed
 * to open. Null when there is no such profile, so the caller can answer its
 * own single 404 rather than this file inventing a second one.
 *
 * The full `StackAcresView` never leaves this function.
 */
export async function projectFarmShowcase(
  farmProfileId: string,
  reactions: ShowcaseReactionCounts,
  sent: ShowcaseReactionId[],
  own: boolean,
  now: Date,
): Promise<StackAcresShowcase | null> {
  const [profile, summaries] = await Promise.all([
    getProfileById(farmProfileId),
    getPublicProfilesByIds([farmProfileId]),
  ]);
  const summary = summaries.get(farmProfileId);
  if (!profile || !summary) return null;

  const owner: StackAcresShowcase["owner"] = {
    profileId: farmProfileId,
    displayName: summary.displayName,
    initials: summary.initials,
    avatarUrl: summary.avatarUrl,
    avatarPreset: summary.avatarPreset,
    accent: summary.accent,
  };
  return project(await readStackAcresViewByProfile(profile, now), owner, reactions, sent, own);
}
