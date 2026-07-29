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
const rebuyConfig: Partial<Record<StripeMode, Promise<StripeRebuyConfig>>> = {};

export interface StripeRebuyConfig {
  priceId: string;
  goldAmount: number;
  unitAmount: number;
  currency: string;
}

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

export function stripeRebuyPriceId(): string | null {
  return process.env.STRIPE_REBUY_PRICE_ID?.trim() || null;
}

export function stripeRebuyGoldAmount(): number {
  const amount = Number.parseInt(process.env.STRIPE_REBUY_GOLD_AMOUNT ?? "5000", 10);
  if (!Number.isInteger(amount) || amount <= 0) return 5000;
  return amount;
}

function rebuyPriceIdFor(mode: StripeMode): string | null {
  if (mode === "live") return stripeRebuyPriceId();
  return process.env.STRIPE_TEST_PRICE_STARTER?.trim() || null;
}

/**
 * Reads the Price from Stripe rather than trusting environment metadata.
 * Checkout and both fulfillment paths share this cached validation.
 */
export function stripeRebuyConfig(mode: StripeMode = "live"): Promise<StripeRebuyConfig> {
  const cached = rebuyConfig[mode];
  if (cached) return cached;
  const work = (async () => {
    const stripe = clientFor(mode);
    const priceId = rebuyPriceIdFor(mode);
    if (!stripe || !priceId) throw new Error("Rebuy payments are not configured yet.");

    const price = await stripe.prices.retrieve(priceId);
    if (price.livemode !== (mode === "live")) {
      throw new Error("The Stripe rebuy Price and secret key are from different modes.");
    }
    if (!price.active || price.type !== "one_time" || price.unit_amount === null) {
      throw new Error("The Stripe rebuy Price must be an active, fixed one-time Price.");
    }

    const productId = typeof price.product === "string" ? price.product : price.product.id;
    const product = await stripe.products.retrieve(productId);
    if ("deleted" in product && product.deleted) {
      throw new Error("The Stripe rebuy Product has been deleted.");
    }
    if (!("active" in product) || !product.active) {
      throw new Error("The Stripe rebuy Product is not active.");
    }

    return {
      priceId,
      goldAmount: stripeRebuyGoldAmount(),
      unitAmount: price.unit_amount,
      currency: price.currency,
    };
  })().catch((error) => {
    delete rebuyConfig[mode];
    throw error;
  });
  rebuyConfig[mode] = work;
  return work;
}

export async function verifiedRebuySession(sessionId: string, expectedProfileId?: string, mode: StripeMode = "live") {
  const stripe = clientFor(mode);
  if (!stripe) throw new Error("Stripe payments are not configured yet.");
  const config = await stripeRebuyConfig(mode);
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"],
  });
  const lineItems = session.line_items?.data ?? [];
  const item = lineItems[0];
  const itemPriceId = typeof item?.price === "string" ? item.price : item?.price?.id;
  const metadata = session.metadata ?? {};
  const valid = (
    session.mode === "payment"
    && session.livemode === (mode === "live")
    && session.currency === config.currency
    && session.amount_total === config.unitAmount
    && lineItems.length === 1
    && item?.quantity === 1
    && itemPriceId === config.priceId
    && metadata.kind === "rebuy_gold"
    && metadata.gold_amount === String(config.goldAmount)
    && Boolean(metadata.profile_id)
    && session.client_reference_id === metadata.profile_id
    && (!expectedProfileId || metadata.profile_id === expectedProfileId)
  );
  if (!valid) throw new Error("Stripe payment details did not match the River Room rebuy.");
  return { session, config, profileId: metadata.profile_id! };
}

// ---- General Gold storefront (multiple tiers) --------------------------
//
// The rebuy config/session pair above is one fixed product, reachable only
// after busting at a table. This is the same idea generalized to several
// products a player can buy any time: each tier names an env var holding a
// Stripe Price id, so the actual charged amount is never hardcoded here --
// it is read from Stripe at request time, the same defense the rebuy path
// already relies on (a Price's amount can only be changed by creating a new
// Price, never edited in place, so what Stripe returns is authoritative).

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
 * The storefront ladder. "starter" deliberately reuses the pre-existing
 * rebuy Price/env var rather than minting a duplicate -- it is the same
 * product Codex's rebuy flow already sells, just also reachable from the
 * general storefront now.
 */
export const GOLD_TIERS: GoldTierDef[] = [
  {
    key: "starter",
    label: "Starter",
    description: "A quick top-up to get back in.",
    goldAmount: 50000,
    envVar: "STRIPE_REBUY_PRICE_ID",
    testEnvVar: "STRIPE_TEST_PRICE_STARTER",
  },
  {
    key: "value",
    label: "Value Pack",
    description: "Our most popular pack.",
    goldAmount: 120000,
    envVar: "STRIPE_PRICE_VALUE",
    testEnvVar: "STRIPE_TEST_PRICE_VALUE",
  },
  {
    key: "stack",
    label: "Stack",
    description: "For a full session at the higher stakes.",
    goldAmount: 270000,
    envVar: "STRIPE_PRICE_STACK",
    testEnvVar: "STRIPE_TEST_PRICE_STACK",
  },
  {
    key: "high_roller",
    label: "High Roller",
    description: "The whole ladder, all at once.",
    goldAmount: 750000,
    envVar: "STRIPE_PRICE_HIGH_ROLLER",
    testEnvVar: "STRIPE_TEST_PRICE_HIGH_ROLLER",
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

const resolvedTierCache = new Map<string, Promise<ResolvedGoldTier>>();

/**
 * Reads a tier's Price from Stripe rather than trusting anything stored
 * locally -- the same validation shape as stripeRebuyConfig, generalized to
 * whichever tier was asked for. Cached per mode+tier key so a burst of
 * checkout requests does not hit the Stripe API once per request.
 */
export function resolveGoldTier(key: string, mode: StripeMode = "live"): Promise<ResolvedGoldTier> {
  const cacheKey = `${mode}:${key}`;
  const cached = resolvedTierCache.get(cacheKey);
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

  resolvedTierCache.set(cacheKey, work);
  work.catch(() => resolvedTierCache.delete(cacheKey));
  return work;
}

/**
 * Every tier that has a Price configured, resolved and validated -- a tier
 * whose env var is unset simply does not appear, so the storefront can ship
 * before every tier's Price exists rather than one missing var breaking the
 * whole page. Always live: the public storefront never sells a test-mode
 * pack, so this default is never overridden by a caller.
 */
export async function listGoldTiers(): Promise<ResolvedGoldTier[]> {
  const settled = await Promise.allSettled(GOLD_TIERS.map((tier) => resolveGoldTier(tier.key)));
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function verifiedTierSession(sessionId: string, expectedProfileId?: string, mode: StripeMode = "live") {
  const stripe = clientFor(mode);
  if (!stripe) throw new Error("Stripe payments are not configured yet.");
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"],
  });
  const metadata = session.metadata ?? {};
  const tierKey = metadata.tier_key;
  if (!tierKey) throw new Error("Stripe session has no River Room tier metadata.");
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
