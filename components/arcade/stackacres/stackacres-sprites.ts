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
 * ALL OF THE WILD FLORA IS ONE PACK AS OF 2026-09-06. The scrub had been cut
 * from an isometric plant pack since it landed, while the five woodland kinds
 * above stayed drawn under an explicit carve-out of Kayo's. He reversed it --
 * "rid of everything from before and fill the map up with the new plates
 * completely" -- so the trees, the pines and the bushes are pack renders now
 * too, and the roster went 9 sprites to 44 -- every plate in the pack that is
 * neither snow-laden nor the wrong climate.
 * Two consequences worth knowing before touching any of it:
 *
 *   The plates are GRADIENT-MAPPED onto art-palette.ts's own `RAMPS` rather
 *   than colour-corrected, because the pack renders near-black with almost no
 *   blue channel and anything else comes out acid yellow. So this art IS on
 *   the palette -- but as baked pixels, which means a ramp retuned in
 *   art-palette.ts will NOT reach it. Re-run the prep script after one.
 *
 *   The boxes grew a lot (a broadleaf is 122x78 art units where it was
 *   64x80), on Kayo's follow-up that they read too small next to the
 *   characters. They are also wider than they are tall now, which is simply
 *   what an isometric camera does to a tree.
 *
 * `flower1/2/3`, `rock`, `log`, `mushroom` and `boulder` are the scenery this
 * does NOT cover, and cannot: it is a plant pack, and it has no flower and no
 * stone in it. They are still painters.
 *
 * `grassTile`, `soilBed` and `waterTile` are in here but are not one of
 * these: none is a painter, none has a box or an anchor, and none is ever
 * wrapped by `spriteBacked`. They ride this module only because this list is
 * what the scene's `preload` walks, and `bakeGrass`/`paintSoilTiles`/
 * `bakePondTexture` want them in hand before drawing rather than a frame
 * later.
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
  // The Pixel Pilgrim's shrine -- one of five isometric cottages from a
  // supplied "Houses Pack 3" asset set (its own painted grass/stone plate
  // included, same "straight-on elevation, placed flat" treatment the barn
  // gets), replacing the hand-drawn Graphics volume the shrine shipped with
  // at first. Picked for its chapel-like spire over the other four -- the
  // most "shrine", least "cottage" silhouette in the set.
  monkHouse: "/stackacres/sprites/monk-house.png",
  windmill: "/stackacres/sprites/windmill.png",
  grandfatherRay: "/stackacres/sprites/grandfather-ray.png",
  // The canopy. Off the isometric plant pack like everything below it since
  // 2026-09-06 -- see scripts/prepare-stackacres-plants.py.
  tree1: "/stackacres/sprites/tree1.png",
  tree2: "/stackacres/sprites/tree2.png",
  tree3: "/stackacres/sprites/tree3.png",
  pine: "/stackacres/sprites/pine.png",
  pine2: "/stackacres/sprites/pine2.png",
  pine3: "/stackacres/sprites/pine3.png",
  pine4: "/stackacres/sprites/pine4.png",
  pine5: "/stackacres/sprites/pine5.png",
  pine6: "/stackacres/sprites/pine6.png",
  pine7: "/stackacres/sprites/pine7.png",
  pine8: "/stackacres/sprites/pine8.png",
  bush: "/stackacres/sprites/bush.png",
  bush2: "/stackacres/sprites/bush2.png",
  bush3: "/stackacres/sprites/bush3.png",
  // The Long Meadow's own grass at the three heights the scythe leaves it
  // (`meadowDensityAt`), plus the open world's grass clumps and rosettes. The
  // prep script records why the mown height had to be cut out of an uncut
  // plate.
  grassTall: "/stackacres/sprites/grass-tall.png",
  grassMid: "/stackacres/sprites/grass-mid.png",
  grassStubble: "/stackacres/sprites/grass-stubble.png",
  tuft: "/stackacres/sprites/tuft.png",
  tuft2: "/stackacres/sprites/tuft2.png",
  swirl1: "/stackacres/sprites/swirl1.png",
  swirl2: "/stackacres/sprites/swirl2.png",
  // Scrub and ground cover -- the size band between a grass clump and a bush,
  // which is where most of the map's variety lives.
  weedTall: "/stackacres/sprites/weed-tall.png",
  weedShort: "/stackacres/sprites/weed-short.png",
  weed3: "/stackacres/sprites/weed3.png",
  weed4: "/stackacres/sprites/weed4.png",
  weed5: "/stackacres/sprites/weed5.png",
  weed6: "/stackacres/sprites/weed6.png",
  scrubLow: "/stackacres/sprites/scrub-low.png",
  scrubRound: "/stackacres/sprites/scrub-round.png",
  scrubFan: "/stackacres/sprites/scrub-fan.png",
  scrubPlume: "/stackacres/sprites/scrub-plume.png",
  scrubBroad: "/stackacres/sprites/scrub-broad.png",
  scrubLeafy: "/stackacres/sprites/scrub-leafy.png",
  scrubSprig: "/stackacres/sprites/scrub-sprig.png",
  scrubBristle: "/stackacres/sprites/scrub-bristle.png",
  scrubThicket: "/stackacres/sprites/scrub-thicket.png",
  scrubRosette: "/stackacres/sprites/scrub-rosette.png",
  scrubPatch: "/stackacres/sprites/scrub-patch.png",
  scrubMound: "/stackacres/sprites/scrub-mound.png",
  frond1: "/stackacres/sprites/frond1.png",
  frond2: "/stackacres/sprites/frond2.png",
  frond3: "/stackacres/sprites/frond3.png",
  frond4: "/stackacres/sprites/frond4.png",
  frond5: "/stackacres/sprites/frond5.png",
  // The three growth frames each for the Long Meadow's two crops. Named for
  // lib/stackacres/crop-visuals.ts's CropStage (0 seedling, 1 sprout,
  // 2 mature) exactly like the painters they front.
  carrot0: "/stackacres/sprites/carrot0.png",
  carrot1: "/stackacres/sprites/carrot1.png",
  carrot2: "/stackacres/sprites/carrot2.png",
  corn0: "/stackacres/sprites/corn0.png",
  corn1: "/stackacres/sprites/corn1.png",
  corn2: "/stackacres/sprites/corn2.png",
  // The three rungs of the equipment ladder (lib/stackacres/equipment.ts).
  // These already shipped -- the store shelf has been showing them as plain
  // `<img>` since the ladder landed -- but nothing ever put them on the canvas,
  // so the tool floating over a mow drag was the same drawn scythe at every
  // rung. They are here now because the ghost is a Phaser image and every
  // Phaser image in this scene comes through this list.
  toolTrowel: "/stackacres/sprites/tool-trowel.png",
  toolIronShovel: "/stackacres/sprites/tool-iron-shovel.png",
  toolGoldenSpade: "/stackacres/sprites/tool-golden-spade.png",
  // Not a painter and not a cut-out: the ground tile, drawn by `bakeGrass`
  // straight into its own 256-unit canvas. It rides this module only because
  // this is what the scene's `preload` walks, and a tile that arrived late
  // would mean baking the lawn twice.
  grassTile: "/stackacres/sprites/grass-tile.png",
  // ONE tilled bed, not a texture -- which is what the thing it replaced
  // (`soilTile`, a repeating furrow texture masked to the whole district's
  // diamond) had to be back when the Crop Fields were one district-sized
  // box. They are a lattice of 64-unit beds now (lib/stackacres/soil.ts), and
  // a 64-unit square projects to a 128x64 screen diamond, so this is that
  // diamond drawn whole. Drawing it whole is what lets its three furrows land
  // exactly on `soilFurrowOffsets()` -- the lines the plants stand on -- where
  // a repeating texture put them wherever its tile scale happened to fall.
  soilBed: "/stackacres/sprites/soil-bed.png",
  // The pond's surface grain, and only the grain -- the shore, the gradient,
  // the bank shadow and the glints stay drawn (art-water.ts). Composited
  // INSIDE the water's own ellipse at low alpha, so it is texture under the
  // gradient rather than a picture of a pond.
  waterTile: "/stackacres/sprites/water-tile.png",
} as const;

export type SpriteName = keyof typeof SPRITE_ART;

/** The sprites that stand in FRONT OF A PAINTER, which is every one of them
 *  except the three ground pictures -- `grassTile`/`soilBed`/`waterTile` have no painter
 *  behind them (a ground tile is a texture, not a thing with a box and an
 *  anchor), so they are the names here that `spriteBacked` and
 *  `bakeSpriteTexture` must never be handed. */
export type PainterSpriteName = Exclude<SpriteName, "grassTile" | "soilBed" | "waterTile">;

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
