import { describe, expect, it } from "vitest";
import {
  formatStack,
  parseStackInBigBlinds,
  STACK_DISPLAY_STORAGE_KEY,
} from "./stack-display";

describe("stack display preference", () => {
  it("defaults off, unlike the sound/music flags", () => {
    expect(parseStackInBigBlinds(null)).toBe(false);
    expect(parseStackInBigBlinds("garbage")).toBe(false);
  });

  it("turns on only for the exact stored value", () => {
    expect(parseStackInBigBlinds("true")).toBe(true);
  });

  it("stores under the app's own namespace, like sound and bet style", () => {
    expect(STACK_DISPLAY_STORAGE_KEY.startsWith("stackchips:")).toBe(true);
  });

  it("formats in chips when the preference is off", () => {
    expect(formatStack(12500, 100, false)).toBe("12,500");
  });

  it("formats in big blinds when on, dropping the decimal on a whole number", () => {
    expect(formatStack(12500, 100, true)).toBe("125 BB");
    expect(formatStack(1250, 100, true)).toBe("12.5 BB");
  });

  it("falls back to chips when there is no real big blind to divide by", () => {
    expect(formatStack(12500, 0, true)).toBe("12,500");
    expect(formatStack(12500, -5, true)).toBe("12,500");
  });
});
