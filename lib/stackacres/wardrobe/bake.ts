/**
 * Bake the farmer's sheet for a look: the same 192 frames, in farmer.json's layout, that
 * art/stackacres-td/lpc/build.py would write for those clothes. The default look comes out
 * byte-identical to public/stackacres-td/characters/farmer.png.
 *
 * It is build.py's own recipe. For every source frame build.py shrinks (a "slot", listed in
 * bake.json) the look's LPC layers are recoloured and stacked at full size, bent at the hips for the
 * harvest, shrunk with lpc.shrink's exact filter and stood on row 44. The frames are then put in
 * sheet order, the eight-frame walk gets its undip, redrawn legs and hop, and the whole sheet is cut
 * to 48 colours with Pillow's median cut. Shrinking each layer on its own and stacking the results
 * looks visibly different, so there is no shortcut there.
 *
 * Pure: no DOM, no Node. `loadLayer` fetches an atlas; decode it with `decodePng` (bake-png.ts),
 * never through a canvas.
 */

import { alphaBox, blankImage, compositeOver, drawnAt, recolour, rgbKey, type RgbaImage } from "./bake-pixels";
import { quantizeMedianCut } from "./quantize";
import { shrinkLpc } from "./shrink";
import type { FarmerLook, WardrobeBody, WardrobeCatalogue, WardrobeSlot } from "./types";

export type { RgbaImage } from "./bake-pixels";
export { decodePng } from "./bake-png";

// --- bake.json -------------------------------------------------------------------------------------

/** One source frame build.py shrinks: its canvas size, the harvest bend, the shrink, the paste. */
export interface BakeSlot {
  readonly size: number;
  /** [drop, dx]: the body above the waist lowered and pushed sideways, or null. */
  readonly bent: readonly [number, number] | null;
  readonly shrink: readonly [number, number];
  readonly at: readonly [number, number];
}

/** A run of sheet frames: one tag in one direction. */
export interface BakeBlock {
  readonly tag: string;
  readonly dir: string;
  readonly frames: readonly number[];
  readonly durations: readonly number[];
  /** The eight-frame walk: undipped, legs posed from `stand` when it is set, then hopped. */
  readonly stride?: boolean;
  readonly stand?: number | null;
}

export interface BakeRecolour {
  readonly material: string;
  /** The ramp the art is drawn in. */
  readonly from: string;
  /** Which of the look's colours it becomes. */
  readonly to: "skin" | "eyes" | "hair" | "item";
}

export interface BakeLayerRef {
  readonly z: number;
  readonly atlas?: string;
  /** LPC items that ship a file per colour: the atlas for each colour id. */
  readonly byColour?: Readonly<Record<string, string>>;
  readonly recolour?: readonly BakeRecolour[];
}

export interface BakeLayout {
  readonly size: readonly [number, number];
  /** [x, y, w, h] in the atlas. */
  readonly crops: readonly (readonly [number, number, number, number])[];
  /** Per slot: [crop, x, y] on the slot's canvas, or null when the layer draws nothing there. */
  readonly slots: readonly (readonly [number, number, number] | null)[];
}

export interface BakeData {
  readonly version: number;
  readonly frame: number;
  readonly columns: number;
  readonly colours: number;
  readonly key: readonly [number, number, number];
  readonly waist: number;
  readonly feet: readonly [number, number];
  readonly hop: readonly number[];
  readonly lift: readonly [readonly number[], readonly number[]];
  readonly stack: readonly WardrobeSlot[];
  readonly ramps: Readonly<Record<string, Readonly<Record<string, readonly (readonly [number, number, number])[]>>>>;
  readonly colourRamps: Readonly<Record<string, { readonly material: string; readonly ramp: string }>>;
  readonly slots: readonly BakeSlot[];
  readonly program: readonly BakeBlock[];
  readonly bodies: Readonly<Record<WardrobeBody, { readonly fixed: readonly BakeLayerRef[]; readonly tools: readonly BakeLayerRef[] }>>;
  readonly items: Readonly<
    Record<string, { readonly bodies: Readonly<Partial<Record<WardrobeBody, readonly BakeLayerRef[]>>>; readonly recolour: readonly BakeRecolour[] }>
  >;
  readonly atlases: Readonly<Record<string, { readonly file: string; readonly layout: string }>>;
  readonly layouts: Readonly<Record<string, BakeLayout>>;
}

/** Fetch one atlas by its path under public/stackacres-td/wardrobe/, decoded (see decodePng). */
export type LayerLoader = (path: string) => Promise<RgbaImage>;

// --- the look as layers ----------------------------------------------------------------------------

interface Layer {
  readonly z: number;
  readonly file: string;
  readonly layout: BakeLayout;
  readonly table: ReadonlyMap<number, number>;
}

function fail(message: string): never {
  throw new Error(`wardrobe bake: ${message}`);
}

function rampFor(bake: BakeData, colourId: string | null, material: string): string {
  if (!colourId) fail(`no colour for ${material}`);
  const entry = bake.colourRamps[colourId] ?? fail(`unknown colour ${colourId}`);
  if (entry.material !== material) fail(`${colourId} is not a ${material} colour`);
  return entry.ramp;
}

/** lpc.Character._mapping: the look's skin, eyes and hair first, then the item's own colour. */
function tableFor(bake: BakeData, look: FarmerLook, recolours: readonly BakeRecolour[], itemColour: string | null): Map<number, number> {
  const table = new Map<number, number>();
  for (const r of recolours) {
    const pick =
      r.to === "skin" ? look.picks.skin.colour : r.to === "eyes" ? look.picks.eyes.colour : r.to === "hair" ? look.picks.hair.colour : itemColour;
    const to = rampFor(bake, pick, r.material);
    const ramps = bake.ramps[r.material] ?? fail(`no ${r.material} ramps`);
    const src = ramps[r.from] ?? fail(`no ${r.material} ramp ${r.from}`);
    const dst = ramps[to] ?? fail(`no ${r.material} ramp ${to}`);
    src.forEach((c, i) => {
      const d = dst[i];
      if (c[0] !== d[0] || c[1] !== d[1] || c[2] !== d[2]) table.set(rgbKey(c[0], c[1], c[2]), rgbKey(d[0], d[1], d[2]));
      else table.delete(rgbKey(c[0], c[1], c[2]));
    });
  }
  return table;
}

function atlasOf(bake: BakeData, key: string): { file: string; layout: BakeLayout } {
  const atlas = bake.atlases[key] ?? fail(`no atlas ${key}`);
  return { file: atlas.file, layout: bake.layouts[atlas.layout] ?? fail(`no layout ${atlas.layout}`) };
}

/**
 * The look's layers in drawing order. Throws on anything the catalogue does not offer: an unknown
 * item or colour, an item in the wrong slot or on a body it is not drawn for.
 */
function layersFor(look: FarmerLook, catalogue: WardrobeCatalogue, bake: BakeData): Layer[] {
  const body = bake.bodies[look.body] ?? fail(`unknown body ${String(look.body)}`);
  for (const slot of ["skin", "eyes", "hair"] as const) {
    const pick = look.picks[slot];
    const item = catalogue.items.find((i) => i.id === pick.item) ?? fail(`unknown ${slot} ${String(pick.item)}`);
    if (item.slot !== slot || !item.bodies.includes(look.body)) fail(`${item.id} is not a ${slot} for ${look.body}`);
    if (!pick.colour || !item.colours.includes(pick.colour)) fail(`${item.id} does not come in ${String(pick.colour)}`);
  }
  const stacked: { z: number; order: number; layer: Layer }[] = [];
  const push = (ref: BakeLayerRef, atlasKey: string, recolours: readonly BakeRecolour[], itemColour: string | null) => {
    const { file, layout } = atlasOf(bake, atlasKey);
    stacked.push({ z: ref.z, order: stacked.length, layer: { z: ref.z, file, layout, table: tableFor(bake, look, recolours, itemColour) } });
  };
  for (const ref of body.fixed) push(ref, ref.atlas ?? fail("body layer without atlas"), ref.recolour ?? [], null);
  for (const slot of bake.stack) {
    const pick = look.picks[slot];
    if (!pick || pick.item === null) {
      if (slot === "hat" || slot === "over" || slot === "face") continue;
      fail(`${slot} cannot be empty`);
    }
    const item = catalogue.items.find((i) => i.id === pick.item) ?? fail(`unknown item ${pick.item}`);
    if (item.slot !== slot) fail(`${item.id} is not a ${slot}`);
    if (!item.bodies.includes(look.body)) fail(`${item.id} is not drawn for ${look.body}`);
    if (item.colours.length ? !pick.colour || !item.colours.includes(pick.colour) : pick.colour !== null) {
      fail(`${item.id} does not come in ${String(pick.colour)}`);
    }
    const entry = bake.items[item.id] ?? fail(`no bake data for ${item.id}`);
    const refs = entry.bodies[look.body] ?? fail(`no ${look.body} layers for ${item.id}`);
    for (const ref of refs) {
      const key = ref.atlas ?? (pick.colour ? ref.byColour?.[pick.colour] : undefined) ?? fail(`no ${item.id} atlas in ${String(pick.colour)}`);
      push(ref, key, entry.recolour, item.slot === "hair" ? null : pick.colour);
    }
  }
  for (const ref of body.tools) push(ref, ref.atlas ?? fail("tool layer without atlas"), [], null);
  // zPos order; equal zPos keeps the stacking order (Python's sort is stable).
  stacked.sort((a, b) => a.z - b.z || a.order - b.order);
  return stacked.map((s) => s.layer);
}

/** Every atlas file a look needs, e.g. to prefetch them. Throws like the bake on a bad look. */
export function layerFilesFor(look: FarmerLook, catalogue: WardrobeCatalogue, bake: BakeData): string[] {
  return [...new Set(layersFor(look, catalogue, bake).map((l) => l.file))];
}

// --- frames ------------------------------------------------------------------------------------------

type Loaded = { readonly layer: Layer; readonly image: RgbaImage };

async function load(layers: Layer[], loadLayer: LayerLoader): Promise<Loaded[]> {
  const cache = new Map<string, Promise<RgbaImage>>();
  return Promise.all(
    layers.map(async (layer) => {
      let raw = cache.get(layer.file);
      if (!raw) {
        raw = loadLayer(layer.file);
        cache.set(layer.file, raw);
      }
      const image = await raw;
      const [w, h] = layer.layout.size;
      if (image.width !== w || image.height !== h) fail(`${layer.file} is ${image.width}x${image.height}, expected ${w}x${h}`);
      return { layer, image: recolour(image, layer.table) };
    }),
  );
}

/** build.bent: the body above the waist lowered by `drop` and pushed `dx` sideways. */
function bent(frame: RgbaImage, drop: number, dx: number, waist: number): RgbaImage {
  const out = blankImage(frame.width, frame.height);
  compositeOver(out, frame, 0, waist, frame.width, frame.height - waist, 0, waist);
  compositeOver(out, frame, 0, 0, frame.width, waist, dx, drop);
  return out;
}

/** One slot: the look stacked, bent, shrunk and stood in a 48px frame (build.place). */
function slotFrame(bake: BakeData, loaded: readonly Loaded[], s: number): RgbaImage {
  const slot = bake.slots[s];
  let canvas = blankImage(slot.size, slot.size);
  for (const { layer, image } of loaded) {
    const ref = layer.layout.slots[s];
    if (!ref) continue;
    const [x, y, w, h] = layer.layout.crops[ref[0]];
    compositeOver(canvas, image, x, y, w, h, ref[1], ref[2]);
  }
  if (slot.bent) canvas = bent(canvas, slot.bent[0], slot.bent[1], bake.waist);
  const small = shrinkLpc(canvas, slot.shrink[0], slot.shrink[1]);
  return drawnAt(small, bake.frame, bake.frame, slot.at[0], slot.at[1]);
}

/** build.hip: the row the legs part at. */
function hip(stand: RgbaImage, feet: readonly [number, number]): number {
  const [fx, fy] = feet;
  let row = fy;
  const a = (x: number, y: number) => stand.data[(y * stand.width + x) * 4 + 3];
  while (row > 0 && a(fx - 1, row - 1) === 0 && a(fx, row - 1) === 0) row--;
  return row;
}

/** build.stepped: eight walk frames with the legs posed from the standing frame. */
function stepped(bake: BakeData, walk: RgbaImage[], stand: RgbaImage): RgbaImage[] {
  const size = bake.frame;
  const fx = bake.feet[0];
  const HIP = hip(stand, bake.feet);
  const legs: RgbaImage = { width: size, height: size, data: new Uint8ClampedArray(stand.data) };
  for (const y of [HIP - 2, HIP - 1]) {
    for (let x = 0; x < size; x++) {
      if (stand.data[(HIP * size + x) * 4 + 3] === 0) legs.data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  }
  legs.data.fill(0, 0, Math.max(0, HIP - 2) * size * 4);
  return walk.map((frame, i) => {
    const got = blankImage(size, size);
    const sides: [number, number, number][] = [
      [0, fx, bake.lift[0][i]],
      [fx, size, bake.lift[1][i]],
    ];
    for (const [x0, x1, lift] of sides) compositeOver(got, legs, x0, HIP - 2, x1 - x0, size - (HIP - 2), x0, HIP - 2 - lift);
    compositeOver(got, frame, 0, 0, size, HIP, 0, 0);
    return got;
  });
}

function shifted(img: RgbaImage, dy: number): RgbaImage {
  return drawnAt(img, img.width, img.height, 0, dy);
}

/** build.undipped: every frame's top where the first frame's is. */
function undipped(walk: RgbaImage[]): RgbaImage[] {
  const top = (alphaBox(walk[0]) ?? fail("empty walk frame"))[1];
  return walk.map((f) => shifted(f, top - (alphaBox(f) ?? fail("empty walk frame"))[1]));
}

/** The sheet's frames, in farmer.json order, for the program blocks wanted (all by default). */
function programFrames(bake: BakeData, slotAt: (s: number) => RgbaImage, wanted?: ReadonlySet<number>): Map<number, RgbaImage> {
  const out = new Map<number, RgbaImage>();
  let index = 0;
  for (const block of bake.program) {
    const first = index;
    index += block.frames.length;
    const needed = [...block.frames.keys()].some((i) => !wanted || wanted.has(first + i));
    if (!needed) continue;
    let frames = block.frames.map((s) => slotAt(s));
    if (block.stride) {
      frames = undipped(frames);
      if (block.stand !== null && block.stand !== undefined) frames = stepped(bake, frames, slotAt(block.stand));
      frames = frames.map((f, i) => shifted(f, bake.hop[i]));
    }
    frames.forEach((f, i) => {
      if (!wanted || wanted.has(first + i)) out.set(first + i, f);
    });
  }
  return out;
}

function frameCount(bake: BakeData): number {
  return bake.program.reduce((n, b) => n + b.frames.length, 0);
}

// --- the palette ---------------------------------------------------------------------------------------

/** build.paletted, then read back as the PNG decodes: 48 colours, the one nearest magenta clear. */
function paletted(bake: BakeData, sheet: RgbaImage): RgbaImage {
  const n = sheet.width * sheet.height;
  const rgb = new Uint8Array(n * 3);
  const [kr, kg, kb] = bake.key;
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    if (sheet.data[s + 3] >= 128) {
      rgb[i * 3] = sheet.data[s];
      rgb[i * 3 + 1] = sheet.data[s + 1];
      rgb[i * 3 + 2] = sheet.data[s + 2];
    } else {
      rgb[i * 3] = kr;
      rgb[i * 3 + 1] = kg;
      rgb[i * 3 + 2] = kb;
    }
  }
  const { palette, indices } = quantizeMedianCut(rgb, bake.colours);
  const entries = palette.length / 3;
  if (entries < bake.colours) fail(`only ${entries} colours`);
  let clear = 0;
  let clearDist = Infinity;
  for (let i = 0; i < bake.colours; i++) {
    const d = (palette[i * 3] - kr) ** 2 + (palette[i * 3 + 1] - kg) ** 2 + (palette[i * 3 + 2] - kb) ** 2;
    if (d < clearDist) {
      clearDist = d;
      clear = i;
    }
  }
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const p = indices[i];
    data[i * 4] = palette[p * 3];
    data[i * 4 + 1] = palette[p * 3 + 1];
    data[i * 4 + 2] = palette[p * 3 + 2];
    data[i * 4 + 3] = p === clear ? 0 : 255;
  }
  return { width: sheet.width, height: sheet.height, data };
}

// --- the API -------------------------------------------------------------------------------------------

/**
 * The whole sheet for a look: 192 frames of 48x48, four to a row (192x2304), in the frame order of
 * public/stackacres-td/characters/farmer.json, which stays the atlas for every look. Transparent
 * pixels are alpha 0 (their colour is the palette's clear entry, as the shipped PNG decodes).
 */
export async function bakeFarmerSheet(
  look: FarmerLook,
  catalogue: WardrobeCatalogue,
  bake: BakeData,
  loadLayer: LayerLoader,
): Promise<RgbaImage> {
  const loaded = await load(layersFor(look, catalogue, bake), loadLayer);
  const cache = new Map<number, RgbaImage>();
  const slotAt = (s: number) => {
    let f = cache.get(s);
    if (!f) {
      f = slotFrame(bake, loaded, s);
      cache.set(s, f);
    }
    return f;
  };
  const frames = programFrames(bake, slotAt);
  const count = frameCount(bake);
  const size = bake.frame;
  const sheet = blankImage(bake.columns * size, Math.ceil(count / bake.columns) * size);
  for (const [i, f] of frames) compositeOver(sheet, f, 0, 0, size, size, (i % bake.columns) * size, Math.floor(i / bake.columns) * size);
  return paletted(bake, sheet);
}

/**
 * Some frames of a look for the mirror, e.g. [1, 5, 9, 13] (standing, facing down, up, left, right)
 * and a walk. Cheap: only those frames are composited and shrunk, and they are not cut to the
 * sheet's 48-colour palette (that palette is picked over all 192 frames), so colours can sit a shade
 * off the baked sheet. Bake the sheet for anything the player keeps.
 */
export async function bakePreview(
  look: FarmerLook,
  catalogue: WardrobeCatalogue,
  bake: BakeData,
  loadLayer: LayerLoader,
  frames: readonly number[],
): Promise<Map<number, RgbaImage>> {
  const count = frameCount(bake);
  for (const f of frames) if (!Number.isInteger(f) || f < 0 || f >= count) fail(`no frame ${f}`);
  const loaded = await load(layersFor(look, catalogue, bake), loadLayer);
  const cache = new Map<number, RgbaImage>();
  const slotAt = (s: number) => {
    let f = cache.get(s);
    if (!f) {
      f = slotFrame(bake, loaded, s);
      cache.set(s, f);
    }
    return f;
  };
  return programFrames(bake, slotAt, new Set(frames));
}
