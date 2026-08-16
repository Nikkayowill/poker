import Link from "next/link";

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
          <ol>
            <li>Royal flush</li>
            <li>Straight flush</li>
            <li>Four of a kind</li>
            <li>Full house</li>
            <li>Flush</li>
            <li>Straight</li>
            <li>Three of a kind</li>
            <li>Two pair</li>
            <li>One pair</li>
            <li>High card</li>
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
