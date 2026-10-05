import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const verifiedStackAcresSession = vi.fn();
const isTestPurchaseAllowed = vi.fn();
const fulfillStackAcresPurchase = vi.fn();

vi.mock("./stripe", () => ({
  verifiedStackAcresSession: (...args: unknown[]) => verifiedStackAcresSession(...args),
  isTestPurchaseAllowed: (...args: unknown[]) => isTestPurchaseAllowed(...args),
}));
vi.mock("./stripe-store", () => ({
  fulfillStackAcresPurchase: (...args: unknown[]) => fulfillStackAcresPurchase(...args),
}));

import { disputeCloseRestoresAccess, settleStackAcresSession } from "./stripe-stackacres";

function verified(paymentStatus: string) {
  return {
    session: { id: "cs_live_12345", payment_status: paymentStatus },
    profileId: "profile-1",
    paymentIntentId: "pi_123",
  };
}

describe("settleStackAcresSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTestPurchaseAllowed.mockReturnValue(false);
    fulfillStackAcresPurchase.mockResolvedValue(true);
  });

  it("turns access on for a paid live session", async () => {
    verifiedStackAcresSession.mockResolvedValue(verified("paid"));
    await expect(settleStackAcresSession("cs_live_12345", "live", "profile-1")).resolves.toBe(true);
    expect(verifiedStackAcresSession).toHaveBeenCalledWith("cs_live_12345", "profile-1", "live");
    expect(fulfillStackAcresPurchase).toHaveBeenCalledWith("cs_live_12345", "profile-1", "pi_123", true);
  });

  it("grants nothing for an unpaid session", async () => {
    verifiedStackAcresSession.mockResolvedValue(verified("unpaid"));
    await expect(settleStackAcresSession("cs_live_12345", "live")).resolves.toBe(false);
    expect(fulfillStackAcresPurchase).not.toHaveBeenCalled();
  });

  it("ignores a test-mode session for a profile off the test allowlist", async () => {
    verifiedStackAcresSession.mockResolvedValue(verified("paid"));
    await expect(settleStackAcresSession("cs_test_12345", "test")).resolves.toBe(false);
    expect(fulfillStackAcresPurchase).not.toHaveBeenCalled();
  });

  it("counts a test-mode session for an allowlisted profile, marked as test", async () => {
    isTestPurchaseAllowed.mockReturnValue(true);
    verifiedStackAcresSession.mockResolvedValue(verified("paid"));
    await expect(settleStackAcresSession("cs_test_12345", "test")).resolves.toBe(true);
    expect(fulfillStackAcresPurchase).toHaveBeenCalledWith("cs_live_12345", "profile-1", "pi_123", false);
  });

  it("does not grant when the session fails verification", async () => {
    verifiedStackAcresSession.mockRejectedValue(new Error("did not match"));
    await expect(settleStackAcresSession("cs_live_12345", "live")).rejects.toThrow("did not match");
    expect(fulfillStackAcresPurchase).not.toHaveBeenCalled();
  });
});

describe("disputeCloseRestoresAccess", () => {
  it("gives the farm back when the money stayed, and not when it was lost", () => {
    expect(disputeCloseRestoresAccess("won")).toBe(true);
    expect(disputeCloseRestoresAccess("warning_closed")).toBe(true);
    expect(disputeCloseRestoresAccess("lost")).toBe(false);
  });
});
