import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasAccess: vi.fn(),
  hasPaid: vi.fn(),
  setAccess: vi.fn(),
  buildCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/server/session", () => ({ readSessionToken: () => "token-1" }));
vi.mock("@/lib/server/profile-store", () => ({
  ensureProfile: async () => ({ id: "profile-1", isRegistered: true }),
  setStackAcresAccess: (...args: unknown[]) => mocks.setAccess(...args),
}));
vi.mock("@/lib/server/stackacres-access", () => ({
  tokenHasStackAcresAccess: (...args: unknown[]) => mocks.hasAccess(...args),
}));
vi.mock("@/lib/server/stripe-store", () => ({
  hasPaidStackAcresPurchase: (...args: unknown[]) => mocks.hasPaid(...args),
}));
vi.mock("@/lib/server/legal-store", () => ({ pendingAcceptances: async () => [] }));
vi.mock("@/lib/server/stripe", () => ({
  stripeClient: () => ({}),
  resolveStackAcresPrice: async () => ({ priceId: "price_1", unitAmount: 799, currency: "usd" }),
  buildCheckoutSession: (...args: unknown[]) => mocks.buildCheckoutSession(...args),
}));

import { POST } from "./route";

function buy() {
  return new NextRequest("https://www.stackchips.test/api/stripe/stackacres", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ over18: true }),
  });
}

describe("POST /api/stripe/stackacres", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAccess.mockResolvedValue(false);
    mocks.hasPaid.mockResolvedValue(false);
    mocks.buildCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
  });

  it("opens the farm again for someone who already paid, instead of charging twice", async () => {
    mocks.hasPaid.mockResolvedValue(true);
    const response = await POST(buy());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ owned: true });
    expect(mocks.setAccess).toHaveBeenCalledWith("profile-1", true);
    expect(mocks.buildCheckoutSession).not.toHaveBeenCalled();
  });

  it("starts checkout for someone who has never paid", async () => {
    const response = await POST(buy());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    expect(mocks.setAccess).not.toHaveBeenCalled();
  });
});
