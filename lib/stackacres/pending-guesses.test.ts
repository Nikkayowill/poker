import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  GuessClaims,
  guessClaims,
  layFarmField,
  overlayCounts,
  overlayEntities,
  takesNext,
  type FarmFields,
  type GuessBase,
  type GuessField,
  type LayMode,
} from "./pending-guesses";
import type { SoilTile } from "./soil";
import type { StackAcresUnitSnapshot } from "./units";

const NOW = new Date("2026-09-23T12:00:00.000Z");

function unit(id: string, overrides: Partial<StackAcresUnitSnapshot> = {}): StackAcresUnitSnapshot {
  return {
    id,
    state: "ready",
    stock: "carrot",
    stake: 25,
    yieldQuantity: 4,
    startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    readyAt: NOW.toISOString(),
    progress: 1,
    hungryAt: null,
    thirstyAt: null,
    isWatered: true,
    seed: false,
    muckFee: null,
    permanent: false,
    housedIn: null,
    soilSlot: null,
    ...overrides,
  };
}

function bed(tx: number, ty: number, order: number): SoilTile {
  return { tx, ty, order, origin: "purchased" };
}

function base(overrides: Partial<GuessBase> = {}): GuessBase {
  return {
    units: [],
    soilTiles: [],
    forageNodes: [],
    landObstacles: [],
    fences: [],
    seedStock: {},
    inventory: {},
    capacity: {},
    profile: null,
    ...overrides,
  };
}

/** A tiny farm screen with the three moves the component makes. */
class Screen {
  shown: Partial<FarmFields>;
  confirmed: Partial<FarmFields>;
  readonly claims = new GuessClaims();

  constructor(start: Partial<FarmFields>) {
    this.shown = { ...start };
    this.confirmed = { ...start };
  }

  private lay(fields: Partial<FarmFields>, mode: LayMode) {
    for (const field of Object.keys(fields) as GuessField[]) {
      const next = fields[field];
      const prev = this.shown[field];
      if (next === undefined || prev === undefined) continue;
      (this.shown as Record<GuessField, unknown>)[field] = layFarmField(field, prev as never, next as never, mode);
    }
  }

  guess(patch: Partial<FarmFields>): string[] {
    const keys = guessClaims(this.shown as GuessBase, patch);
    this.claims.claim(keys);
    this.lay(patch, { base: "prev", keys: new Set(keys) });
    return keys;
  }

  answer(data: Partial<FarmFields>, own: readonly string[] = []) {
    this.confirmed = { ...this.confirmed, ...data };
    this.lay(data, { base: "next", keys: this.claims.heldBesides(new Set(own)) });
  }

  settle(keys: readonly string[]) {
    const freed = this.claims.release(keys);
    this.lay(this.confirmed, { base: "prev", keys: freed });
  }
}

describe("guessClaims", () => {
  it("claims just the bed a hoe made, not the whole soil list", () => {
    const a = bed(0, 0, 1);
    const keys = guessClaims(base({ soilTiles: [a] }), { soilTiles: [a, bed(1, 0, 2)], cropFieldsUnlocked: true });
    expect(keys.sort()).toEqual(["cropFieldsUnlocked", "soilTiles:1,0"]);
  });

  it("claims a harvested crop and a spent seed by name", () => {
    const ripe = unit("c1");
    const other = unit("c2");
    expect(guessClaims(base({ units: [ripe, other] }), { units: [other] })).toEqual(["units:c1"]);
    expect(guessClaims(base({ seedStock: { carrot: 3, corn: 1 } }), { seedStock: { carrot: 2, corn: 1 } })).toEqual([
      "seedStock:carrot",
    ]);
  });

  it("claims Gold only when the balance moved", () => {
    const profile = { goldBalance: 100 } as PlayerProfile;
    expect(guessClaims(base({ profile }), { profile: { ...profile } })).toEqual([]);
    expect(guessClaims(base({ profile }), { profile: { ...profile, goldBalance: 90 } })).toEqual(["profile:gold"]);
  });
});

describe("overlay helpers", () => {
  it("replaces, drops and adds only the named entities", () => {
    const idOf = (e: { id: string; v: number }) => e.id;
    const onScreen = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
    const incoming = [{ id: "a", v: 2 }, { id: "d", v: 2 }];
    expect(overlayEntities(onScreen, incoming, idOf, new Set(["a", "b", "d"]))).toEqual([
      { id: "a", v: 2 },
      { id: "c", v: 1 },
      { id: "d", v: 2 },
    ]);
  });

  it("takes named counts, including a count that went away", () => {
    expect(overlayCounts({ carrot: 2, corn: 1 }, { carrot: 5 }, new Set(["carrot", "corn"]))).toEqual({ carrot: 5 });
  });

  it("hands back the same array when nothing changed", () => {
    const tiles = [bed(0, 0, 1)];
    const same = layFarmField("soilTiles", tiles, [bed(0, 0, 1)], { base: "next", keys: new Set() });
    expect(same).toBe(tiles);
  });

  it("decides whole fields by the mode", () => {
    expect(takesNext("water", { base: "next", keys: new Set() })).toBe(true);
    expect(takesNext("water", { base: "next", keys: new Set(["water"]) })).toBe(false);
    expect(takesNext("water", { base: "prev", keys: new Set(["water"]) })).toBe(true);
  });
});

describe("a farm with taps in the air", () => {
  it("keeps a second hoed bed when the first hoe's answer never saw it", () => {
    const screen = new Screen({ soilTiles: [] });
    const a = screen.guess({ soilTiles: [bed(0, 0, 1)] });
    const b = screen.guess({ soilTiles: [bed(0, 0, 1), bed(1, 0, 2)] });

    screen.answer({ soilTiles: [bed(0, 0, 1)] }, a);
    screen.settle(a);
    expect(screen.shown.soilTiles).toEqual([bed(0, 0, 1), bed(1, 0, 2)]);

    screen.answer({ soilTiles: [bed(0, 0, 1), bed(1, 0, 2)] }, b);
    screen.settle(b);
    expect(screen.shown.soilTiles).toEqual([bed(0, 0, 1), bed(1, 0, 2)]);
  });

  it("keeps a picked crop gone when a sibling's older answer still has it", () => {
    const ripe = unit("c1");
    const screen = new Screen({ units: [ripe], soilTiles: [] });
    const pick = screen.guess({ units: [] });
    const hoe = screen.guess({ soilTiles: [bed(3, 3, 1)] });

    screen.answer({ units: [ripe], soilTiles: [bed(3, 3, 1)] }, hoe);
    screen.settle(hoe);
    expect(screen.shown.units).toEqual([]);

    screen.answer({ units: [], soilTiles: [bed(3, 3, 1)] }, pick);
    screen.settle(pick);
    expect(screen.shown.units).toEqual([]);
  });

  it("undoes only the refused guess and leaves a sibling's standing", () => {
    const screen = new Screen({ soilTiles: [], seedStock: { carrot: 2 } });
    const refused = screen.guess({ soilTiles: [bed(0, 0, 1)] });
    screen.guess({ seedStock: { carrot: 1 } });

    screen.settle(refused);
    expect(screen.shown.soilTiles).toEqual([]);
    expect(screen.shown.seedStock).toEqual({ carrot: 1 });
  });

  it("falls back to the newer answer when its own answer lost the race", () => {
    const screen = new Screen({ soilTiles: [] });
    const hoe = screen.guess({ soilTiles: [bed(0, 0, 5)] });
    // A newer answer already carried the bed (with the order the server
    // actually gave it); this hoe's own answer was dropped as stale.
    screen.answer({ soilTiles: [bed(0, 0, 7)] });
    expect(screen.shown.soilTiles).toEqual([bed(0, 0, 5)]);
    screen.settle(hoe);
    expect(screen.shown.soilTiles).toEqual([bed(0, 0, 7)]);
  });

  it("holds a thing two guesses share until both let go", () => {
    const claims = new GuessClaims();
    claims.claim(["units:c1"]);
    claims.claim(["units:c1", "water"]);
    expect(claims.heldBesides(new Set(["units:c1"]))).toEqual(new Set(["units:c1", "water"]));
    expect(claims.release(["units:c1"])).toEqual(new Set());
    expect(claims.release(["units:c1", "water"])).toEqual(new Set(["units:c1", "water"]));
  });
});
