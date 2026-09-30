import { afterEach, describe, expect, it, vi } from "vitest";
import { playerFacingMessage, publicErrorMessage } from "./public-error";

describe("playerFacingMessage", () => {
  it("keeps refusals we wrote for the player", () => {
    expect(playerFacingMessage("Not enough Gold.")).toBe("Not enough Gold.");
    expect(playerFacingMessage("The table changed. Refresh and try again.")).toBe(
      "The table changed. Refresh and try again.",
    );
  });

  it("trims database text off our own prefix", () => {
    expect(playerFacingMessage('Could not spend Gold: relation "profiles" does not exist')).toBe(
      "Could not spend Gold.",
    );
    expect(playerFacingMessage("Could not load profile: JWT expired")).toBe("Could not load profile.");
  });

  it("drops database, code and debug text", () => {
    expect(playerFacingMessage('column "gold" does not exist')).toBeNull();
    expect(playerFacingMessage("unlock_stackacres_perk returned no row")).toBeNull();
    expect(playerFacingMessage("barnaby: not-ready with no active quest")).toBeNull();
    expect(playerFacingMessage("PGRST116")).toBeNull();
    expect(playerFacingMessage("Cannot read properties of undefined (reading 'id')")).toBeNull();
    expect(playerFacingMessage("New row violates row-level security policy.")).toBeNull();
  });
});

describe("publicErrorMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back and logs when nothing is safe to show", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error('duplicate key value violates unique constraint "x"');
    expect(publicErrorMessage(error, "Could not save that.")).toBe("Could not save that.");
    expect(log).toHaveBeenCalledWith(error);
  });

  it("never shows a code error, however it reads", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicErrorMessage(new TypeError("Something went wrong here."), "Try again.")).toBe("Try again.");
  });

  it("uses the fallback for a non-Error throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicErrorMessage("boom", "Try again.")).toBe("Try again.");
  });

  it("passes a clean refusal through without logging it", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicErrorMessage(new Error("Not enough Gold."), "Try again.")).toBe("Not enough Gold.");
    expect(log).not.toHaveBeenCalled();
  });
});
