import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, isValidPushKey } from "./endpoint";

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QAbc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://attacker.example/collect",
    "https://fcm.googleapis.com.attacker.example/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://user:pass@fcm.googleapis.com/x",
    "not a url",
    `https://fcm.googleapis.com/${"a".repeat(2000)}`,
  ])("refuses %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe("isValidPushKey", () => {
  it("accepts base64url keys", () => {
    expect(isValidPushKey("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM")).toBe(true);
    expect(isValidPushKey("tBHItJI5svbpez7KI4CCXg==")).toBe(true);
  });

  it("refuses empty, oversized or non-base64 values", () => {
    expect(isValidPushKey("")).toBe(false);
    expect(isValidPushKey("a".repeat(300))).toBe(false);
    expect(isValidPushKey("<script>")).toBe(false);
  });
});
