/**
 * WHICH PBR CLAMP A MATERIAL SLOT SHOULD GET — the fix for the "dead eyes,
 * plastic skin" half of the uncanny-valley complaint.
 *
 * `glb-avatar.tsx` clamps every mesh material's roughness/metalness toward
 * cloth-appropriate values (`CLOTH_ROUGHNESS_FLOOR`/`CLOTH_METALNESS_CEILING`)
 * so a cotton hoodie doesn't read as wet latex under the studio spot — but it
 * used to apply that clamp to every material with no name filter, which also
 * flattened glossy eyes and pushed already-broken skin authoring further from
 * correct rather than fixing it.
 *
 * A direct audit of every roster `.glb`'s embedded material JSON (not
 * guessed — read the binary GLB chunk) found the six STARTER characters
 * (the only ones any seat can actually show; premium has no equip path yet)
 * split into three shapes:
 *   - Pablo: fully separable (`Skin_MAT`, `Eyes_MAT`, `Clothes_MAT`, ...),
 *     with an authored glossy eye (roughness 0.03) the old blanket clamp was
 *     force-raising to 0.55.
 *   - Michael: fully separable (`Bodymat`, `Eyelashmat`, `Hairmat`, ...).
 *   - Daniel / Dora / Gloria / James: body vs. hair (`Ch\d+_body`,
 *     `Ch\d+_hair`), with body materials authored at `metalness 0.5` — a
 *     real authoring bug the old clamp only pulled down to 0.15.
 * The eight premium characters share one flat material for the whole body
 * and cannot be classified this way — they fall through to `"other"`, same
 * treatment as today, and stay a known follow-up (needs a Blender-side
 * material split, not a runtime fix).
 *
 * Pure name matching, no three.js, so `npm test` reaches it.
 */

export type AvatarMaterialClass = "eyes" | "skin" | "other";

// Negative lookahead excludes "Eyelashmat" (Michael's roster) — an eyelash
// is hair, not the eyeball, and wants the matte "other" clamp, not the
// eyes' near-pass-through gloss.
const EYE_PATTERN = /eye(?!lash)/i;
const SKIN_PATTERN = /skin|body/i;

export function classifyAvatarMaterial(name: string | undefined | null): AvatarMaterialClass {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "other";
  if (EYE_PATTERN.test(trimmed)) return "eyes";
  if (SKIN_PATTERN.test(trimmed)) return "skin";
  return "other";
}
