import { describe, expect, it } from "vitest";
import { TRAVELER_QUESTS } from "./quests";
import { TRAVELER_IDS } from "./travelers";
import { isCounterObjective, type StoryObjective } from "./quests";

/**
 * A quest may only ask for something the live farm can actually do.
 *
 * Two ways that broke before. Ray's first quest wanted new soil beds, which
 * the server refuses until the Crop Fields are bought, so his line could never
 * start. Barnaby and Leo wanted irrigation pipes, which no control in the
 * top-down farm can place at all, so the finale behind them was unreachable.
 *
 * Both are the same mistake: an objective whose verb has no button. This test
 * is the list of verbs a player can actually perform. Adding a kind here is a
 * promise that something on the farm sends its event.
 */

/** Every objective kind a player can reach today. */
const REACHABLE: readonly StoryObjective["kind"][] = [
  "harvest",
  "harvest-any-crop",
  "collect-livestock",
  "water",
  "feed",
  "buy-feed",
  "process",
  "fish",
  "secret-zones",
  "clear-sector",
  "soil",
  "contracts",
  "forge",
  "crossbreed",
  "deliver",
  "hold-tool",
];

/**
 * Work a player can only finish once. These must NOT be counter objectives:
 * a counter only ticks while its quest is open, so doing the thing before the
 * quest was offered leaves nothing left to do and no way to finish. They are
 * read off the farm at turn-in instead (StoryFacts in ./state.ts).
 */
const ONCE_ONLY: readonly StoryObjective["kind"][] = [
  "clear-sector",
  "soil",
  "forge",
  "crossbreed",
];

describe("every quest asks for something reachable", () => {
  it("names only verbs the farm can perform", () => {
    for (const id of TRAVELER_IDS) {
      for (const quest of TRAVELER_QUESTS[id]) {
        for (const objective of quest.objectives) {
          expect(REACHABLE, `${quest.id} asks for "${objective.kind}"`).toContain(objective.kind);
        }
      }
    }
  });

  it("never asks for irrigation pipes, which nothing can place", () => {
    const kinds = TRAVELER_IDS.flatMap((id) =>
      TRAVELER_QUESTS[id].flatMap((quest) => quest.objectives.map((objective) => objective.kind)),
    );
    expect(kinds).not.toContain("pipes");
  });

  it("reads once-only work off the farm instead of counting it", () => {
    for (const kind of ONCE_ONLY) {
      expect(
        isCounterObjective({ kind, target: 1 } as StoryObjective),
        `"${kind}" is counted, so finishing it early would strand the quest`,
      ).toBe(false);
    }
  });

  it("has Ray open the Crop Fields, so the land is never a 15,000 Gold wall", () => {
    const opens = TRAVELER_IDS.flatMap((id) =>
      TRAVELER_QUESTS[id].filter((quest) => quest.opensCropFields).map((quest) => quest.id),
    );
    // Exactly one quest may hand over the land, or "who opens this" has no
    // single answer.
    expect(opens).toEqual(["ray.q3"]);
  });

  it("gives Ray a first quest a brand-new farm can finish", () => {
    // Six free starter beds, a watering can and 3 Gold wheat is the whole of
    // a new farm. Watering is the only verb all of that supports.
    const first = TRAVELER_QUESTS.ray[0];
    expect(first.objectives).toHaveLength(1);
    expect(first.objectives[0].kind).toBe("water");
  });
});
