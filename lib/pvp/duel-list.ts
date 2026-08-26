/**
 * The four duels, for pickers that let a caller start one against someone
 * specific: the friends drawer's Challenge select and the table's own
 * challenge-this-seat control.
 *
 * NOT sourced from lib/pvp/registry.ts, since that index pulls in every
 * engine, and trivia's and word-race's carry `import "server-only"`
 * question/word banks (see lib/pvp/trivia-questions.ts). Both callers are
 * client components, and importing the registry here would ship both banks
 * into the browser bundle the same way Word Race's once did before that file
 * existed. Each /games/* page still hardcodes its own id and title
 * separately for the same reason: this is the one shared list for the two
 * places that need all four at once.
 */
export const CHALLENGEABLE_DUELS: readonly { id: string; label: string }[] = [
  { id: "chess", label: "Chess" },
  { id: "checkers", label: "Checkers" },
  { id: "trivia", label: "Trivia Showdown" },
  { id: "word-race", label: "Word Race" },
];
