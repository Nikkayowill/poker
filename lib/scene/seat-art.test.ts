import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SEAT_ART_CHARACTERS } from "./seat-art.generated";
import { HANDS_PER_CAST, pickSeatArt, seatArtCharacterForSlot, seatArtSrc } from "./seat-art";

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

  /* Seats 2-5 all draw from the same unfiltered roster (no forced angle to
     narrow the pool -- see the next test), so within one cast they should
     still never repeat a face. Seat 1 is deliberately excluded here: its
     pool is narrowed to whichever characters have its forced angle, which
     can legitimately collide with a seat drawing from the full roster. */
  it("seats a different character in every unrestricted opponent slot, within one cast", () => {
    const seen = new Set<string | null>();
    for (let slot = 2; slot <= 5; slot += 1) {
      seen.add(seatArtCharacterForSlot("table-a", 3, slot)?.id ?? null);
    }
    expect(seen.size).toBe(4);
  });

  /* The regression this whole filter exists for: a character shot at 0deg
     only has no business at seat 1, which forces its widest plate. Landing
     there would draw the character facing the camera dead-on at the one
     seat that most needs to look turned toward the pot. */
  it("never seats a character missing seat 1's forced angle", () => {
    for (let hand = 0; hand < HANDS_PER_CAST * 20; hand += HANDS_PER_CAST) {
      for (const tableId of ["table-a", "table-b", "table-c", "table-d"]) {
        const character = seatArtCharacterForSlot(tableId, hand, 1);
        expect(character?.angles).toContain(40);
      }
    }
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
  it("keeps the normal 20-degree tier separate from the forced 40-degree seat", () => {
    const character = SEAT_ART_CHARACTERS.find((entry) => entry.id === "character6");
    expect(character).toBeDefined();

    expect(pickSeatArt(character!, 25).src).toBe(seatArtSrc("character6", 20));
    expect(pickSeatArt(character!, 25, 40).src).toBe(seatArtSrc("character6", 40));
  });
});
