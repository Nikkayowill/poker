import { describe, expect, it } from "vitest";
import { PROP_SHADOW, PROP_SIZE, propRect } from "./props";
import { nearPath } from "./paths";
import { inPondZone } from "./water";
import { zoneAt } from "./zones";
import {
  VISITOR_IDS,
  VISITOR_KIND,
  VISITOR_LINE,
  VISITOR_NAME,
  VISITOR_PORTRAIT,
  VISITOR_PROPS,
  visitorForKind,
  visitorHitAt,
} from "./visitors";

/** Where the brief places each visitor -- checked directly against the real
 *  district a placed point resolves to, not against this module's own
 *  internal zone table, so a bug in that table would actually fail this. */
const EXPECTED_ZONE: Record<string, string> = {
  bleep: "farmstead",
  glimm: "oak",
  pixl: "oak",
  dott: "oak",
  nib: "coast",
  squee: "coast",
  mira: "mine",
  tavo: "mine",
  zeph: "townsquare",
  kip: "townsquare",
};

describe("visitor props", () => {
  it("places exactly the ten visitors, one each", () => {
    expect(VISITOR_PROPS).toHaveLength(10);
    const kinds = new Set(VISITOR_PROPS.map((p) => p.kind));
    expect(kinds.size).toBe(10);
  });

  it("has a size and a shadow for every visitor kind", () => {
    for (const id of VISITOR_IDS) {
      const kind = VISITOR_KIND[id];
      expect(PROP_SIZE[kind].w).toBeGreaterThan(0);
      expect(PROP_SIZE[kind].h).toBeGreaterThan(0);
      expect(PROP_SHADOW[kind].w).toBeGreaterThan(0);
      expect(PROP_SHADOW[kind].h).toBeGreaterThan(0);
    }
  });

  it("keeps every visitor's box in its own aspect ratio (never stretched)", () => {
    // width/288 tall, matching each PNG's own real pixel dimensions --
    // see props.ts's own comment on PROP_SIZE for the source numbers.
    const PNG_ASPECT: Record<string, number> = {
      bleep: 198 / 288,
      glimm: 240 / 288,
      nib: 168 / 288,
      pixl: 246 / 288,
      squee: 216 / 288,
      dott: 246 / 288,
      mira: 102 / 288,
      zeph: 132 / 288,
      kip: 174 / 288,
      tavo: 132 / 288,
    };
    for (const id of VISITOR_IDS) {
      const size = PROP_SIZE[VISITOR_KIND[id]];
      expect(size.w / size.h).toBeCloseTo(PNG_ASPECT[id], 2);
    }
  });

  it("stands each visitor in the district the brief names", () => {
    for (const prop of VISITOR_PROPS) {
      const id = visitorForKind(prop.kind);
      expect(id).not.toBeNull();
      expect(zoneAt(prop.x, prop.y)).toBe(EXPECTED_ZONE[id!]);
    }
  });

  it("never lands on a path or in the pond", () => {
    for (const prop of VISITOR_PROPS) {
      expect(nearPath(prop.x, prop.y)).toBe(false);
      expect(inPondZone(prop.x, prop.y)).toBe(false);
    }
  });

  it("never overlaps another visitor's own picture box", () => {
    for (let i = 0; i < VISITOR_PROPS.length; i += 1) {
      for (let j = i + 1; j < VISITOR_PROPS.length; j += 1) {
        const a = propRect(VISITOR_PROPS[i]);
        const b = propRect(VISITOR_PROPS[j]);
        const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("gives every visitor a name, a line and a portrait", () => {
    for (const id of VISITOR_IDS) {
      expect(VISITOR_NAME[id].length).toBeGreaterThan(0);
      expect(VISITOR_LINE[id].length).toBeGreaterThan(0);
      expect(VISITOR_PORTRAIT[id]).toBe(`/stackacres/sprites/visitor-${id}.png`);
    }
  });

  it("round-trips a placed kind back to its own visitor id", () => {
    for (const prop of VISITOR_PROPS) {
      expect(visitorForKind(prop.kind)).toBe(
        VISITOR_IDS.find((id) => VISITOR_KIND[id] === prop.kind),
      );
    }
    expect(visitorForKind("windmill")).toBeNull();
  });
});

describe("visitorHitAt", () => {
  it("hits every placed visitor at its own feet", () => {
    for (const prop of VISITOR_PROPS) {
      expect(visitorHitAt(prop.x, prop.y - 1)).toBe(prop.kind);
    }
  });

  it("misses empty ground far from any visitor", () => {
    expect(visitorHitAt(0, 0)).toBeNull();
  });
});
