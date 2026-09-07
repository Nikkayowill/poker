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
 * Stage 1 (2.5x) and stage 2 (4x) are the two the mobile-legibility pass
 * actually specified. Stage 0 is 1.5x: a seedling has to stay clearly the
 * smallest of the three or the ramp stops reading as growth, but leaving it
 * at 1x next to a 2.5x sprout makes the first frame invisible and the second
 * one look like it teleported in.
 *
 * EVERY VALUE HERE MUST LAND ON A WHOLE PIXEL for both crops' painter boxes,
 * because `bakeSpriteTexture` takes `Math.ceil(w * ART_SCALE * scale)` per
 * axis INDEPENDENTLY. Stage 0 was 1.6x, which is where that bites: a carrot's
 * 12x16 box gives 153.6 x 204.8, which ceils to 154 x 205 -- so the frame was
 * resampled by 1.6042x across and 1.6016x down, a NON-UNIFORM stretch, and
 * the seedling came out very slightly squashed as well as soft. At 1.5x all
 * four numbers are exact (carrot 144x192, corn 144x264); stages 1 and 2
 * already were. crop-visuals.test.ts holds the whole table to that rule so a
 * future retune cannot reintroduce a fractional rung.
 *
 * This is a ROUNDING fix, not a fix for crop softness in general. The crop
 * PNGs are ~5-6x upscales of 13-17 pixel source bands, so the frames are
 * starved of real detail that no scale here can restore -- that needs new art
 * at bake resolution. See `scripts/prepare-stackacres-crops.py`.
 */
const STAGE_SCALE: Readonly<Record<CropStage, number>> = { 0: 1.5, 1: 2.5, 2: 4 };

export function cropSpriteScale(stage: CropStage): number {
  return STAGE_SCALE[stage];
}

/**
 * How far above its own box's bottom edge each frame's ink actually begins,
 * in art units. All zero: every crop frame is now a generated sprite
 * (stackacres-art.ts's `spriteBacked`), and the FLUX prep pipeline
 * (~/.local/share/flux-sprite-test/task-crops/prep_crops.py, external to this
 * repo) fits every asset to its box HEIGHT and pastes it flush to the
 * canvas's own bottom edge -- the same "stand on its floor" convention
 * task-trees's prep script established. So the ink always starts exactly at
 * the box's bottom edge now, for every stage of both crops.
 *
 * This table predates that: it used to be hand-read off the vector painters
 * these sprites replaced (a carrot's stem stroke started a few tenths of a
 * unit above the baseline), which is why it is kept as a table rather than
 * deleted outright -- a future crop whose art is NOT re-fit flush (or a
 * fallback path that draws the old vector shape) would need it non-zero
 * again, and this is where that number would go.
 *
 * Anything nonzero here floats once the frame is scaled up, which is the
 * whole reason this table exists -- see `cropGroundOffset`.
 */
const FOOT_INSET: Readonly<Record<CropArt, Readonly<Record<CropStage, number>>>> = {
  // All 22 crops are flush-bottom trimmed sprites, so every one of these is
  // zero.
  garlic: { 0: 0, 1: 0, 2: 0 },
  onion: { 0: 0, 1: 0, 2: 0 },
  beet: { 0: 0, 1: 0, 2: 0 },
  poppy: { 0: 0, 1: 0, 2: 0 },
  potato: { 0: 0, 1: 0, 2: 0 },
  carrot: { 0: 0, 1: 0, 2: 0 },
  cabbage: { 0: 0, 1: 0, 2: 0 },
  cucumber: { 0: 0, 1: 0, 2: 0 },
  pepper: { 0: 0, 1: 0, 2: 0 },
  brokoly: { 0: 0, 1: 0, 2: 0 },
  sunflower: { 0: 0, 1: 0, 2: 0 },
  sunflowe_broken: { 0: 0, 1: 0, 2: 0 },
  wheat1: { 0: 0, 1: 0, 2: 0 },
  tomato: { 0: 0, 1: 0, 2: 0 },
  corn: { 0: 0, 1: 0, 2: 0 },
  corn2: { 0: 0, 1: 0, 2: 0 },
  eggplant: { 0: 0, 1: 0, 2: 0 },
  grap: { 0: 0, 1: 0, 2: 0 },
  grap2: { 0: 0, 1: 0, 2: 0 },
  pumpkin: { 0: 0, 1: 0, 2: 0 },
  wheat2: { 0: 0, 1: 0, 2: 0 },
  artichoke: { 0: 0, 1: 0, 2: 0 },
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

export function cropFootprintHalf(art: CropArt, stage: CropStage): number {
  return Math.max(CROP_FOOTPRINT_HALF, (CROP_BOX[art].w / 2) * cropSpriteScale(stage));
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
 * call site (`.setScale(cropShadowScale(art, stage) / S)`).
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

export function cropShadowScale(art: CropArt, stage: CropStage): number {
  return (CROP_SHADOW_FRACTION * cropFootprintHalf(art, stage) * 2) / CROP_SHADOW_BOX_WIDTH;
}

/* ------------------------------------------------------------------ */
/* Growing between two frames                                          */
/* ------------------------------------------------------------------ */

/**
 * How long a plant takes to grow from one frame into the next, on screen.
 *
 * A crop's three frames are 1.6x, 2.5x and 4x, so crossing a boundary is a 56%
 * then a 60% jump in apparent size. Until this existed the scene answered that
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
 * Zero at both ends for every frame shipping today (`FOOT_INSET` is all zero --
 * see its own note), so this currently interpolates nothing. It is here for
 * exactly the reason that table is kept rather than deleted: a crop whose art
 * is not re-fit flush needs a non-zero inset, and a growth tween that moved the
 * plant's size without moving its feet would slide it off the soil for 350ms
 * every time it grew.
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

/**
 * The ground diamond's half-size at the same `t`.
 *
 * The gold "ready" ring is traced against this (`unitFootprintHalf` in
 * stackacres-scene.ts), and so is the fallback half of the tap test -- so a
 * ring left at the old frame's size for the length of the tween would sit
 * inside a plant that had already outgrown it, which is the exact "framed
 * rather than sitting inside it" complaint that sized the ring off the crop in
 * the first place. Driven off the same proxy as the plant and the shadow, for
 * the same reason they are.
 */
export function cropFootprintHalfBlend(art: CropArt, from: CropStage, to: CropStage, t: number): number {
  const a = cropFootprintHalf(art, from);
  const b = cropFootprintHalf(art, to);
  return a + (b - a) * growthProgress(t);
}
