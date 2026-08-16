import Link from "next/link";

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What is Gold, and can I cash it out?",
    a: "Gold is StackChips' in-app currency. It has no cash value: no hand you play and no amount of Gold you hold can be exchanged for real money, cryptocurrency, or any other prize.",
  },
  {
    q: "I'm out of Gold. How do I get more?",
    a: (
      <>
        A few ways, all reachable from the lobby: daily and weekly{" "}
        <Link href="/challenges">Challenges</Link> credit Gold automatically on
        completion, the player menu offers a daily Gold grant (bigger the more
        days in a row you claim it) and a short rewarded-ad option a few times
        a day, and if your balance drops below the cheapest table&rsquo;s buy-in the
        lobby offers a one-time recovery top-up. Buying Gold directly is also
        always optional, never required to play.
      </>
    ),
  },
  {
    q: "Are the other seats at my table real people?",
    a: "Not necessarily — any seat that isn't held by another player is filled by a computer-controlled opponent, following the same rules and betting limits as everyone else, with no view of your cards and no advantage.",
  },
  {
    q: "What are duels?",
    a: "Head-to-head games — Chess, Checkers, Trivia Showdown, Word Race — where both players stake Gold and the winner takes the whole pot. Nothing is taken by the house.",
  },
  {
    q: "Does supporting StackChips get me anything in the game?",
    a: (
      <>
        No. A support payment on the <Link href="/store">Support page</Link> is
        a voluntary gift toward running costs — it never touches your Gold
        balance, odds, or matchmaking.
      </>
    ),
  },
  {
    q: "I'm playing as a guest. Will I lose my progress?",
    a: "A guest profile lives only in the browser you're using. Sign in from the lobby to carry your Gold, avatar, and collection to an account so a cleared browser can't take them with it.",
  },
];

/** The Help / FAQ / Contact page. Reuses the /legal shell, same as About. */
export function HelpPage() {
  return (
    <main className="legal-page">
      <header className="legal-page-header">
        <div>
          <p className="legal-page-kicker">StackChips · Help</p>
          <h1>Questions, answered.</h1>
        </div>
        <Link className="legal-page-back" href="/">Back to StackChips</Link>
      </header>

      <article className="legal-page-document">
        <dl className="info-faq-list">
          {FAQ.map(({ q, a }) => (
            <div className="info-faq-item" key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>

        <p>
          Didn&rsquo;t find it here? Email{" "}
          <a href="mailto:support@stackchips.app">support@stackchips.app</a> and
          a person will answer.
        </p>
      </article>
    </main>
  );
}
