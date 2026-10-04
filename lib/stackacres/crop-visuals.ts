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
 * WHY A CROP GETS ANY BUMP AT ALL. Every other thing on this map is drawn at
 * its painter's own size (`setScale(1 / ART_SCALE)`), and a crop mostly is
 * too now -- the real art (the Gr8FarmPack, see
 * `scripts/prepare-stackacres-farmpack-crops.py`) reads fine at its own
 * trimmed box size. This used to blow crops up to 1.5x/2.5x/4x their box:
 * that was a legibility hack from when the crop frames were tiny placeholder
 * art and a ripe row was a few pixels of green on a phone. With real art in
 * place that hack is gone; what is left is a small nudge so a mature plant
 * still reads as slightly fuller than a seedling.
 *
 * The three frames are ./world.ts's `growthStage` output, not a separate
 * ladder: 0 seedling, 1 sprout, 2 mature/harvest-ready.
 */

import { type StackAcresCrop, } from "./catalogue";

/**
 * Which crop's three frames a stock kind draws. Every crop id IS its own art
 * id -- all 16 Gr8FarmPack crop ids equal their own sprite file prefix (see
 * ./items.ts's own note on that identity). `CropArt` is therefore just
 * `StackAcresCrop` restated under its own name.
 */
export type CropArt = StackAcresCrop;

/** ./world.ts's `growthStage` output, named for what each frame is. */
export type CropStage = 0 | 1 | 2;

/**
 * Sprite scale per frame, against the painter's own drawn size.
 *
 * Stage 0 (seedling) is exactly 1x -- true box size, same as everything else
 * on the map. Stages 1 and 2 get a small, deliberately modest bump (1.125x,
 * 1.25x) so a mature plant still reads as fuller than a sprout, without
 * reviving the old 1.5x/2.5x/4x blow-up (see this file's header) now that
 * the frames are real art instead of tiny placeholders.
 *
 * EVERY VALUE HERE MUST LAND ON A WHOLE PIXEL for every crop's painter box,
 * since `bakeSpriteTexture` (stackacres-art.ts) takes
 * `Math.ceil(w * ART_SCALE * scale)` per axis INDEPENDENTLY -- a fractional
 * product resamples a frame by a slightly different factor across than down,
 * a non-uniform stretch on top of whatever softening the resize itself adds.
 * ART_SCALE is 8, so any scale that is a multiple of 1/8 lands on a whole
 * pixel for every box regardless of that box's own dimensions; 1, 1.125 (9/8)
 * and 1.25 (10/8) all are. crop-visuals.test.ts holds the table to that rule
 * so a future retune cannot reintroduce a fractional rung.
 */
const STAGE_SCALE: Readonly<Record<CropStage, number>> = { 0: 1, 1: 1.125, 2: 1.25 };

export function cropSpriteScale(stage: CropStage): number {
  return STAGE_SCALE[stage];
}

/** The scale a crop's frame is actually drawn at. Every crop draws at 1x
 *  now -- the CraftPix roster's carrot/corn/corn2 bake-enlarged special case
 *  is gone with it: the Gr8FarmPack has no crop whose native trimmed box
 *  read too small to need it, and `cropSpriteScale`'s own stage bump already
 *  covers "a mature plant reads fuller than a seedling" for every crop. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility, see the comment above
export function cropDrawnScale(art: CropArt, stage: CropStage): number {
  return 1;
}

/**
 * The crop hit region's half-size in world units, before the scene adds its
 * own fingertip pad.
 *
 * `CROP_FOOTPRINT_HALF` is what every crop used flat before the crops were
 * grown, and it is kept as a FLOOR rather than replaced: several crops (a
 * seedling especially, at its true 1x size) have a narrower footprint than
 * that, and shrinking the target of the hardest crop to see would be exactly
 * the wrong way round. Above the floor
 * the region tracks the sprite, so the mature frame a thumb is aiming at is
 * the mature frame it hits.
 */
export const CROP_FOOTPRINT_HALF = 12;

/** Each crop art's own painter box, in art units (see stackacres-art.ts,
 *  whose painters are drawn to these exact dimensions). Every box is the
 *  Gr8FarmPack's own mature (stage-2) frame, trimmed to its alpha bbox and
 *  rounded up to a whole ART_SCALE unit ÷ ART_SCALE -- printed by
 *  scripts/prepare-stackacres-farmpack-crops.py, computed once, not
 *  recomputed here. Replaces the 22-crop CraftPix table outright
 *  (2026-09-12); re-run that script rather than hand-editing a row. */
const CROP_BOX: Readonly<Record<CropArt, { readonly w: number; readonly h: number }>> = {
  bell_pepper: { w: 14, h: 18 },
  broccoli: { w: 14, h: 13 },
  cabbage: { w: 13, h: 11 },
  carrot: { w: 9, h: 14 },
  celery: { w: 10, h: 14 },
  corn: { w: 13, h: 32 },
  eggplant: { w: 15, h: 19 },
  green_bean: { w: 17, h: 19 },
  lettuce: { w: 10, h: 9 },
  onion: { w: 10, h: 10 },
  pepper: { w: 16, h: 20 },
  potato: { w: 9, h: 17 },
  radish: { w: 11, h: 18 },
  spinach: { w: 13, h: 13 },
  tomato: { w: 16, h: 22 },
  wheat: { w: 10, h: 29 },
};

/**
 * The widest a ripe crop is drawn, in screen units. A bed's diamond is
 * 2 * SOIL_TILE (32) across, so a plant this wide stands on its own square
 * and only just meets its neighbours' leaves, instead of sprawling over two
 * or three beds and hiding the ones behind it. A tap goes by square, so the
 * square has to stay visible.
 */
export const CROP_BED_FIT_WIDTH = 30;

/** How much a crop's whole picture is shrunk so its ripe frame, as actually
 *  drawn, fits its bed. 1 for a crop that already fits; never grows one.
 *  The foot corrections, heap, footprint and shadow in this file already
 *  include it; the scene applies it to the plant sprite itself. */
export function cropBedFit(art: CropArt): number {
  return Math.min(1, CROP_BED_FIT_WIDTH / (CROP_BOX[art].w * cropDrawnScale(art, 2)));
}

export function cropFootprintHalf(art: CropArt, stage: CropStage): number {
  return Math.max(CROP_FOOTPRINT_HALF, (CROP_BOX[art].w / 2) * cropSpriteScale(stage) * cropBedFit(art));
}

/**
 * How big to draw the grounding shadow under a crop, as a Phaser scale
 * factor against `cropShadow`'s own painted size -- the same kind of number
 * `cropSpriteScale` is for the plant itself, and used the same way at the
 * call site (`.setScale(cropShadowScale(art, stage) / S)`).
 *
 * Every other standee on the map (`isLivestock` branch, stackacres-scene.ts)
 * plants a fixed-size shadow under itself because livestock don't change
 * size. A crop does -- 1x to 1.25x across its three frames -- and a shadow
 * sized for the seedling would read as undersized under the mature stalk,
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

export function cropShadowScale(art: CropArt, stage: CropStage): number {
  return (CROP_SHADOW_FRACTION * cropFootprintHalf(art, stage) * 2) / CROP_SHADOW_BOX_WIDTH;
}

/* ------------------------------------------------------------------ */
/* Growing between two frames                                          */
/* ------------------------------------------------------------------ */

