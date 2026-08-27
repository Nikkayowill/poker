import { describe, expect, it } from "vitest";
import { CRIB_STATE_CHANGED, cribLobbyChannelName, cribTableChannelName } from "./crib-channel";

describe("cribLobbyChannelName", () => {
  it("is the fixed global lobby topic broadcast_crib_signal() publishes to", () => {
    expect(cribLobbyChannelName()).toBe("crib:lobby");
  });
});

describe("cribTableChannelName", () => {
  it("matches the topic the trigger builds from a table id", () => {
    // The trigger builds 'crib:' || v_table_id::text. If these ever disagree
    // the app subscribes to a channel nobody writes to, and a table
    // silently stops syncing with no error anywhere.
    expect(cribTableChannelName("2c9a0f5e-0000-4000-8000-000000000001"))
      .toBe("crib:2c9a0f5e-0000-4000-8000-000000000001");
  });
});

describe("CRIB_STATE_CHANGED", () => {
  it("is a stable event name", () => {
    expect(CRIB_STATE_CHANGED).toBe("CRIB_STATE_CHANGED");
  });
});
