import { describe, expect, it } from "vitest";
import {
  TABLE_EVENT_VERSION,
  parseTableStateChanged,
  tableChannelName,
  tableStateChangedPayload,
} from "./table-channel";

describe("tableChannelName", () => {
  it("matches the topic the Postgres trigger publishes to", () => {
    // The trigger builds 'table:' || new.game_id::text. If these two ever
    // disagree the app subscribes to a channel nobody writes to, and every
    // table silently stops updating with no error anywhere.
    expect(tableChannelName("2c9a0f5e-0000-4000-8000-000000000001"))
      .toBe("table:2c9a0f5e-0000-4000-8000-000000000001");
  });
});

describe("parseTableStateChanged", () => {
  it("reads the current flat envelope", () => {
    const payload = tableStateChangedPayload(42, "2026-07-31T12:00:00.000Z");
    expect(parseTableStateChanged(payload)).toEqual({
      v: TABLE_EVENT_VERSION,
      version: 42,
      updatedAt: "2026-07-31T12:00:00.000Z",
    });
  });

  it("reads a bare {version} from a database that has not run the migration", () => {
    // The deployed app can be newer than the database it points at. Refusing
    // this shape would take a live table offline rather than degrade.
    expect(parseTableStateChanged({ version: 7 })).toEqual({
      v: 0,
      version: 7,
      updatedAt: null,
    });
  });

  it("reads the nested shape the persistent worker used to send", () => {
    expect(
      parseTableStateChanged({
        type: "TABLE_STATE_CHANGED",
        tableId: "table-1",
        phase: "BettingRounds",
        state: { version: 9, updatedAt: "2026-07-31T12:00:00.000Z" },
      }),
    ).toEqual({ v: 0, version: 9, updatedAt: "2026-07-31T12:00:00.000Z" });
  });

  it("accepts a version encoded as a string", () => {
    expect(parseTableStateChanged({ v: 1, version: "12" })?.version).toBe(12);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "TABLE_STATE_CHANGED"],
    ["an empty object", {}],
    ["a non-numeric version", { version: "soon" }],
    ["a NaN version", { version: Number.NaN }],
    ["an empty-string version", { version: "" }],
    ["a null nested state", { state: null }],
  ])("rejects %s", (_label, payload) => {
    expect(parseTableStateChanged(payload)).toBeNull();
  });

  it("prefers the top-level version when both shapes are present", () => {
    // A publisher mid-migration could emit both. The flat field is the one
    // this contract owns, so it wins rather than the result depending on
    // property order.
    expect(
      parseTableStateChanged({ v: 1, version: 5, state: { version: 4 } })?.version,
    ).toBe(5);
  });

  it("ignores an updatedAt that is not a string", () => {
    expect(parseTableStateChanged({ v: 1, version: 3, updatedAt: 1700 })?.updatedAt)
      .toBeNull();
  });
});
