import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACRES,
  ACRE_NOT_YOURS,
  ACRE_TREELINE,
  ACRE_UPKEEP_GOLD,
  LOOSE_WILD_TILES,
  acreAtMapTile,
  acreById,
  acreGate,
  acreGateMessage,
  acrePrice,
  acreUpkeepFee,
  acresView,
  boughtAcreCount,
  isAcreId,
} from "./acres";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH, HOMESTEAD_WILD_ROWS } from "./homestead-ground";
import { isWildMapTile } from "./hoeable";

function wildTiles(): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < HOMESTEAD_MAP_HEIGHT; ty += 1) {
    for (let tx = 0; tx < HOMESTEAD_MAP_WIDTH; tx += 1) if (isWildMapTile(tx, ty)) out.push({ tx, ty });
  }
  return out;
}

describe("the acre list", () => {
  it("has unique ids the database check accepts", () => {
    expect(new Set(ACRES.map((acre) => acre.id)).size).toBe(ACRES.length);
    for (const acre of ACRES) expect(acre.id).toMatch(/^[A-Z][0-9]{1,2}$/);
  });

  it("never overlaps and stays on the map", () => {
    const seen = new Set<string>();
    for (const acre of ACRES) {
      expect(acre.tx).toBeGreaterThanOrEqual(0);
      expect(acre.ty).toBeGreaterThanOrEqual(0);
      expect(acre.tx + acre.width).toBeLessThanOrEqual(HOMESTEAD_MAP_WIDTH);
      expect(acre.ty + acre.height).toBeLessThanOrEqual(HOMESTEAD_MAP_HEIGHT);
      for (let ty = acre.ty; ty < acre.ty + acre.height; ty += 1) {
        for (let tx = acre.tx; tx < acre.tx + acre.width; tx += 1) {
          const key = `${tx},${ty}`;
          expect(seen.has(key), `${acre.id} overlaps at ${key}`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it("covers every wild tile except the loose ones", () => {
    const loose = new Set(LOOSE_WILD_TILES.map((tile) => `${tile.tx},${tile.ty}`));
    const uncovered = wildTiles().filter((tile) => !acreAtMapTile(tile.tx, tile.ty) && !loose.has(`${tile.tx},${tile.ty}`));
    expect(uncovered).toEqual([]);
    for (const tile of LOOSE_WILD_TILES) {
      expect(isWildMapTile(tile.tx, tile.ty)).toBe(true);
      expect(acreAtMapTile(tile.tx, tile.ty)).toBeNull();
    }
  });

  it("gives every acre enough wild ground to be worth buying", () => {
    for (const acre of ACRES) {
      const wild = wildTiles().filter((tile) => acreAtMapTile(tile.tx, tile.ty)?.id === acre.id).length;
      expect(wild, acre.id).toBeGreaterThanOrEqual(20);
    }
  });

  it("looks acres up by id", () => {
    expect(acreById("W1")?.id).toBe("W1");
    expect(acreById("nope")).toBeNull();
    expect(isAcreId("S20")).toBe(true);
    expect(isAcreId("S21")).toBe(false);
    expect(isAcreId(7)).toBe(false);
  });
});

describe("the migration's copy of the map", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261001204826_stackacres_acres.sql"), "utf8");

  it("holds the same acre rectangles", () => {
    const rects = [...sql.matchAll(/\('([A-Z]\d+)', (\d+), (\d+), (\d+), (\d+)\)/g)].map((m) => ({
      id: m[1],
      tx: Number(m[2]),
      ty: Number(m[3]),
      width: Number(m[4]),
      height: Number(m[5]),
    }));
    expect(rects).toEqual(ACRES.map((acre) => ({ id: acre.id, tx: acre.tx, ty: acre.ty, width: acre.width, height: acre.height })));
  });

  it("holds the same wild rows", () => {
    const rows = new Map([...sql.matchAll(/\((\d+), '([01]{64})'\)/g)].map((m) => [Number(m[1]), m[2]]));
    HOMESTEAD_WILD_ROWS.forEach((row, y) => {
      if (row.includes("1")) expect(rows.get(y), `row ${y}`).toBe(row);
      else expect(rows.has(y), `row ${y}`).toBe(false);
    });
  });
});

describe("who may build where", () => {
  const west = ACRES[0];
  const wildInWest = wildTiles().find((tile) => acreAtMapTile(tile.tx, tile.ty)?.id === west.id);
  const yard = (() => {
    for (let ty = 0; ty < HOMESTEAD_MAP_HEIGHT; ty += 1) {
      for (let tx = 0; tx < HOMESTEAD_MAP_WIDTH; tx += 1) if (!isWildMapTile(tx, ty) && !acreAtMapTile(tx, ty)) return { tx, ty };
    }
    throw new Error("no yard");
  })();

  it("lets anyone build off the wild land", () => {
    expect(acreGate(yard.tx, yard.ty, new Set())).toEqual({ ok: true });
  });

  it("asks for the deed on wild ground that is not owned", () => {
    const gate = acreGate(wildInWest!.tx, wildInWest!.ty, new Set());
    expect(gate).toMatchObject({ ok: false, reason: "not_owned" });
    if (!gate.ok) expect(acreGateMessage(gate)).toBe(ACRE_NOT_YOURS);
  });

  it("lets a farm build on an acre it owns, and only that acre", () => {
    expect(acreGate(wildInWest!.tx, wildInWest!.ty, new Set([west.id]))).toEqual({ ok: true });
    const other = wildTiles().find((tile) => acreAtMapTile(tile.tx, tile.ty)?.id === ACRES[1].id)!;
    expect(acreGate(other.tx, other.ty, new Set([west.id]))).toMatchObject({ ok: false, reason: "not_owned" });
  });

  it("calls a wild tile in no acre the treeline", () => {
    const loose = LOOSE_WILD_TILES[0];
    const gate = acreGate(loose.tx, loose.ty, new Set(ACRES.map((acre) => acre.id)));
    expect(gate).toEqual({ ok: false, reason: "treeline" });
    if (!gate.ok) expect(acreGateMessage(gate)).toBe(ACRE_TREELINE);
  });
});

describe("price and upkeep", () => {
  it("starts cheap and climbs on every axis", () => {
    const first = acrePrice(0);
    expect(first).toEqual({ gold: 300, wood: 15, stone: 8 });
    let previous = first;
    for (let owned = 1; owned < ACRES.length; owned += 1) {
      const next = acrePrice(owned);
      expect(next.gold).toBeGreaterThan(previous.gold);
      expect(next.wood).toBeGreaterThan(previous.wood);
      expect(next.stone).toBeGreaterThan(previous.stone);
      previous = next;
    }
  });

  it("rounds Gold to the nearest 50", () => {
    for (let owned = 0; owned < ACRES.length; owned += 1) expect(acrePrice(owned).gold % 50).toBe(0);
  });

  it("treats a nonsense count as none owned", () => {
    expect(acrePrice(-3)).toEqual(acrePrice(0));
    expect(acrePrice(Number.NaN)).toEqual(acrePrice(0));
  });

  it("bills bought acres a flat fee and grandfathered ones nothing", () => {
    const owned = [
      { id: "W1", source: "bought" as const },
      { id: "W2", source: "bought" as const },
      { id: "W3", source: "grandfathered" as const },
    ];
    expect(boughtAcreCount(owned)).toBe(2);
    expect(acreUpkeepFee(owned)).toBe(2 * ACRE_UPKEEP_GOLD);
    expect(acreUpkeepFee([])).toBe(0);
  });

  it("prices the next acre off everything owned, grandfathered too, and runs out", () => {
    const view = acresView([
      { id: "W2", source: "grandfathered" },
      { id: "W1", source: "bought" },
    ]);
    expect(view.owned).toEqual(["W1", "W2"]);
    expect(view.price).toEqual(acrePrice(2));
    expect(view.upkeepEach).toBe(ACRE_UPKEEP_GOLD);
    expect(acresView(ACRES.map((acre) => ({ id: acre.id, source: "bought" as const }))).price).toBeNull();
  });
});
