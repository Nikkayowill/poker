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
 * `grassTile`, `soilSlot` and `waterTile` are in here but are not one of
 * these: none is a painter, none has a box or an anchor, and none is ever
 * wrapped by `spriteBacked`. They ride this module only because this list is
 * what the scene's `preload` walks, and `bakeGrass`/`paintOwnedSlots`/
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

import { STACKACRES_CROPS } from "@/lib/stackacres/catalogue";
import { ART_SCALE } from "./art-kit";

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
  // The three growth frames each for all 22 of the Long Meadow's crops.
  // Named for lib/stackacres/crop-visuals.ts's CropStage (0 seedling,
  // 1 sprout, 2 mature) exactly like the painters they front. `sprout`/
  // `cash_crop`, the two hand-vector crops these frames used to belong to,
  // are gone -- carrot/corn are ordinary CraftPix crops here now, at the
  // same sprite filenames those two ids used to occupy.
  artichoke0: "/stackacres/sprites/artichoke0.png",
  artichoke1: "/stackacres/sprites/artichoke1.png",
  artichoke2: "/stackacres/sprites/artichoke2.png",
  beet0: "/stackacres/sprites/beet0.png",
  beet1: "/stackacres/sprites/beet1.png",
  beet2: "/stackacres/sprites/beet2.png",
  brokoly0: "/stackacres/sprites/brokoly0.png",
  brokoly1: "/stackacres/sprites/brokoly1.png",
  brokoly2: "/stackacres/sprites/brokoly2.png",
  cabbage0: "/stackacres/sprites/cabbage0.png",
  cabbage1: "/stackacres/sprites/cabbage1.png",
  cabbage2: "/stackacres/sprites/cabbage2.png",
  carrot0: "/stackacres/sprites/carrot0.png",
  carrot1: "/stackacres/sprites/carrot1.png",
  carrot2: "/stackacres/sprites/carrot2.png",
  corn0: "/stackacres/sprites/corn0.png",
  corn1: "/stackacres/sprites/corn1.png",
  corn2: "/stackacres/sprites/corn2.png",
  corn20: "/stackacres/sprites/corn20.png",
  corn21: "/stackacres/sprites/corn21.png",
  corn22: "/stackacres/sprites/corn22.png",
  cucumber0: "/stackacres/sprites/cucumber0.png",
  cucumber1: "/stackacres/sprites/cucumber1.png",
  cucumber2: "/stackacres/sprites/cucumber2.png",
  eggplant0: "/stackacres/sprites/eggplant0.png",
  eggplant1: "/stackacres/sprites/eggplant1.png",
  eggplant2: "/stackacres/sprites/eggplant2.png",
  garlic0: "/stackacres/sprites/garlic0.png",
  garlic1: "/stackacres/sprites/garlic1.png",
  garlic2: "/stackacres/sprites/garlic2.png",
  grap0: "/stackacres/sprites/grap0.png",
  grap1: "/stackacres/sprites/grap1.png",
  grap2: "/stackacres/sprites/grap2.png",
  grap20: "/stackacres/sprites/grap20.png",
  grap21: "/stackacres/sprites/grap21.png",
  grap22: "/stackacres/sprites/grap22.png",
  onion0: "/stackacres/sprites/onion0.png",
  onion1: "/stackacres/sprites/onion1.png",
  onion2: "/stackacres/sprites/onion2.png",
  pepper0: "/stackacres/sprites/pepper0.png",
  pepper1: "/stackacres/sprites/pepper1.png",
  pepper2: "/stackacres/sprites/pepper2.png",
  poppy0: "/stackacres/sprites/poppy0.png",
  poppy1: "/stackacres/sprites/poppy1.png",
  poppy2: "/stackacres/sprites/poppy2.png",
  potato0: "/stackacres/sprites/potato0.png",
  potato1: "/stackacres/sprites/potato1.png",
  potato2: "/stackacres/sprites/potato2.png",
  pumpkin0: "/stackacres/sprites/pumpkin0.png",
  pumpkin1: "/stackacres/sprites/pumpkin1.png",
  pumpkin2: "/stackacres/sprites/pumpkin2.png",
  sunflowe_broken0: "/stackacres/sprites/sunflowe_broken0.png",
  sunflowe_broken1: "/stackacres/sprites/sunflowe_broken1.png",
  sunflowe_broken2: "/stackacres/sprites/sunflowe_broken2.png",
  sunflower0: "/stackacres/sprites/sunflower0.png",
  sunflower1: "/stackacres/sprites/sunflower1.png",
  sunflower2: "/stackacres/sprites/sunflower2.png",
  tomato0: "/stackacres/sprites/tomato0.png",
  tomato1: "/stackacres/sprites/tomato1.png",
  tomato2: "/stackacres/sprites/tomato2.png",
  wheat10: "/stackacres/sprites/wheat10.png",
  wheat11: "/stackacres/sprites/wheat11.png",
  wheat12: "/stackacres/sprites/wheat12.png",
  wheat20: "/stackacres/sprites/wheat20.png",
  wheat21: "/stackacres/sprites/wheat21.png",
  wheat22: "/stackacres/sprites/wheat22.png",
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
  // ONE planting square, not a whole bed -- replaced the old `soilBed`
  // (one picture per 64-unit bed, all twelve of its squares baked into a
  // single furrowed diamond) so a bed bought one square at a time and a bed
  // bought whole draw through the same picture, at the same
  // `SOIL_COL_PITCH`x`SOIL_ROW_PITCH` footprint `paintOwnedSlots` already
  // draws squares at. Any world rect projects to an exactly-2:1 diamond
  // (see lib/stackacres/iso.ts's `isoProject`), which is why one 256x128
  // picture displays correctly at a square's own screen size with no
  // stretch, whatever that size works out to.
  soilSlot: "/stackacres/sprites/soil-slot.png",
  // The pond's surface grain, and only the grain -- the shore, the gradient,
  // the bank shadow and the glints stay drawn (art-water.ts). Composited
  // INSIDE the water's own ellipse at low alpha, so it is texture under the
  // gradient rather than a picture of a pond.
  waterTile: "/stackacres/sprites/water-tile.png",
  // The ten stranded visitors (lib/stackacres/visitors.ts) -- static,
  // tappable, already-generated pixel-art PNGs standing in a flat-vector
  // world on purpose (the "art-style shock" greeting is the whole feature).
  // Ordinary core sprites in every other respect: `CORE_SPRITE_NAMES` below
  // picks them up automatically since they are not crop frames.
  visitorBleep: "/stackacres/sprites/visitor-bleep.png",
  visitorGlimm: "/stackacres/sprites/visitor-glimm.png",
  visitorNib: "/stackacres/sprites/visitor-nib.png",
  visitorPixl: "/stackacres/sprites/visitor-pixl.png",
  visitorSquee: "/stackacres/sprites/visitor-squee.png",
  visitorDott: "/stackacres/sprites/visitor-dott.png",
  visitorMira: "/stackacres/sprites/visitor-mira.png",
  visitorZeph: "/stackacres/sprites/visitor-zeph.png",
  visitorKip: "/stackacres/sprites/visitor-kip.png",
  visitorTavo: "/stackacres/sprites/visitor-tavo.png",
} as const;

export type SpriteName = keyof typeof SPRITE_ART;

/**
 * Phone-only stand-ins for the handful of sprites whose desktop file is
 * baked to ART_SCALE 8 (see art-kit.ts's own header) but only ever gets
 * drawn into a 4-per-unit canvas on a phone. `pine`/`pine2..8` and `tree1..3`
 * are ~800px renders that a phone bakes down to ~400px either way, so the
 * other half of every pixel was pure decode-and-upload cost paid before a
 * single frame drew, never sampled again. `barn` joins them for the same
 * reason at a smaller scale. Half linear size = a quarter of the pixels,
 * generated at exactly the phone ART_SCALE target so nothing is ever
 * upscaled: see the identical halving these dimensions get from the desktop
 * ones in stackacres-art.ts's `pine`/`tree1..3`/`barn` painter boxes.
 *
 * Everything else here stays one file for both: the rest of the roster was
 * never oversized for its box the way these eleven were (grass/scrub/weed
 * plates and the crop frames are already a few hundred pixels at most), so a
 * second copy of each would only be more files to keep in sync for a saving
 * too small to chase.
 */
const PHONE_SPRITE_ART: Partial<Record<SpriteName, string>> = {
  pine: "/stackacres/sprites/pine-phone.png",
  pine2: "/stackacres/sprites/pine2-phone.png",
  pine3: "/stackacres/sprites/pine3-phone.png",
  pine4: "/stackacres/sprites/pine4-phone.png",
  pine5: "/stackacres/sprites/pine5-phone.png",
  pine6: "/stackacres/sprites/pine6-phone.png",
  pine7: "/stackacres/sprites/pine7-phone.png",
  pine8: "/stackacres/sprites/pine8-phone.png",
  tree1: "/stackacres/sprites/tree1-phone.png",
  tree2: "/stackacres/sprites/tree2-phone.png",
  tree3: "/stackacres/sprites/tree3-phone.png",
  barn: "/stackacres/sprites/barn-phone.png",
};

/** The URL a name's raw file actually loads from -- the phone-sized stand-in
 *  above when ART_SCALE says this is a phone and one exists, `SPRITE_ART`'s
 *  own desktop path otherwise. Every load site (this module's own
 *  `loadSprite` and the scene's `preload`) goes through this rather than
 *  reading `SPRITE_ART` directly, so a name never has two different files
 *  loaded under it depending on who asked. */
export function spriteUrl(name: SpriteName): string {
  return (ART_SCALE === 4 && PHONE_SPRITE_ART[name]) || SPRITE_ART[name];
}

/** The sprites that stand in FRONT OF A PAINTER, which is every one of them
 *  except the three ground pictures -- `grassTile`/`soilSlot`/`waterTile` have no painter
 *  behind them (a ground tile is a texture, not a thing with a box and an
 *  anchor), so they are the names here that `spriteBacked` and
 *  `bakeSpriteTexture` must never be handed. */
export type PainterSpriteName = Exclude<SpriteName, "grassTile" | "soilSlot" | "waterTile">;

export const SPRITE_NAMES = Object.keys(SPRITE_ART) as readonly SpriteName[];

export function isSpriteName(name: string): name is SpriteName {
  return name in SPRITE_ART;
}

/**
 * Every crop's three growth-stage frames -- 22 crops x 3 stages, derived
 * from `STACKACRES_CROPS` rather than hand-listed so a new crop's frames are
 * picked up automatically. These are the reason the scene's `preload` used
 * to fetch 150+ files on every single boot: a crop only ever stands in the
 * Long Meadow (soil is a Crop Fields concept everywhere else, see
 * stackacres-farm.tsx's own note on that), so nothing needs these until the
 * camera actually reaches it. `stackacres-scene.ts` loads `CORE_SPRITE_NAMES`
 * at boot and fetches this set lazily once the Long Meadow enters view.
 */
export const CROP_SPRITE_NAMES: readonly SpriteName[] = STACKACRES_CROPS.flatMap(
  (crop) => [0, 1, 2].map((stage) => `${crop}${stage}` as SpriteName),
);

/** Everything preload can fetch immediately -- every sprite except the
 *  Long-Meadow-only crop frames above. */
export const CORE_SPRITE_NAMES: readonly SpriteName[] = SPRITE_NAMES.filter(
  (name) => !(CROP_SPRITE_NAMES as readonly string[]).includes(name),
);

/** The Phaser texture key the raw file is loaded under. Deliberately not the
 *  painter's own name: the name has to stay the power-of-two canvas texture
 *  the scene bakes, so every `add.image(..., ART_FRAME)` call site keeps
 *  working untouched. */
export function spriteLoadKey(name: SpriteName): string {
  return `sprite:${name}`;
}

const loaded = new Map<SpriteName, HTMLImageElement>();
const requested = new Set<SpriteName>();
const waiting = new Set<() => void>();

/**
 * Starts fetching ONE sprite. Safe to call from anywhere and any number of
 * times; a no-op on the server and after the first call for that name.
 *
 * One at a time, and only on ask, because this cache is the DOM side of the
 * art -- the toolbelt, the seed strip, the splash -- and those between them
 * reach a couple of dozen painters, not all 130. It used to fetch the lot the
 * first time anything touched it, which meant opening a panel with a gold
 * coin in it decoded every tree, every pine and all 66 crop frames into an
 * `HTMLImageElement` that nothing was ever going to draw, and held them for
 * the session. On a desktop that was invisible. On a phone it was tens of
 * megabytes next to the ones Phaser was already holding, and the farm was
 * running out of WebView before it finished booting.
 */
function loadSprite(name: SpriteName): void {
  if (requested.has(name) || typeof window === "undefined" || typeof Image === "undefined") return;
  requested.add(name);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    loaded.set(name, img);
    for (const cb of [...waiting]) cb();
  };
  // A sprite that fails to load is not an error worth breaking the farm
  // over: the painter it wraps is still there and still draws.
  img.onerror = () => {};
  img.src = spriteUrl(name);
}

/** The decoded image, or null while it is still coming. Asking is what starts
 *  it coming. */
export function spriteImage(name: SpriteName): HTMLImageElement | null {
  loadSprite(name);
  const img = loaded.get(name);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Calls back every time another sprite arrives, so a canvas that already
 * painted the fallback can paint again. Returns its own unsubscribe.
 */
export function onSpriteReady(cb: () => void): () => void {
  waiting.add(cb);
  return () => waiting.delete(cb);
}

/**
 * True once every sprite anything has ASKED for has arrived -- which is what
 * a caller subscribing to `onSpriteReady` actually wants to know, since the
 * only sprites that will ever arrive now are the ones something requested.
 * False before the first request, so a canvas that has not painted yet keeps
 * listening.
 */
export function allSpritesReady(): boolean {
  return requested.size > 0 && [...requested].every((n) => spriteImage(n) !== null);
}
