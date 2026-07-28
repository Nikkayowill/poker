import "server-only";
import { adminClient } from "./supabase-admin";

export type StripePaymentKind = "rebuy_gold" | "gold_purchase";

/**
 * Applies a paid Checkout Session exactly once. The database unique key is
 * the source of truth, so both a webhook retry and a browser verification
 * request are safe to run for the same Stripe session.
 *
 * `kind` defaults to the original single-product rebuy so every existing
 * caller keeps working unchanged; the general storefront passes
 * `kind: "gold_purchase"` and its tier key explicitly.
 */
export async function fulfillStripePayment(
  stripeSessionId: string,
  profileId: string,
  goldAmount: number,
  options: { kind?: StripePaymentKind; tierKey?: string } = {},
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) throw new Error("Stripe purchases require Supabase persistence.");
  const { data, error } = await supabase.rpc("fulfill_stripe_payment", {
    p_stripe_session_id: stripeSessionId,
    p_profile_id: profileId,
    p_gold_amount: goldAmount,
    p_kind: options.kind ?? "rebuy_gold",
    p_tier_key: options.tierKey ?? null,
  });
  if (error) throw new Error(`Could not fulfill Stripe payment: ${error.message}`);
  return data === true;
}
