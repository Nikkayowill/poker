import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { bakeFarmerSheet, bakePreview, decodePng, layerFilesFor, type BakeData, type RgbaImage } from "./bake";
import { normalizeLook } from "./look";
import { WARDROBE_SLOTS, type FarmerLook, type WardrobeCatalogue } from "./types";

const ROOT = join(__dirname, "..", "..", "..");
const WARDROBE = join(ROOT, "public", "stackacres-td", "wardrobe");
const FIXTURES = join(__dirname, "__fixtures__");

const catalogue = JSON.parse(readFileSync(join(WARDROBE, "catalogue.json"), "utf8")) as WardrobeCatalogue;
const bake = JSON.parse(readFileSync(join(WARDROBE, "bake.json"), "utf8")) as BakeData;
const looks = JSON.parse(readFileSync(join(FIXTURES, "looks.json"), "utf8")) as Record<string, FarmerLook>;

const loadLayer = async (path: string): Promise<RgbaImage> => decodePng(new Uint8Array(readFileSync(join(WARDROBE, path))));

async function sharpRgba(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

function differing(a: RgbaImage, b: RgbaImage): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++;
  }
  return n;
}

describe("bakeFarmerSheet", () => {
  it("bakes the default look byte-identical to the shipped farmer.png", async () => {
    const got = await bakeFarmerSheet(catalogue.defaultLook, catalogue, bake, loadLayer);
    const want = await sharpRgba(join(ROOT, "public", "stackacres-td", "characters", "farmer.png"));
    expect([got.width, got.height]).toEqual([192, 2304]);
    expect(differing(got, want)).toBe(0);
  });

  it("the default look in the fixtures is the catalogue's", () => {
    expect(looks.default).toEqual(catalogue.defaultLook);
  });

  for (const name of ["female-ponytail", "male-bare", "male-cavalier"]) {
    it(`bakes ${name} byte-identical to build.py's sheet for it`, async () => {
      const got = await bakeFarmerSheet(looks[name], catalogue, bake, loadLayer);
      const want = await sharpRgba(join(FIXTURES, `${name}.png`));
      expect(differing(got, want)).toBe(0);
    });
  }

  it("previews frames that match the sheet's shape", async () => {
    const frames = await bakePreview(catalogue.defaultLook, catalogue, bake, loadLayer, [1, 5, 9, 13, 112, 113]);
    expect([...frames.keys()].sort((a, b) => a - b)).toEqual([1, 5, 9, 13, 112, 113]);
    for (const f of frames.values()) expect([f.width, f.height]).toEqual([48, 48]);
  });

  it("throws on things the catalogue does not offer", async () => {
    const base = catalogue.defaultLook;
    const bad: FarmerLook[] = [
      { ...base, picks: { ...base.picks, hat: { item: "hat_formal_tophat", colour: "cloth:red" } } },
      { ...base, picks: { ...base.picks, top: { item: "torso_clothes_longsleeve", colour: "cloth:plaid" } } },
      { ...base, picks: { ...base.picks, face: { item: "beards_trimmed", colour: null } }, body: "female" },
      { ...base, picks: { ...base.picks, top: { item: null, colour: null } } },
      { ...base, picks: { ...base.picks, hair: { item: "hair_plain", colour: "cloth:red" } } },
    ];
    for (const look of bad) await expect(bakeFarmerSheet(look, catalogue, bake, loadLayer)).rejects.toThrow(/wardrobe bake/);
  });
});

describe("the wardrobe's files", () => {
  it("catalogue.json is a WardrobeCatalogue whose default look normalizes to itself", () => {
    for (const item of catalogue.items) {
      expect(WARDROBE_SLOTS).toContain(item.slot);
      expect(item.bodies.length).toBeGreaterThan(0);
      for (const colour of item.colours) expect(catalogue.colours[colour], `${item.id} ${colour}`).toBeDefined();
      expect(item.price === null || (Number.isInteger(item.price) && item.price > 0)).toBe(true);
    }
    for (const [id, colour] of Object.entries(catalogue.colours)) {
      expect(colour.id).toBe(id);
      expect(colour.swatch).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(normalizeLook(catalogue.defaultLook, catalogue, new Set())).toEqual(catalogue.defaultLook);
    for (const look of Object.values(looks)) expect(normalizeLook(look, catalogue, null)).toEqual(look);
  });

  it("every item, colour and body the catalogue offers resolves to layer files that exist", () => {
    const files = new Set(readdirSync(join(WARDROBE, "layers")).map((f) => `layers/${f}`));
    let looksChecked = 0;
    for (const item of catalogue.items) {
      if (item.slot === "skin" || item.slot === "eyes") continue;
      for (const body of item.bodies) {
        for (const colour of item.colours.length ? item.colours : [null]) {
          const base = catalogue.defaultLook;
          const look: FarmerLook = {
            body,
            picks: {
              ...base.picks,
              [item.slot]: { item: item.id, colour },
            },
          };
          for (const file of layerFilesFor(look, catalogue, bake)) expect(files.has(file), file).toBe(true);
          looksChecked++;
        }
      }
    }
    for (const id of ["skin", "eyes"]) {
      const item = catalogue.items.find((i) => i.id === id);
      expect(item?.colours.length).toBeGreaterThan(0);
      for (const colour of item?.colours ?? []) expect(bake.colourRamps[colour], colour).toBeDefined();
    }
    for (const colour of Object.keys(catalogue.colours)) expect(bake.colourRamps[colour], colour).toBeDefined();
    expect(looksChecked).toBeGreaterThan(300);
  });

  it("decodePng reads every layer atlas exactly as sharp does", async () => {
    for (const file of readdirSync(join(WARDROBE, "layers"))) {
      const path = join(WARDROBE, "layers", file);
      const ours = await decodePng(new Uint8Array(readFileSync(path)));
      const theirs = await sharpRgba(path);
      // Fully transparent pixels carry no colour anywhere in the bake.
      for (let i = 0; i < ours.data.length; i += 4) {
        if (ours.data[i + 3] === 0 && theirs.data[i + 3] === 0) {
          ours.data.fill(0, i, i + 4);
          theirs.data.fill(0, i, i + 4);
        }
      }
      expect(differing(ours, theirs), file).toBe(0);
    }
  });
});
