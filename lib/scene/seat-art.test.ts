import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SEAT_ART_CHARACTERS } from "./seat-art.generated";
import { HANDS_PER_CAST, pickSeatArt, seatArtBox, seatArtCharacterForSlot, seatArtSrc } from "./seat-art";

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

describe("seatArtCharacterForSlot", () => {
  it("holds one lineup for a whole cast, then turns it over", () => {
    const first = seatArtCharacterForSlot("table-a", 0, 1);
    for (let hand = 0; hand < HANDS_PER_CAST; hand += 1) {
      expect(seatArtCharacterForSlot("table-a", hand, 1)).toBe(first);
    }
    expect(seatArtCharacterForSlot("table-a", HANDS_PER_CAST, 1)).not.toBe(first);
  });

  /* No seat currently forces an angle (seat 1 did, through 2026-08-24 -- see
     `SeatArtOverride.angle`'s own note), so all five opponent slots draw
     from the same unfiltered roster and should still never repeat a face
     within one cast. */
  it("seats a different character in every opponent slot, within one cast", () => {
    const seen = new Set<string | null>();
    for (let slot = 1; slot <= 5; slot += 1) {
      seen.add(seatArtCharacterForSlot("table-a", 3, slot)?.id ?? null);
    }
    expect(seen.size).toBe(5);
  });

  it("is a pure function of the table id, hand number and slot", () => {
    expect(seatArtCharacterForSlot("table-a", 17, 2)).toBe(seatArtCharacterForSlot("table-a", 17, 2));
  });

  it("does not open every table with the same lineup", () => {
    const openers = new Set(
      ["table-a", "table-b", "table-c", "table-d", "table-e", "table-f"]
        .map((id) => seatArtCharacterForSlot(id, 1, 1)?.id),
    );
    expect(openers.size).toBeGreaterThan(1);
  });

  /* Total over the junk a caller can hand it: the alternative to answering is
     an empty seat, which reads as the art failing to load. */
  it("answers for any hand number, including nonsense ones", () => {
    const ids = SEAT_ART_CHARACTERS.map((c) => c.id);
    for (const hand of [0, 1, -5, 3.7, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ids).toContain(seatArtCharacterForSlot("table-a", hand, 3)?.id);
    }
    expect(ids).toContain(seatArtCharacterForSlot("", 4, 1)?.id);
  });
});

describe("pickSeatArt angle contracts", () => {
  // No seat currently sets `forceAngle` (see `SeatArtOverride.angle`'s own
  // note), but the mechanism itself is still real -- this pins that a
  // caller who does pass one still reaches a third plate the magnitude-based
  // default would never select on its own.
  it("keeps the normal 20-degree tier separate from an explicitly forced 40-degree plate", () => {
    const character = SEAT_ART_CHARACTERS.find((entry) => entry.id === "character5");
    expect(character).toBeDefined();

    expect(pickSeatArt(character!, 25).src).toBe(seatArtSrc("character5", 20));
    expect(pickSeatArt(character!, 25, 40).src).toBe(seatArtSrc("character5", 40));
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
