/**
 * The 3D room's real-geometry character roster — rigged .glb humanoids,
 * replacing the six-angle sprite turnaround at seats that carry one.
 *
 * Pure data, no three.js import, so `npm test` reaches it. Each model is a
 * Mixamo-rigged export (Khronos glTF Blender I/O) carrying one baked clip
 * named "Armature|mixamo.com|Layer0" — `avatar-state`'s fuzzy clip matching
 * falls through to "first clip" for these on purpose, since none of the
 * fourteen ships multiple named states yet.
 *
 * TWO THINGS MEASURED OFF THESE FILES that the loader depends on, so that
 * a fifteenth model can be checked against them rather than discovered:
 *  - the baked clip is a SEATED pose, while the bind pose is STANDING. Both
 *    are measured, for different things — see glb-avatar.tsx's header.
 *  - they do NOT agree on units, and neither roster is internally
 *    consistent about it. Of the original six, five are authored in metres
 *    (bind skeleton ~1.77 tall); Michael is at almost exactly twice that.
 *    The eight added from the customer pack (Claira, Donni, Jimmy, Kenji,
 *    Marcus, Oscar, Derek, Victor) carry their own FBX source scale, not
 *    necessarily either of those conventions. None of this matters at
 *    runtime — glb-avatar.tsx measures each model's own bone span and
 *    normalizes to HUMAN_STANDING_UNITS rather than assuming a convention —
 *    but it means nothing here is ever safe to eyeball as "looks about
 *    right" against another file in this array.
 *
 * TWO TIERS, and the split is deliberate rather than cosmetic:
 *  - "starter": free from the moment a seat needs a face. `characterForSlot`
 *    — the automatic assignment every unclaimed bot/human seat gets — cycles
 *    ONLY this tier. That is the enforcement, not a comment: a premium
 *    character reachable by the same cycling that seats bots for free would
 *    make the premium tier worthless the moment a table filled.
 *  - "premium": customer-supplied characters the owner intends to sell.
 *    Not wired to any purchase, ownership or equip path yet — there is no
 *    3D-room analogue of lib/cosmetics/catalog.ts today, and inventing one
 *    (pricing, a store surface, a Supabase ownership table) is a separate
 *    decision from getting the assets into the roster at all. `tier` is the
 *    seam a future store slots into; until then a premium entry sits in the
 *    roster unused by anything.
 *
 * The two renamed customer-pack files are the one thing here that isn't a
 * mechanical port: the source files were "JackieChan_Rigged.fbx" and
 * "PhilIvey_Rigged.fbx". Selling a character under a real, identifiable
 * person's name — a working actor, and a professional poker player, in a
 * poker app — is a right-of-publicity/false-endorsement exposure regardless
 * of how closely the art actually resembles them. Renamed to Kenji and
 * Marcus before anything shipped; the id, display name and every file on
 * disk carry the new name only. Do not reintroduce the original names in
 * code, art, or store copy.
 */

export type CharacterTier = "starter" | "premium";

export interface Character3D {
  id: string;
  name: string;
  /** Path under public/models/, same convention avatarFigure() uses for /avatars/. */
  url: string;
  tier: CharacterTier;
}

export const CHARACTERS_3D: readonly Character3D[] = [
  { id: "gloria", name: "Gloria", url: "/models/Gloria.glb", tier: "starter" },
  { id: "michael", name: "Michael", url: "/models/Michael.glb", tier: "starter" },
  { id: "pablo", name: "Pablo", url: "/models/Pablo.glb", tier: "starter" },
  { id: "james", name: "James", url: "/models/James.glb", tier: "starter" },
  { id: "daniel", name: "Daniel", url: "/models/Daniel.glb", tier: "starter" },
  { id: "dora", name: "Dora", url: "/models/Dora.glb", tier: "starter" },
  { id: "claira", name: "Claira", url: "/models/Claira.glb", tier: "premium" },
  { id: "donni", name: "Donni", url: "/models/Donni.glb", tier: "premium" },
  { id: "jimmy", name: "Jimmy", url: "/models/Jimmy.glb", tier: "premium" },
  { id: "kenji", name: "Kenji", url: "/models/Kenji.glb", tier: "premium" },
  { id: "marcus", name: "Marcus", url: "/models/Marcus.glb", tier: "premium" },
  { id: "oscar", name: "Oscar", url: "/models/Oscar.glb", tier: "premium" },
  { id: "derek", name: "Derek", url: "/models/Derek.glb", tier: "premium" },
  { id: "victor", name: "Victor", url: "/models/Victor.glb", tier: "premium" },
] as const;

export const STARTER_CHARACTERS_3D: readonly Character3D[] = CHARACTERS_3D.filter(
  (c) => c.tier === "starter",
);

export const PREMIUM_CHARACTERS_3D: readonly Character3D[] = CHARACTERS_3D.filter(
  (c) => c.tier === "premium",
);

export function characterById(id: string): Character3D | null {
  return CHARACTERS_3D.find((c) => c.id === id) ?? null;
}

/**
 * Deterministic roster assignment for seats with no cosmetic equipped yet —
 * cycles the starter tier only. Premium characters are real entries in
 * CHARACTERS_3D (loadable by id, listable via PREMIUM_CHARACTERS_3D) but are
 * never hit by this cycle, which is what keeps them worth selling.
 */
export function characterForSlot(slot: number): Character3D {
  return STARTER_CHARACTERS_3D[slot % STARTER_CHARACTERS_3D.length];
}
