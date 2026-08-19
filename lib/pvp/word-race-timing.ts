/**
 * Word Race's two clock constants, and nothing else.
 *
 * ## Why this is its own file
 *
 * The board needs these numbers to size its countdown, and importing them from
 * lib/pvp/word-race.ts -- which is where they were -- pulled that module into
 * the client bundle, and with it `./word-race-words`: all 478 words and their
 * hints, shipped to every player.
 *
 * That is not a size problem, it is the game. A player looking at a scramble
 * with the bank in memory does not have to unscramble anything; they open the
 * console and ask which entry is an anagram of what is on screen. The board's
 * own header says a component holding the answer "would put the whole game one
 * devtools breakpoint away" -- the bank made it a one-liner, and this file is
 * what makes that comment true.
 *
 * The bank is `server-only` now, which turns the mistake into a build failure
 * rather than a leak nobody notices. That is the same treatment
 * lib/pvp/trivia-questions.ts and lib/arcade/puzzles/word-stack-answers.ts get, and
 * it is why these two constants had to move somewhere a client may reach.
 *
 * Nothing else belongs here. A third constant that the board does not render
 * belongs beside the rules it governs, in word-race.ts.
 */

/**
 * How long a round runs before nobody wins it.
 *
 * A deadline rather than a target -- most rounds end well inside it. Its real
 * job is two stuck players, who must not be able to stall the match.
 */
export const WORD_RACE_ROUND_MS = 30_000;

/** How long the answer stays on screen between rounds. Also the only window in which the solution may leave the server. */
export const WORD_RACE_REVEAL_MS = 2_500;
