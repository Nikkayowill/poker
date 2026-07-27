import { describe, expect, it } from "vitest";
import {
  defaultAvatar,
  mixColor,
  normalizeAvatar,
  starterAvatars,
  type AvatarConfig,
} from "./catalog";

describe("avatar config", () => {
  it("falls back to defaults for a profile that has never customized one", () => {
    expect(normalizeAvatar(null)).toEqual(defaultAvatar);
    expect(normalizeAvatar(undefined)).toEqual(defaultAvatar);
    expect(normalizeAvatar({})).toEqual(defaultAvatar);
  });

  it("keeps recognised values and discards anything invented", () => {
    const result = normalizeAvatar({
      skinTone: "ebony",
      hairStyle: "mohawk-of-fire",
      face: "sharp",
      outfit: 42,
    });
    expect(result.skinTone).toBe("ebony");
    expect(result.face).toBe("sharp");
    // A client cannot invent a hairstyle or send a nonsense type; both fall
    // back rather than reaching the renderer and drawing nothing.
    expect(result.hairStyle).toBe(defaultAvatar.hairStyle);
    expect(result.outfit).toBe(defaultAvatar.outfit);
  });

  it("survives a config saved before a category existed", () => {
    // Simulates an older row: valid, but missing a field added later.
    const legacy = { skinTone: "sand", hairStyle: "crop", hairColor: "jet", face: "calm" };
    const result = normalizeAvatar(legacy);
    expect(result.facialHair).toBe(defaultAvatar.facialHair);
    expect(result.outfit).toBe(defaultAvatar.outfit);
    expect(result.skinTone).toBe("sand");
  });

  it("round-trips every starter figure unchanged", () => {
    starterAvatars.forEach((starter) => {
      expect(normalizeAvatar(starter.config as unknown)).toEqual<AvatarConfig>(starter.config);
    });
  });

  it("mixes a colour toward a target", () => {
    expect(mixColor("#ffffff", "#000000", 0)).toBe("#ffffff");
    expect(mixColor("#ffffff", "#000000", 1)).toBe("#000000");
    expect(mixColor("#ffffff", "#000000", 0.5)).toBe("#808080");
  });
});
