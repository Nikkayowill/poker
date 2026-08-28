import Link from "next/link";
import { STAKES_TIERS, TIER_CONFIG } from "@/lib/game/tiers";

type RankingCard = { rank: string; suit: "♠" | "♥" | "♦" | "♣" };

const HAND_RANKINGS: Array<{ name: string; description: string; cards: RankingCard[] }> = [
  {
    name: "Royal flush",
    description: "A, K, Q, J, 10 — all in the same suit.",
    cards: [
      { rank: "A", suit: "♠" }, { rank: "K", suit: "♠" }, { rank: "Q", suit: "♠" },
      { rank: "J", suit: "♠" }, { rank: "10", suit: "♠" },
    ],
  },
  {
    name: "Straight flush",
    description: "Five cards in sequence, all in the same suit.",
    cards: [
      { rank: "9", suit: "♥" }, { rank: "8", suit: "♥" }, { rank: "7", suit: "♥" },
      { rank: "6", suit: "♥" }, { rank: "5", suit: "♥" },
    ],
  },
  {
    name: "Four of a kind",
    description: "Four cards of the same rank.",
    cards: [
      { rank: "7", suit: "♠" }, { rank: "7", suit: "♥" }, { rank: "7", suit: "♦" },
      { rank: "7", suit: "♣" }, { rank: "K", suit: "♠" },
    ],
  },
  {
    name: "Full house",
    description: "Three of a kind plus a pair.",
    cards: [
      { rank: "Q", suit: "♠" }, { rank: "Q", suit: "♥" }, { rank: "Q", suit: "♦" },
      { rank: "4", suit: "♣" }, { rank: "4", suit: "♠" },
    ],
  },
  {
    name: "Flush",
    description: "Five cards of the same suit, not in sequence.",
    cards: [
      { rank: "A", suit: "♥" }, { rank: "9", suit: "♥" }, { rank: "7", suit: "♥" },
      { rank: "4", suit: "♥" }, { rank: "2", suit: "♥" },
    ],
  },
  {
    name: "Straight",
    description: "Five cards in sequence, with any mix of suits.",
    cards: [
      { rank: "9", suit: "♠" }, { rank: "8", suit: "♥" }, { rank: "7", suit: "♦" },
      { rank: "6", suit: "♣" }, { rank: "5", suit: "♠" },
    ],
  },
  {
    name: "Three of a kind",
    description: "Three cards of the same rank.",
    cards: [
      { rank: "J", suit: "♠" }, { rank: "J", suit: "♦" }, { rank: "J", suit: "♣" },
      { rank: "8", suit: "♥" }, { rank: "3", suit: "♠" },
    ],
  },
  {
    name: "Two pair",
    description: "Two different pairs.",
    cards: [
      { rank: "A", suit: "♠" }, { rank: "A", suit: "♥" }, { rank: "9", suit: "♦" },
      { rank: "9", suit: "♣" }, { rank: "4", suit: "♠" },
    ],
  },
  {
    name: "One pair",
    description: "Two cards of the same rank.",
    cards: [
      { rank: "K", suit: "♠" }, { rank: "K", suit: "♥" }, { rank: "8", suit: "♦" },
      { rank: "5", suit: "♣" }, { rank: "2", suit: "♠" },
    ],
  },
  {
    name: "High card",
    description: "No combination — the highest card plays.",
    cards: [
      { rank: "A", suit: "♠" }, { rank: "Q", suit: "♥" }, { rank: "9", suit: "♦" },
      { rank: "7", suit: "♣" }, { rank: "4", suit: "♠" },
    ],
  },
];

/**
 * Rules reference, not a tutorial overlay -- a player looking this up already
 * has a table open in another tab. Reuses the /legal shell like About and
 * Help; the only addition is `.info-page-section h2`/`ol`/`ul` styling in
 * 47-site-info.css, since 35-legal.css only ever styled a flat run of <p>s.
 *
 * The blinds list renders straight from TIER_CONFIG rather than being typed
 * out, on purpose -- a static copy of the ladder is exactly the kind of
 * number that goes stale the next time a tier's blinds get retuned and
 * nobody remembers this page also has a copy of them.
 */
export function HowToPlayPage() {
  return (
    <main className="legal-page">
      <header className="legal-page-header">
        <div>
          <p className="legal-page-kicker">StackChips · How to Play</p>
          <h1>Texas Hold&rsquo;em, six-max.</h1>
        </div>
        <Link className="legal-page-back" href="/">Back to StackChips</Link>
      </header>

      <article className="legal-page-document">
        <section className="info-page-section">
          <h2>The table</h2>
          <p>
            Up to six players share a table. Two seats post the small and big
            blind automatically each hand, and the blinds rotate one seat
            clockwise as each hand ends — there&rsquo;s never an ante on top of
            them, at any stakes. Every player buys in with Gold and plays the
            stack in front of them — there&rsquo;s no reaching into your balance
            mid-hand.
          </p>
        </section>

        <section className="info-page-section">
          <h2>How a hand plays out</h2>
          <ol>
            <li><strong>Preflop</strong> — everyone gets two private hole cards; betting starts left of the big blind.</li>
            <li><strong>Flop</strong> — three shared community cards are dealt face up, then another round of betting.</li>
            <li><strong>Turn</strong> — a fourth community card, then betting.</li>
            <li><strong>River</strong> — the fifth and final community card, then a last round of betting.</li>
            <li><strong>Showdown</strong> — anyone still in makes their best five-card hand from their two hole cards and the five on the board; the best hand takes the pot.</li>
          </ol>
          <p>
            A hand can also end early — everyone but one player folds, and the
            pot goes to whoever&rsquo;s left without a showdown.
          </p>
        </section>

        <section className="info-page-section">
          <h2>Betting on each street</h2>
          <p>
            On your turn you&rsquo;ll always see only the actions that are
            actually legal to make:
          </p>
          <ul>
            <li><strong>Check</strong> — pass the action along without betting. Only available when nobody&rsquo;s bet yet this street.</li>
            <li><strong>Call</strong> — match the current bet to stay in.</li>
            <li><strong>Raise</strong> — increase the bet. A raise has to be at least as large as the last bet or raise on that street (the big blind, the first time a street sees one), so a raise can&rsquo;t be so small it&rsquo;s barely worth reacting to.</li>
            <li><strong>Fold</strong> — give up the hand and whatever you&rsquo;ve already put in the pot.</li>
            <li><strong>All-in</strong> — bet your entire remaining stack. If that&rsquo;s less than a full raise, it still gets you to showdown, but it doesn&rsquo;t reopen betting for anyone who&rsquo;s already acted this street — they can call it, but they can&rsquo;t raise again unless someone else makes a full-size raise first.</li>
          </ul>
        </section>

        <section className="info-page-section">
          <h2>All-in and side pots</h2>
          <p>
            Going all-in for less than the current bet doesn&rsquo;t end the hand
            for everyone else — it caps what you can win. Anyone who keeps
            betting past your stack is playing for a separate side pot you
            have no claim on; you can only win the portion of the pot that
            you and the players you&rsquo;re contesting it with both covered. With
            several players all-in for different amounts, the table can split
            into multiple pots this way, each awarded on its own — it&rsquo;s
            possible to lose the side pot and still win the main one, or the
            other way around.
          </p>
        </section>

        <section className="info-page-section">
          <h2>Blinds by stakes</h2>
          <p>Buy-in and blinds are fixed per table — pick a stakes level, and that&rsquo;s what you&rsquo;re playing.</p>
          <ul>
            {STAKES_TIERS.map((tier) => {
              const config = TIER_CONFIG[tier];
              return (
                <li key={tier}>
                  <strong>{config.label} Gold</strong> buy-in — {config.smallBlind.toLocaleString()} / {config.bigBlind.toLocaleString()} blinds
                </li>
              );
            })}
          </ul>
        </section>

        <section className="info-page-section">
          <h2>Busting and rebuying</h2>
          <p>
            Run your stack to zero and your seat sits out until you rebuy —
            the table keeps playing without you, so there&rsquo;s no rush. You
            can rebuy the moment the hand that busted you is actually decided
            (not mid-hand), and always for the same fixed buy-in the table
            started at. There&rsquo;s no way to buy Gold from the table itself; if
            you&rsquo;re short, the busted screen offers a one-time top-up when
            you&rsquo;re eligible for one, and <Link href="/rewards">every other
            way to earn Gold</Link> is one tap back to the lobby.
          </p>
        </section>

        <section className="info-page-section">
          <h2>Other ways to play</h2>
          <ul>
            <li>
              <strong>Heads-Up</strong> — you against one opponent, hand after
              hand, for a fixed buy-in with no rebuys and no bots. Bust and
              the match is over immediately; your opponent takes both stacks.
            </li>
            <li>
              <strong>Sit &amp; Go</strong> — a 6-max tournament for real
              registrants only. Entry fee doubles as your starting stack,
              blinds escalate on a fast turbo schedule to force a winner in
              roughly 30-50 hands, there are no rebuys, and it&rsquo;s
              winner-take-all across every seat&rsquo;s entry fee.
            </li>
          </ul>
        </section>

        <section className="info-page-section">
          <h2>Hand rankings, best to worst</h2>
          <p className="hand-ranking-intro">The examples below show the pattern to look for. Suits never break a tie in Hold&rsquo;em.</p>
          <ol className="hand-ranking-list">
            {HAND_RANKINGS.map((hand) => (
              <li className="hand-ranking-item" key={hand.name}>
                <div className="hand-ranking-cards" aria-label={`${hand.name} example`}>
                  {hand.cards.map((card, index) => (
                    <span className={`ranking-card ${card.suit === "♥" || card.suit === "♦" ? "ranking-card-red" : ""}`} key={`${card.rank}-${card.suit}-${index}`}>
                      <span>{card.rank}</span>
                      <span aria-hidden="true">{card.suit}</span>
                    </span>
                  ))}
                </div>
                <div className="hand-ranking-copy">
                  <strong>{hand.name}</strong>
                  <span>{hand.description}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="info-page-section">
          <h2>Duels</h2>
          <p>
            Outside the table, <Link href="/">head-to-head duels</Link> pit two
            players directly against each other: Chess, Checkers, Trivia
            Showdown, and Word Race. Both players stake Gold up front, and
            whoever wins takes the whole pot — the house never takes a cut.
          </p>
          <p>
            Cribbage runs alongside them on the same no-house-cut terms, but
            it&rsquo;s a 3-4 player free-for-all rather than a 1v1 challenge —
            everyone seated antes in, and whoever wins the race to 121 takes
            the whole table&rsquo;s pot.
          </p>
        </section>
      </article>
    </main>
  );
}
