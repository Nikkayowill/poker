import { describe, expect, it } from "vitest";
import { PVP_STATE_CHANGED, pvpChannelName } from "./duel-channel";

describe("pvpChannelName", () => {
  it("matches the topic broadcast_pvp_signal() publishes to", () => {
    // The trigger builds 'pvp:' || first_id::text / 'pvp:' || second_id::text.
    // If these ever disagree the app subscribes to a channel nobody writes
    // to, and a duel silently stops syncing with no error anywhere.
    expect(pvpChannelName("2c9a0f5e-0000-4000-8000-000000000001"))
      .toBe("pvp:2c9a0f5e-0000-4000-8000-000000000001");
  });
});

describe("PVP_STATE_CHANGED", () => {
  it("is a stable event name", () => {
    // Also the literal the migration's realtime.send() calls pass -- a
    // rename on one side without the other is the same silent-stop failure.
    expect(PVP_STATE_CHANGED).toBe("PVP_STATE_CHANGED");
  });
});
