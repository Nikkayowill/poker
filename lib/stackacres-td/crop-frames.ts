/**
 * Which picture in the common atlas a crop is drawn with at each stage.
 *
 * The carrot, potato, radish and wheat are drawn at every stage. The rest grow
 * as the generic plant and ripen into their own drawing
 * (art/stackacres-td/rich/ripe_crops.py), so a ripe crop always shows what it
 * is. ./crop-frames.test.ts checks every name here is really in the atlas.
 */

/** Drawn at every stage, under the name each has in the atlas. Wheat's is the sheaf. */
const DRAWN_CROPS: Readonly<Record<string, string>> = { carrot: "carrot", potato: "potato", radish: "radish", wheat: "wheatsheaf" };

/** Drawn only once ripe. */
const RIPE_DRAWN: ReadonlySet<string> = new Set([
  "tomato", "eggplant", "pepper", "bell_pepper", "corn", "onion",
  "green_bean", "lettuce", "cabbage", "broccoli", "spinach", "celery",
]);

export type CropStage = 0 | 1 | 2;

export function cropFrame(stock: string, stage: CropStage): string {
  const drawn = DRAWN_CROPS[stock];
  if (drawn) return `crop_${drawn}_${stage}`;
  if (stage === 2 && RIPE_DRAWN.has(stock)) return `crop_${stock}_2`;
  return `crop_generic_${stage}`;
}
