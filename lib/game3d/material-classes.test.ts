import { describe, expect, it } from "vitest";
import { classifyAvatarMaterial } from "./material-classes";

describe("classifyAvatarMaterial", () => {
  it("classifies the real starter-roster eye material names as eyes", () => {
    expect(classifyAvatarMaterial("Eyes_MAT")).toBe("eyes");
    expect(classifyAvatarMaterial("Eyes_MAT.001")).toBe("eyes");
  });

  it("does not classify an eyelash material as eyes", () => {
    // Michael's roster — an eyelash is hair, not the eyeball, and wants the
    // matte "other" clamp rather than the eyes' near-pass-through gloss.
    expect(classifyAvatarMaterial("Eyelashmat")).toBe("other");
  });

  it("classifies the real starter-roster skin/body material names as skin", () => {
    expect(classifyAvatarMaterial("Skin_MAT")).toBe("skin");
    expect(classifyAvatarMaterial("Ch31_body")).toBe("skin");
    expect(classifyAvatarMaterial("Ch02_body")).toBe("skin");
    expect(classifyAvatarMaterial("Ch07_body")).toBe("skin");
    expect(classifyAvatarMaterial("Ch20_body")).toBe("skin");
    expect(classifyAvatarMaterial("Bodymat")).toBe("skin");
  });

  it("falls back to other for cloth/hair/prop materials", () => {
    expect(classifyAvatarMaterial("Clothes_MAT")).toBe("other");
    expect(classifyAvatarMaterial("Clothes_MAT.001")).toBe("other");
    expect(classifyAvatarMaterial("Cigar_Mat")).toBe("other");
    expect(classifyAvatarMaterial("Hairmat")).toBe("other");
    expect(classifyAvatarMaterial("Topmat")).toBe("other");
    expect(classifyAvatarMaterial("Bottommat")).toBe("other");
    expect(classifyAvatarMaterial("Shoesmat")).toBe("other");
    expect(classifyAvatarMaterial("Ch31_hair")).toBe("other");
  });

  it("falls back to other for the eight premium characters' single shared material", () => {
    expect(classifyAvatarMaterial("Material.001")).toBe("other");
  });

  it("falls back to other for missing or empty names rather than throwing", () => {
    expect(classifyAvatarMaterial(undefined)).toBe("other");
    expect(classifyAvatarMaterial(null)).toBe("other");
    expect(classifyAvatarMaterial("")).toBe("other");
    expect(classifyAvatarMaterial("   ")).toBe("other");
  });
});
