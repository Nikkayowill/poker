import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  avatarCosmetics,
  avatarFace,
  avatarFigure,
  cosmetics,
  DEFAULT_AVATAR_COSMETIC,
  DEFAULT_CARD_BACK,
  cosmeticById,
} from "./catalog";

const publicDir = path.join(process.cwd(), "public");
const onDisk = (webPath: string) => existsSync(path.join(publicDir, webPath));

describe("cosmetic catalog", () => {
  it("has no duplicate ids", () => {
    const ids = cosmetics.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships both crops of artwork for every avatar", () => {
    // The catalog and the artwork are joined by id alone, so a character added
    // without running the prepare script -- or with a source file named a
    // little differently -- lists in the store and then renders as a monogram
    // for everyone who buys it. This is the only place that catches that.
    const missing = avatarCosmetics.flatMap((item) => [
      ...(onDisk(avatarFigure(item.id)) ? [] : [`${item.id}: figure`]),
      ...(onDisk(avatarFace(item.id)) ? [] : [`${item.id}: face`]),
    ]);
    expect(missing).toEqual([]);
  });

  it("keeps the defaults pointing at real entries", () => {
    expect(cosmeticById(DEFAULT_AVATAR_COSMETIC)?.slot).toBe("avatar");
    expect(cosmeticById(DEFAULT_CARD_BACK)?.slot).toBe("cardBack");
  });

  it("gives away exactly one avatar and one card back", () => {
    // A new player has to arrive wearing something, and it has to be the same
    // something every time or the default equipment cannot be relied upon.
    const free = cosmetics.filter((item) => item.price === 0);
    expect(free.map((item) => item.id).sort()).toEqual(
      [DEFAULT_AVATAR_COSMETIC, DEFAULT_CARD_BACK].sort(),
    );
  });

  it("never prices a signature item", () => {
    // Status has to be unbuyable to mean anything -- the rule the whole
    // cosmetic economy leans on.
    for (const item of cosmetics.filter((entry) => entry.rarity === "signature")) {
      expect(item.price).toBeNull();
    }
  });

  it("gives every entry exactly one source of artwork", () => {
    for (const item of cosmetics) {
      // Card backs are drawn from `art`; avatars are supplied images keyed by
      // id. An entry with both, or neither, renders as nothing at all.
      expect(Boolean(item.art)).toBe(item.slot === "cardBack");
    }
  });
});
