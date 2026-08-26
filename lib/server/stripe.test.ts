import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { buildCheckoutSession } from "./stripe";

function fakeStripe(session: Partial<Stripe.Checkout.Session>) {
  const create = vi.fn().mockResolvedValue(session);
  return { stripe: { checkout: { sessions: { create } } } as unknown as Stripe, create };
}

describe("buildCheckoutSession", () => {
  it("builds the shared one-time shape and passes through the optional fields a call site sets", async () => {
    const { stripe, create } = fakeStripe({ url: "https://checkout.stripe.test/session", id: "cs_test_1" });

    const session = await buildCheckoutSession(stripe, {
      mode: "payment",
      priceId: "price_gold",
      profileId: "profile-1",
      successUrl: "https://stackchips.test/store/gold?payment=success",
      cancelUrl: "https://stackchips.test/store/gold?payment=cancelled",
      billingAddressCollection: "required",
      customText: { submit: { message: "no cash value" } },
      metadata: { kind: "gold_purchase", tier_key: "starter", profile_id: "profile-1", gold_amount: "20000" },
    });

    expect(session.url).toBe("https://checkout.stripe.test/session");
    expect(create).toHaveBeenCalledWith({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: "price_gold", quantity: 1 }],
      success_url: "https://stackchips.test/store/gold?payment=success",
      cancel_url: "https://stackchips.test/store/gold?payment=cancelled",
      client_reference_id: "profile-1",
      metadata: { kind: "gold_purchase", tier_key: "starter", profile_id: "profile-1", gold_amount: "20000" },
      billing_address_collection: "required",
      custom_text: { submit: { message: "no cash value" } },
    });
  });

  it("attaches an existing customer and subscription-level metadata only when given", async () => {
    const { stripe, create } = fakeStripe({ url: "https://checkout.stripe.test/session", id: "cs_test_2" });

    await buildCheckoutSession(stripe, {
      mode: "subscription",
      priceId: "price_monthly",
      profileId: "profile-2",
      successUrl: "https://stackchips.test/store?payment=success",
      cancelUrl: "https://stackchips.test/store?payment=cancelled",
      customerId: "cus_existing",
      subscriptionMetadata: { profile_id: "profile-2", tier_key: "backer" },
      metadata: { kind: "support_subscription", tier_key: "backer", profile_id: "profile-2" },
    });

    expect(create).toHaveBeenCalledWith({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: "price_monthly", quantity: 1 }],
      success_url: "https://stackchips.test/store?payment=success",
      cancel_url: "https://stackchips.test/store?payment=cancelled",
      client_reference_id: "profile-2",
      metadata: { kind: "support_subscription", tier_key: "backer", profile_id: "profile-2" },
      customer: "cus_existing",
      subscription_data: { metadata: { profile_id: "profile-2", tier_key: "backer" } },
    });
  });

  it("throws when Stripe returns no URL, instead of returning a session no caller can redirect to", async () => {
    const { stripe } = fakeStripe({ url: null, id: "cs_test_3" });

    await expect(
      buildCheckoutSession(stripe, {
        mode: "payment",
        priceId: "price_gold",
        profileId: "profile-3",
        successUrl: "https://stackchips.test/store/gold?payment=success",
        cancelUrl: "https://stackchips.test/store/gold?payment=cancelled",
        metadata: {},
      }),
    ).rejects.toThrow("Stripe did not return a checkout URL.");
  });
});
