import Link from "next/link";

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
 * 43-site-info.css, since 35-legal.css only ever styled a flat run of <p>s.
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
            clockwise as each hand ends. Every player buys in with Gold and
            plays the stack in front of them — there&rsquo;s no reaching into your
            balance mid-hand.
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
            On any street, a player can fold out of the hand, call the current
            bet, or raise it. A hand can also end early — everyone but one
            player folds, and the pot goes to whoever&rsquo;s left without a
            showdown.
          </p>
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
        </section>
      </article>
    </main>
  );
}
