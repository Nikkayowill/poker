import { describe, expect, it } from "vitest";
import {
  parseEnabledFlag,
  readStoredPreference,
  writeStoredPreference,
  type PreferenceStorage,
} from "./stored-preference";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: PreferenceStorage & { snapshot(): Record<string, string> } = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    snapshot: () => Object.fromEntries(map),
  };
  return storage;
}

describe("parseEnabledFlag", () => {
  it("is on unless the stored value is exactly \"false\"", () => {
    expect(parseEnabledFlag("false")).toBe(false);
    expect(parseEnabledFlag("true")).toBe(true);
    expect(parseEnabledFlag(null)).toBe(true);
    // A value from a newer build, or a corrupted one, means on rather than
    // off: the off state here is a mute, and defaulting to silence would be a
    // broken-looking app.
    expect(parseEnabledFlag("")).toBe(true);
    expect(parseEnabledFlag("False")).toBe(true);
    expect(parseEnabledFlag("0")).toBe(true);
  });
});

describe("readStoredPreference", () => {
  it("reads the current key", () => {
    const storage = fakeStorage({ "stackchips:sound-enabled": "false" });
    const value = readStoredPreference(storage, {
      key: "stackchips:sound-enabled",
      parse: parseEnabledFlag,
    });
    expect(value).toBe(false);
  });

  it("carries a muted player's choice across a key rename", () => {
    // The incident this exists for: the StackChips rename moved the key
    // without the value, and "on unless exactly false" then un-muted everyone
    // who had muted the app.
    const storage = fakeStorage({ "river-room:sound-enabled": "false" });

    const value = readStoredPreference(storage, {
      key: "stackchips:sound-enabled",
      legacyKey: "river-room:sound-enabled",
      parse: parseEnabledFlag,
    });

    expect(value).toBe(false);
    expect(storage.snapshot()).toEqual({ "stackchips:sound-enabled": "false" });
  });

  it("migrates once, then never looks at the legacy key again", () => {
    const storage = fakeStorage({ "river-room:sound-enabled": "false" });
    const options = {
      key: "stackchips:sound-enabled",
      legacyKey: "river-room:sound-enabled",
      parse: parseEnabledFlag,
    };

    expect(readStoredPreference(storage, options)).toBe(false);
    // A legacy key written again by some other tab must not resurrect and
    // override the value the player has since chosen under the new key.
    storage.setItem("stackchips:sound-enabled", "true");
    storage.setItem("river-room:sound-enabled", "false");
    expect(readStoredPreference(storage, options)).toBe(true);
  });

  it("prefers the current key when both exist", () => {
    const storage = fakeStorage({
      "stackchips:sound-enabled": "true",
      "river-room:sound-enabled": "false",
    });
    expect(
      readStoredPreference(storage, {
        key: "stackchips:sound-enabled",
        legacyKey: "river-room:sound-enabled",
        parse: parseEnabledFlag,
      }),
    ).toBe(true);
  });

  it("leaves a player with neither key on the default", () => {
    const storage = fakeStorage();
    expect(
      readStoredPreference(storage, {
        key: "stackchips:sound-enabled",
        legacyKey: "river-room:sound-enabled",
        parse: parseEnabledFlag,
      }),
    ).toBe(true);
    expect(storage.snapshot()).toEqual({});
  });

  it("parses the default when storage is unavailable", () => {
    // A server render and a browser blocking storage are ordinary cases, not
    // exceptions to catch at each call site.
    expect(readStoredPreference(null, { key: "any", parse: parseEnabledFlag })).toBe(true);
    expect(readStoredPreference(null, { key: "any", parse: (raw) => raw ?? "fallback" })).toBe(
      "fallback",
    );
  });

  it("hands the raw string to parse, so non-boolean preferences work too", () => {
    const storage = fakeStorage({ "stackchips:bet-style": "neat_slide" });
    expect(
      readStoredPreference(storage, {
        key: "stackchips:bet-style",
        parse: (raw) => (raw === "neat_slide" ? "neat_slide" : "splash_chunk"),
      }),
    ).toBe("neat_slide");
  });
});

describe("writeStoredPreference", () => {
  it("persists the value", () => {
    const storage = fakeStorage();
    writeStoredPreference(storage, "stackchips:sound-enabled", "false");
    expect(storage.getItem("stackchips:sound-enabled")).toBe("false");
  });

  it("is a no-op without storage rather than a throw", () => {
    expect(() => writeStoredPreference(null, "k", "v")).not.toThrow();
  });

  it("swallows a storage that throws", () => {
    // Private-mode Safari and a full quota both throw on setItem. A preference
    // that fails to persist resets next visit; an exception escaping a click
    // handler breaks the menu.
    const throwing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() => writeStoredPreference(throwing, "k", "v")).not.toThrow();
  });
});
