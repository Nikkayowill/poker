import Link from "next/link";

/**
 * The one-paragraph "who's behind this" page. Reuses the /legal shell
 * (35-legal.css) rather than inventing a second plain-page layout -- this is
 * the same register, a reference page nobody is meant to decode, not another
 * product surface.
 */
export function AboutPage() {
  return (
    <main className="legal-page">
      <header className="legal-page-header">
        <div>
          <p className="legal-page-kicker">StackChips · About</p>
          <h1>A poker room, not a casino floor.</h1>
        </div>
        <Link className="legal-page-back" href="/">Back to StackChips</Link>
      </header>

      <article className="legal-page-document">
        <p>
          StackChips is a six-max Texas Hold&rsquo;em table, played with Gold — an
          in-app currency that has no cash value and can&rsquo;t be exchanged for
          any. Alongside the table, head-to-head duels (Chess, Checkers, Trivia
          Showdown, Word Race) let two players stake Gold against each other
          directly, winner takes the pot, with nothing taken off the top.
        </p>
        <p>
          Every game on StackChips is skill or social — there&rsquo;s no roulette
          wheel, no slots, no pure chance dressed up as a game. That&rsquo;s a
          deliberate line, not an oversight.
        </p>
        <p>
          StackChips is operated from Nova Scotia, Canada. If you&rsquo;d like to
          support the project, one-time and monthly options are on the{" "}
          <Link href="/store">Support page</Link> — they&rsquo;re a gift toward
          running costs, and grant nothing in-game. If you have a question we
          haven&rsquo;t answered, <Link href="/help">Help</Link> is the fastest
          way to reach us.
        </p>
      </article>
    </main>
  );
}
