import { describe, expect, it } from "vitest";
import {
  botCardBackFor,
  cardBackArt,
  cosmetics,
  cosmeticById,
  DEFAULT_CARD_BACK,
} from "./catalog";

const cardBacks = cosmetics.filter((item) => item.slot === "cardBack");
const houseArt = cosmeticById(DEFAULT_CARD_BACK)!.art!;

describe("cardBackArt", () => {
  it("resolves every card back in the catalog to its own artwork", () => {
    // The catalog is where these are defined and the felt is where they are
    // seen, and until this milestone nothing connected the two: all seven
    // rendered as one hardcoded green back.
    for (const item of cardBacks) {
      expect({ id: item.id, art: cardBackArt(item.id) }).toEqual({ id: item.id, art: item.art });
    }
    // Distinct artwork, or "resolving" each id is not worth anything.
    const bases = new Set(cardBacks.map((item) => cardBackArt(item.id).base));
    expect(bases.size).toBeGreaterThan(4);
  });

  it("falls back to the house deck rather than drawing nothing", () => {
    // Called for every face-down card on the table. An id that no longer
    // exists, a seat from a table dealt before this shipped, a bot with
    // nothing equipped -- each of these reaches an SVG fill attribute, and
    // undefined there is a blank rectangle where a card should be.
    expect(cardBackArt(null)).toEqual(houseArt);
    expect(cardBackArt(undefined)).toEqual(houseArt);
    expect(cardBackArt("back-that-was-retired")).toEqual(houseArt);
    expect(cardBackArt("")).toEqual(houseArt);
    // An avatar id is a real cosmetic in the wrong slot -- the one wrong
    // value most likely to be passed here by mistake, since both live in one
    // catalog and a seat carries both.
    expect(cardBackArt("character1")).toEqual(houseArt);
  });
});

describe("botCardBackFor", () => {
  it("only ever deals a bot a standard-tier back", () => {
    // A table of bots holding the 400,000 Gold rare back devalues the only
    // thing this catalog sells.
    for (let position = 0; position < 24; position += 1) {
      const item = cosmeticById(botCardBackFor(position))!;
      expect({ position, slot: item.slot, rarity: item.rarity })
        .toEqual({ position, slot: "cardBack", rarity: "standard" });
    }
  });

  it("varies across a full table", () => {
    // Five bots showing five identical house decks is the same as not having
    // shipped the feature, for the one player most likely to be seeing it:
    // someone playing their first hand, alone, against bots.
    const seen = new Set([1, 2, 3, 4, 5].map(botCardBackFor));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("is stable for a given seat", () => {
    // Positions are reused as players come and go; a back that changed each
    // time it was asked for would flicker mid-hand.
    expect(botCardBackFor(3)).toBe(botCardBackFor(3));
  });
});
