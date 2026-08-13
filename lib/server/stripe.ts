import "server-only";
import Stripe from "stripe";

/**
 * Live and test share one webhook endpoint (Stripe supports registering both
 * against the same URL, each with its own signing secret). Which mode a
 * request is in is decided once, in the webhook route, by which secret
 * verifies the raw-body signature -- never by anything the browser sends.
 * Every function below that resolves a Price or verifies a session takes
 * that already-decided mode as a parameter; nothing here re-derives it.
 */
export type StripeMode = "live" | "test";

let liveClient: Stripe | null | undefined;
let testClient: Stripe | null | undefined;

function clientFor(mode: StripeMode): Stripe | null {
  if (mode === "live") {
    if (liveClient !== undefined) return liveClient;
    const secret = process.env.STRIPE_SECRET_KEY?.trim();
    liveClient = secret ? new Stripe(secret) : null;
    return liveClient;
  }
  if (testClient !== undefined) return testClient;
  const secret = process.env.STRIPE_TEST_SECRET_KEY?.trim();
  testClient = secret ? new Stripe(secret) : null;
  return testClient;
}

export function stripeClient(): Stripe | null {
  return clientFor("live");
}

export function stripeTestClient(): Stripe | null {
  return clientFor("test");
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

export function stripeTestWebhookSecret(): string | null {
  return process.env.STRIPE_TEST_WEBHOOK_SECRET?.trim() || null;
}

/**
 * Which profiles may ever attempt a Stripe test-mode purchase. Server-only
 * and never derived from anything the browser sends -- a request for a test
 * profile not on this list is rejected the same way an ordinary player's
 * would be.
 */
export function isTestPurchaseAllowed(profileId: string): boolean {
  const allowed = process.env.STRIPE_TEST_ALLOWED_PROFILE_IDS ?? "";
  return allowed
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(profileId);
}

// ---- Voluntary support (one-time and monthly) --------------------------
//
// No tier here ever grants Gold or anything with in-game economic effect --
// see lib/legal/documents.ts's support_disclosure, which this module exists
// to match. Each tier is two independent Stripe Prices (one-time and
// monthly), each read live from Stripe rather than trusted from anything
// cached locally -- the same defense the old Gold storefront relied on (a
// Price's amount can only be changed by creating a new Price, never edited
// in place).

export type SupportBilling = "one_time" | "monthly";

export interface SupportTierDef {
  /** Stable once shipped -- becomes a DB check-constraint value and Stripe subscription metadata. */
  key: string;
  label: string;
  description: string;
  oneTimeEnvVar: string;
  oneTimeTestEnvVar: string;
  monthlyEnvVar: string;
  monthlyTestEnvVar: string;
}

export const SUPPORT_TIERS: SupportTierDef[] = [
  {
    key: "supporter",
    label: "Supporter",
    description: "A small thank-you toward hosting.",
    oneTimeEnvVar: "STRIPE_PRICE_SUPPORT_SUPPORTER_ONCE",
    oneTimeTestEnvVar: "STRIPE_TEST_PRICE_SUPPORT_SUPPORTER_ONCE",
    monthlyEnvVar: "STRIPE_PRICE_SUPPORT_SUPPORTER_MONTHLY",
    monthlyTestEnvVar: "STRIPE_TEST_PRICE_SUPPORT_SUPPORTER_MONTHLY",
  },
  {
    key: "backer",
    label: "Backer",
    description: "Keeps the servers (and the dogs) fed.",
    oneTimeEnvVar: "STRIPE_PRICE_SUPPORT_BACKER_ONCE",
    oneTimeTestEnvVar: "STRIPE_TEST_PRICE_SUPPORT_BACKER_ONCE",
    monthlyEnvVar: "STRIPE_PRICE_SUPPORT_BACKER_MONTHLY",
    monthlyTestEnvVar: "STRIPE_TEST_PRICE_SUPPORT_BACKER_MONTHLY",
  },
  {
    key: "patron",
    label: "Patron",
    description: "The most generous way to say thanks.",
    oneTimeEnvVar: "STRIPE_PRICE_SUPPORT_PATRON_ONCE",
    oneTimeTestEnvVar: "STRIPE_TEST_PRICE_SUPPORT_PATRON_ONCE",
    monthlyEnvVar: "STRIPE_PRICE_SUPPORT_PATRON_MONTHLY",
    monthlyTestEnvVar: "STRIPE_TEST_PRICE_SUPPORT_PATRON_MONTHLY",
  },
];

export function supportTierByKey(key: string): SupportTierDef | null {
  return SUPPORT_TIERS.find((tier) => tier.key === key) ?? null;
}

export interface ResolvedSupportPrice {
  priceId: string;
  unitAmount: number;
  currency: string;
}

export interface ResolvedSupportTier {
  key: string;
  label: string;
  description: string;
  /** Null when that billing option's env var is unset or its Price failed validation -- the button for it just doesn't render. */
  oneTime: ResolvedSupportPrice | null;
  monthly: ResolvedSupportPrice | null;
}

const resolvedPriceCache = new Map<string, Promise<ResolvedSupportPrice>>();

/**
 * Reads one tier+billing combination's Price from Stripe and validates its
 * shape matches what it claims to be -- a one-time tier must be a fixed
 * one_time Price, a monthly tier must be a recurring monthly Price. Cached
 * per mode+billing+tier so a burst of requests does not hit the Stripe API
 * once per request.
 */
function resolveSupportPrice(envVar: string, billing: SupportBilling, tierKey: string, mode: StripeMode): Promise<ResolvedSupportPrice> {
  const cacheKey = `${mode}:${billing}:${tierKey}`;
  const cached = resolvedPriceCache.get(cacheKey);
  if (cached) return cached;

  const work = (async () => {
    const stripe = clientFor(mode);
    const priceId = process.env[envVar]?.trim();
    if (!stripe || !priceId) throw new Error(`The ${tierKey} ${billing} price is not configured yet.`);

    const price = await stripe.prices.retrieve(priceId);
    if (price.livemode !== (mode === "live")) {
      throw new Error(`The ${tierKey} ${billing} Price and secret key are from different modes.`);
    }
    if (!price.active || price.unit_amount === null) {
      throw new Error(`The ${tierKey} ${billing} Price must be an active, fixed Price.`);
    }
    if (billing === "one_time" && price.type !== "one_time") {
      throw new Error(`The ${tierKey} one-time Price must be a one_time Price.`);
    }
    if (billing === "monthly" && (price.type !== "recurring" || price.recurring?.interval !== "month")) {
      throw new Error(`The ${tierKey} monthly Price must be a monthly recurring Price.`);
    }

    const productId = typeof price.product === "string" ? price.product : price.product.id;
    const product = await stripe.products.retrieve(productId);
    if ("deleted" in product && product.deleted) throw new Error(`The ${tierKey} ${billing} Product has been deleted.`);
    if (!("active" in product) || !product.active) throw new Error(`The ${tierKey} ${billing} Product is not active.`);

    return { priceId, unitAmount: price.unit_amount, currency: price.currency };
  })();

  resolvedPriceCache.set(cacheKey, work);
  work.catch(() => resolvedPriceCache.delete(cacheKey));
  return work;
}

/**
 * Every support tier, both billing options resolved independently -- a tier
 * whose monthly Price isn't configured yet still shows its one-time button,
 * and vice versa, rather than one missing env var hiding the whole tier.
 * Always live: the public panel never sells a test-mode option.
 */
export async function listSupportTiers(mode: StripeMode = "live"): Promise<ResolvedSupportTier[]> {
  const settled = await Promise.all(
    SUPPORT_TIERS.map(async (def) => {
      const [oneTime, monthly] = await Promise.allSettled([
        resolveSupportPrice(mode === "live" ? def.oneTimeEnvVar : def.oneTimeTestEnvVar, "one_time", def.key, mode),
        resolveSupportPrice(mode === "live" ? def.monthlyEnvVar : def.monthlyTestEnvVar, "monthly", def.key, mode),
      ]);
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        oneTime: oneTime.status === "fulfilled" ? oneTime.value : null,
        monthly: monthly.status === "fulfilled" ? monthly.value : null,
      };
    }),
  );
  return settled.filter((tier) => tier.oneTime !== null || tier.monthly !== null);
}

/**
 * Verifies a completed one-time support Checkout Session against Stripe's
 * own record of it -- the payment-mode counterpart to the old
 * verifiedTierSession. There is no subscription equivalent of this
 * function: a subscription's state is synced from the live Subscription
 * object (see lib/server/stripe-store.ts's syncSubscriptionState), never
 * re-validated against a cached per-session amount, since a subscription
 * isn't a fixed one-shot amount the way a one-time payment is.
 */
export async function verifiedSupportSession(
  sessionId: string,
  expectedProfileId: string | undefined,
  mode: StripeMode = "live",
): Promise<{ session: Stripe.Checkout.Session; tier: ResolvedSupportTier; profileId: string }> {
  const stripe = clientFor(mode);
  if (!stripe) throw new Error("Stripe payments are not configured yet.");
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"],
  });
  const metadata = session.metadata ?? {};
  const tierKey = metadata.tier_key;
  const def = tierKey ? supportTierByKey(tierKey) : null;
  if (!def) throw new Error("Stripe session has no StackChips support tier metadata.");

  const oneTime = await resolveSupportPrice(mode === "live" ? def.oneTimeEnvVar : def.oneTimeTestEnvVar, "one_time", def.key, mode);
  const tier: ResolvedSupportTier = { key: def.key, label: def.label, description: def.description, oneTime, monthly: null };

  const lineItems = session.line_items?.data ?? [];
  const item = lineItems[0];
  const itemPriceId = typeof item?.price === "string" ? item.price : item?.price?.id;
  const valid = (
    session.mode === "payment"
    && session.livemode === (mode === "live")
    && session.currency === oneTime.currency
    && session.amount_total === oneTime.unitAmount
    && lineItems.length === 1
    && item?.quantity === 1
    && itemPriceId === oneTime.priceId
    && metadata.kind === "support_one_time"
    && Boolean(metadata.profile_id)
    && session.client_reference_id === metadata.profile_id
    && (!expectedProfileId || metadata.profile_id === expectedProfileId)
  );
  if (!valid) throw new Error("Stripe payment details did not match the requested support tier.");
  return { session, tier, profileId: metadata.profile_id! };
}

/**
 * A Stripe-hosted Customer Portal session URL, for the "Manage membership"
 * button -- cancellation, payment-method updates, and receipts all happen
 * inside Stripe's own UI rather than a custom in-app flow. Always live: the
 * public support panel never manages a test-mode subscription this way.
 */
export async function createPortalSession(customerId: string, returnUrl: string, mode: StripeMode = "live"): Promise<string> {
  const stripe = clientFor(mode);
  if (!stripe) throw new Error("Stripe payments are not configured yet.");
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return portalSession.url;
}
