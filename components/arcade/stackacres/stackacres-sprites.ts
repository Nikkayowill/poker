/**
 * The sprites that ship as images rather than as painter code.
 *
 * WHY THIS EXISTS. Everything else in StackAcres is drawn by a function in
 * stackacres-art.ts, and that is still the default: a painter is on the
 * `RAMPS` palette by construction, recolours by swapping a ramp, and costs
 * nothing to ship. These are the exception, generated rather than drawn, and
 * they buy a silhouette the painters were not getting -- the cow and the hen
 * especially, which were circles with rounded-rect legs. `sheep`, `ox` and
 * `hog` are the same trade for the same reason (see the FLUX bake-off Kayo
 * signed off on); `grandfatherRay` is not an animal at all but is drawn the
 * identical way, since he is a character sprite standing in the world, not a
 * UI portrait.
 *
 * Ray was re-rolled at CHIBI proportions on 2026-09-04 -- one head in three
 * rather than one in six -- because looking DOWN at a figure on an isometric
 * grid foreshortens its body away to almost nothing, and a small head then
 * leaves nothing to read at all. See his painter in art-props.ts.
 *
 * `tree1/2/3`, `pine` and `bush` joined them on 2026-09-04, and they are the
 * reason this comment no longer opens by holding the trees up as the model
 * case FOR painters. They were one `treeRound` shape drawn three times in
 * three greens, which was the cheapest thing in the art file and the weakest
 * thing on the map. Two things changed together: Kayo called the art (his
 * words) "complete dog shit", and the same pass grouped the woodland into
 * groves and treelines (`chunkScenery` in lib/stackacres/world.ts), so
 * copies now stand shoulder to shoulder where the old scatter spread them
 * thin enough for one silhouette to pass. The three broadleaves are three
 * genuinely different renders now rather than three ramps, BECAUSE a PNG
 * cannot be recoloured -- the variety had to move into the art itself.
 *
 * `grassTile` and `soilTile` are in here but are not one of these: neither is
 * a painter, has no box or anchor, and neither is ever wrapped by
 * `spriteBacked`. They ride this module only because this list is what the
 * scene's `preload` walks, and `bakeGrass`/`paintAreaGround` want them in
 * hand before drawing rather than a frame later.
 *
 * WHAT THEY COST, so nobody has to rediscover it: they are off `RAMPS`, they
 * carry gradients where the rest of the farm is flat, and they cannot be
 * recoloured. Do not reach for this module to add a variant. A new animal in
 * a different colour is a painter, not another PNG.
 *
 * HOW THEY REACH A CANVAS. Every surface in StackAcres draws a painter into a
 * 2D context -- the Phaser world through `bakeTexture`, the toolbelt and seed
 * strip through `paintIcon`, the lobby card through stackacres-cover-art.tsx.
 * So these are exposed the same way: stackacres-art.ts wraps each of these
 * painters so it draws the image once the image is here and its own shapes
 * until then. Nothing at a draw site had to change.
 *
 * `carrot0/1/2` and `corn0/1/2` joined them -- the three growth frames per
 * crop (lib/stackacres/crop-visuals.ts's `CropStage`) used to be a couple of
 * quadratic-curve strokes for the two unripe stages, which is legible as "a
 * crop is here" and nothing more at the seedling/sprout sizes a phone
 * actually shows. Same trade as the trees: six genuinely different renders
 * (not three ramps -- a crop's growth is its SHAPE changing, not its colour),
 * and `lib/stackacres/crop-visuals.ts`'s `FOOT_INSET` table went to all zero
 * on the same pass, since the prep pipeline fits every one of these flush to
 * its box's own bottom edge, the same convention the trees use.
 *
 * The one thing worth knowing before regenerating a crop: FLUX draws every
 * carrot standing in a mound of earth no matter how flatly the prompt forbids
 * ground, so the prep pass strips a brown pad out of the bottom band the way
 * it already stripped a grey/pink one. It has to -- the scene draws its OWN
 * grounding ellipse under each crop (`cropShadow`), so a baked mound ships
 * two shadows stacked. Soil and carrot are both r>g>b and are told apart by
 * saturation, not hue. The corn frames needed none of that.
 *
 * The module is imported by Node tests through the painter module, so it must
 * never touch `Image` at import time.
 */

export const SPRITE_ART = {
  cow: "/stackacres/sprites/cow.png",
  hen: "/stackacres/sprites/hen.png",
  sheep: "/stackacres/sprites/sheep.png",
  ox: "/stackacres/sprites/ox.png",
  hog: "/stackacres/sprites/hog.png",
  barn: "/stackacres/sprites/barn.png",
  windmill: "/stackacres/sprites/windmill.png",
  grandfatherRay: "/stackacres/sprites/grandfather-ray.png",
  tree1: "/stackacres/sprites/tree1.png",
  tree2: "/stackacres/sprites/tree2.png",
  tree3: "/stackacres/sprites/tree3.png",
  pine: "/stackacres/sprites/pine.png",
  bush: "/stackacres/sprites/bush.png",
  // The three growth frames each for the Long Meadow's two crops. Named for
  // lib/stackacres/crop-visuals.ts's CropStage (0 seedling, 1 sprout,
  // 2 mature) exactly like the painters they front.
  carrot0: "/stackacres/sprites/carrot0.png",
  carrot1: "/stackacres/sprites/carrot1.png",
  carrot2: "/stackacres/sprites/carrot2.png",
  corn0: "/stackacres/sprites/corn0.png",
  corn1: "/stackacres/sprites/corn1.png",
  corn2: "/stackacres/sprites/corn2.png",
  // Not a painter and not a cut-out: the ground tile, drawn by `bakeGrass`
  // straight into its own 256-unit canvas. It rides this module only because
  // this is what the scene's `preload` walks, and a tile that arrived late
  // would mean baking the lawn twice.
  grassTile: "/stackacres/sprites/grass-tile.png",
  // Same deal as `grassTile`, for the Long Meadow's Crop Fields: a repeating
  // tilled-furrow texture masked to the district's own diamond in
  // `paintAreaGround`, replacing that fill's flat colour + drawn furrow
  // lines when it has loaded (falls back to the old flat fill otherwise).
  soilTile: "/stackacres/sprites/soil-tile.png",
} as const;

export type SpriteName = keyof typeof SPRITE_ART;

/** The sprites that stand in FRONT OF A PAINTER, which is every one of them
 *  except the two ground tiles -- `grassTile`/`soilTile` have no painter
 *  behind them (a ground tile is a texture, not a thing with a box and an
 *  anchor), so they are the names here that `spriteBacked` and
 *  `bakeSpriteTexture` must never be handed. */
export type PainterSpriteName = Exclude<SpriteName, "grassTile" | "soilTile">;

export const SPRITE_NAMES = Object.keys(SPRITE_ART) as readonly SpriteName[];

export function isSpriteName(name: string): name is SpriteName {
  return name in SPRITE_ART;
}

/** The Phaser texture key the raw file is loaded under. Deliberately not the
 *  painter's own name: the name has to stay the power-of-two canvas texture
 *  the scene bakes, so every `add.image(..., ART_FRAME)` call site keeps
 *  working untouched. */
export function spriteLoadKey(name: SpriteName): string {
  return `sprite:${name}`;
}

const loaded = new Map<SpriteName, HTMLImageElement>();
const waiting = new Set<() => void>();
let started = false;

/**
 * Starts fetching every one of them. Safe to call from anywhere and any
 * number of times; a no-op on the server and after the first call.
 */
export function loadSprites(): void {
  if (started || typeof window === "undefined" || typeof Image === "undefined") return;
  started = true;
  for (const name of SPRITE_NAMES) {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      loaded.set(name, img);
      for (const cb of [...waiting]) cb();
    };
    // A sprite that fails to load is not an error worth breaking the farm
    // over: the painter it wraps is still there and still draws.
    img.onerror = () => {};
    img.src = SPRITE_ART[name];
  }
}

/** The decoded image, or null while it is still coming. */
export function spriteImage(name: SpriteName): HTMLImageElement | null {
  loadSprites();
  const img = loaded.get(name);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Calls back every time another sprite arrives, so a canvas that already
 * painted the fallback can paint again. Returns its own unsubscribe.
 */
export function onSpriteReady(cb: () => void): () => void {
  loadSprites();
  waiting.add(cb);
  return () => waiting.delete(cb);
}

/** True once every sprite has arrived — lets a caller stop re-subscribing. */
export function allSpritesReady(): boolean {
  return SPRITE_NAMES.every((n) => spriteImage(n) !== null);
}
