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

import { isLivestock, type StackAcresCrop, type StackAcresStock } from "./catalogue";

/**
 * Which crop's three frames a stock kind draws. Every crop id IS its own art
 * id -- all 16 Gr8FarmPack crop ids equal their own sprite file prefix (see
 * ./items.ts's own note on that identity). `CropArt` is therefore just
 * `StackAcresCrop` restated under its own name.
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
 * Where each crop's own root point sits in its frame, as an offset from the
 * bottom-centre of its canvas: `dx` right of centre, `dy` up from the bottom
 * edge, both in art units.
 *
 * ALL ZERO for the Gr8FarmPack roster (2026-09-12), and that is not a
 * placeholder -- it is what the pack's own art measures to.
 * `scripts/prepare-stackacres-farmpack-crops.py` trims each frame to its own
 * alpha bbox, centred left/right and flush to the bottom, independently per
 * stage (there is no shared-camera ground plane across a crop's 3 frames the
 * way the old CraftPix renders had). Bottom-centre of a bottom-anchored trim
 * IS the root point, so there is nothing left to correct. The CraftPix
 * roster's non-zero table (hand-measured off a 3D render's own lean and
 * depth) does not apply here; don't carry a row over from it if a crop name
 * happens to repeat.
 *
 * Re-run that script rather than hand-editing a row if this ever needs to
 * stop being all-zero -- same rule `CROP_BOX` already carries.
 */
const CROP_FOOT: Readonly<Record<CropArt, { readonly dx: number; readonly dy: number }>> = {
  bell_pepper: { dx: 0, dy: 0 },
  broccoli: { dx: 0, dy: 0 },
  cabbage: { dx: 0, dy: 0 },
  carrot: { dx: 0, dy: 0 },
  celery: { dx: 0, dy: 0 },
  corn: { dx: 0, dy: 0 },
  eggplant: { dx: 0, dy: 0 },
  green_bean: { dx: 0, dy: 0 },
  lettuce: { dx: 0, dy: 0 },
  onion: { dx: 0, dy: 0 },
  pepper: { dx: 0, dy: 0 },
  potato: { dx: 0, dy: 0 },
  radish: { dx: 0, dy: 0 },
  spinach: { dx: 0, dy: 0 },
  tomato: { dx: 0, dy: 0 },
  wheatsheaf: { dx: 0, dy: 0 },
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
  wheatsheaf: { w: 10, h: 29 },
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
 * Tracks the CROP'S OWN WIDTH rather than being one size for all 16: a heap
 * sized for a carrot reads as a smudge beside a cabbage, which is what made
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
 * of the ground rather than standing on it. It is wrong for a crop that lies
 * ACROSS its own base -- a rosette, a sprawling vine -- where a heap in
 * front lands in the middle of the leaves as a brown lump.
 *
 * The tell is already measured: `CROP_FOOT`'s `dy` is how far up the frame
 * the ground sits at the plant's base, so a big one means the plant's own
 * ink hangs well below its footing, which is exactly what a sprawler does.
 * No second table, and no per-crop taste. Every Gr8FarmPack crop's `dy` is 0
 * (see CROP_FOOT's own header), so this always reads false for the current
 * roster -- kept as a real check rather than hard-coded false in case a
 * future crop's own art needs it.
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

