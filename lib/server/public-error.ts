/**
 * What a player is allowed to read when a route fails.
 *
 * Services throw plain `Error`s for two different things: refusals we wrote for
 * the player ("Not enough Gold.") and faults that carry database or code text
 * ("Could not spend Gold: relation ... does not exist"). Routes used to send
 * `error.message` either way, so schema errors reached the screen. This keeps
 * the first kind, trims the second back to our own words, and falls back to
 * the route's plain message for anything else. The real error is logged.
 */

/** Words that only show up in database, network or code errors. */
const INTERNAL_TEXT =
  /\b(relation|column|constraint|violates|syntax|duplicate key|null value|PGRST\w*|JWT|schema|function|rpc|row-level|permission denied|returned no row|undefined|null|NaN|fetch failed|ECONN\w*|ETIMEDOUT|uuid)\b/i;

/** Built-in error types only come from bugs, never from a refusal we wrote. */
const CODE_ERRORS = new Set(["TypeError", "RangeError", "SyntaxError", "ReferenceError", "ZodError"]);

/** The player-safe version of a thrown message, or null when none of it is safe to show. */
export function playerFacingMessage(raw: string): string | null {
  // "Could not spend Gold: <database text>" keeps the part we wrote.
  const head = raw.split(": ")[0].trim();
  if (!head.includes(" ")) return null;
  const sentence = /[.!?]$/.test(head) ? head : `${head}.`;
  if (sentence.length > 140) return null;
  if (!/^[A-Z]/.test(sentence)) return null;
  if (/[_{}<>`[\]=|\\/\n]|\(\)/.test(sentence)) return null;
  if (INTERNAL_TEXT.test(sentence)) return null;
  return sentence;
}

/** The message a route should send for a caught error. */
export function publicErrorMessage(error: unknown, fallback: string): string {
  const safe = error instanceof Error && !CODE_ERRORS.has(error.name) ? playerFacingMessage(error.message) : null;
  if (safe === null || (error instanceof Error && safe !== error.message)) {
    console.error(error);
  }
  return safe ?? fallback;
}
