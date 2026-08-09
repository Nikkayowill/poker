/**
 * Terms of Service and the Gold purchase disclosure, in code rather than the
 * database -- same reasoning as the cosmetics catalog: a new version is a
 * number bump and new body text here, with no migration and no admin CMS.
 * Only *acceptance* (who agreed to which version, when) is dynamic enough to
 * belong in Postgres.
 *
 * The version number is the whole enforcement mechanism. A player's
 * acceptance is recorded against a specific version (see
 * lib/server/legal-store.ts); bump the number here and every existing
 * acceptance stops counting as current, so editing this file is how a real
 * legal change gets re-consented rather than silently grandfathering
 * everyone in under old language they never saw.
 */

export type LegalDocumentSlug = "terms_of_service" | "gold_disclosure" | "app_disclaimer";

/**
 * Every slug that needs accepting, in prompt order. A caller with no profile
 * yet has accepted none of them, so this doubles as the "nothing accepted"
 * answer -- worth sharing rather than restating the list per call site.
 */
export const LEGAL_DOCUMENT_SLUGS: readonly LegalDocumentSlug[] = [
  "terms_of_service",
  "gold_disclosure",
];

export interface LegalDocument {
  slug: LegalDocumentSlug;
  version: number;
  title: string;
  /** Plain paragraphs, rendered as-is -- no markdown, so there is nothing to sanitize wrong. */
  body: string[];
}

export const LEGAL_DOCUMENTS: Record<LegalDocumentSlug, LegalDocument> = {
  terms_of_service: {
    slug: "terms_of_service",
    // Bumped to 2 when the computer-opponent disclosure below was added. That
    // re-prompts every existing player, which is the intended cost: it is the
    // only disclosure in the product that opponents may not be people, and
    // grandfathering players in under language that never mentioned it is
    // exactly what the version mechanism exists to prevent.
    version: 2,
    title: "Terms of Service",
    body: [
      "StackChips is a free-to-play social poker game played with Gold, an in-app entertainment currency. Nothing in StackChips is real-money gambling: no hand you play, and no amount of Gold you hold, wins, buys, or can be exchanged for real money, cryptocurrency, or any prize of monetary value.",
      "Tables are filled with computer-controlled opponents. Any seat at your table that is not held by another player is played by StackChips software, and seats can change hands between hands as players join and leave. Computer opponents follow the same rules, the same betting limits, and the same shuffled deck as every other seat; they cannot see your cards, and they receive no advantage of any kind.",
      "You must be at least 18 years old, or the age of majority where you live if that is higher, to play. By continuing you confirm you meet that requirement.",
      "Your Gold balance, table history, and cosmetics belong to your StackChips profile and have no value outside the app. We can suspend or terminate a profile that cheats, abuses other players, colludes, or attempts to convert Gold into anything of real-world value.",
      "We may change these Terms as the game changes. Continuing to play after a change takes effect means you accept the current version; if you were asked to accept again, it is because something material changed.",
    ],
  },
  gold_disclosure: {
    slug: "gold_disclosure",
    version: 1,
    title: "Gold Purchase Disclosure",
    body: [
      "Gold is a virtual, in-app entertainment currency. It has no cash value, cannot be redeemed for cash, and cannot be exchanged, transferred, or cashed out for any real-world currency, cryptocurrency, goods, or prize of monetary value under any circumstances.",
      "Purchasing Gold is optional and never required to play. A Gold purchase is a one-time payment for the stated amount of in-app Gold, charged immediately at checkout. Purchases are final; Gold already credited to your balance cannot be refunded except where required by law.",
      "Prices are shown in the currency charged by Stripe, our payment processor, at checkout before you pay. We never store your card details -- Stripe handles payment directly.",
    ],
  },
  app_disclaimer: {
    slug: "app_disclaimer",
    version: 1,
    title: "App Disclaimer",
    body: [
      "StackChips is provided for entertainment and general informational purposes. It is not financial, legal, medical, tax, investment, gaming, or other professional advice, and using StackChips does not create a professional-client relationship.",
      "The app, its games, content, features, and availability are provided on an as-is and as-available basis, to the fullest extent permitted by law. We do not promise that StackChips will be uninterrupted, error-free, secure, current, or available at any particular time, or that defects will always be corrected.",
      "Game results, balances, rankings, puzzles, odds, descriptions, and other information may contain errors or omissions and may change without notice. You are responsible for how you use the app and for complying with the laws and age requirements that apply where you live.",
      "To the fullest extent permitted by law, StackChips and its operators are not responsible for indirect, incidental, special, consequential, exemplary, or punitive loss arising from your use of or inability to use the app. Nothing in this disclaimer excludes or limits a responsibility that cannot lawfully be excluded or limited.",
      "StackChips may use third-party services, payment providers, analytics, hosting, and advertising partners. Their services, content, links, availability, and privacy practices are governed by their own terms and policies; their appearance in or connection with StackChips is not an endorsement or guarantee by StackChips.",
    ],
  },
};

export function currentVersion(slug: LegalDocumentSlug): number {
  return LEGAL_DOCUMENTS[slug].version;
}

/** Public route for the full, readable version of each accepted document. */
export function legalDocumentPath(slug: LegalDocumentSlug): string {
  if (slug === "terms_of_service") return "/legal/terms";
  if (slug === "gold_disclosure") return "/legal/gold-disclosure";
  return "/legal/disclaimer";
}
