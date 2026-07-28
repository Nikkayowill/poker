import "server-only";
import Stripe from "stripe";

let client: Stripe | null | undefined;
let rebuyConfig: Promise<StripeRebuyConfig> | null = null;

export interface StripeRebuyConfig {
  priceId: string;
  goldAmount: number;
  unitAmount: number;
  currency: string;
}

export function stripeClient(): Stripe | null {
  if (client !== undefined) return client;
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  client = secret ? new Stripe(secret) : null;
  return client;
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

export function stripeRebuyPriceId(): string | null {
  return process.env.STRIPE_REBUY_PRICE_ID?.trim() || null;
}

export function stripeRebuyGoldAmount(): number {
  const amount = Number.parseInt(process.env.STRIPE_REBUY_GOLD_AMOUNT ?? "5000", 10);
  if (!Number.isInteger(amount) || amount <= 0) return 5000;
  return amount;
}

/**
 * Reads the Price from Stripe rather than trusting environment metadata.
 * Checkout and both fulfillment paths share this cached validation.
 */
export function stripeRebuyConfig(): Promise<StripeRebuyConfig> {
  if (rebuyConfig) return rebuyConfig;
  rebuyConfig = (async () => {
    const stripe = stripeClient();
    const priceId = stripeRebuyPriceId();
    if (!stripe || !priceId) throw new Error("Rebuy payments are not configured yet.");

    const price = await stripe.prices.retrieve(priceId);
    const secretIsLive = process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_") ?? false;
    if (price.livemode !== secretIsLive) {
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
    rebuyConfig = null;
    throw error;
  });
  return rebuyConfig;
}

export async function verifiedRebuySession(sessionId: string, expectedProfileId?: string) {
  const stripe = stripeClient();
  if (!stripe) throw new Error("Stripe payments are not configured yet.");
  const config = await stripeRebuyConfig();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"],
  });
  const lineItems = session.line_items?.data ?? [];
  const item = lineItems[0];
  const itemPriceId = typeof item?.price === "string" ? item.price : item?.price?.id;
  const metadata = session.metadata ?? {};
  const valid = (
    session.mode === "payment"
    && session.livemode === (process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_") ?? false)
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
    goldAmount: 5000,
    envVar: "STRIPE_REBUY_PRICE_ID",
  },
  {
    key: "value",
    label: "Value Pack",
    description: "Our most popular pack.",
    goldAmount: 11000,
    envVar: "STRIPE_PRICE_VALUE",
  },
  {
    key: "stack",
    label: "Stack",
    description: "For a full session at the higher stakes.",
    goldAmount: 24000,
    envVar: "STRIPE_PRICE_STACK",
  },
  {
    key: "high_roller",
    label: "High Roller",
    description: "The whole ladder, all at once.",
    goldAmount: 70000,
    envVar: "STRIPE_PRICE_HIGH_ROLLER",
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
 * whichever tier was asked for. Cached per tier key so a burst of checkout
 * requests does not hit the Stripe API once per request.
 */
export function resolveGoldTier(key: string): Promise<ResolvedGoldTier> {
  const cached = resolvedTierCache.get(key);
  if (cached) return cached;

  const work = (async () => {
    const def = goldTierByKey(key);
    if (!def) throw new Error("That Gold pack does not exist.");
    const stripe = stripeClient();
    const priceId = process.env[def.envVar]?.trim();
    if (!stripe || !priceId) throw new Error("That Gold pack is not configured yet.");

    const price = await stripe.prices.retrieve(priceId);
    const secretIsLive = process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_") ?? false;
    if (price.livemode !== secretIsLive) {
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

  resolvedTierCache.set(key, work);
  work.catch(() => resolvedTierCache.delete(key));
  return work;
}

/**
 * Every tier that has a Price configured, resolved and validated -- a tier
 * whose env var is unset simply does not appear, so the storefront can ship
 * before every tier's Price exists rather than one missing var breaking the
 * whole page.
 */
export async function listGoldTiers(): Promise<ResolvedGoldTier[]> {
  const settled = await Promise.allSettled(GOLD_TIERS.map((tier) => resolveGoldTier(tier.key)));
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function verifiedTierSession(sessionId: string, expectedProfileId?: string) {
  const stripe = stripeClient();
  if (!stripe) throw new Error("Stripe payments are not configured yet.");
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"],
  });
  const metadata = session.metadata ?? {};
  const tierKey = metadata.tier_key;
  if (!tierKey) throw new Error("Stripe session has no River Room tier metadata.");
  const tier = await resolveGoldTier(tierKey);

  const lineItems = session.line_items?.data ?? [];
  const item = lineItems[0];
  const itemPriceId = typeof item?.price === "string" ? item.price : item?.price?.id;
  const valid = (
    session.mode === "payment"
    && session.livemode === (process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_") ?? false)
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
