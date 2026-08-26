import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  avatarCosmetics,
  avatarFace,
  avatarFigure,
  characterAvatarCosmetics,
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

  it("resolves equipment from a stored value, the legacy `avatar` key, or neither", () => {
    expect(defaultEquipped.avatar2d).toBe("character4");
    expect(normalizeEquipped({ avatar: "character9" })).toMatchObject({
      avatar2d: "character9",
    });
    expect(normalizeEquipped({ avatar2d: "character9" })).toMatchObject({
      avatar2d: "character9",
    });
    expect(normalizeEquipped({})).toMatchObject({ avatar2d: DEFAULT_AVATAR_COSMETIC });
  });

  it("gives away the starter roster and exactly one card back", () => {
    // A new player has to arrive wearing something, and the default has to be
    // among the free choices every time or the default equipment cannot be
    // relied upon. Two starters, not one -- a man and a woman.
    const free = cosmetics.filter((item) => item.price === 0);
    const freeAvatars = free.filter((item) => item.slot === "avatar");
    const freeCardBacks = free.filter((item) => item.slot === "cardBack");
    expect(freeAvatars.map((item) => item.id)).toContain(DEFAULT_AVATAR_COSMETIC);
    expect(freeAvatars.map((item) => item.id).sort()).toEqual(["character4", "character9"]);
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
    }
  });
});

describe("character avatars (the seat-art roster, sold in the store)", () => {
  it("has exactly one catalog entry per seat-art character, and vice versa", () => {
    expect(characterAvatarCosmetics.map((item) => item.id).sort()).toEqual(
      SEAT_ART_CHARACTERS.map((character) => character.id).sort(),
    );
  });

  it("gives character4 and character9 away free and prices every rare character as one ascending Gold ladder", () => {
    const starters = ["character4", "character9"];
    for (const id of starters) {
      const item = characterAvatarCosmetics.find((entry) => entry.id === id);
      expect(item?.price).toBe(0);
      expect(item?.rarity).toBe("standard");
    }

    const paidIds = [
      "character5",
      "character6",
      "character7",
      "character8",
      // The earned tier (character1-3) interrupts the id run, not the
      // ladder -- survivors pick the pricing back up above character8.
      "character10",
      "character11",
      "character12",
      "character13",
      "character14",
      "character15",
      "character16",
      "character17",
      "character18",
      "character19",
      "character20",
      "character21",
      "character22",
      "character23",
      "character24",
      "character25",
    ];
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

  it("earns character1-3 on an ascending hands-won ladder instead of selling them", () => {
    // The tier only means anything while it stays unbuyable, so this pins the
    // absent price as hard as it pins the threshold -- putting a Gold price on
    // one of these is the failure mode, not forgetting a rung.
    const earnedIds = ["character1", "character2", "character3"];
    const earned = earnedIds.map((id) => characterAvatarCosmetics.find((entry) => entry.id === id));
    for (const item of earned) {
      expect(item?.price).toBeNull();
      expect(item?.rarity).toBe("signature");
      expect(item?.unlock).toBeDefined();
    }

    const thresholds = earned.map((item) => (item?.unlock as { handsWon: number }).handsWon);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
    expect(new Set(thresholds).size).toBe(thresholds.length);
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
