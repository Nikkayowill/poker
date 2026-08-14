import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HANDS_PER_DOWN } from "./dealer-roster";
import { SEAT_ART_CHARACTERS } from "./seat-art.generated";
import { seatArtCharacterForSlot, seatArtSrc } from "./seat-art";

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
  it("holds one lineup for a whole down, then hands over", () => {
    const first = seatArtCharacterForSlot("table-a", 0, 1);
    for (let hand = 0; hand < HANDS_PER_DOWN; hand += 1) {
      expect(seatArtCharacterForSlot("table-a", hand, 1)).toBe(first);
    }
    expect(seatArtCharacterForSlot("table-a", HANDS_PER_DOWN, 1)).not.toBe(first);
  });

  /* The whole point of five characters for five opponent chairs: within one
     down, no two seats should draw the same face. A pick that ignored `slot`
     would fail this the moment the roster and the seat count line up. */
  it("seats a different character in every opponent slot, within one down", () => {
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
