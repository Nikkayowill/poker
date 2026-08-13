/**
 * Terms of Service and the other player-facing disclosures, in code rather
 * than the database -- same reasoning as the cosmetics catalog: a new
 * version is a number bump and new body text here, with no migration and no
 * admin CMS. Only *acceptance* (who agreed to which version, when) is
 * dynamic enough to belong in Postgres.
 *
 * The version number is the whole enforcement mechanism. A player's
 * acceptance is recorded against a specific version (see
 * lib/server/legal-store.ts); bump the number here and every existing
 * acceptance stops counting as current, so editing this file is how a real
 * legal change gets re-consented rather than silently grandfathering
 * everyone in under old language they never saw.
 */

export type LegalDocumentSlug =
  | "terms_of_service"
  | "privacy_policy"
  | "support_disclosure"
  | "app_disclaimer";

/**
 * Every slug that needs accepting, in prompt order. A caller with no profile
 * yet has accepted none of them, so this doubles as the "nothing accepted"
 * answer -- worth sharing rather than restating the list per call site.
 */
export const LEGAL_DOCUMENT_SLUGS: readonly LegalDocumentSlug[] = [
  "terms_of_service",
  "privacy_policy",
  "support_disclosure",
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
    // Bumped to 3 to add the dispute-resolution section below (informal
    // resolution first, Nova Scotia governing law/venue, individual-claims
    // only). Deliberately does NOT include a binding-arbitration clause --
    // Canadian courts have struck those down as unconscionable against
    // individual consumers in ways US courts generally do not (Uber
    // Technologies Inc v Heller, 2020 SCC 16), so a boilerplate US-style
    // arbitration clause here would read as enforceable without reliably
    // being so. This section has not been reviewed by Nova Scotia counsel;
    // treat it as a first draft to take to a real lawyer, not a final
    // opinion, before leaning on it in an actual dispute.
    version: 3,
    title: "Terms of Service",
    body: [
      "StackChips is a free-to-play social poker game played with Gold, an in-app entertainment currency. Nothing in StackChips is real-money gambling: no hand you play, and no amount of Gold you hold, wins, buys, or can be exchanged for real money, cryptocurrency, or any prize of monetary value.",
      "Tables are filled with computer-controlled opponents. Any seat at your table that is not held by another player is played by StackChips software, and seats can change hands between hands as players join and leave. Computer opponents follow the same rules, the same betting limits, and the same shuffled deck as every other seat; they cannot see your cards, and they receive no advantage of any kind.",
      "You must be at least 18 years old, or the age of majority where you live if that is higher, to play. By continuing you confirm you meet that requirement.",
      "Your Gold balance, table history, and cosmetics belong to your StackChips profile and have no value outside the app. We can suspend or terminate a profile that cheats, abuses other players, colludes, or attempts to convert Gold into anything of real-world value.",
      "Before either of us starts a court proceeding, you agree to first contact us at support@stackchips.app and describe the dispute; we will try in good faith to resolve it informally within 60 days.",
      "These Terms, and any dispute arising from them or from your use of StackChips, are governed by the laws of the Province of Nova Scotia and the federal laws of Canada applicable there, without regard to conflict-of-laws rules. Subject to the informal-resolution step above, you and StackChips agree that the courts of Nova Scotia have exclusive jurisdiction over any dispute that is not resolved informally, and you consent to that jurisdiction and venue.",
      "You and StackChips agree to bring any claim only in an individual capacity, not as a plaintiff or class member in any purported class, collective, or representative proceeding. If a court holds this individual-basis requirement unenforceable as to a particular claim, that claim -- and only that claim -- may proceed on a class or representative basis in the courts identified above, and every other part of these Terms remains in effect.",
      "We may change these Terms as the game changes. Continuing to play after a change takes effect means you accept the current version; if you were asked to accept again, it is because something material changed.",
    ],
  },
  privacy_policy: {
    slug: "privacy_policy",
    // Bumped to 2 when Gold purchases were replaced by voluntary support --
    // the payment-data paragraph below described crediting a Gold balance,
    // which is no longer true and would misdescribe what a support payment
    // does with a player's data.
    version: 2,
    title: "Privacy Policy",
    body: [
      "StackChips is operated from Nova Scotia, Canada. This policy explains what we collect when you use the app, why, and who else sees it, alongside the Terms of Service.",
      "If you play as a guest, we hold an HttpOnly session cookie identifying your profile and nothing else identifying. If you link an account, we hold the email or identifier your sign-in provider gives us. Either way we hold your display name, avatar image, Gold balance, hand history, rank, and other gameplay records tied to your profile. Uploaded avatar images are stored in a public bucket for image delivery -- do not upload an image you want to keep private.",
      "If you choose to support StackChips, one-time or monthly payments are processed by Stripe. We never receive or store your card number; we receive transaction and subscription status from Stripe, which we use only to keep the payment and billing records we are required to keep -- a support payment does not add anything to your profile for us to receive.",
      "We automatically receive technical data such as IP address, device and browser information, and crash/error reports (via Sentry) needed to run and debug the app. If you choose to watch a rewarded ad for free Gold, the ad is served by Adsterra, which may set its own cookies or identifiers under its own privacy policy; we do not use Adsterra outside that optional feature.",
      "We do not sell your personal information. We share it only with the service providers that run the app for us -- Stripe (payments), Supabase (hosting, database, authentication), Sentry (error monitoring), and Adsterra (only for the optional rewarded-ad feature) -- and only for the purpose of running StackChips, not for their own independent marketing.",
      "We keep your data while your profile is active and delete or anonymize it on request, except records we must retain for legal, tax, or accounting reasons, such as payment history.",
      "You can ask us to access, correct, or delete your personal data at any time by emailing support@stackchips.app. Because StackChips operates from Nova Scotia, our baseline practice follows Canada's Personal Information Protection and Electronic Documents Act (PIPEDA); if the law where you live gives you additional rights, we will honor requests consistent with that law too.",
      "StackChips is not directed at children under 13, and we do not knowingly collect personal information from them. The Terms of Service already require every player to be at least 18, or the age of majority where they live if higher.",
      "We may update this policy as the app changes. Continuing to play after an update takes effect means you accept the current version; if you were asked to accept again, it is because something material changed.",
    ],
  },
  support_disclosure: {
    slug: "support_disclosure",
    // Replaces gold_disclosure. StackChips no longer sells Gold for real
    // money -- see lib/legal/documents.ts history and CLAUDE.md for why:
    // paying real money for anything that plays into a chance-based game is
    // exactly the fact pattern that drew the Big Fish Casino litigation, and
    // Stripe's own restricted-business rules separately require a genuine
    // no-consideration donation not to resemble a sale. Voluntary support
    // grants nothing back -- no Gold, no gameplay advantage, no odds
    // change -- specifically so it stays a real donation rather than a sale
    // wearing a donation label. Do not attach a Gold reward, a gameplay
    // perk, or anything with in-game economic effect to any support tier
    // without redoing this analysis; a purely cosmetic, gameplay-neutral
    // thank-you (e.g., a name badge) would be fine and would just need a
    // version bump to disclose.
    version: 1,
    title: "Supporting StackChips",
    body: [
      "Supporting StackChips is entirely optional and never required to play. Your Gold balance, odds, matchmaking, and everything else about how you play are identical whether or not you support us.",
      "A support payment -- one-time or monthly -- does not purchase or unlock Gold, and does not grant any competitive or economic advantage in any game. It is a gift to help cover running costs (hosting, and yes, dog treats for Loki and Finn), not a purchase of anything in-game.",
      "Monthly support is offered in a few tiers (currently $2.99, $5.99, and $9.99 per month, in the currency Stripe charges you) and renews automatically each month until you cancel. You can cancel at any time from your account; canceling stops future renewals and does not affect a charge already made.",
      "Support payments are processed by Stripe, our payment processor. We never see or store your card details. Payments are final and non-refundable except where required by law, including the current month of a subscription you cancel partway through.",
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
  if (slug === "privacy_policy") return "/legal/privacy";
  if (slug === "support_disclosure") return "/legal/support";
  return "/legal/disclaimer";
}
