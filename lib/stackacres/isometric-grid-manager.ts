/**
 * IsometricGridManager: a cell-addressed placement layer for StackAcres.
 *
 * The world is a matrix of 64x32 diamond cells. Every placed thing (a 1x1
 * path stone, a 3x3 crop field, a 2x2 coop) owns a rectangle of whole cells
 * and one sprite anchored at that rectangle's near (south) corner. Because
 * placement is only ever in whole cells, two footprints that touch share an
 * edge exactly, which is what gives a village the packed, gap-free look of a
 * Hay Day or FarmVille 2 farm instead of a scatter of loose decals.
 *
 * Phaser is reached only through `SpriteFactory`: the manager asks the
 * factory for a sprite and then positions, sorts and destroys it through
 * the small `GridSprite` surface a `Phaser.GameObjects.Sprite` already
 * satisfies. `phaserSpriteFactory` binds a real scene; `stubSpriteFactory`
 * records plain objects so the grid math and occupancy rules test under
 * Vitest with no canvas, no textures and no Phaser runtime.
 *
 * Coordinates: `gridToScreen` returns the CENTER of a cell's diamond, and
 * cell (0, 0)'s center sits at `origin`. The projection is the same 2:1
 * shear as ./iso.ts (a +x step goes right and down, a +y step goes left and
 * down), scaled to a fixed pixel tile instead of world units. The pointer
 * side expects camera-adjusted points, so hand it `pointer.worldX/worldY`
 * from a scrolled Phaser camera, not the raw screen position.
 */

import type * as Phaser from "phaser";

export const ISO_TILE_WIDTH = 64;
export const ISO_TILE_HEIGHT = 32;
const HALF_W = ISO_TILE_WIDTH / 2;
const HALF_H = ISO_TILE_HEIGHT / 2;

export type CellOccupancy = "empty" | "path" | "building" | "crop";
export type PlaceableAssetType = Exclude<CellOccupancy, "empty">;

export interface GridCell {
  readonly x: number;
  readonly y: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A whole-cell rectangle: `x`/`y` is the north-most cell, sizes in cells. */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CellState {
  readonly occupancy: CellOccupancy;
  /** The ground key while empty; the owning asset's key once occupied. */
  readonly textureKey: string;
  /** Owning asset id, or null while empty. */
  readonly assetId: string | null;
}

/** Indexed `[gridY][gridX]`. */
export type GridMatrix = ReadonlyArray<ReadonlyArray<CellState>>;

/** The four projected corners of a footprint's diamond, in screen order. */
export interface FootprintCorners {
  readonly n: ScreenPoint;
  readonly e: ScreenPoint;
  readonly s: ScreenPoint;
  readonly w: ScreenPoint;
}

/**
 * One edge of a footprint's diamond, for laying a fence or a furrow along
 * it. `along` names the grid axis the edge runs parallel to, which is the
 * rotation a sprite drawn along that axis needs (see ISO_EDGE_ANGLE in
 * ./iso.ts).
 */
export interface FootprintEdge {
  readonly from: ScreenPoint;
  readonly to: ScreenPoint;
  readonly along: "x" | "y";
}

export interface FootprintEdges {
  readonly north: FootprintEdge;
  readonly east: FootprintEdge;
  readonly south: FootprintEdge;
  readonly west: FootprintEdge;
}

/**
 * What the manager needs from a sprite. `Phaser.GameObjects.Sprite`
 * satisfies this structurally; tests use `StubSprite`.
 */
export interface GridSprite {
  setPosition(x: number, y: number): this;
  setOrigin(x: number, y: number): this;
  setDepth(depth: number): this;
  destroy(): void;
}

export interface SpriteSpec {
  readonly assetId: string;
  readonly assetType: PlaceableAssetType;
  readonly textureKey: string;
  readonly footprint: Footprint;
  /** The south corner the sprite will be anchored to. */
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

export type SpriteFactory = (spec: SpriteSpec) => GridSprite;

export interface PlacedAsset {
  readonly id: string;
  readonly type: PlaceableAssetType;
  readonly textureKey: string;
  readonly footprint: Footprint;
  /** South corner of the footprint diamond; the sprite's (0.5, 1) origin. */
  readonly anchor: ScreenPoint;
  readonly depth: number;
  readonly sprite: GridSprite;
}

export type PlacementFailure = "invalid-size" | "out-of-bounds" | "overlap" | "duplicate-id";

export type PlacementCheck =
  | { readonly ok: true; readonly footprint: Footprint }
  | {
      readonly ok: false;
      readonly reason: PlacementFailure;
      /** Cells that refused the placement, for a red-tinted drag preview. */
      readonly blockingCells: readonly GridCell[];
    };

export type PlacementResult =
  | { readonly ok: true; readonly asset: PlacedAsset }
  | {
      readonly ok: false;
      readonly reason: PlacementFailure;
      readonly blockingCells: readonly GridCell[];
    };

export interface PlaceAssetOptions {
  /** Defaults to the asset type, which works as a stub texture name. */
  readonly textureKey?: string;
  /** Defaults to a manager-generated id. */
  readonly id?: string;
}

export interface IsometricGridOptions {
  readonly columns: number;
  readonly rows: number;
  /** Screen point of cell (0, 0)'s diamond center. Defaults to (0, 0). */
  readonly origin?: ScreenPoint;
  /** Texture key every empty cell reports. Defaults to "ground". */
  readonly groundTextureKey?: string;
  readonly createSprite: SpriteFactory;
}

/**
 * Paths are flat decals and always draw under anything standing on the
 * same ground, so they get their own band below crops and buildings. Inside
 * a band the south corner's screen y orders near over far.
 */
const DEPTH_BAND: Readonly<Record<PlaceableAssetType, number>> = {
  path: 0,
  crop: 1,
  building: 1,
};
const DEPTH_BAND_SPAN = 1_000_000;

const SPRITE_ORIGIN_X = 0.5;
const SPRITE_ORIGIN_Y = 1;

export class IsometricGridManager {
  readonly columns: number;
  readonly rows: number;
  readonly origin: ScreenPoint;
  readonly groundTextureKey: string;

  private readonly createSprite: SpriteFactory;
  private readonly cells: CellState[][];
  private readonly placed = new Map<string, PlacedAsset>();
  private nextId = 1;

  constructor(options: IsometricGridOptions) {
    if (!isPositiveInteger(options.columns) || !isPositiveInteger(options.rows)) {
      throw new RangeError("IsometricGridManager needs positive integer columns and rows");
    }
    this.columns = options.columns;
    this.rows = options.rows;
    this.origin = options.origin ?? { x: 0, y: 0 };
    this.groundTextureKey = options.groundTextureKey ?? "ground";
    this.createSprite = options.createSprite;
    this.cells = [];
    for (let y = 0; y < this.rows; y++) {
      const row: CellState[] = [];
      for (let x = 0; x < this.columns; x++) row.push(this.emptyCell());
      this.cells.push(row);
    }
  }

  // ---- Core grid math -------------------------------------------------

  /** Screen center of cell (gridX, gridY). Accepts fractional cells. */
  gridToScreen(gridX: number, gridY: number): ScreenPoint {
    return {
      x: this.origin.x + (gridX - gridY) * HALF_W,
      y: this.origin.y + (gridX + gridY) * HALF_H,
    };
  }

  /** Exact inverse of `gridToScreen`, unrounded. */
  screenToGridExact(pointerX: number, pointerY: number): ScreenPoint {
    const fx = (pointerX - this.origin.x) / HALF_W;
    const fy = (pointerY - this.origin.y) / HALF_H;
    return { x: (fy + fx) / 2, y: (fy - fx) / 2 };
  }

  /**
   * The cell whose diamond contains the pointer, or null when the pointer
   * is off the map. Rounding in grid space is exact containment here: a
   * cell's diamond is the image of the unit square around its center.
   */
  screenToGrid(pointerX: number, pointerY: number): GridCell | null {
    const exact = this.screenToGridExact(pointerX, pointerY);
    const cell = { x: Math.round(exact.x), y: Math.round(exact.y) };
    return this.isInside(cell.x, cell.y) ? cell : null;
  }

  /** Like `screenToGrid`, but an off-map pointer clamps to the edge cell. */
  nearestCell(pointerX: number, pointerY: number): GridCell {
    const exact = this.screenToGridExact(pointerX, pointerY);
    return {
      x: clamp(Math.round(exact.x), 0, this.columns - 1),
      y: clamp(Math.round(exact.y), 0, this.rows - 1),
    };
  }

  isInside(gridX: number, gridY: number): boolean {
    return gridX >= 0 && gridY >= 0 && gridX < this.columns && gridY < this.rows;
  }

  /** Projected corners of a footprint's ground diamond. */
  footprintCorners(footprint: Footprint): FootprintCorners {
    const x0 = footprint.x - 0.5;
    const y0 = footprint.y - 0.5;
    const x1 = x0 + footprint.width;
    const y1 = y0 + footprint.height;
    return {
      n: this.gridToScreen(x0, y0),
      e: this.gridToScreen(x1, y0),
      s: this.gridToScreen(x1, y1),
      w: this.gridToScreen(x0, y1),
    };
  }

  /** The four diamond edges, clockwise from the north corner. */
  footprintEdges(footprint: Footprint): FootprintEdges {
    const c = this.footprintCorners(footprint);
    return {
      north: { from: c.n, to: c.e, along: "x" },
      east: { from: c.e, to: c.s, along: "y" },
      south: { from: c.s, to: c.w, along: "x" },
      west: { from: c.w, to: c.n, along: "y" },
    };
  }

  /** Axis-aligned screen box of a footprint's ground diamond. */
  footprintBounds(footprint: Footprint): ScreenRect {
    const c = this.footprintCorners(footprint);
    return {
      x: c.w.x,
      y: c.n.y,
      width: c.e.x - c.w.x,
      height: c.s.y - c.n.y,
    };
  }

  // ---- State ----------------------------------------------------------

  get matrix(): GridMatrix {
    return this.cells;
  }

  get assets(): readonly PlacedAsset[] {
    return [...this.placed.values()];
  }

  getCell(gridX: number, gridY: number): CellState | undefined {
    return this.isInside(gridX, gridY) ? this.cells[gridY][gridX] : undefined;
  }

  getAsset(id: string): PlacedAsset | undefined {
    return this.placed.get(id);
  }

  assetAt(gridX: number, gridY: number): PlacedAsset | undefined {
    const id = this.getCell(gridX, gridY)?.assetId;
    return id === null || id === undefined ? undefined : this.placed.get(id);
  }

  // ---- Placement ------------------------------------------------------

  /**
   * Whether a footprint would fit. The anchor rounds to the nearest cell so
   * a fractional drag position snaps the same way `screenToGrid` does.
   */
  canPlace(gridX: number, gridY: number, widthInCells: number, heightInCells: number): PlacementCheck {
    if (!isPositiveInteger(widthInCells) || !isPositiveInteger(heightInCells)) {
      return { ok: false, reason: "invalid-size", blockingCells: [] };
    }
    const footprint: Footprint = {
      x: Math.round(gridX),
      y: Math.round(gridY),
      width: widthInCells,
      height: heightInCells,
    };
    const outside = this.footprintCells(footprint).filter((c) => !this.isInside(c.x, c.y));
    if (outside.length > 0) {
      return { ok: false, reason: "out-of-bounds", blockingCells: outside };
    }
    const taken = this.footprintCells(footprint).filter(
      (c) => this.cells[c.y][c.x].occupancy !== "empty",
    );
    if (taken.length > 0) {
      return { ok: false, reason: "overlap", blockingCells: taken };
    }
    return { ok: true, footprint };
  }

  /**
   * Snap an asset into whole cells, claim its footprint and create its
   * sprite. Refuses rather than nudges: a placement that would overlap or
   * hang off the map returns the blocking cells and changes nothing.
   */
  placeAsset(
    gridX: number,
    gridY: number,
    assetType: PlaceableAssetType,
    widthInCells: number,
    heightInCells: number,
    options: PlaceAssetOptions = {},
  ): PlacementResult {
    const check = this.canPlace(gridX, gridY, widthInCells, heightInCells);
    if (!check.ok) return check;

    const id = options.id ?? `asset-${this.nextId++}`;
    if (this.placed.has(id)) {
      return { ok: false, reason: "duplicate-id", blockingCells: [] };
    }
    const textureKey = options.textureKey ?? assetType;
    const footprint = check.footprint;
    const anchor = this.footprintCorners(footprint).s;
    const depth = DEPTH_BAND[assetType] * DEPTH_BAND_SPAN + anchor.y;

    const sprite = this.createSprite({
      assetId: id,
      assetType,
      textureKey,
      footprint,
      x: anchor.x,
      y: anchor.y,
      depth,
    });
    sprite.setOrigin(SPRITE_ORIGIN_X, SPRITE_ORIGIN_Y).setPosition(anchor.x, anchor.y).setDepth(depth);

    const asset: PlacedAsset = { id, type: assetType, textureKey, footprint, anchor, depth, sprite };
    for (const c of this.footprintCells(footprint)) {
      this.cells[c.y][c.x] = { occupancy: assetType, textureKey, assetId: id };
    }
    this.placed.set(id, asset);
    return { ok: true, asset };
  }

  /** Free the footprint and destroy the sprite. False if the id is unknown. */
  removeAsset(id: string): boolean {
    const asset = this.placed.get(id);
    if (!asset) return false;
    for (const c of this.footprintCells(asset.footprint)) {
      this.cells[c.y][c.x] = this.emptyCell();
    }
    this.placed.delete(id);
    asset.sprite.destroy();
    return true;
  }

  /**
   * The closest anchor to (gridX, gridY) where a footprint fits, searched
   * in rings out to `maxRadius` cells. What a drop onto an occupied spot
   * uses to slide into the nearest open slot flush against its neighbours.
   */
  findNearestPlacement(
    gridX: number,
    gridY: number,
    widthInCells: number,
    heightInCells: number,
    maxRadius = Math.max(this.columns, this.rows),
  ): GridCell | null {
    if (!isPositiveInteger(widthInCells) || !isPositiveInteger(heightInCells)) return null;
    const cx = Math.round(gridX);
    const cy = Math.round(gridY);
    for (let r = 0; r <= maxRadius; r++) {
      let best: GridCell | null = null;
      let bestDistance = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this.canPlace(x, y, widthInCells, heightInCells).ok) continue;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            best = { x, y };
            bestDistance = distance;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Destroy every sprite and reset the matrix to empty ground. */
  clear(): void {
    for (const id of [...this.placed.keys()]) this.removeAsset(id);
  }

  // ---- Internals ------------------------------------------------------

  private footprintCells(footprint: Footprint): GridCell[] {
    const out: GridCell[] = [];
    for (let y = footprint.y; y < footprint.y + footprint.height; y++) {
      for (let x = footprint.x; x < footprint.x + footprint.width; x++) {
        out.push({ x, y });
      }
    }
    return out;
  }

  private emptyCell(): CellState {
    return { occupancy: "empty", textureKey: this.groundTextureKey, assetId: null };
  }
}

// ---- Sprite factories ---------------------------------------------------

/** Binds the manager to a live scene. The only place Phaser is touched. */
export function phaserSpriteFactory(scene: Phaser.Scene): SpriteFactory {
  return (spec) => scene.add.sprite(spec.x, spec.y, spec.textureKey);
}

/** A recorded stand-in for a Phaser sprite, for tests and headless tools. */
export class StubSprite implements GridSprite {
  x = 0;
  y = 0;
  originX = 0.5;
  originY = 0.5;
  depth = 0;
  destroyed = false;

  constructor(readonly spec: SpriteSpec) {}

  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setOrigin(x: number, y: number): this {
    this.originX = x;
    this.originY = y;
    return this;
  }

  setDepth(depth: number): this {
    this.depth = depth;
    return this;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export interface StubSpriteFactory {
  readonly factory: SpriteFactory;
  /** Every sprite ever created, in creation order, destroyed ones included. */
  readonly sprites: readonly StubSprite[];
}

export function stubSpriteFactory(): StubSpriteFactory {
  const sprites: StubSprite[] = [];
  return {
    factory: (spec) => {
      const sprite = new StubSprite(spec);
      sprites.push(sprite);
      return sprite;
    },
    sprites,
  };
}

// ---- Helpers ------------------------------------------------------------

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
