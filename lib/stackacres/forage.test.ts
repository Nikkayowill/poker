import { describe, expect, it } from "vitest";

import { STACKACRES_CATALOGUE } from "./catalogue";
import {
  FORAGE_CROPS,
  FORAGE_NODE_IDS,
  FORAGE_REGROW_MS,
  FORAGE_SEEDS_PER_PICK,
  forageCrop,
  forageNodeSnapshot,
  forageYieldLabel,
  freshForageNodeState,
  isForageNodeId,
  isForageNodeReady,
  pickForageNode,
  type ForageNodeState,
} from "./forage";

const NOW = new Date("2026-09-21T12:00:00.000Z");

describe("forage nodes", () => {
  it("only knows the four Homestead bushes", () => {
    expect(FORAGE_NODE_IDS).toHaveLength(4);
    expect(isForageNodeId("homestead-1")).toBe(true);
    expect(isForageNodeId("homestead-9")).toBe(false);
    expect(isForageNodeId("tree:homestead-1")).toBe(false);
  });

  it("forages tier-1 crops only", () => {
    // Anything dearer than a tier-1 seed belongs in Ray's shop, where Gold
    // buys it -- see the file header.
    for (const crop of FORAGE_CROPS) {
      expect(STACKACRES_CATALOGUE[crop].seedCost).toBe(1);
    }
  });

  it("gives the four bushes four different seeds on a fresh farm", () => {
    const carried = FORAGE_NODE_IDS.map((id) => forageCrop(id, 0));
    expect(new Set(carried).size).toBe(4);
  });

  it("walks a bush through every crop as it is picked", () => {
    const seen = new Set(FORAGE_CROPS.map((_, step) => forageCrop("homestead-1", step)));
    expect(seen.size).toBe(FORAGE_CROPS.length);
  });

  it("carries the same seed for the same pick count, every time", () => {
    // What makes a retry safe: the answer is a function of stored state, not
    // of when it is asked.
    expect(forageCrop("homestead-3", 5)).toBe(forageCrop("homestead-3", 5));
  });

  it("folds a negative pick count back into range instead of throwing", () => {
    expect(FORAGE_CROPS).toContain(forageCrop("homestead-2", -4));
  });
});

describe("picking", () => {
  it("pays the seed the bush was carrying, not the next one", () => {
    const state: ForageNodeState = { picks: 2, pickedAt: null };
    const picked = pickForageNode("homestead-1", state, NOW);
    expect(picked?.crop).toBe(forageCrop("homestead-1", 2));
    expect(picked?.quantity).toBe(FORAGE_SEEDS_PER_PICK);
  });

  it("advances the bush and starts its regrow clock", () => {
    const picked = pickForageNode("homestead-1", freshForageNodeState(), NOW);
    expect(picked?.nextState).toEqual({ picks: 1, pickedAt: NOW.toISOString() });
  });

  it("refuses a bush picked a moment ago", () => {
    const justPicked: ForageNodeState = { picks: 1, pickedAt: NOW.toISOString() };
    expect(pickForageNode("homestead-1", justPicked, NOW)).toBeNull();
    const soon = new Date(NOW.getTime() + FORAGE_REGROW_MS - 1);
    expect(pickForageNode("homestead-1", justPicked, soon)).toBeNull();
  });

  it("carries seed again once the regrow window has run out", () => {
    const justPicked: ForageNodeState = { picks: 1, pickedAt: NOW.toISOString() };
    const later = new Date(NOW.getTime() + FORAGE_REGROW_MS);
    expect(isForageNodeReady(justPicked, later)).toBe(true);
    expect(pickForageNode("homestead-1", justPicked, later)?.crop).toBe(
      forageCrop("homestead-1", 1),
    );
  });

  it("treats an unparseable timestamp as ready rather than stranding the bush", () => {
    // Same call `isWoodNodeChoppable` makes on an unreadable `felledAt`: a
    // row nobody can date is worked, not locked away forever.
    expect(isForageNodeReady({ picks: 1, pickedAt: "not a date" }, NOW)).toBe(true);
  });
});

describe("snapshots", () => {
  it("reports an untouched bush as ready with no respawn clock", () => {
    const snapshot = forageNodeSnapshot("homestead-2", freshForageNodeState(), NOW);
    expect(snapshot).toEqual({
      nodeId: "homestead-2",
      ready: true,
      crop: forageCrop("homestead-2", 0),
      respawnProgress: null,
    });
  });

  it("reports how far a picked bush has come back", () => {
    const picked: ForageNodeState = { picks: 1, pickedAt: NOW.toISOString() };
    const halfway = new Date(NOW.getTime() + FORAGE_REGROW_MS / 2);
    const snapshot = forageNodeSnapshot("homestead-2", picked, halfway);
    expect(snapshot.ready).toBe(false);
    expect(snapshot.respawnProgress).toBeCloseTo(0.5);
    // Already showing what it will carry when it comes back.
    expect(snapshot.crop).toBe(forageCrop("homestead-2", 1));
  });
});

describe("labels", () => {
  it("pluralises the seed count", () => {
    expect(forageYieldLabel("radish", 1)).toBe("1 Radish seed");
    expect(forageYieldLabel("radish", 2)).toBe("2 Radish seeds");
  });
});
