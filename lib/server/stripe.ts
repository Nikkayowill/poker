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

// ---- Gold purchase (reinstated 2026-08-15) ------------------------------
//
// See lib/legal/documents.ts's gold_disclosure for why this exists again
// after being pulled: an informed, accepted risk decision, not an
// oversight. Three tiers, all one-time, each a live Stripe Price read
// at request time the same way the support tiers below are -- a Price's
// amount can only be changed by creating a new Price, never edited in
// place, so what Stripe returns is authoritative over anything cached here.

export interface GoldTierDef {
  key: string;
  label: string;
  description: string;
  goldAmount: number;
  /** Which env var holds this tier's live Stripe Price id. */
  envVar: string;
  /** Which env var holds this tier's test-mode Price id, for verification. */
  testEnvVar: string;
}

/**
 * Repriced cheaper 2026-08-22, Kayo's direct call. STRIPE_REBUY_PRICE_ID now
 * points at a new $1.99 CAD Price (prod_V4ps93p85SZfo0 /
 * price_1U7FarHrjHRpeZPRKf3Nw2gz, 20k Gold) on the same Starter Pack
 * Product the old $2.99/50k Price lived on -- that old Price
 * (price_1U4gD5HrjHRpeZPReMjQYirb) is deactivated, not deleted, so it stays
 * on the account's own history. STRIPE_PRICE_VALUE is untouched -- the
 * $9.99/500k High Roller Price already matched what Kayo asked for, so no
 * new Price was needed there. The new middle rung is a brand new Product
 * ("Value Pack", prod_V7Ua9qvg7XR3on) since nothing sat between Starter and
 * High Roller before -- its env var (STRIPE_PRICE_VALUE_PACK) is new and
 * needs setting in Vercel before this tier actually appears (listGoldTiers
 * skips any tier whose env var is unset, same as every tier already did).
 */
export const GOLD_TIERS: GoldTierDef[] = [
  {
    key: "starter",
    label: "Starter Pack",
    description: "A solid stack to sit down with.",
    goldAmount: 20000,
    envVar: "STRIPE_REBUY_PRICE_ID",
    testEnvVar: "STRIPE_TEST_PRICE_STARTER",
  },
  {
    key: "value_pack",
    label: "Value Pack",
    description: "A bigger stack for the table.",
    goldAmount: 100000,
    envVar: "STRIPE_PRICE_VALUE_PACK",
    testEnvVar: "STRIPE_TEST_PRICE_VALUE_PACK",
  },
  {
    key: "high_roller",
    label: "High Roller",
    description: "Five Value Packs worth, all at once.",
    goldAmount: 500000,
    envVar: "STRIPE_PRICE_VALUE",
    testEnvVar: "STRIPE_TEST_PRICE_VALUE",
  },
];

export function goldTierByKey(key: string): GoldTierDef | null {
  return GOLD_TIERS.find((tier) => tier.key === key) ?? null;
}

export interface ResolvedGoldTier {
  key: string;
  label: string;
  description: string;
  goldAmount: number;
  priceId: string;
  unitAmount: number;
  currency: string;
}

const resolvedGoldTierCache = new Map<string, Promise<ResolvedGoldTier>>();

/**
 * Reads a tier's Price from Stripe rather than trusting anything stored
 * locally -- same validation shape as resolveSupportPrice below. Cached per
 * mode+tier key so a burst of checkout requests does not hit the Stripe API
 * once per request.
 */
export function resolveGoldTier(key: string, mode: StripeMode = "live"): Promise<ResolvedGoldTier> {
  const cacheKey = `${mode}:${key}`;
  const cached = resolvedGoldTierCache.get(cacheKey);
  if (cached) return cached;

  const work = (async () => {
    const def = goldTierByKey(key);
    if (!def) throw new Error("That Gold pack does not exist.");
    const stripe = clientFor(mode);
    const priceId = process.env[mode === "live" ? def.envVar : def.testEnvVar]?.trim();
    if (!stripe || !priceId) throw new Error("That Gold pack is not configured yet.");

    const price = await stripe.prices.retrieve(priceId);
    if (price.livemode !== (mode === "live")) {
      throw new Error(`The ${key} Price and secret key are from different modes.`);
    }
    if (!price.active || price.type !== "one_time" || price.unit_amount === null) {
      throw new Error(`The ${key} Price must be an active, fixed one-time Price.`);
    }

    const productId = typeof price.product === "string" ? price.product : price.product.id;
    const product = await stripe.products.retrieve(productId);
    if ("deleted" in product && product.deleted) throw new Error(`The ${key} Product has been deleted.`);
    if (!("active" in product) || !product.active) throw new Error(`The ${key} Product is not active.`);

    return {
      key: def.key,
      label: def.label,
      description: def.description,
      goldAmount: def.goldAmount,
      priceId,
      unitAmount: price.unit_amount,
      currency: price.currency,
    };
  })();

  resolvedGoldTierCache.set(cacheKey, work);
  work.catch(() => resolvedGoldTierCache.delete(cacheKey));
  return work;
}

/**
 * Every Gold tier that has a Price configured, resolved and validated -- a
 * tier whose env var is unset simply does not appear. Always live: the
 * public storefront never sells a test-mode pack.
 */
export async function listGoldTiers(): Promise<ResolvedGoldTier[]> {
  const settled = await Promise.allSettled(GOLD_TIERS.map((tier) => resolveGoldTier(tier.key)));
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function verifiedGoldSession(sessionId: string, expectedProfileId?: string, mode: StripeMode = "live") {
  const stripe = clientFor(mode);
  if (!stripe) throw new Error("Stripe payments are not configured yet.");
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"],
  });
  const metadata = session.metadata ?? {};
  const tierKey = metadata.tier_key;
  if (!tierKey) throw new Error("Stripe session has no StackChips Gold tier metadata.");
  const tier = await resolveGoldTier(tierKey, mode);

  const lineItems = session.line_items?.data ?? [];
  const item = lineItems[0];
  const itemPriceId = typeof item?.price === "string" ? item.price : item?.price?.id;
  const valid = (
    session.mode === "payment"
    && session.livemode === (mode === "live")
    && session.currency === tier.currency
    && session.amount_total === tier.unitAmount
    && lineItems.length === 1
    && item?.quantity === 1
    && itemPriceId === tier.priceId
    && metadata.kind === "gold_purchase"
    && metadata.gold_amount === String(tier.goldAmount)
    && Boolean(metadata.profile_id)
    && session.client_reference_id === metadata.profile_id
    && (!expectedProfileId || metadata.profile_id === expectedProfileId)
  );
  if (!valid) throw new Error("Stripe payment details did not match the requested Gold pack.");
  return { session, tier, profileId: metadata.profile_id! };
}

/**
 * US states where selling a chance-game-usable virtual currency for real
 * money is a live litigation risk (Kater v. Churchill Downs / Big Fish
 * Casino, decided under Washington's unusually broad "thing of value"
 * gambling statute -- see lib/legal/documents.ts's gold_disclosure). This is
 * the one mitigation applied; it is not a claim that buying Gold is risk-free
 * everywhere else.
 */
const RESTRICTED_GOLD_BILLING_STATES: Record<string, ReadonlySet<string>> = {
  US: new Set(["WA"]),
};

function isRestrictedGoldBillingAddress(address: Stripe.Address | null | undefined): boolean {
  if (!address?.country) return false;
  const blocked = RESTRICTED_GOLD_BILLING_STATES[address.country];
  if (!blocked || !address.state) return false;
  return blocked.has(address.state.toUpperCase());
}

/**
 * Refunds a Gold purchase whose Stripe-collected billing address is in a
 * restricted state, and reports whether it did. Checkout collects the
 * address in the same step as payment (see billing_address_collection:
 * "required" at session creation), so this runs after the charge exists
 * rather than blocking it beforehand -- the charge is refunded immediately,
 * before any Gold is credited, never the other way around.
 */
export async function enforceGoldBillingRestriction(session: Stripe.Checkout.Session, mode: StripeMode): Promise<boolean> {
  if (!isRestrictedGoldBillingAddress(session.customer_details?.address)) return false;
  const stripe = clientFor(mode);
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (stripe && paymentIntentId) {
    await stripe.refunds.create({ payment_intent: paymentIntentId, reason: "requested_by_customer" });
  }
  return true;
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
