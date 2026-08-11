import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARACTERS_3D,
  PREMIUM_CHARACTERS_3D,
  STARTER_CHARACTERS_3D,
  characterById,
  characterForSlot,
} from "./characters";

/** Only the parts of a glTF asset these tests actually assert on. A loose
 *  map cannot express them: the properties read below are arrays that get
 *  flatMapped, and an index signature yields `any` (which the lint rule
 *  rejects) or `unknown` (which has no .flatMap). */
type GlbJson = {
  skins?: { joints?: number[] }[];
  animations?: { channels?: { target?: { node?: number } }[] }[];
};

function readGlbJson(url: string): GlbJson {
  const bytes = readFileSync(resolve(process.cwd(), "public", url.slice(1)));
  expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
  expect(bytes.readUInt32LE(4)).toBe(2);

  let offset = 12;
  while (offset < bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "JSON") {
      return JSON.parse(bytes.toString("utf8", offset + 8, offset + 8 + chunkLength));
    }
    offset += 8 + chunkLength;
  }

  throw new Error(`GLB has no JSON chunk: ${url}`);
}

describe("characters3D roster", () => {
  it("every id, name and url is unique", () => {
    expect(new Set(CHARACTERS_3D.map((c) => c.id)).size).toBe(CHARACTERS_3D.length);
    expect(new Set(CHARACTERS_3D.map((c) => c.name)).size).toBe(CHARACTERS_3D.length);
    expect(new Set(CHARACTERS_3D.map((c) => c.url)).size).toBe(CHARACTERS_3D.length);
  });

  it("every url points under public/models/", () => {
    for (const c of CHARACTERS_3D) {
      expect(c.url).toMatch(/^\/models\/[^/]+\.glb$/);
    }
  });

  it("ships a real skin and animation channel for every character", () => {
    for (const character of CHARACTERS_3D) {
      const gltf = readGlbJson(character.url);
      const skins = gltf.skins ?? [];
      const animations = gltf.animations ?? [];
      const joints = new Set(skins.flatMap((skin: { joints?: number[] }) => skin.joints ?? []));
      const channels = animations.flatMap(
        (animation: { channels?: { target?: { node?: number } }[] }) =>
          animation.channels ?? [],
      );

      expect(skins.length, character.id).toBeGreaterThan(0);
      expect(joints.size, character.id).toBeGreaterThan(0);
      expect(animations.length, character.id).toBeGreaterThan(0);
      expect(channels.length, character.id).toBeGreaterThan(0);
      expect(
        channels.every((channel: { target?: { node?: number } }) =>
          channel.target?.node !== undefined && joints.has(channel.target.node),
        ),
        character.id,
      ).toBe(true);
    }
  });

  it("splits into starter and premium with no overlap and no leftovers", () => {
    expect(STARTER_CHARACTERS_3D.length + PREMIUM_CHARACTERS_3D.length).toBe(
      CHARACTERS_3D.length,
    );
    for (const c of STARTER_CHARACTERS_3D) expect(c.tier).toBe("starter");
    for (const c of PREMIUM_CHARACTERS_3D) expect(c.tier).toBe("premium");
  });

  it("never names a real, identifiable public figure", () => {
    // The two customer-pack files this guards were "JackieChan_Rigged" and
    // "PhilIvey_Rigged" before being renamed — see this module's header.
    // This is not exhaustive, just a tripwire against reintroducing either.
    const banned = ["jackie", "chan", "ivey"];
    for (const c of CHARACTERS_3D) {
      const lower = `${c.id} ${c.name}`.toLowerCase();
      for (const word of banned) {
        expect(lower).not.toContain(word);
      }
    }
  });

  it("characterForSlot only ever returns a starter-tier character", () => {
    for (let slot = 0; slot < 20; slot++) {
      expect(characterForSlot(slot).tier).toBe("starter");
    }
  });

  it("characterForSlot cycles the starter roster deterministically", () => {
    expect(characterForSlot(0)).toBe(characterForSlot(STARTER_CHARACTERS_3D.length));
    expect(characterForSlot(1)).toBe(characterForSlot(STARTER_CHARACTERS_3D.length + 1));
  });

  it("characterById resolves both tiers and rejects unknown ids", () => {
    expect(characterById("gloria")?.tier).toBe("starter");
    expect(characterById("marcus")?.tier).toBe("premium");
    expect(characterById("nonexistent")).toBeNull();
  });
});
