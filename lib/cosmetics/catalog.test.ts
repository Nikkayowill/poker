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
    const missing = avatarCosmetics.filter((item) => item.renderMode !== "3d").flatMap((item) => [
      ...(onDisk(avatarFigure(item.id)) ? [] : [`${item.id}: figure`]),
      ...(onDisk(avatarFace(item.id)) ? [] : [`${item.id}: face`]),
    ]);
    expect(missing).toEqual([]);
  });

  it("keeps the defaults pointing at real entries", () => {
    expect(cosmeticById(DEFAULT_AVATAR_COSMETIC)?.slot).toBe("avatar");
    expect(cosmeticById(DEFAULT_CARD_BACK)?.slot).toBe("cardBack");
  });

  it("gives away the starter roster and exactly one card back", () => {
    // A new player has to arrive wearing something, and the default has to be
    // among the free choices every time or the default equipment cannot be
    // relied upon. Avatars are the starter tier, not just one -- an NBA 2K
    // MyTeam-style pick of five rather than a single forced default.
    const free = cosmetics.filter((item) => item.price === 0);
    const freeAvatars = free.filter((item) => item.slot === "avatar" && item.renderMode !== "3d");
    const freeCardBacks = free.filter((item) => item.slot === "cardBack");
    expect(freeAvatars.map((item) => item.id)).toContain(DEFAULT_AVATAR_COSMETIC);
    expect(freeAvatars).toHaveLength(5);
    expect(freeCardBacks.map((item) => item.id)).toEqual([DEFAULT_CARD_BACK]);
  });

  it("never prices a signature item", () => {
    // Status has to be unbuyable to mean anything -- the rule the whole
    // cosmetic economy leans on.
    for (const item of cosmetics.filter((entry) => entry.rarity === "signature")) {
      expect(item.price).toBeNull();
    }
  });

  it("never puts a Gold price on a progress-unlocked avatar", () => {
    // A hands-won/chips-won avatar is earned, exactly like a signature item --
    // Gold must never also buy a shortcut around the same threshold.
    for (const item of avatarCosmetics.filter((entry) => entry.unlock)) {
      expect(item.price).toBeNull();
    }
  });

  it("unlocks each progress-gated avatar on exactly one metric", () => {
    for (const item of avatarCosmetics.filter((entry) => entry.unlock)) {
      const keys = Object.keys(item.unlock!);
      expect(keys).toHaveLength(1);
      expect(["handsWon", "chipsWon"]).toContain(keys[0]);
    }
  });

  it("gives every entry exactly one source of artwork", () => {
    for (const item of cosmetics) {
      // Card backs are drawn from `art`; avatars are supplied images keyed by
      // id. An entry with both, or neither, renders as nothing at all.
      expect(Boolean(item.art)).toBe(item.slot === "cardBack");
      if (item.renderMode === "3d") expect(item.slot).toBe("avatar");
    }
  });
});
