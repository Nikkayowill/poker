import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ADSTERRA_DELIVERY_DOMAINS,
  REWARDED_AD_UNIT,
  deliveryDomainOf,
  isAllowedByCsp,
} from "./adsterra";

/**
 * The CSP and the ad units have to agree, and nothing else can tell you when
 * they stop.
 *
 * A loader on a host the policy does not name never executes. There is no
 * exception thrown, no failed promise, nothing an error boundary or a Sentry
 * breadcrumb would catch -- just an empty box, in production, for whoever the
 * vendor has already migrated. This vendor has moved delivery domains at least
 * once already, which is why the list has three entries.
 *
 * next.config.ts cannot import from lib/, so the list is duplicated there by
 * necessity. This reads the config as text and asserts the duplicate is
 * faithful, which is the cheapest thing that would fail on a one-sided edit.
 */
describe("Adsterra units", () => {
  const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
  /**
   * The config with its prose removed.
   *
   * The comments in next.config.ts *name* the domain that stays blocked, in
   * order to say that it stays blocked -- so a plain text search for it finds
   * the note explaining the rule and reports it as a violation of that same
   * rule. Only the code can be searched for what the policy allows.
   */
  const configCode = config
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Whole-line comments only. A general `//.*` strip eats the `//` in every
    // https:// URL in the policy, which is most of what these tests read.
    .replace(/^\s*\/\/.*$/gm, "");

  it("serves the rewarded unit from a domain the CSP allows", () => {
    expect(isAllowedByCsp(REWARDED_AD_UNIT)).toBe(true);
  });

  it.each(ADSTERRA_DELIVERY_DOMAINS)("next.config.ts allows %s", (domain) => {
    expect(configCode).toContain(`https://*.${domain}`);
  });

  it("names every allowed domain in script-src, frame-src, img-src and connect-src", () => {
    // A domain in script-src but not frame-src is the exact shape of the bug
    // this app already hit once: the loader runs, the iframe it writes does
    // not. The four directives are declared from one shared constant in
    // next.config.ts, so this asserts that constant is used in all four.
    for (const directive of ["script-src", "frame-src", "img-src", "connect-src"]) {
      expect(configCode).toMatch(new RegExp(`${directive}[^\`]*adsterraOrigins`));
    }
  });

  it("keeps 'self' in frame-src", () => {
    // The unit renders in a srcdoc iframe, which has no URL of its own and is
    // matched against this document's origin. Without 'self' the slot is
    // blocked before the vendor's hosts are ever consulted.
    expect(configCode).toMatch(/frame-src 'self'/);
  });

  it("still refuses the unrelated beacon domain", () => {
    // Recorded in CLAUDE.md as a deliberate block: a beacon to a domain no ad
    // needs is the popunder/redirect behaviour this vendor is known for, and
    // widening the policy for it buys nothing.
    expect(configCode).not.toContain("spendsdetachment.com");
  });

  it("reads a registrable domain off a unit's loader", () => {
    expect(deliveryDomainOf(REWARDED_AD_UNIT)).toBe("effectivecpmnetwork.com");
  });
});
