import "server-only";
import { verifiedStackAcresSession, isTestPurchaseAllowed, type StripeMode } from "./stripe";
import { fulfillStackAcresPurchase } from "./stripe-store";

/**
 * Checks a StackAcres Checkout Session against Stripe's own record and, when
 * it is paid, turns access on. The one place the webhook and the return-trip
 * verify both go through, so they cannot disagree.
 *
 * A test-mode session for a profile not on the test allowlist is ignored, as
 * for every other purchase. Returns whether the session is paid and counted.
 */
export async function settleStackAcresSession(
  sessionId: string,
  mode: StripeMode,
  expectedProfileId?: string,
): Promise<boolean> {
  const { session, profileId, paymentIntentId } = await verifiedStackAcresSession(sessionId, expectedProfileId, mode);
  if (session.payment_status !== "paid") return false;
  if (mode === "test" && !isTestPurchaseAllowed(profileId)) return false;
  await fulfillStackAcresPurchase(session.id, profileId, paymentIntentId, mode === "live");
  return true;
}

/**
 * Whether a closed dispute gives the farm back. "won" is a chargeback we won;
 * "warning_closed" is an inquiry that ended without becoming one. Either way
 * the money stayed, so the access the dispute took away comes back.
 */
export function disputeCloseRestoresAccess(status: string): boolean {
  return status === "won" || status === "warning_closed";
}
