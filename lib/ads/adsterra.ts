/**
 * The Adsterra units this app can render, as data.
 *
 * In lib/ rather than inline in a component for the reason lib/arcade/games.ts
 * is: vitest.config.ts collects only lib/ and app/, so a slot key written next
 * to the markup is a slot key no test can check. The one test that matters here
 * is that every unit's loader host is a host next.config.ts's CSP actually
 * allows -- a mismatch is invisible until a real browser blocks the script, and
 * this vendor's hosts have already drifted once.
 *
 * ON THE HOSTS DRIFTING
 *
 * Adsterra moves publishers between delivery domains without notice, and a
 * loader on a host the CSP does not name simply never executes -- no error the
 * app can see, just an empty box. The allow-list therefore names each
 * registrable domain with a wildcard on the subdomain, because the creative
 * comes from sibling subdomains of the loader's, not from one fixed host.
 */

export interface AdsterraUnit {
  /** The unit key from the Adsterra dashboard. */
  adKey: string;
  /** The loader this unit is served by. */
  scriptSrc: string;
  width: number;
  height: number;
}

/**
 * Every delivery domain the CSP allows, without the scheme or wildcard.
 *
 * Kept here, in testable code, and mirrored by next.config.ts -- which cannot
 * import this file, because a next.config.ts import would drag it into the
 * build config's module graph. The test asserts they agree instead.
 */
export const ADSTERRA_DELIVERY_DOMAINS = [
  "effectivecpmnetwork.com",
  "profitabledisplaynetwork.com",
  "effectivecreativeformat.com",
] as const;

/**
 * The unit shown inside the rewarded-ad modal.
 *
 * 300x250 because that is what the existing account is configured for -- the
 * key and the dimensions are one setting on Adsterra's side, and a mismatch
 * serves nothing rather than serving a resized banner.
 *
 * The key is public vendor configuration, not an application secret. Keep it
 * in the deployment environment so a masked or stale dashboard value can
 * never be shipped as if it were a working unit.
 */
export const REWARDED_AD_UNIT: AdsterraUnit = {
  adKey: process.env.NEXT_PUBLIC_ADSTERRA_KEY ?? "",
  scriptSrc: "https://pl30614360.effectivecpmnetwork.com/c7/0f/54/c70f542f472123eecce05e14a79898f8.js",
  width: 300,
  height: 250,
};

/** The registrable domain of a unit's loader, for the CSP agreement test. */
export function deliveryDomainOf(unit: AdsterraUnit): string {
  const host = new URL(unit.scriptSrc).hostname;
  return host.split(".").slice(-2).join(".");
}

/** Whether a unit's loader would survive the CSP. False means an empty box and no error. */
export function isAllowedByCsp(unit: AdsterraUnit): boolean {
  return (ADSTERRA_DELIVERY_DOMAINS as readonly string[]).includes(deliveryDomainOf(unit));
}
