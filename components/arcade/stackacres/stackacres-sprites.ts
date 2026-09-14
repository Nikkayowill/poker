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
 * signed off on).
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
 * `flower1/2/3` and `rock` are scenery this plant pack does NOT cover, and
 * cannot: it has no flower and no stone in it. They are still painters.
 * `log`, `mushroom` and `boulder` used to be in that same boat but are not
 * anymore -- they are FLUX-generated now too, just from a separate isometric
 * organic pipeline (task-remaining-props), not this plant pack.
 *
 * `grassTile` is in here but is not one of these: it is not a painter, it has
 * no box and no anchor, and it is never wrapped by `spriteBacked`. It rides
 * this module only because this list is what the scene's `preload` walks, and
 * `bakeGrass` wants it in hand before drawing rather than a frame later. (The terrain atlas and
 * the open-sea tile are loaded by the scene itself -- see art-terrain.ts.)
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
 * ALL 16 CROPS ARE THIS TREATMENT NOW (2026-09-12), off the Gr8FarmPack --
 * three growth frames per crop (lib/stackacres/crop-visuals.ts's `CropStage`)
 * used to be a couple of quadratic-curve strokes for the two unripe stages,
 * which is legible as "a crop is here" and nothing more at the
 * seedling/sprout sizes a phone actually shows. Same trade as the trees:
 * genuinely different art per stage (not three ramps -- a crop's growth is
 * its SHAPE changing, not its colour). `CROP_FOOT` in crop-visuals.ts is all
 * zero for this roster, since `scripts/prepare-stackacres-farmpack-crops.py`
 * trims every frame flush to its own bottom-centre -- see that table's own
 * header for why that is a real measurement here, not a placeholder.
 *
 * THEY ARE ALL WEBP ON DISK (2026-09-12), which is 40% off what the roster
 * cost as PNG. The prep scripts still write PNG, because that is what Pillow
 * and the packs speak -- `pnpm assets:webp` is the step that converts what
 * they produced and deletes the PNG behind it, so run it after re-generating
 * any of this art or the path here will point at a file that is no longer
 * there. scripts/encode-stackacres-webp.mjs carries the per-file rule and
 * why it is a measurement rather than a preference.
 *
 * The module is imported by Node tests through the painter module, so it must
 * never touch `Image` at import time.
 */

import { STACKACRES_CROPS } from "@/lib/stackacres/catalogue";
import { ART_SCALE } from "./art-kit";

export const SPRITE_ART = {
  cow: "/stackacres/sprites/cow.webp",
  hen: "/stackacres/sprites/hen.webp",
  sheep: "/stackacres/sprites/sheep.webp",
  ox: "/stackacres/sprites/ox.webp",
  hog: "/stackacres/sprites/hog.webp",
  barn: "/stackacres/sprites/barn.webp",
  // The barn's own second frame: door swung open, hay bursting out, for the
  // brief acknowledgement `arriveAtBarn` (game-juice-manager.ts) plays when
  // a collected item lands. Same canvas as `barn`, chroma-keyed off the
  // same magenta backing so the two line up in place -- the `rayHouse`/
  // `rayHouseOpen` pattern, just triggered by a delivery arriving rather
  // than a press.
  barnOpen: "/stackacres/sprites/barn-open.webp",
  windmill: "/stackacres/sprites/windmill.webp",
  // Ray's house: two states of one supplied isometric cottage, chroma-keyed
  // off a solid magenta backing and cropped to the same canvas so the two
  // line up in place. `rayHouse` is idle; `rayHouseOpen` (door open, window
  // boxes out, a fold-down step, a scatter of petals) is what the scene
  // swaps to for as long as a finger is down on the house, the same
  // press-and-release feel a FarmVille building gives -- see
  // `paintRayHouse`/`setRayHousePressed` in stackacres-scene.ts. Grandfather
  // Ray himself no longer stands here as a sprite; he is being redrawn at a
  // proper isometric scale to stand beside the house once that art is ready.
  rayHouse: "/stackacres/sprites/ray-house.webp",
  rayHouseOpen: "/stackacres/sprites/ray-house-open.webp",
  // The Greenhouse (lib/stackacres/greenhouse.ts): two states of one
  // supplied isometric glasshouse, chroma-keyed off a solid magenta backing
  // and cropped to the same canvas so the two line up in place -- the same
  // `rayHouse`/`rayHouseOpen` pattern. `greenhouse` is idle; `greenhouseOpen`
  // (vents cracked, steam drifting off the panes) is what the scene swaps to
  // for as long as the Greenhouse panel is open -- see `setGreenhouseHeldOpen`
  // in stackacres-scene.ts.
  greenhouse: "/stackacres/sprites/greenhouse.webp",
  greenhouseOpen: "/stackacres/sprites/greenhouse-open.webp",
  // The Factory (2026-09-12), by `FACTORY_FOOTPRINT` in world.ts -- same
  // two-state pattern as `rayHouse`/`rayHouseOpen`: `factory` idle,
  // `factoryOpen` (extra chimney smoke, a bread cart rolled into the open
  // bay) a second frame with no trigger wired to it yet -- placed as
  // landmark scenery only, the same posture `paintFactory` documents. Kept
  // real and registered now so a later pass wiring an actual interaction
  // only has to call `setFactoryHeldOpen`-shaped code, not touch art.
  factory: "/stackacres/sprites/factory.webp",
  factoryOpen: "/stackacres/sprites/factory-open.webp",
  // The canopy. Off the isometric plant pack like everything below it since
  // 2026-09-06 -- see scripts/prepare-stackacres-plants.py.
  tree1: "/stackacres/sprites/tree1.webp",
  tree2: "/stackacres/sprites/tree2.webp",
  tree3: "/stackacres/sprites/tree3.webp",
  pine: "/stackacres/sprites/pine.webp",
  pine2: "/stackacres/sprites/pine2.webp",
  pine3: "/stackacres/sprites/pine3.webp",
  pine4: "/stackacres/sprites/pine4.webp",
  pine5: "/stackacres/sprites/pine5.webp",
  pine6: "/stackacres/sprites/pine6.webp",
  pine7: "/stackacres/sprites/pine7.webp",
  pine8: "/stackacres/sprites/pine8.webp",
  bush: "/stackacres/sprites/bush.webp",
  bush2: "/stackacres/sprites/bush2.webp",
  bush3: "/stackacres/sprites/bush3.webp",
  // The Long Meadow's own grass at the three heights the scythe leaves it
  // (`meadowDensityAt`), plus the open world's grass clumps and rosettes. The
  // prep script records why the mown height had to be cut out of an uncut
  // plate.
  grassTall: "/stackacres/sprites/grass-tall.webp",
  grassMid: "/stackacres/sprites/grass-mid.webp",
  grassStubble: "/stackacres/sprites/grass-stubble.webp",
  tuft: "/stackacres/sprites/tuft.webp",
  tuft2: "/stackacres/sprites/tuft2.webp",
  swirl1: "/stackacres/sprites/swirl1.webp",
  swirl2: "/stackacres/sprites/swirl2.webp",
  // Scrub and ground cover -- the size band between a grass clump and a bush,
  // which is where most of the map's variety lives.
  weedTall: "/stackacres/sprites/weed-tall.webp",
  weedShort: "/stackacres/sprites/weed-short.webp",
  weed3: "/stackacres/sprites/weed3.webp",
  weed4: "/stackacres/sprites/weed4.webp",
  weed5: "/stackacres/sprites/weed5.webp",
  weed6: "/stackacres/sprites/weed6.webp",
  scrubLow: "/stackacres/sprites/scrub-low.webp",
  scrubRound: "/stackacres/sprites/scrub-round.webp",
  scrubFan: "/stackacres/sprites/scrub-fan.webp",
  scrubPlume: "/stackacres/sprites/scrub-plume.webp",
  scrubBroad: "/stackacres/sprites/scrub-broad.webp",
  scrubLeafy: "/stackacres/sprites/scrub-leafy.webp",
  scrubSprig: "/stackacres/sprites/scrub-sprig.webp",
  scrubBristle: "/stackacres/sprites/scrub-bristle.webp",
  scrubThicket: "/stackacres/sprites/scrub-thicket.webp",
  scrubRosette: "/stackacres/sprites/scrub-rosette.webp",
  scrubPatch: "/stackacres/sprites/scrub-patch.webp",
  scrubMound: "/stackacres/sprites/scrub-mound.webp",
  frond1: "/stackacres/sprites/frond1.webp",
  frond2: "/stackacres/sprites/frond2.webp",
  frond3: "/stackacres/sprites/frond3.webp",
  frond4: "/stackacres/sprites/frond4.webp",
  frond5: "/stackacres/sprites/frond5.webp",
  // The three growth frames each for all 16 of the Long Meadow's crops.
  // Named for lib/stackacres/crop-visuals.ts's CropStage (0 seedling,
  // 1 sprout, 2 mature) exactly like the painters they front. Off the
  // Gr8FarmPack (2026-09-12) -- see scripts/prepare-stackacres-farmpack-crops.py.
  bell_pepper0: "/stackacres/sprites/bell_pepper0.webp",
  bell_pepper1: "/stackacres/sprites/bell_pepper1.webp",
  bell_pepper2: "/stackacres/sprites/bell_pepper2.webp",
  broccoli0: "/stackacres/sprites/broccoli0.webp",
  broccoli1: "/stackacres/sprites/broccoli1.webp",
  broccoli2: "/stackacres/sprites/broccoli2.webp",
  cabbage0: "/stackacres/sprites/cabbage0.webp",
  cabbage1: "/stackacres/sprites/cabbage1.webp",
  cabbage2: "/stackacres/sprites/cabbage2.webp",
  carrot0: "/stackacres/sprites/carrot0.webp",
  carrot1: "/stackacres/sprites/carrot1.webp",
  carrot2: "/stackacres/sprites/carrot2.webp",
  celery0: "/stackacres/sprites/celery0.webp",
  celery1: "/stackacres/sprites/celery1.webp",
  celery2: "/stackacres/sprites/celery2.webp",
  corn0: "/stackacres/sprites/corn0.webp",
  corn1: "/stackacres/sprites/corn1.webp",
  corn2: "/stackacres/sprites/corn2.webp",
  eggplant0: "/stackacres/sprites/eggplant0.webp",
  eggplant1: "/stackacres/sprites/eggplant1.webp",
  eggplant2: "/stackacres/sprites/eggplant2.webp",
  green_bean0: "/stackacres/sprites/green_bean0.webp",
  green_bean1: "/stackacres/sprites/green_bean1.webp",
  green_bean2: "/stackacres/sprites/green_bean2.webp",
  lettuce0: "/stackacres/sprites/lettuce0.webp",
  lettuce1: "/stackacres/sprites/lettuce1.webp",
  lettuce2: "/stackacres/sprites/lettuce2.webp",
  onion0: "/stackacres/sprites/onion0.webp",
  onion1: "/stackacres/sprites/onion1.webp",
  onion2: "/stackacres/sprites/onion2.webp",
  pepper0: "/stackacres/sprites/pepper0.webp",
  pepper1: "/stackacres/sprites/pepper1.webp",
  pepper2: "/stackacres/sprites/pepper2.webp",
  potato0: "/stackacres/sprites/potato0.webp",
  potato1: "/stackacres/sprites/potato1.webp",
  potato2: "/stackacres/sprites/potato2.webp",
  radish0: "/stackacres/sprites/radish0.webp",
  radish1: "/stackacres/sprites/radish1.webp",
  radish2: "/stackacres/sprites/radish2.webp",
  spinach0: "/stackacres/sprites/spinach0.webp",
  spinach1: "/stackacres/sprites/spinach1.webp",
  spinach2: "/stackacres/sprites/spinach2.webp",
  tomato0: "/stackacres/sprites/tomato0.webp",
  tomato1: "/stackacres/sprites/tomato1.webp",
  tomato2: "/stackacres/sprites/tomato2.webp",
  wheatsheaf0: "/stackacres/sprites/wheatsheaf0.webp",
  wheatsheaf1: "/stackacres/sprites/wheatsheaf1.webp",
  wheatsheaf2: "/stackacres/sprites/wheatsheaf2.webp",
  // The three rungs of the equipment ladder (lib/stackacres/equipment.ts).
  // These already shipped -- the store shelf has been showing them as plain
  // `<img>` since the ladder landed -- but nothing ever put them on the canvas,
  // so the tool floating over a mow drag was the same drawn scythe at every
  // rung. They are here now because the ghost is a Phaser image and every
  // Phaser image in this scene comes through this list.
  toolTrowel: "/stackacres/sprites/tool-trowel.webp",
  toolIronShovel: "/stackacres/sprites/tool-iron-shovel.webp",
  toolGoldenSpade: "/stackacres/sprites/tool-golden-spade.webp",
  // The Mower (lib/stackacres/cutters.ts), same "the shelf icon should be
  // the thing you see in your hand" reasoning as the three tools above --
  // this is also the sprite that rolls across the meadow while it is driven.
  // FLUX-generated at the exact tool STYLE contract, with a baked drop-
  // shadow masked out at prep time (see task-tools/prep_mower.py) in favour
  // of a real one added in the scene, the same as every other world sprite.
  cutterMower: "/stackacres/sprites/cutter-mower.webp",
  // The drag-to-water token's own can (2026-09-13), off the same Gr8FarmPack
  // as the crop roster -- see prepare-stackacres-watering-can-icon.py, and
  // that plate's own carve-out in prepare-stackacres-farmpack-props.py's
  // header ("tool-tier and drag-to-water systems, not static props"). Not a
  // world sprite: fitted into `ico-watering-can`'s 24x24 icon box the same
  // aspect-preserving way `cropIcon` fits a crop's own portrait
  // (stackacres-art.ts's `wateringCanIcon`). Scoped to the drag token only,
  // on purpose -- the well-fill toast, the HUD water counter, the "needs
  // water" cue bubble over a dry crop and the toolbelt's own Water button
  // all keep drawing `ico-water`'s plain droplet, see
  // stackacres-drag-affordance.tsx.
  wateringCan: "/stackacres/sprites/watering-can.webp",
  // Not a painter and not a cut-out: the ground tile, drawn by `bakeGrass`
  // straight into its own 256-unit canvas. It rides this module only because
  // this is what the scene's `preload` walks, and a tile that arrived late
  // would mean baking the lawn twice.
  grassTile: "/stackacres/sprites/grass-tile.webp",
  // The eleven story travelers (lib/stackacres/story/): ten true pixel-art
  // PNGs standing in a flat-vector world on purpose (they are not from
  // here, and the art says so), and Great-Grandpa Ray, the one smooth
  // render among them because he IS from here. The same files the dialogue
  // bubbles show as portraits (TRAVELER_PORTRAIT). Ordinary core sprites in
  // every other respect: `CORE_SPRITE_NAMES` below picks them up
  // automatically since they are not crop frames.
  //
  // Ray's own real, solid art (2026-09-12) -- he stood in as a pale
  // desaturated placeholder ("Ray's spirit") until this pack landed; nothing
  // about the wiring here changed, only which picture the same name points
  // at. `travelerRayActive` is his second frame -- a wave, chroma-keyed off
  // the same magenta backing and cropped to the same canvas as `travelerRay`
  // -- swapped in for as long as his own dialogue bubble is open, the same
  // `rayHouse`/`rayHouseOpen` held-open contract (see `paintTravelers`/
  // `setTravelerRayHeldOpen` in stackacres-scene.ts).
  travelerRay: "/stackacres/sprites/traveler-ray.webp",
  travelerRayActive: "/stackacres/sprites/traveler-ray-open.webp",
  travelerPierre: "/stackacres/sprites/traveler-pierre.webp",
  travelerMiles: "/stackacres/sprites/traveler-miles.webp",
  travelerSkye: "/stackacres/sprites/traveler-skye.webp",
  travelerBarnaby: "/stackacres/sprites/traveler-barnaby.webp",
  travelerArthur: "/stackacres/sprites/traveler-arthur.webp",
  travelerBrayden: "/stackacres/sprites/traveler-brayden.webp",
  travelerIvy: "/stackacres/sprites/traveler-ivy.webp",
  travelerWes: "/stackacres/sprites/traveler-wes.webp",
  travelerBea: "/stackacres/sprites/traveler-bea.webp",
  travelerLeo: "/stackacres/sprites/traveler-leo.webp",
  // The yard props and woodland litter (lib/stackacres/props.ts,
  // art-props.ts's PROP_PAINTERS), FLUX-generated at an isometric organic
  // STYLE contract distinct from the flat-vector RAMPS system on purpose --
  // the ground they stand on (grassTile above, and the sea/pond tiles
  // art-terrain.ts loads separately) is an organic, painterly, noisy texture
  // pack, not a flat fill, so these lean into FLUX's native gradients and
  // texture grain instead of fighting them the way cutterMower/toolTrowel
  // above do. See
  // project_stackacres_isometric_organic_prop_style memory for the approved
  // STYLE string and the pipeline (~/.local/share/flux-sprite-test/task-well,
  // task-remaining-props).
  //
  // `well`/`wheelbarrow`/`toolBarrel` removed -- Kayo pulled those three
  // renders (blurry against this style's grain) pending a replacement asset;
  // stackacres-art.ts's PAINTERS now points those three straight at the
  // procedural painter instead of `spriteBacked(...)`. Re-add here once a
  // replacement file ships.
  crate: "/stackacres/sprites/crate.webp",
  logPile: "/stackacres/sprites/log-pile.webp",
  mailbox: "/stackacres/sprites/mailbox.webp",
  signpost: "/stackacres/sprites/signpost.webp",
  lampPost: "/stackacres/sprites/lamp-post.webp",
  flowerBed: "/stackacres/sprites/flower-bed.webp",
  stoneWall: "/stackacres/sprites/stone-wall.webp",
  scarecrow: "/stackacres/sprites/scarecrow.webp",
  truck: "/stackacres/sprites/truck.webp",
  windmillBlades: "/stackacres/sprites/windmill-blades.webp",
  log: "/stackacres/sprites/log.webp",
  mushroom: "/stackacres/sprites/mushroom.webp",
  boulder: "/stackacres/sprites/boulder.webp",
  // The Farmstead clutter band's new variety (lib/stackacres/props.ts's
  // CLUTTER_KINDS), off the Gr8FarmPack -- see
  // scripts/prepare-stackacres-farmpack-props.py. Filenames are the prop id
  // verbatim, same convention the crop roster above uses.
  hayBale1: "/stackacres/sprites/hayBale1.webp",
  hayBale2: "/stackacres/sprites/hayBale2.webp",
  bucket: "/stackacres/sprites/bucket.webp",
  stringLights: "/stackacres/sprites/stringLights.webp",
  smallBush1: "/stackacres/sprites/smallBush1.webp",
  smallBush2: "/stackacres/sprites/smallBush2.webp",
  wildflowers1: "/stackacres/sprites/wildflowers1.webp",
  wildflowers2: "/stackacres/sprites/wildflowers2.webp",
  flowerBush1: "/stackacres/sprites/flowerBush1.webp",
  flowerBush2: "/stackacres/sprites/flowerBush2.webp",
  flowerSprig1: "/stackacres/sprites/flowerSprig1.webp",
  flowerSprig2: "/stackacres/sprites/flowerSprig2.webp",
  // The Factory's own back fence (2026-09-12), off the same pack's barbed-
  // wire plates -- see props.ts's own PropKind comment on the two end
  // shapes and two straight ones.
  barbEndWest: "/stackacres/sprites/barbEndWest.webp",
  barbEndEast: "/stackacres/sprites/barbEndEast.webp",
  barbStraight1: "/stackacres/sprites/barbStraight1.webp",
  barbStraight2: "/stackacres/sprites/barbStraight2.webp",
  // Not an environment prop: a standing NPC, so pixel-art STYLE matching the
  // travelers above rather than the organic-isometric prop contract.
  midnightMerchant: "/stackacres/sprites/midnight-merchant.webp",
} as const;

export type SpriteName = keyof typeof SPRITE_ART;

/**
 * Phone-only stand-ins for the handful of sprites whose desktop file is
 * baked to ART_SCALE 8 (see art-kit.ts's own header) but only ever gets
 * drawn into a 4-per-unit canvas on a phone. `pine`/`pine2..8` and `tree1..3`
 * are ~800px renders that a phone bakes down to ~400px either way, so the
 * other half of every pixel was pure decode-and-upload cost paid before a
 * single frame drew, never sampled again. `barn`/`barnOpen` join them for
 * the same reason at a smaller scale. Half linear size = a quarter of the
 * pixels, generated at exactly the phone ART_SCALE target so nothing is
 * ever upscaled: see the identical halving these dimensions get from the
 * desktop ones in stackacres-art.ts's `pine`/`tree1..3`/`barn` painter
 * boxes.
 *
 * Everything else here stays one file for both: the rest of the roster was
 * never oversized for its box the way these eleven were (grass/scrub/weed
 * plates and the crop frames are already a few hundred pixels at most), so a
 * second copy of each would only be more files to keep in sync for a saving
 * too small to chase.
 */
const PHONE_SPRITE_ART: Partial<Record<SpriteName, string>> = {
  pine: "/stackacres/sprites/pine-phone.webp",
  pine2: "/stackacres/sprites/pine2-phone.webp",
  pine3: "/stackacres/sprites/pine3-phone.webp",
  pine4: "/stackacres/sprites/pine4-phone.webp",
  pine5: "/stackacres/sprites/pine5-phone.webp",
  pine6: "/stackacres/sprites/pine6-phone.webp",
  pine7: "/stackacres/sprites/pine7-phone.webp",
  pine8: "/stackacres/sprites/pine8-phone.webp",
  tree1: "/stackacres/sprites/tree1-phone.webp",
  tree2: "/stackacres/sprites/tree2-phone.webp",
  tree3: "/stackacres/sprites/tree3-phone.webp",
  barn: "/stackacres/sprites/barn-phone.webp",
  barnOpen: "/stackacres/sprites/barn-open-phone.webp",
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
 *  except `grassTile` -- a ground tile is a texture, not a thing with a box
 *  and an anchor, so it is the one name here that `spriteBacked` and
 *  `bakeSpriteTexture` must never be handed. (`soilSlot` was the other, until
 *  a bed became the `soilBed` painter and its picture was deleted.)
 *
 *  `wateringCan` is the second exception, for a different reason: it is
 *  never placed in the Phaser world at all, only drawn into a DOM icon
 *  canvas by `wateringCanIcon` (stackacres-art.ts), the same
 *  fit-without-stretching read `cropIcon` gives a crop's own portrait. There
 *  is no `wateringCan`-named entry in `PainterName`/`DRAWN`/`PAINTERS` for
 *  `bakeSpriteTexture` to find, on purpose -- excluding it here rather than
 *  adding one nothing would ever call. */
export type PainterSpriteName = Exclude<SpriteName, "grassTile" | "wateringCan">;

export const SPRITE_NAMES = Object.keys(SPRITE_ART) as readonly SpriteName[];

export function isSpriteName(name: string): name is SpriteName {
  return name in SPRITE_ART;
}

/**
 * Every crop's three growth-stage frames -- 16 crops x 3 stages, derived
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
