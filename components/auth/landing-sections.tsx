"use client";

import Link from "next/link";
import {
  Bot,
  Coins,
  Facebook,
  Instagram,
  KeyRound,
  Linkedin,
  Lock,
  Spade,
  Timer,
  Trophy,
  Users,
  Youtube,
} from "lucide-react";

/**
 * Everything on the signed-out landing page below the sign-in block.
 *
 * Kept out of AccountEntryCard on purpose: that component owns the auth state
 * machine and is what the e2e suite drives, so marketing copy changing under
 * it should never risk the entry flow.
 */

/**
 * The signup offer, in one place.
 *
 * Deliberately a lone constant with a comment on it: every *other* price in
 * the app is resolved from Stripe at request time rather than hardcoded (see
 * app/api/stripe/tiers/route.ts), so this is the one number that can drift out
 * of sync with what a player is actually charged. If the Stripe catalogue
 * changes, this line has to change with it.
 */
const SIGNUP_OFFER = "$1.99 for 1,000,000 Gold — one per new signup";

/**
 * Product features, not testimonials.
 *
 * The wireframe sketched these cells as quoted praise with a name and face
 * attached. Those would have to be invented, and invented reviews with
 * invented people behind them are not something to ship on a live product --
 * so the grid keeps its shape and carries claims that are true of the build
 * instead. Swap in real quotes once there are real quotes to use.
 */
const FEATURES = [
  {
    icon: Lock,
    title: "The deck never reaches your browser",
    body: "Shuffling, dealing and every hole card stay server-side. Nothing that decides a hand is something a client could read or change.",
  },
  {
    icon: Users,
    title: "Six-max no-limit Hold’em",
    body: "Proper ring mechanics: blinds, side pots, all-in protection and no-limit re-raise rules that behave the way they should.",
  },
  {
    icon: Spade,
    title: "Sit down as a guest",
    body: "No account needed to play a hand. Attach your Gold, avatar and collection to a real account whenever you feel like it.",
  },
  {
    icon: Timer,
    title: "A shot clock, and a way out",
    body: "Turn timers keep hands moving, and three time cards per seat buy you an extra twenty seconds when the decision is worth it.",
  },
  {
    icon: Bot,
    title: "Bots that actually fold",
    body: "Empty seats are played by opponents with distinct styles, so a short table still plays like poker instead of like a calling contest.",
  },
  {
    icon: KeyRound,
    title: "Private tables for your table",
    body: "Open a room, share the six-character code, and everyone lands on the same felt. No lobby hunting.",
  },
] as const;

const FOOTER_COLUMNS = [
  {
    heading: "Play",
    links: [
      { label: "Quick play", href: "/" },
      { label: "Leaderboard", href: "/leaderboard" },
      { label: "Private tables", href: "/" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Collection", href: "/collection" },
      { label: "Gold store", href: "/store" },
      { label: "Leaderboard season", href: "/leaderboard" },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Contact us", href: "mailto:support@stackchips.app" },
      { label: "Buy Gold", href: "/store" },
      { label: "Your collection", href: "/collection" },
    ],
  },
] as const;

const SOCIALS = [
  { label: "StackChips on Facebook", href: "https://www.facebook.com/", Icon: Facebook },
  { label: "StackChips on LinkedIn", href: "https://www.linkedin.com/", Icon: Linkedin },
  { label: "StackChips on YouTube", href: "https://www.youtube.com/", Icon: Youtube },
  { label: "StackChips on Instagram", href: "https://www.instagram.com/", Icon: Instagram },
] as const;

export function LandingSections({
  onPrimary,
  primaryDisabled,
}: {
  onPrimary: () => void;
  primaryDisabled: boolean;
}) {
  return (
    <>
      <section className="landing-features" aria-labelledby="landing-features-title">
        <h2 id="landing-features-title">Features</h2>
        <div className="landing-feature-grid">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article className="landing-feature" key={title}>
              <span className="landing-feature-icon" aria-hidden="true"><Icon size={17} /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <p className="landing-offer">
        <Coins size={15} aria-hidden="true" />
        {SIGNUP_OFFER}
      </p>

      <section className="landing-cta" aria-labelledby="landing-cta-title">
        <div>
          <h2 id="landing-cta-title">Take a seat tonight</h2>
          <p>Six-max, real stakes in Gold, and a table that is already dealing.</p>
        </div>
        <div className="landing-cta-actions">
          {/* Deliberately not "Play as guest" -- the sign-in block above already
              has a button with that exact name, and two buttons sharing one
              accessible name are ambiguous to anyone navigating by button list
              (and collide with the e2e suite's role locators). */}
          <button type="button" className="landing-cta-primary" disabled={primaryDisabled} onClick={onPrimary}>
            Take a free seat
          </button>
          {/* A link, not a button: it navigates, so it should be openable in a
              new tab and announced as a link. */}
          <Link className="landing-cta-secondary" href="/leaderboard">
            <Trophy size={15} aria-hidden="true" /> See the leaderboard
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <span className="landing-footer-name">StackChips</span>
          <p>No-limit Hold’em, dealt server-side.</p>
          <ul className="landing-socials">
            {SOCIALS.map(({ label, href, Icon }) => (
              <li key={label}>
                <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label}>
                  <Icon size={15} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav className="landing-footer-column" key={column.heading} aria-label={column.heading}>
            <h3>{column.heading}</h3>
            <ul>
              {column.links.map((link) => (
                <li key={`${column.heading}-${link.label}`}>
                  {link.href.startsWith("mailto:")
                    ? <a href={link.href}>{link.label}</a>
                    : <Link href={link.href}>{link.label}</Link>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <p className="landing-footer-legal">
          StackChips Gold has no cash value and cannot be redeemed or withdrawn.
          This is a play-money game.
        </p>
      </footer>
    </>
  );
}
