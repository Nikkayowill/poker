import { describe, expect, it } from "vitest";
import { createGame, toSnapshot } from "../game/engine";
import { detectImage } from "./image";
import type { PlayerProfile } from "./types";
import { defaultAvatar } from "@/lib/avatar/catalog";

describe("profile appearance", () => {
  it("is copied into a new seat without exposing session identity", () => {
    const token = crypto.randomUUID();
    const profile: PlayerProfile = {
      id: crypto.randomUUID(),
      displayName: "Card Shark",
      initials: "CS",
      avatarUrl: "https://example.test/avatar.png",
      avatarPreset: "crown",
      avatar: defaultAvatar,
      accent: "#c08dff",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      goldBalance: 2000,
      unlimitedGold: false,
      lastDailyClaimAt: null,
      isRegistered: false,
    };
    const snapshot = toSnapshot(createGame(token, profile.displayName, profile), token);
    expect(snapshot.seats[0]).toMatchObject({
      name: "Card Shark",
      initials: "CS",
      avatarUrl: profile.avatarUrl,
      avatarPreset: "crown",
      accent: "#c08dff",
    });
    expect("ownerToken" in snapshot).toBe(false);
  });
});

describe("avatar content detection", () => {
  it("detects supported formats from bytes instead of trusting the filename", () => {
    expect(detectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toEqual({
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(detectImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({
      contentType: "image/png",
      extension: "png",
    });
  });

  it("rejects executable or unknown content", () => {
    expect(detectImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImage(new TextEncoder().encode("MZ executable"))).toBeNull();
  });
});
