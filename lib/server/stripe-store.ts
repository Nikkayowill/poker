import "server-only";
import type Stripe from "stripe";
import { adminClient } from "./supabase-admin";

export type StripePaymentKind = "rebuy_gold" | "gold_purchase" | "support_one_time";

/**
 * Applies a paid Checkout Session exactly once. The database unique key is
 * the source of truth, so both a webhook retry and a browser verification
 * request are safe to run for the same Stripe session.
 *
 * `goldAmount` is nullable: a support payment (kind "support_one_time")
 * credits nothing to the player's account; see lib/legal/documents.ts's
 * support_disclosure. Crediting is conditional on kind inside the RPC, not
 * unconditional on every payment; a support row still gets inserted for
 * audit/idempotency, it just never reaches the profiles UPDATE.
 *
 * `kind` defaults to the original single-product rebuy so every existing
 * caller keeps working unchanged.
 *
 * `livemode` defaults to true (the real economy). A false value credits the
 * profile's isolated test_gold_balance instead of gold_balance; see the
 * fulfill_stripe_payment migration. Callers must have already confirmed the
 * profile is on the test allowlist; this function does not check that.
 */
export async function fulfillStripePayment(
  stripeSessionId: string,
  profileId: string,
  goldAmount: number | null,
  options: { kind?: StripePaymentKind; tierKey?: string; livemode?: boolean } = {},
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) throw new Error("Stripe purchases require Supabase persistence.");
  const { data, error } = await supabase.rpc("fulfill_stripe_payment", {
    p_stripe_session_id: stripeSessionId,
    p_profile_id: profileId,
    p_gold_amount: goldAmount,
    p_kind: options.kind ?? "rebuy_gold",
    p_tier_key: options.tierKey ?? null,
    p_livemode: options.livemode ?? true,
  });
  if (error) throw new Error(`Could not fulfill Stripe payment: ${error.message}`);
  return data === true;
}

export type StripeSubscriptionStatus =
  | "active" | "trialing" | "past_due" | "canceled" | "unpaid"
  | "incomplete" | "incomplete_expired" | "paused";

export interface StoredStripeSubscription {
  stripeSubscriptionId: string;
  profileId: string;
  stripeCustomerId: string;
  tierKey: string;
  status: StripeSubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  livemode: boolean;
  updatedAt: string;
}

function fromSubscriptionRow(row: Record<string, unknown>): StoredStripeSubscription {
  return {
    stripeSubscriptionId: String(row.stripe_subscription_id),
    profileId: String(row.profile_id),
    stripeCustomerId: String(row.stripe_customer_id),
    tierKey: String(row.tier_key),
    status: row.status as StripeSubscriptionStatus,
    currentPeriodStart: (row.current_period_start as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    canceledAt: (row.canceled_at as string | null) ?? null,
    livemode: Boolean(row.livemode),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Mirrors one Stripe Subscription's current state into stripe_subscriptions.
 * Always re-fetches the subscription live from Stripe rather than trusting
 * the webhook event's embedded object, the same "never trust cached data"
 * discipline lib/server/stripe.ts applies to Prices. Grants nothing; this is
 * a state mirror for the support panel to read, never a path to Gold.
 *
 * `eventCreatedAt` should be the originating Stripe event's own `created`
 * timestamp (webhook callers), not `Date.now()`: the upsert RPC uses it as
 * a recency guard so a late-delivered or redelivered webhook can never
 * regress a newer status. The verify-route recovery path (no stored event,
 * just a live read) passes `new Date()`, which is correct there since it is
 * always the freshest possible read.
 */
export async function syncSubscriptionState(
  stripe: Stripe,
  subscriptionId: string,
  livemode: boolean,
  eventCreatedAt: Date,
): Promise<StoredStripeSubscription | null> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const profileId = subscription.metadata.profile_id;
  const tierKey = subscription.metadata.tier_key;
  if (!profileId || !tierKey) return null; // not a StackChips support subscription

  // current_period_start/end live on the subscription item in this API
  // version, not on the Subscription root; see lib/server/stripe.ts's
  // header comment for the SDK landmine this guards against.
  const item = subscription.items.data[0];
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const supabase = adminClient();
  if (!supabase) throw new Error("Subscriptions require Supabase persistence.");
  const { data, error } = await supabase.rpc("upsert_stripe_subscription", {
    p_stripe_subscription_id: subscription.id,
    p_profile_id: profileId,
    p_stripe_customer_id: customerId,
    p_tier_key: tierKey,
    p_status: subscription.status,
    p_current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : null,
    p_current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    p_livemode: livemode,
    p_event_created_at: eventCreatedAt.toISOString(),
  });
  if (error) throw new Error(`Could not sync subscription: ${error.message}`);
  return data ? fromSubscriptionRow(data as Record<string, unknown>) : null;
}

/** This profile's most recent support subscription, live-mode only; for the "Manage membership" portal link and the panel's membership card. */
export async function latestStripeSubscription(profileId: string): Promise<StoredStripeSubscription | null> {
  const supabase = adminClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("stripe_subscriptions")
    .select("*")
    .eq("profile_id", profileId)
    .eq("livemode", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return fromSubscriptionRow(data as Record<string, unknown>);
}
