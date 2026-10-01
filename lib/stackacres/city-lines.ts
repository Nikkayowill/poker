/**
 * What the City says when a tap lands on something with no story yet.
 * Buildings say they are closed and townsfolk pass the time of day, so a tap
 * is never met with silence. Nothing here promises a feature.
 */

const CLOSED: Readonly<Record<string, string>> = {
  inn: "The inn isn't open yet.",
  tailor: "The tailor isn't open yet.",
  bakery: "The bakery isn't open yet.",
  markethall: "The market hall isn't open yet.",
  chapel: "The chapel is quiet.",
  mill: "The mill isn't running.",
  millrow: "The mill isn't running.",
  crane: "Nobody is working the crane.",
  cross: "Just a crossroads.",
  stall: "This stall is empty.",
};

const GREETINGS: readonly string[] = [
  "Fine day for it.",
  "Morning. Busy out on the farm?",
  "Good to see a new face.",
  "Mind the bridge on your way back.",
];

/** The line for a tapped City building, or null when the tag has none. */
export function cityBuildingLine(kind: string): string | null {
  return CLOSED[kind] ?? null;
}

/** A townsperson's greeting, the same one every time for the same person. */
export function cityGreeting(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return GREETINGS[hash % GREETINGS.length];
}
