import { describe, expect, it } from "vitest";
import { SNG_STATE_CHANGED, sitAndGoLobbyChannelName, sitAndGoTableChannelName } from "./sit-and-go-channel";

// These must match the topics and event broadcast_sit_and_go_signal()
// publishes. If they drift the app listens to a channel nobody writes to and
// the waiting room silently stops updating.
describe("sit and go channels", () => {
  it("uses the fixed lobby topic", () => {
    expect(sitAndGoLobbyChannelName()).toBe("sng:lobby");
  });

  it("builds the table topic from a table id", () => {
    expect(sitAndGoTableChannelName("2c9a0f5e-0000-4000-8000-000000000001"))
      .toBe("sng:2c9a0f5e-0000-4000-8000-000000000001");
  });

  it("uses a stable event name", () => {
    expect(SNG_STATE_CHANGED).toBe("SNG_STATE_CHANGED");
  });
});
