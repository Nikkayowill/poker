import { describe, expect, it } from "vitest";
import type { PreferenceStorage } from "@/lib/profile/stored-preference";
import {
  ENTRY_GATE_STORAGE_KEY,
  readEntryGatePassed,
  writeEntryGatePassed,
} from "./entry-gate";

function fakeStorage(initial: Record<string, string> = {}): PreferenceStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("readEntryGatePassed", () => {
  it("is false with no storage at all (server render, blocked storage)", () => {
    expect(readEntryGatePassed(null)).toBe(false);
  });

  it("is false for an absent key", () => {
    expect(readEntryGatePassed(fakeStorage())).toBe(false);
  });

  it("is true only for an exact stored 'true'", () => {
    expect(readEntryGatePassed(fakeStorage({ [ENTRY_GATE_STORAGE_KEY]: "true" }))).toBe(true);
    // The opposite polarity from parseEnabledFlag: any junk means "show the
    // gate", because the gate can recover and an empty lobby cannot.
    expect(readEntryGatePassed(fakeStorage({ [ENTRY_GATE_STORAGE_KEY]: "TRUE" }))).toBe(false);
    expect(readEntryGatePassed(fakeStorage({ [ENTRY_GATE_STORAGE_KEY]: "1" }))).toBe(false);
    expect(readEntryGatePassed(fakeStorage({ [ENTRY_GATE_STORAGE_KEY]: "false" }))).toBe(false);
  });

  it("is false, not a throw, when the storage itself throws", () => {
    const throwing: PreferenceStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(readEntryGatePassed(throwing)).toBe(false);
  });
});

describe("writeEntryGatePassed", () => {
  it("round-trips through a real write", () => {
    const storage = fakeStorage();
    writeEntryGatePassed(storage, true);
    expect(readEntryGatePassed(storage)).toBe(true);
    writeEntryGatePassed(storage, false);
    expect(readEntryGatePassed(storage)).toBe(false);
  });

  it("clears by removing the key rather than storing a falsy value", () => {
    const storage = fakeStorage({ [ENTRY_GATE_STORAGE_KEY]: "true" });
    writeEntryGatePassed(storage, false);
    expect(storage.data.has(ENTRY_GATE_STORAGE_KEY)).toBe(false);
  });

  it("tolerates a null or throwing storage", () => {
    expect(() => writeEntryGatePassed(null, true)).not.toThrow();
    const throwing: PreferenceStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(() => writeEntryGatePassed(throwing, true)).not.toThrow();
    expect(() => writeEntryGatePassed(throwing, false)).not.toThrow();
  });
});
