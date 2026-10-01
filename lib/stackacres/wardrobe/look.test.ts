import { describe, expect, it } from "vitest";
import {
  lookKey,
  normalizeLook,
  readWardrobe,
  sameLook,
  wardrobeCosmeticId,
  withBody,
  withColour,
  withItem,
} from "./look";
import type { FarmerLook, WardrobeCatalogue, WardrobeItem } from "./types";

const item = (id: string, slot: WardrobeItem["slot"], colours: string[], extra: Partial<WardrobeItem> = {}): WardrobeItem => ({
  id,
  slot,
  label: id,
  bodies: ["male", "female"],
  colours,
  price: null,
  ...extra,
});

const catalogue: WardrobeCatalogue = {
  version: 1,
  colours: {},
  items: [
    item("skin", "skin", ["light", "brown"]),
    item("eyes", "eyes", ["blue", "green"]),
    item("plain", "hair", ["blonde", "black"]),
    item("bob", "hair", ["blonde", "black"], { bodies: ["female"] }),
    item("bonnie", "hat", ["tan", "red"]),
    item("cavalier", "hat", ["red"], { price: 1500 }),
    item("longsleeve", "top", ["forest", "red"]),
    item("overalls", "over", ["blue"]),
    item("pants", "bottom", ["navy"]),
    item("boots", "shoes", ["brown"]),
    item("glasses", "face", []),
  ],
  defaultLook: {
    body: "male",
    picks: {
      skin: { item: "skin", colour: "light" },
      eyes: { item: "eyes", colour: "blue" },
      hair: { item: "plain", colour: "blonde" },
      hat: { item: "bonnie", colour: "tan" },
      top: { item: "longsleeve", colour: "forest" },
      over: { item: "overalls", colour: "blue" },
      bottom: { item: "pants", colour: "navy" },
      shoes: { item: "boots", colour: "brown" },
      face: { item: null, colour: null },
    },
  },
};
const look = catalogue.defaultLook;
const nobody = new Set<string>();

describe("normalizeLook", () => {
  it("accepts the default look", () => {
    expect(normalizeLook(look, catalogue, nobody)).toEqual(look);
  });

  it("refuses an item that does not exist, is in the wrong slot, or a colour it does not come in", () => {
    expect(normalizeLook({ ...look, picks: { ...look.picks, hat: { item: "crown", colour: "tan" } } }, catalogue, nobody)).toBeNull();
    expect(normalizeLook({ ...look, picks: { ...look.picks, hat: { item: "plain", colour: "blonde" } } }, catalogue, nobody)).toBeNull();
    expect(normalizeLook({ ...look, picks: { ...look.picks, hat: { item: "bonnie", colour: "purple" } } }, catalogue, nobody)).toBeNull();
  });

  it("lets only optional slots be empty", () => {
    expect(normalizeLook({ ...look, picks: { ...look.picks, hat: { item: null, colour: null } } }, catalogue, nobody)).not.toBeNull();
    expect(normalizeLook({ ...look, picks: { ...look.picks, top: { item: null, colour: null } } }, catalogue, nobody)).toBeNull();
  });

  it("keeps a body to what is drawn for it", () => {
    const bob = { ...look, picks: { ...look.picks, hair: { item: "bob", colour: "black" } } };
    expect(normalizeLook(bob, catalogue, nobody)).toBeNull();
    expect(normalizeLook({ ...bob, body: "female" }, catalogue, nobody)).not.toBeNull();
  });

  it("only saves a paid item that is owned, but lets anyone try it on", () => {
    const hat = { ...look, picks: { ...look.picks, hat: { item: "cavalier", colour: "red" } } };
    expect(normalizeLook(hat, catalogue, nobody)).toBeNull();
    expect(normalizeLook(hat, catalogue, new Set([wardrobeCosmeticId("cavalier")]))).not.toBeNull();
    expect(normalizeLook(hat, catalogue, null)).not.toBeNull();
  });

  it("takes a colourless item with no colour", () => {
    const glasses = { ...look, picks: { ...look.picks, face: { item: "glasses", colour: null } } };
    expect(normalizeLook(glasses, catalogue, nobody)?.picks.face).toEqual({ item: "glasses", colour: null });
    expect(normalizeLook({ ...glasses, picks: { ...glasses.picks, face: { item: "glasses", colour: "red" } } }, catalogue, nobody)).toBeNull();
  });

  it("refuses junk", () => {
    expect(normalizeLook(null, catalogue, nobody)).toBeNull();
    expect(normalizeLook({ body: "robot", picks: look.picks }, catalogue, nobody)).toBeNull();
    expect(normalizeLook({ body: "male" }, catalogue, nobody)).toBeNull();
  });
});

describe("editing a look", () => {
  it("keeps the colour when the new item comes in it, else takes the item's first", () => {
    const red = withColour(look, "top", "red");
    expect(withItem(red, "hat", catalogue.items.find((i) => i.id === "bonnie")!).picks.hat.colour).toBe("tan");
    expect(withItem(withColour(look, "hat", "red"), "hat", catalogue.items.find((i) => i.id === "cavalier")!).picks.hat).toEqual({ item: "cavalier", colour: "red" });
  });

  it("swaps out what the new body cannot wear when switching body", () => {
    const female: FarmerLook = { ...look, body: "female", picks: { ...look.picks, hair: { item: "bob", colour: "black" } } };
    expect(withBody(female, "male", catalogue).picks.hair.item).toBe("plain");
    expect(withBody(look, "female", catalogue).picks).toEqual(look.picks);
  });

  it("keys equal looks equally", () => {
    expect(sameLook(look, JSON.parse(JSON.stringify(look)) as FarmerLook)).toBe(true);
    expect(lookKey(look)).not.toBe(lookKey(withColour(look, "top", "red")));
  });
});

describe("readWardrobe", () => {
  it("gives a new farm today's farmer and four empty outfits", () => {
    expect(readWardrobe(undefined, catalogue, nobody)).toEqual({ look, outfits: [null, null, null, null] });
  });

  it("drops what the catalogue no longer has, without losing the rest", () => {
    const stale = { ...look, picks: { ...look.picks, hat: { item: "gone", colour: "tan" } } };
    const state = readWardrobe({ look: stale, outfits: [look, stale] }, catalogue, nobody);
    expect(state.look).toEqual(look);
    expect(state.outfits).toEqual([look, null, null, null]);
  });
});
