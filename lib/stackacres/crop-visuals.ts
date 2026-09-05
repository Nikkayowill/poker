/**
 * How big a crop is drawn, where its feet land once it has been grown, and
 * how far past its art a thumb still counts as having hit it.
 *
 * Pure numbers with no Phaser and no components/ import, for the reason
 * stated at the top of ./units.ts: vitest only reaches lib/ and app/, and
 * this is exactly the arithmetic that wants holding to its values. The scene
 * (components/arcade/stackacres/stackacres-scene.ts) is the only caller and
 * owns none of these decisions.
 *
 * WHY THE CROPS ARE DRAWN OVERSIZED. Every other thing on this map is drawn
 * at its painter's own size (`setScale(1 / ART_SCALE)`), and that reads
 * correctly for a barn or a cow. A carrot's ripe frame is a 12x16 unit box,
 * most of which is leaf: on a phone held in landscape, at the zoom the
 * opening shot uses, that is a few pixels of green and the player cannot
 * tell a row that is ready from one that was sown a minute ago. The crops
 * are therefore deliberately off-scale against the rest of the world -- a
 * ripe Cash Crop stands taller than the Hen Coop's hens -- because being
 * legible mid-thumb beats being proportionate.
 *
 * The three frames are ./world.ts's `growthStage` output, not a separate
 * ladder: 0 seedling, 1 sprout, 2 mature/harvest-ready.
 */

import { isLivestock, type StackAcresStock } from "./catalogue";

/** Which crop's three frames a stock kind draws. Mirrors the scene's own
 *  `unit.stock === "cash_crop" ? "corn" : "carrot"`, which is the only place
 *  this mapping exists on the render side. */
export type CropArt = "carrot" | "corn";

/** ./world.ts's `growthStage` output, named for what each frame is. */
export type CropStage = 0 | 1 | 2;

export function cropArtFor(stock: StackAcresStock): CropArt | null {
  if (isLivestock(stock)) return null;
  return stock === "cash_crop" ? "corn" : "carrot";
}

/**
 * Sprite scale per frame, against the painter's own drawn size.
 *
 * Stage 1 (2.5x) and stage 2 (4x) are the two the mobile-legibility pass
 * actually specified. Stage 0 is 1.6x: a seedling has to stay clearly the
 * smallest of the three or the ramp stops reading as growth, but leaving it
 * at 1x next to a 2.5x sprout makes the first frame invisible and the second
 * one look like it teleported in.
 */
const STAGE_SCALE: Readonly<Record<CropStage, number>> = { 0: 1.6, 1: 2.5, 2: 4 };

export function cropSpriteScale(stage: CropStage): number {
  return STAGE_SCALE[stage];
}

/**
 * How far above its own box's bottom edge each frame's ink actually begins,
 * in art units -- hand-read off the painters in
 * components/arcade/stackacres/stackacres-art.ts, which are canvas draw calls
 * and cannot be measured from here.
 *
 * Measured to the bottom of the INK, not to the path -- a stroke is centred
 * on its own line, so half the width sits below where `moveTo` put it, and
 * measuring to the path alone over-corrects and buries the stem.
 *
 *   carrot0   stems from y 15, stroke 1.2 -> ink to 15.6 in a 16 box  -> 0.4
 *   carrot1   stems from y 15, stroke 1.4 -> ink to 15.7 in a 16 box  -> 0.3
 *   carrot2   the root's own box runs to y 16.2, past the baseline,
 *             so it is already planted                              -> 0
 *   corn0/1/2 the stalk starts at y 22 in a 22-tall box              -> 0
 *
 * Anything nonzero here floats once the frame is scaled up, which is the
 * whole reason this table exists -- see `cropGroundOffset`.
 */
const FOOT_INSET: Readonly<Record<CropArt, Readonly<Record<CropStage, number>>>> = {
  carrot: { 0: 0.4, 1: 0.3, 2: 0 },
  corn: { 0: 0, 1: 0, 2: 0 },
};

/**
 * How far DOWN in screen units to nudge a scaled crop so its feet land back
 * on the soil.
 *
 * A painter anchors at (0.5, 1) -- the bottom edge of its box -- and Phaser
 * scales about that origin, so a frame whose ink starts `d` units above the
 * box's bottom has that gap multiplied along with everything else: at 2.5x, a
 * 1-unit gap becomes 2.5, and the sprout hovers a unit and a half over the
 * plot. Pushing the sprite down by the growth in that gap puts the ink back
 * exactly where it sat at 1x.
 *
 * Zero for every frame already drawn to its own baseline, which is most of
 * them -- this is a correction, not a per-frame nudge to taste.
 */
export function cropGroundOffset(art: CropArt, stage: CropStage): number {
  return (cropSpriteScale(stage) - 1) * FOOT_INSET[art][stage];
}

/**
 * The crop hit region's half-size in world units, before the scene adds its
 * own fingertip pad.
 *
 * `CROP_FOOTPRINT_HALF` is what every crop used flat before the crops were
 * grown, and it is kept as a FLOOR rather than replaced: a seedling drawn at
 * 1.6x has a narrower footprint than that, and shrinking the target of the
 * hardest crop to see would be exactly the wrong way round. Above the floor
 * the region tracks the sprite, so the mature frame a thumb is aiming at is
 * the mature frame it hits.
 */
export const CROP_FOOTPRINT_HALF = 12;

/** Painter box width shared by every crop frame (carrot and corn are both
 *  12 units wide; see stackacres-art.ts). */
const CROP_BOX_WIDTH = 12;

export function cropFootprintHalf(stage: CropStage): number {
  return Math.max(CROP_FOOTPRINT_HALF, (CROP_BOX_WIDTH / 2) * cropSpriteScale(stage));
}

/**
 * What a crop's sprite is drawn at when its soil has run dry: visibly faded,
 * not hidden. It is still the same plant standing in the same place -- the
 * fade is the map saying "this one has stopped", the same job the amber ring
 * does for a hungry animal, in the one channel a crop has that an animal's
 * silhouette does not.
 */
export const CROP_DRY_ALPHA = 0.55;

export function cropSpriteAlpha(isWatered: boolean): number {
  return isWatered ? 1 : CROP_DRY_ALPHA;
}

/**
 * How big to draw the grounding shadow under a crop, as a Phaser scale
 * factor against `cropShadow`'s own painted size -- the same kind of number
 * `cropSpriteScale` is for the plant itself, and used the same way at the
 * call site (`.setScale(cropShadowScale(stage) / S)`).
 *
 * Every other standee on the map (`isLivestock` branch, stackacres-scene.ts)
 * plants a fixed-size shadow under itself because livestock don't change
 * size. A crop does -- 1.6x to 4x across its three frames -- and a shadow
 * sized for the seedling would read as a puddle under the mature stalk,
 * while one sized for the mature stalk would swallow the seedling. So this
 * tracks `cropFootprintHalf`, the one number that already answers "how big
 * does this stage's plant actually read as", rather than a second hand-tuned
 * ladder that could drift from it.
 */
const CROP_SHADOW_BOX_WIDTH = 16;

/** A shadow pool reads as grounding the plant only while it stays smaller
 *  than the canopy casting it -- a shadow the same size as the plant above
 *  it looks like a second, flatter plant instead. */
const CROP_SHADOW_FRACTION = 0.8;

export function cropShadowScale(stage: CropStage): number {
  return (CROP_SHADOW_FRACTION * cropFootprintHalf(stage) * 2) / CROP_SHADOW_BOX_WIDTH;
}
