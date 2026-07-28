import "server-only";
import Stripe from "stripe";

let client: Stripe | null | undefined;

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
