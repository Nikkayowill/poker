import { describe, expect, it } from "vitest";
import { installPlatform, installShortStep } from "./platform";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_LEGACY = "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
// iPadOS 13+ deliberately impersonates desktop Safari.
const IPAD_MODERN = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC = IPAD_MODERN;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("installPlatform", () => {
  it("reads an iPhone as ios", () => {
    expect(installPlatform(IPHONE)).toBe("ios");
  });

  it("reads a pre-13 iPad as ios", () => {
    expect(installPlatform(IPAD_LEGACY)).toBe("ios");
  });

  it("reads a modern iPad as ios despite its desktop UA string", () => {
    // The whole reason maxTouchPoints is a parameter. Without it this iPad
    // gets the desktop copy and is never told how to install.
    expect(installPlatform(IPAD_MODERN, 5)).toBe("ios");
  });

  it("does not mistake a real Mac for an iPad", () => {
    // Same UA string as the case above; only the touch-points differ.
    expect(installPlatform(MAC, 0)).toBe("other");
  });

  it("reads Android Chrome as android", () => {
    expect(installPlatform(ANDROID)).toBe("android");
  });

  it("falls back to other for desktop Windows", () => {
    expect(installPlatform(WINDOWS)).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(installPlatform(IPHONE.toUpperCase())).toBe("ios");
  });

  it("treats an empty UA as other rather than throwing", () => {
    expect(installPlatform("")).toBe("other");
  });
});

describe("installShortStep", () => {
  it("never hands the same wording to two different platforms", () => {
    // A generic set of steps would be worse than none: following the Android
    // menu path on iOS finds nothing.
    const lines = ["ios", "android", "other"] as const;
    expect(new Set(lines.map(installShortStep)).size).toBe(3);
  });

  it("tells iOS to use Share, which is the only path Safari has", () => {
    expect(installShortStep("ios")).toContain("Share");
  });

  it("stays one line on a phone", () => {
    // A footnote under a login form, not a section. At 390px this is about
    // the longest string that does not wrap to three lines.
    for (const platform of ["ios", "android", "other"] as const) {
      expect(installShortStep(platform).length).toBeLessThanOrEqual(60);
    }
  });
});
