import { describe, expect, it } from "vitest";
import { HEADS_UP_STATE_CHANGED, headsUpChannelName } from "./heads-up-channel";

// These must match the topic and event broadcast_heads_up_signal() publishes.
describe("heads up channel", () => {
  it("builds the topic from a profile id", () => {
    expect(headsUpChannelName("2c9a0f5e-0000-4000-8000-000000000001"))
      .toBe("hu:2c9a0f5e-0000-4000-8000-000000000001");
  });

  it("uses a stable event name", () => {
    expect(HEADS_UP_STATE_CHANGED).toBe("HEADS_UP_STATE_CHANGED");
  });
});
