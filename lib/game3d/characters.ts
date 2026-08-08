/**
 * The 3D room's real-geometry character roster — rigged .glb humanoids,
 * replacing the six-angle sprite turnaround at seats that carry one.
 *
 * Pure data, no three.js import, so `npm test` reaches it. Each model is a
 * Mixamo-rigged export (Khronos glTF Blender I/O) carrying one baked clip
 * named "Armature|mixamo.com|Layer0" — `avatar-state`'s fuzzy clip matching
 * falls through to "first clip" for these on purpose, since none of the six
 * ships multiple named states yet.
 *
 * TWO THINGS MEASURED OFF THESE FILES that the loader depends on, so that
 * a seventh model can be checked against them rather than discovered:
 *  - the baked clip is a SEATED pose, while the bind pose is STANDING. Both
 *    are measured, for different things — see glb-avatar.tsx's header.
 *  - they do NOT agree on units. Five are authored in metres (bind skeleton
 *    ~1.77 tall); Michael is at almost exactly twice that. Nothing here is
 *    in centimetres, whatever an earlier note in glb-avatar.tsx claimed.
 */

export interface Character3D {
  id: string;
  name: string;
  /** Path under public/models/, same convention avatarFigure() uses for /avatars/. */
  url: string;
}

export const CHARACTERS_3D: readonly Character3D[] = [
  { id: "gloria", name: "Gloria", url: "/models/Gloria.glb" },
  { id: "michael", name: "Michael", url: "/models/Michael.glb" },
  { id: "pablo", name: "Pablo", url: "/models/Pablo.glb" },
  { id: "james", name: "James", url: "/models/James.glb" },
  { id: "daniel", name: "Daniel", url: "/models/Daniel.glb" },
  { id: "dora", name: "Dora", url: "/models/Dora.glb" },
] as const;

export function characterById(id: string): Character3D | null {
  return CHARACTERS_3D.find((c) => c.id === id) ?? null;
}

/** Deterministic roster assignment for seats with no cosmetic equipped yet — cycles the roster. */
export function characterForSlot(slot: number): Character3D {
  return CHARACTERS_3D[slot % CHARACTERS_3D.length];
}
