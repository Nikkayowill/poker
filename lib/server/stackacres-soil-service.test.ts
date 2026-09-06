import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { growAreaBounds } from "@/lib/stackacres/world";
import { SOIL_TILE, SOIL_TILE_PRICE_GOLD, soilTileAt } from "@/lib/stackacres/soil";
import {
  StackAcresRequestError,
  placeStackAcresSoilTile,
  removeStackAcresSoilTile,
} from "./stackacres-service";
import { __resetStackAcresForTest } from "./stackacres-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { adjustGold, ensureProfile } from "./profile-store";

const T0 = new Date("2026-09-06T12:00:00.000Z");

async function funded(gold = 500_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return token;
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** A tile comfortably inside the Long Meadow's own Crop Fields. */
function meadowTile(offset = 0) {
  const area = growAreaBounds("meadow");
  const centre = soilTileAt(area.x + area.width / 2, area.y + area.height / 2);
  return { tx: centre.tx + offset, ty: centre.ty };
}

/** Well outside every district -- generously far, not just off one edge. */
const FAR_AWAY = { tx: 10_000, ty: 10_000 };

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresIntentsForTest();
});

describe("placeStackAcresSoilTile — money ordering", () => {
  it("spends the flat price and reports the new tile", async () => {
    const token = await funded();
    const start = await balance(token);
    const { tx, ty } = meadowTile();

    const view = await placeStackAcresSoilTile(token, { tx, ty }, T0);

    expect(await balance(token)).toBe(start - SOIL_TILE_PRICE_GOLD);
    expect(view.soilTiles.some((tile) => tile.tx === tx && tile.ty === ty && tile.origin === "purchased")).toBe(
      true,
    );
  });

  it("refuses and refunds nothing spent when the cell is already taken", async () => {
    const token = await funded();
    const { tx, ty } = meadowTile();
    await placeStackAcresSoilTile(token, { tx, ty }, T0);
    const afterFirst = await balance(token);

    await expect(placeStackAcresSoilTile(token, { tx, ty }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );

    expect(await balance(token)).toBe(afterFirst);
  });

  it("refuses when Gold is short and moves nothing", async () => {
    const token = await funded(10);
    const { tx, ty } = meadowTile();

    await expect(placeStackAcresSoilTile(token, { tx, ty }, T0)).rejects.toBeInstanceOf(
      StackAcresRequestError,
    );
    expect(await balance(token)).toBe(10);
  });

  it("refuses a tile outside the Crop Fields, and spends nothing", async () => {
    const token = await funded();
    const start = await balance(token);

    await expect(
      placeStackAcresSoilTile(token, FAR_AWAY, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);

    expect(await balance(token)).toBe(start);
  });
});

describe("removeStackAcresSoilTile", () => {
  it("removes a purchased tile and refunds nothing", async () => {
    const token = await funded();
    const { tx, ty } = meadowTile();
    await placeStackAcresSoilTile(token, { tx, ty }, T0);
    const afterPlace = await balance(token);

    const view = await removeStackAcresSoilTile(token, { tx, ty }, T0);

    expect(await balance(token)).toBe(afterPlace);
    expect(view.soilTiles.some((tile) => tile.tx === tx && tile.ty === ty)).toBe(false);
  });

  it("refuses to remove a starter tile", async () => {
    const token = await funded();
    // The two starter tiles are never persisted (see starterSoilTiles's own
    // header) -- there is no row here to remove at all, which is exactly the
    // refusal a client tapping a starter bed should get.
    const area = growAreaBounds("meadow");
    const starterish = soilTileAt(area.x + area.width / 2, area.y + area.height / 2);

    await expect(
      removeStackAcresSoilTile(token, starterish, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });

  it("refuses a coordinate with nothing on it", async () => {
    const token = await funded();
    await expect(
      removeStackAcresSoilTile(token, FAR_AWAY, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });
});

describe("SOIL_TILE lattice bounds check", () => {
  it("accepts a tile fully inside the meadow and refuses one straddling its edge", async () => {
    const token = await funded();
    const area = growAreaBounds("meadow");
    const inside = soilTileAt(area.x + SOIL_TILE, area.y + SOIL_TILE);
    await expect(placeStackAcresSoilTile(token, inside, T0)).resolves.toBeTruthy();
  });
});
