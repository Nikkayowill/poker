import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  avatarCosmetics,
  avatarFace,
  avatarFigure,
  character3DCosmetics,
  characterAvatarCosmetics,
  characterThumbnail,
  cosmetics,
  DEFAULT_AVATAR_COSMETIC,
  DEFAULT_CARD_BACK,
  cosmeticById,
  defaultEquipped,
  normalizeEquipped,
} from "./catalog";
import { SEAT_ART_CHARACTERS, seatArtSrc } from "@/lib/scene/seat-art";

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

  it("ships a captured thumbnail for every 3D character", () => {
    const missing = character3DCosmetics
      .filter((item) => !onDisk(characterThumbnail(item.id)))
      .map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it("keeps the defaults pointing at real entries", () => {
    expect(cosmeticById(DEFAULT_AVATAR_COSMETIC)?.slot).toBe("avatar");
    expect(cosmeticById(DEFAULT_CARD_BACK)?.slot).toBe("cardBack");
  });

  it("keeps independent 2D and 3D equipment slots", () => {
    expect(defaultEquipped.avatar2d).toBe("character1");
    expect(character3DCosmetics.map((item) => item.id)).toContain(defaultEquipped.avatar3d);
    expect(normalizeEquipped({ avatar: "marcus" })).toMatchObject({
      avatar2d: "character1",
      avatar3d: "marcus",
    });
    expect(normalizeEquipped({ avatar2d: "character2", avatar3d: "victor" })).toMatchObject({
      avatar2d: "character2",
      avatar3d: "victor",
    });
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

  it("locks every customer-pack 3D character behind a win reward or premium price", () => {
    const starter3D = character3DCosmetics.filter((item) => item.price === 0);
    const earned3D = character3DCosmetics.filter((item) => item.unlock);
    const paid3D = character3DCosmetics.filter((item) => typeof item.price === "number" && item.price > 0);

    expect(starter3D.map((item) => item.id)).toEqual([
      "gloria", "michael", "pablo", "james", "daniel", "dora",
    ]);
    expect(earned3D.map((item) => item.id)).toEqual(["donni", "jimmy", "kenji"]);
    expect(earned3D.map((item) => item.unlock)).toEqual([
      { handsWon: 50 },
      { handsWon: 150 },
      { handsWon: 500 },
    ]);
    expect(earned3D.every((item) => item.price === null)).toBe(true);
    expect(paid3D.map((item) => [item.id, item.price])).toEqual([
      ["claira", 7_000_000],
      ["marcus", 6_000_000],
      ["oscar", 2_000_000],
      ["derek", 1_000_000],
      ["victor", 4_000_000],
    ]);
    const claira = character3DCosmetics.find((item) => item.id === "claira");
    expect(claira?.description).toBe(
      "gf of owner. She is an AET and soon to be civil engineer, relatively new to poker but dont underestimate her",
    );
    expect(claira?.price).toBeGreaterThan(Math.max(...paid3D.filter((item) => item.id !== "claira").map((item) => item.price as number)));
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

describe("character avatars (the seat-art roster, sold in the store)", () => {
  it("has exactly one catalog entry per seat-art character, and vice versa", () => {
    expect(characterAvatarCosmetics.map((item) => item.id).sort()).toEqual(
      SEAT_ART_CHARACTERS.map((character) => character.id).sort(),
    );
  });

  it("gives character1-5 away free and prices character6-11 as an ascending Gold ladder", () => {
    const starters = ["character1", "character2", "character3", "character4", "character5"];
    for (const id of starters) {
      const item = characterAvatarCosmetics.find((entry) => entry.id === id);
      expect(item?.price).toBe(0);
      expect(item?.rarity).toBe("standard");
    }

    const paidIds = ["character6", "character7", "character8", "character9", "character10", "character11"];
    const prices = paidIds.map((id) => characterAvatarCosmetics.find((entry) => entry.id === id)?.price as number);
    expect(prices.every((price) => typeof price === "number" && price > 0)).toBe(true);
    // A ladder, not just "all priced" -- each rung costs strictly more than
    // the last, matching the 3D roster's own Gold-purchase pattern.
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(new Set(prices).size).toBe(prices.length);
    for (const id of paidIds) {
      expect(characterAvatarCosmetics.find((entry) => entry.id === id)?.rarity).toBe("rare");
    }
  });

  it("resolves avatarFigure/avatarFace to the character's own 0deg seat-art plate", () => {
    // One image now serves the store card and every small-circle avatar --
    // there is no separate face-crop derivative any more.
    for (const item of characterAvatarCosmetics) {
      expect(avatarFigure(item.id)).toBe(seatArtSrc(item.id, 0));
      expect(avatarFace(item.id)).toBe(seatArtSrc(item.id, 0));
    }
  });
});
