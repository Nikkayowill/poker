"use client";

import Link from "next/link";
import {
  Bot,
  Brain,
  CalendarDays,
  Club,
  Coins,
  Diamond,
  Facebook,
  Grid3x3,
  Instagram,
  KeyRound,
  Linkedin,
  Lock,
  Spade,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { ARCADE_GAMES, arcadeEntryLabel } from "@/lib/arcade/games";
import { InstallCta } from "@/components/pwa/install-cta";
import { StackChipsLogo } from "@/components/brand/stackchips-logo";

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
 * Icons for the arcade catalogue.
 *
 * Keyed off ArcadeGameId and looked up rather than stored on the game itself:
 * lib/arcade/games.ts is pure data reachable by `npm test`, and putting a
 * React component reference in it would drag lucide into everything that
 * imports the catalogue -- including the server-side wallet predicates.
 */
const GAME_ICONS: Record<string, LucideIcon> = {
  "blackjack-21": Spade,
  "daily-wordle": Grid3x3,
  connections: Brain,
  "hi-lo": TrendingUp,
  "video-poker": Club,
  "roulette-wheel": Diamond,
  "daily-sudoku": Grid3x3,
  "memory-match": Brain,
  baccarat: Diamond,
  "coin-flip": Coins,
};

/**
 * The headline game, which is not in ARCADE_GAMES.
 *
 * Hold'em is the table the whole app is built around, not a row in the
 * arcade catalogue -- it has no `entryCost` (buy-ins come off TIER_CONFIG's
 * ladder, five tiers deep) and no single href. So it is stated here rather
 * than smuggled into that list, where it would have to lie about both.
 */
const HEADLINE_GAME = {
  name: "Six-Max Hold’em",
  blurb: "Server-dealt no-limit ring games, five buy-in tiers",
  stake: "250 – 5,000",
} as const;

/**
 * Product features, not testimonials.
 *
 * The wireframe sketched these cells as quoted praise with a name and face
 * attached. Those would have to be invented, and invented reviews with
 * invented people behind them are not something to ship on a live product --
 * so the grid keeps its shape and carries claims that are true of the build
 * instead. Swap in real quotes once there are real quotes to use.
 *
 * Every claim below is checkable against the code, which is the bar: the
 * server-side deck one is lib/game/engine.ts plus each game's `to*Snapshot`
 * redaction, the odds one is HI_LO_HOUSE_EDGE in lib/arcade/hi-lo.ts, the
 * one-wallet one is that every arcade service settles through spendGold /
 * creditGold on the same profile.
 */
const FEATURES = [
  {
    icon: Lock,
    title: "The deck never reaches your browser",
    body: "Shuffling, dealing and every hole card stay server-side — the wire payload has no deck field at all. Nothing that decides a hand is something a client could read or change.",
  },
  {
    icon: Coins,
    title: "One wallet, every game",
    body: "Gold you win at the poker table stakes a blackjack shoe or a Hi-Lo call. No per-game currencies, no conversion, no second balance to top up.",
  },
  {
    icon: TrendingUp,
    title: "Odds derived, never invented",
    body: "Hi-Lo prices every call off the cards actually left in the deck and shows you the multiplier before you commit. A 3% house edge, quoted up front, on a table you can check.",
  },
  {
    icon: CalendarDays,
    title: "Free daily puzzles",
    body: "Wordle and Connections, one fresh board a day for everybody, no Gold staked. Play them, share the grid, and keep your streak beside your chip count.",
  },
  {
    icon: Bot,
    title: "Bots that actually fold",
    body: "Empty seats are played by opponents with distinct styles — a rock, a maniac, a calling station — so a short table still plays like poker instead of like a calling contest.",
  },
  {
    icon: Timer,
    title: "A shot clock, and a way out",
    body: "Turn timers keep hands moving, and three time cards per seat buy you an extra twenty seconds when the decision is worth it.",
  },
  {
    icon: Users,
    title: "Friends, and a seat beside them",
    body: "Add players you met at the table, see who is online, and pull them onto your felt without either of you hunting through a lobby.",
  },
  {
    icon: KeyRound,
    title: "Private tables for your table",
    body: "Open a room, share the six-character code, and everyone lands on the same felt. The code never leaves the server in an invite, so it cannot be forwarded on.",
  },
  {
    icon: Spade,
    title: "Sit down as a guest",
    body: "No account needed to play a hand. Attach your Gold, avatar and collection to a real account whenever you feel like it.",
  },
] as const;

const FOOTER_COLUMNS = [
  {
    heading: "Play",
    links: [
      { label: "Quick play", href: "/" },
      { label: "Blackjack 21", href: "/games/blackjack" },
      { label: "Hi-Lo", href: "/games/hi-lo" },
      { label: "Daily Wordle", href: "/games/wordle" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Collection", href: "/collection" },
      { label: "Gold store", href: "/store" },
      { label: "Leaderboard", href: "/leaderboard" },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Contact us", href: "mailto:support@stackchips.app" },
      { label: "Buy Gold", href: "/store" },
      { label: "Connections", href: "/games/connections" },
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
  // Live games lead; the rest are shown as what they honestly are. A hub
  // blurb must not promise a mechanic the table lacks -- see the note on
  // Hi-Lo's blurb in lib/arcade/games.ts -- and a landing page must not
  // promise a game that has no route behind it.
  const live = ARCADE_GAMES.filter((game) => game.status === "live");
  const soon = ARCADE_GAMES.filter((game) => game.status !== "live");

  return (
    <>
      <InstallCta />

      <section className="landing-games" aria-labelledby="landing-games-title">
        <div className="landing-section-head">
          <h2 id="landing-games-title">The floor</h2>
          <p>{live.length + 1} games live now, {soon.length} more dealing in.</p>
        </div>

        <div className="landing-game-grid">
          {/* The headline tile spans two columns: Hold'em is the house game,
              not one of ten equals. */}
          <article className="landing-game landing-game-headline">
            <span className="landing-game-icon" aria-hidden="true"><Club size={20} /></span>
            <div className="landing-game-body">
              <h3>{HEADLINE_GAME.name}</h3>
              <p>{HEADLINE_GAME.blurb}</p>
            </div>
            <span className="landing-game-stake">
              <Coins size={13} aria-hidden="true" /> {HEADLINE_GAME.stake}
            </span>
          </article>

          {live.map((game) => {
            const Icon = GAME_ICONS[game.id] ?? Club;
            return (
              <article className="landing-game" key={game.id}>
                <span className="landing-game-icon" aria-hidden="true"><Icon size={18} /></span>
                <div className="landing-game-body">
                  <h3>{game.name}</h3>
                  <p>{game.blurb}</p>
                </div>
                <span className={game.kind === "puzzle" ? "landing-game-stake is-free" : "landing-game-stake"}>
                  {game.kind === "puzzle"
                    ? "Free daily"
                    : <><Coins size={13} aria-hidden="true" /> {arcadeEntryLabel(game)}</>}
                </span>
              </article>
            );
          })}
        </div>

        <ul className="landing-soon" aria-label="Coming soon">
          {soon.map((game) => (
            <li key={game.id}>{game.name}</li>
          ))}
        </ul>
      </section>

      <section className="landing-features" aria-labelledby="landing-features-title">
        <div className="landing-section-head">
          <h2 id="landing-features-title">Why this table</h2>
          <p>Everything below is true of the build, not of the pitch.</p>
        </div>
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
          <StackChipsLogo size={96} className="landing-footer-logo" />
          <p>High roller arcade. Poker, tables and puzzles, dealt server-side.</p>
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
