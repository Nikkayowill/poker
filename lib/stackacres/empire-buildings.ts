/**
 * The buildings a player buys and places on the Far Field (the "empire" area), and where one may go.
 *
 * A building is bought once, with Gold, Wood and Metal. After that it is the player's: moving it,
 * picking it up and putting it back down are free. A picked-up building waits in storage (tx/ty null)
 * until it is placed again.
 *
 * The same check runs in the browser (to paint the green or red squares while placing) and on the
 * server (which has the final say). A building stands on a rectangle of tiles and may not cover the
 * map's own walls, trees and rocks, another building, or the way in over the bridge. Every building's
 * door has to stay reachable on foot from the bridge, so nobody can wall themselves or a door in.
 *
 * Gold enters nowhere here. It leaves once per building, on purchase (lib/server/stackacres-service.ts).
 */

import area from "@/public/stackacres-td/areas/empire/area.json";
import type { MaterialCost } from "./machine-items";

// The grocery is not here on purpose: it stands in the city, already running, and is bought through its
// manager (docs/stackacres-second-map-direction.md). The Far Field is for farm and industry buildings.
export const EMPIRE_BUILDING_KINDS = ["barn"] as const;
export type EmpireBuildingKind = (typeof EMPIRE_BUILDING_KINDS)[number];

export interface EmpireBuildingDef {
  label: string;
  /** One line for the build tray. */
  blurb: string;
  gold: number;
  materials: readonly MaterialCost[];
  /** Ground plan in tiles: `w` across, `h` deep. A placed building's (tx, ty) is the plan's top-left tile. */
  w: number;
  h: number;
  /** The door's column within the plan. The square in front of it, just below the plan, must stay open. */
  doorDx: number;
}

// Prices are a first pass for the economy tuning to revisit (docs/stackacres-second-map-direction.md).
export const EMPIRE_BUILDINGS: Readonly<Record<EmpireBuildingKind, EmpireBuildingDef>> = {
  barn: {
    label: "Barn",
    blurb: "Stores the harvest until it's hauled to market.",
    gold: 6000,
    materials: [
      { item: "wood", quantity: 60 },
      { item: "metal", quantity: 10 },
    ],
    w: 7,
    h: 6,
    doorDx: 3,
  },
};

export function isEmpireBuildingKind(value: string): value is EmpireBuildingKind {
  return (EMPIRE_BUILDING_KINDS as readonly string[]).includes(value);
}

export interface EmpireBuilding {
  id: string;
  kind: EmpireBuildingKind;
  /** Top-left tile of the plan, or null while it sits in storage. */
  tx: number | null;
  ty: number | null;
}

/** The Far Field's own HUD numbers and buildings, as the server sends them. */
export interface EmpireSnapshot {
  wood: number;
  wheat: number;
  workers: number;
  /** The shared inventory's Metal, which buildings cost alongside Wood and Gold. */
  metal: number;
  /** Every building the player owns there, placed or in storage. */
  buildings: EmpireBuilding[];
}

export const EMPTY_EMPIRE: EmpireSnapshot = { wood: 0, wheat: 0, workers: 0, metal: 0, buildings: [] };

export interface PlacedEmpireBuilding extends EmpireBuilding {
  tx: number;
  ty: number;
}

export function isPlaced(building: EmpireBuilding): building is PlacedEmpireBuilding {
  return building.tx !== null && building.ty !== null;
}

export interface Tile {
  tx: number;
  ty: number;
}

const key = (tx: number, ty: number) => `${tx},${ty}`;

export function buildingTiles(kind: EmpireBuildingKind, tx: number, ty: number): Tile[] {
  const { w, h } = EMPIRE_BUILDINGS[kind];
  const tiles: Tile[] = [];
  for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) tiles.push({ tx: x, ty: y });
  return tiles;
}

/** The square in front of the door. */
export function doorTile(kind: EmpireBuildingKind, tx: number, ty: number): Tile {
  const def = EMPIRE_BUILDINGS[kind];
  return { tx: tx + def.doorDx, ty: ty + def.h };
}

/** The Far Field's own walk grid: its size, and what its walls, trees and rocks already take up. */
export const EMPIRE_MAP = (() => {
  const blocked = new Set<string>();
  for (const [tx, ty] of area.blocked) blocked.add(key(tx, ty));
  for (const prop of area.props) for (const [tx, ty] of prop.blocks) blocked.add(key(tx, ty));
  // The way in over the bridge, and a square round where you land: never built on.
  const keepClear = new Set<string>();
  const { tile } = area;
  const around = (x0: number, y0: number, x1: number, y1: number) => {
    for (let ty = Math.floor(y0 / tile) - 1; ty <= Math.floor((y1 - 1) / tile) + 1; ty++) {
      for (let tx = Math.floor(x0 / tile) - 1; tx <= Math.floor((x1 - 1) / tile) + 1; tx++) keepClear.add(key(tx, ty));
    }
  };
  for (const exit of area.exits) around(exit.x, exit.y, exit.x + exit.w, exit.y + exit.h);
  around(area.spawn.x - tile / 2, area.spawn.y - tile / 2, area.spawn.x + tile / 2, area.spawn.y + tile / 2);
  const spawn: Tile = { tx: Math.floor(area.spawn.x / tile), ty: Math.floor(area.spawn.y / tile) };
  return { width: area.width, height: area.height, tile, blocked, keepClear, spawn };
})();

/**
 * Which buildings stand where, as one string: placed buildings by id, `id:tx:ty` joined by commas. The server
 * checks the placement rules against the layout it read, then hands this to the database, which refuses the
 * write if the layout has changed since (place_empire_building's 'stale'). The database builds the same string.
 */
export function layoutFingerprint(buildings: readonly EmpireBuilding[]): string {
  return buildings
    .filter(isPlaced)
    .map((b) => ({ id: b.id, at: `${b.id}:${b.tx}:${b.ty}` }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((b) => b.at)
    .join(",");
}

export type PlacementProblem = "edge" | "blocked" | "bridge" | "overlap" | "door" | "path";

export const PLACEMENT_MESSAGES: Readonly<Record<PlacementProblem, string>> = {
  edge: "It doesn't fit there.",
  blocked: "Something's in the way.",
  bridge: "Keep the way to the bridge clear.",
  overlap: "Another building is there.",
  door: "Leave room in front of the door.",
  path: "That would block a door or you in.",
};

/**
 * Why `kind` can't go with its top-left at (tx, ty), or null when it can. `placed` is everything already
 * standing; `movingId` is the building being moved, which doesn't get in its own way. `alsoReach` are more
 * squares that must stay reachable from the bridge, as every door must (the browser passes the farmer's, so
 * nobody builds themselves into a corner; the server doesn't know where he stands).
 */
export function placementProblem(
  kind: EmpireBuildingKind,
  tx: number,
  ty: number,
  placed: readonly PlacedEmpireBuilding[],
  movingId: string | null = null,
  alsoReach: readonly Tile[] = [],
): PlacementProblem | null {
  const { width, height, blocked, keepClear, spawn } = EMPIRE_MAP;
  const others = placed.filter((building) => building.id !== movingId);
  const taken = new Set<string>();
  for (const other of others) for (const t of buildingTiles(other.kind, other.tx, other.ty)) taken.add(key(t.tx, t.ty));

  const tiles = buildingTiles(kind, tx, ty);
  const door = doorTile(kind, tx, ty);
  if (tiles.some((t) => t.tx < 0 || t.ty < 0 || t.tx >= width || t.ty >= height)) return "edge";
  if (door.ty >= height) return "edge";
  if (tiles.some((t) => keepClear.has(key(t.tx, t.ty)))) return "bridge";
  if (tiles.some((t) => blocked.has(key(t.tx, t.ty)))) return "blocked";
  if (tiles.some((t) => taken.has(key(t.tx, t.ty)))) return "overlap";
  if (blocked.has(key(door.tx, door.ty)) || taken.has(key(door.tx, door.ty))) return "door";

  // Every door, this one's and everyone else's, still reachable from the bridge.
  for (const t of tiles) taken.add(key(t.tx, t.ty));
  const reached = new Set<string>([key(spawn.tx, spawn.ty)]);
  const queue: Tile[] = [spawn];
  for (let head = 0; head < queue.length; head++) {
    const { tx: x, ty: y } = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || reached.has(k) || blocked.has(k) || taken.has(k)) continue;
      reached.add(k);
      queue.push({ tx: nx, ty: ny });
    }
  }
  const doors = [door, ...others.map((other) => doorTile(other.kind, other.tx, other.ty)), ...alsoReach];
  if (doors.some((d) => !reached.has(key(d.tx, d.ty)))) return "path";
  return null;
}
