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
 * too now -- the real art (the `hjm-all_crops_in_lines.png` sheet, see
 * `scripts/prepare-stackacres-crops.py`) reads fine at its own trimmed box
 * size. This used to blow crops up to 1.5x/2.5x/4x their box: that was a
 * legibility hack from when the crop frames were tiny placeholder art and a
 * ripe row was a few pixels of green on a phone. With real art in place that
 * hack is gone; what is left is a small nudge so a mature plant still reads
 * as slightly fuller than a seedling.
 *
 * The three frames are ./world.ts's `growthStage` output, not a separate
 * ladder: 0 seedling, 1 sprout, 2 mature/harvest-ready.
 */

import { isLivestock, type StackAcresCrop, type StackAcresStock } from "./catalogue";

/**
 * Which crop's three frames a stock kind draws. Every crop id IS its own art
 * id now -- there is no more sprout->carrot / cash_crop->corn indirection,
 * since `sprout`/`cash_crop` are gone and all 22 CraftPix crop ids equal
 * their own sprite file prefix (see ./items.ts's own note on that identity).
 * `CropArt` is therefore just `StackAcresCrop` restated under its own name.
 */
export type CropArt = StackAcresCrop;

/** ./world.ts's `growthStage` output, named for what each frame is. */
export type CropStage = 0 | 1 | 2;

export function cropArtFor(stock: StackAcresStock): CropArt | null {
  return isLivestock(stock) ? null : (stock as CropArt);
}

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
 * because `bakeSpriteTexture` (carrot/corn/corn2, the crops it actually
 * bakes at scale) takes `Math.ceil(w * ART_SCALE * scale)` per axis
 * INDEPENDENTLY -- a fractional product resamples a frame by a slightly
 * different factor across than down, a non-uniform stretch on top of
 * whatever softening the resize itself adds. ART_SCALE is 8, so any scale
 * that is a multiple of 1/8 lands on a whole pixel for every box regardless
 * of that box's own dimensions; 1, 1.125 (9/8) and 1.25 (10/8) all are.
 * crop-visuals.test.ts holds the table to that rule so a future retune
 * cannot reintroduce a fractional rung.
 */
const STAGE_SCALE: Readonly<Record<CropStage, number>> = { 0: 1, 1: 1.125, 2: 1.25 };

export function cropSpriteScale(stage: CropStage): number {
  return STAGE_SCALE[stage];
}

/** The scale a crop's frame is actually drawn at. Only carrot and the two
 *  corns are baked enlarged per stage (stackacres-art.ts's `cropBakeScale`
 *  reads this); every other crop's three frames share one box. */
export function cropDrawnScale(art: CropArt, stage: CropStage): number {
  return art === "carrot" || art === "corn" || art === "corn2" ? cropSpriteScale(stage) : 1;
}

/**
 * Where each crop's own root point sits in its frame, as an offset from the
 * bottom-centre of its canvas: `dx` right of centre, `dy` up from the bottom
 * edge, both in art units.
 *
 * WHY A TRIMMED SPRITE NEEDS THIS. Every frame is trimmed to its ink and
 * pasted flush to the bottom of a shared canvas, so bottom-centre is the
 * lowest pixel anywhere in the frame -- and on anything that sprawls that is
 * a front leaf, not the point the plant grows out of. Anchoring there drew a
 * cabbage up and back off its own bed, floating over the soil rather than
 * standing in it.
 *
 * MEASURED, NOT TUNED, and the two halves are measured differently on
 * purpose.
 *
 * `dy` is the model's own root point in 3D: `center_objects_at_origin` in
 * scripts/render-stackacres-craftpix-crops.py puts each bbox centre on the
 * world origin, so (0, 0, ground) is the plant's footprint at ground level,
 * and `ground_anchor` projects it through the render's own camera. That is
 * the number that carries DEPTH -- how far up the frame the ground is at the
 * plant's base -- and it is what stops a sprawling rosette floating over its
 * bed.
 *
 * `dx` is not that point. A model that leans (a bulb with its leaves fanning
 * to one side) has its bbox centre away from the bulb, and anchoring
 * sideways there hung onions and garlic off the edge of their own soil. So
 * across the frame the anchor is where the plant's mass actually rests: the
 * alpha-weighted centre of the bottom slice of the ink
 * (`ground_band_centre` in scripts/trim-stackacres-craftpix-crops.py).
 *
 * Both come out of that trim script, which prints this table. Re-run the
 * pair after a re-render rather than hand-editing a row -- the same rule
 * `CROP_BOX` already carries.
 *
 * `dy` is clamped at zero by the trim script. A model whose projected root
 * lands below its own lowest ink would otherwise be honoured by LIFTING the
 * plant, which hung the carrot about three units over its own heap of soil.
 * Sinking a plant into its bed is fine; hanging one above it is the bug this
 * table exists to fix.
 */
const CROP_FOOT: Readonly<Record<CropArt, { readonly dx: number; readonly dy: number }>> = {
  artichoke: { dx: 1.04, dy: 2.19 },
  beet: { dx: 0.91, dy: 1.57 },
  brokoly: { dx: 4.6, dy: 0.93 },
  cabbage: { dx: 2.25, dy: 8.34 },
  carrot: { dx: -0.67, dy: 0 },
  corn: { dx: 0.79, dy: 0 },
  corn2: { dx: 2.64, dy: 9.59 },
  cucumber: { dx: 1.72, dy: 1.54 },
  eggplant: { dx: -8.42, dy: 12.19 },
  garlic: { dx: -1.71, dy: 4.84 },
  grap: { dx: -0.57, dy: 1.36 },
  grap2: { dx: 0.18, dy: 1.06 },
  onion: { dx: 2.85, dy: 1.6 },
  pepper: { dx: -1.15, dy: 2.94 },
  poppy: { dx: -0.02, dy: 1.29 },
  potato: { dx: -0.27, dy: 2.99 },
  pumpkin: { dx: -13.91, dy: 7.27 },
  sunflowe_broken: { dx: -3.04, dy: 0 },
  sunflower: { dx: -0.99, dy: 2.89 },
  tomato: { dx: 2.94, dy: 1.85 },
  wheat1: { dx: -4.66, dy: 2.58 },
  wheat2: { dx: -6.03, dy: 5.7 },
};

/**
 * How far DOWN in screen units to nudge a crop so its root point lands on the
 * bed rather than its lowest leaf tip -- `CROP_FOOT`'s own `dy`, scaled.
 *
 * A painter anchors at (0.5, 1) -- the bottom edge of its box -- and Phaser
 * scales about that origin, so a root point `dy` units above the bottom edge
 * is `dy * scale` above it once the frame is grown. The correction has to
 * grow with it or a ripe plant sits higher off its bed than a seedling does.
 */
export function cropGroundOffset(art: CropArt, stage: CropStage): number {
  return CROP_FOOT[art].dy * cropSpriteScale(stage) * cropBedFit(art);
}

/**
 * The sideways half of the same correction: how far to slide a crop so its
 * root point is over the middle of its bed, in screen units.
 *
 * Negative of `CROP_FOOT`'s `dx` for the obvious reason -- a root point drawn
 * to the RIGHT of the canvas's centre has to move the sprite LEFT to land on
 * the bed -- and scaled with the frame for the same reason `cropGroundOffset`
 * is.
 */
export function cropFootShiftX(art: CropArt, stage: CropStage): number {
  return -CROP_FOOT[art].dx * cropSpriteScale(stage) * cropBedFit(art);
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
 *  whose painters are drawn to these exact dimensions). Every box is sized
 *  off its own trimmed CraftPix sprite's real pixel dimensions (÷
 *  ART_SCALE) -- computed once, not recomputed here. This replaces the old
 *  hand-vector carrot (12x16) / corn (12x22) boxes outright; those ids now
 *  draw the new CraftPix renders at these dimensions instead. */
const CROP_BOX: Readonly<Record<CropArt, { readonly w: number; readonly h: number }>> = {
  artichoke: { w: 22, h: 47 },
  beet: { w: 25, h: 41 },
  brokoly: { w: 39, h: 30 },
  cabbage: { w: 38, h: 31 },
  carrot: { w: 34, h: 37 },
  corn: { w: 23, h: 42 },
  corn2: { w: 24, h: 44 },
  cucumber: { w: 22, h: 44 },
  eggplant: { w: 33, h: 26 },
  garlic: { w: 23, h: 40 },
  grap: { w: 14, h: 46 },
  grap2: { w: 16, h: 44 },
  onion: { w: 33, h: 38 },
  pepper: { w: 19, h: 40 },
  poppy: { w: 29, h: 44 },
  potato: { w: 23, h: 47 },
  pumpkin: { w: 41, h: 25 },
  sunflowe_broken: { w: 28, h: 36 },
  sunflower: { w: 20, h: 40 },
  tomato: { w: 31, h: 39 },
  wheat1: { w: 23, h: 37 },
  wheat2: { w: 37, h: 36 },
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

/** One crop's own painted frame, in art units. Exported for the tests that
 *  hold the foot corrections inside it -- nothing in the app reads this
 *  directly, it reads the functions built on it below. */
export function cropBox(art: CropArt): { readonly w: number; readonly h: number } {
  return CROP_BOX[art];
}

/**
 * How big to draw the heap of soil banked around a crop's stem
 * (stackacres-art.ts's `soilCollar`), as a scale of that painter's own
 * 16-unit box.
 *
 * Tracks the CROP'S OWN WIDTH rather than being one size for all 22: a heap
 * sized for a garlic reads as a smudge beside a cabbage, which is what made
 * the bigger crops look like they were standing next to their soil rather
 * than in it. Just over half the frame's width, so the heap is wide enough
 * to meet the plant's base on both sides and never so wide it outgrows the
 * bed it sits on.
 */
export function cropCollarScale(art: CropArt, stage: CropStage): number {
  return ((CROP_BOX[art].w * 0.55) / 16) * cropSpriteScale(stage) * cropBedFit(art);
}

/**
 * Whether the heap of soil is drawn BEHIND the plant instead of over its
 * foot.
 *
 * Over the foot is the rule and it is what makes a plant read as growing out
 * of the ground rather than standing on it. It is wrong for the few crops
 * that lie ACROSS their own base -- a cabbage's rosette, a pumpkin's vine --
 * where a heap in front lands in the middle of the leaves as a brown lump.
 *
 * The tell is already measured: `CROP_FOOT`'s `dy` is how far up the frame
 * the ground sits at the plant's base, so a big one means the plant's own
 * ink hangs well below its footing, which is exactly what a sprawler does.
 * No second table, and no per-crop taste.
 */
export function cropCollarBehind(art: CropArt): boolean {
  return CROP_FOOT[art].dy >= 6;
}

export function cropFootprintHalf(art: CropArt, stage: CropStage): number {
  return Math.max(CROP_FOOTPRINT_HALF, (CROP_BOX[art].w / 2) * cropSpriteScale(stage) * cropBedFit(art));
}

/**
 * What a crop's sprite is drawn at when its soil has run dry: visibly faded,
 * not hidden. It is still the same plant standing in the same place -- the
 * fade is the map saying "this one has stopped", alongside the water cue
 * bubble the scene floats over it.
 */
export const CROP_DRY_ALPHA = 0.55;

export function cropSpriteAlpha(isWatered: boolean): number {
  return isWatered ? 1 : CROP_DRY_ALPHA;
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

/**
 * How long a plant takes to grow from one frame into the next, on screen.
 *
 * A crop's three frames are 1x, 1.125x and 1.25x, so crossing a boundary is a
 * 12.5% then an 11.1% jump in apparent size. Until this existed the scene answered that
 * by destroying the node and building a new one (`signatureOf` counts the
 * stage, and `setUnits` rebuilds on a signature change), which put the whole
 * jump plus a texture swap plus a shadow resize into a single frame with no
 * anticipation and no settle -- the plant teleported.
 *
 * 350ms is long enough to read as the plant growing and short enough that a
 * player sweeping a ready row is never waiting on it: the pop bounce a tap
 * answers with (`popUnit`) is 370ms end to end, so a growth landing mid-sweep
 * finishes inside a beat the player is already watching.
 */
export const CROP_GROWTH_TWEEN_MS = 350;

/** Clamped to 0..1, so a tween read one frame late -- or an ease that leaves
 *  the unit interval -- can never scale a plant past its own target frame or
 *  invert it. */
function growthProgress(t: number): number {
  if (!Number.isFinite(t)) return 1;
  return Math.min(1, Math.max(0, t));
}

/**
 * The sprite scale to draw a growing plant at, `t` of the way from `from`'s
 * apparent size to `to`'s -- expressed as a MULTIPLE OF THE `to` FRAME'S OWN
 * NATURAL SIZE, so it is exactly 1 at `t = 1`.
 *
 * That framing is forced by the enlargement being BAKED into the texture (see
 * `cropSpriteScale`'s own note, and `cropBakeScale` in stackacres-art.ts): the
 * scene swaps the new stage's texture in immediately, and that texture is
 * already drawn at `cropSpriteScale(to)`. So the tween's job is not to scale
 * from one number to another, it is to start the NEW texture shrunk to the OLD
 * frame's apparent size and then release it to its own. Hence the ratio -- at
 * `t = 0` this is `scale(from) / scale(to)`, which renders the new frame at
 * exactly the size the old one occupied, and the swap itself is invisible.
 */
export function cropStageSpriteBlend(from: CropStage, to: CropStage, t: number): number {
  const a = cropSpriteScale(from);
  const b = cropSpriteScale(to);
  return (a + (b - a) * growthProgress(t)) / b;
}

/**
 * The grounding shadow's scale at the same `t`, in the units `cropShadowScale`
 * already returns.
 *
 * Driven off the SAME `t` as the plant rather than a tween of its own, which is
 * the whole point: the shadow is what pins the plant to the furrow, and two
 * tweens of equal duration are still two tweens -- one scheduled a frame apart
 * from the other, or one surviving a rebuild the other did not, detaches the
 * plant from its own shadow mid-growth. The scene drives both off one proxy
 * object so they cannot come apart.
 */
export function cropShadowScaleBlend(art: CropArt, from: CropStage, to: CropStage, t: number): number {
  const a = cropShadowScale(art, from);
  const b = cropShadowScale(art, to);
  return a + (b - a) * growthProgress(t);
}

/**
 * The feet correction at the same `t`.
 *
 * A growth that moved a plant's size without moving its feet would slide it
 * off the soil for the whole 350ms every time it grew, which is exactly what
 * `CROP_FOOT` is scaled per stage to avoid.
 */
export function cropGroundOffsetBlend(
  art: CropArt,
  from: CropStage,
  to: CropStage,
  t: number,
): number {
  const a = cropGroundOffset(art, from);
  const b = cropGroundOffset(art, to);
  return a + (b - a) * growthProgress(t);
}

/** `cropFootShiftX` at the same `t`, for the same reason. */
export function cropFootShiftXBlend(
  art: CropArt,
  from: CropStage,
  to: CropStage,
  t: number,
): number {
  const a = cropFootShiftX(art, from);
  const b = cropFootShiftX(art, to);
  return a + (b - a) * growthProgress(t);
}

