import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SEAT_ART_CHARACTERS } from "./seat-art.generated";
import { pickSeatArt, seatArtBox, seatArtSrc } from "./seat-art";

const publicDir = path.join(process.cwd(), "public");

describe("the seat art roster", () => {
  it("has art on disk for every character's every angle", () => {
    for (const character of SEAT_ART_CHARACTERS) {
      for (const angle of character.angles) {
        const file = path.join(publicDir, seatArtSrc(character.id, angle).slice(1));
        expect(existsSync(file), `${seatArtSrc(character.id, angle)} is missing from public/`).toBe(true);
      }
    }
  });

  it("gives every character their own identity", () => {
    const ids = SEAT_ART_CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("pickSeatArt angle contracts", () => {
  it("caps the turn at the second angle even when a wider plate exists", () => {
    const character = SEAT_ART_CHARACTERS.find((entry) => entry.id === "character5");
    expect(character).toBeDefined();
    expect(character!.angles).toContain(40);

    expect(pickSeatArt(character!, 10).src).toBe(seatArtSrc("character5", 0));
    expect(pickSeatArt(character!, 25).src).toBe(seatArtSrc("character5", 20));
    expect(pickSeatArt(character!, 60).src).toBe(seatArtSrc("character5", 20));
  });
});

describe("seatArtBox", () => {
  // A character's plate has no transparent margin below the hand -- it's
  // built flush to the crop edge, same as every other character (see
  // prepare-seat-art.py). Any scale that grows the box from the head down
  // instead of the hands up pushes that flush edge past the felt/rail line,
  // which read as an arm sinking into the table (seat1's forced-40deg
  // override, 2026-08-22 -- two characters since renumbered/deleted did this).
  const head = { x: 100, y: 50 };
  const hands = { x: 100, y: 250 };
  const slot = { scale: 1, crown: 0.02, offsetX: 0, offsetY: 0 };

  it("lands the box bottom exactly on the hands anchor at scale 1", () => {
    const box = seatArtBox(head, hands, 0.7, false, slot);
    expect(box!.top + box!.height).toBeCloseTo(hands.y, 5);
  });

  it("keeps the hands pinned to the anchor at any scale -- only the top should move", () => {
    for (const scale of [0.8, 1.2, 1.3, 1.6]) {
      const box = seatArtBox(head, hands, 0.7, false, { ...slot, scale });
      expect(box!.top + box!.height).toBeCloseTo(hands.y, 5);
    }
  });

  it("treats offsetY as a plain pixel nudge off the hands anchor, independent of scale", () => {
    for (const scale of [1, 1.3]) {
      const box = seatArtBox(head, hands, 0.7, false, { ...slot, scale, offsetY: 20 });
      expect(box!.top + box!.height).toBeCloseTo(hands.y + 20, 5);
    }
  });
});
