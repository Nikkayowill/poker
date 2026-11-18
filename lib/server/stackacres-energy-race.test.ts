import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AXE_SWING_ENERGY } from "@/lib/stackacres/axe";
import { ENERGY_MAX } from "@/lib/stackacres/energy";
import { LAND_OBSTACLES, LAND_OBSTACLE_DEFS, LAND_SWING_ENERGY } from "@/lib/stackacres/land-clearing";
import { WOOD_NODE_IDS } from "@/lib/stackacres/tree-nodes";
import { ensureProfile } from "./profile-store";
import { StackAcresRequestError, chopStackAcresWoodTree, workStackAcresLand } from "./stackacres-service";
import { __resetStackAcresForTest, readStackAcresEnergy, writeStackAcresEnergy } from "./stackacres-store";

/**
 * Swings that reach the server together, which is what a weak phone
 * connection does when it lets go of a queue of taps at once. Each spends
 * energy through the same version-guarded row, so they collide.
 */

vi.mock("./stackacres-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stackacres-store")>();
  return { ...actual, writeStackAcresEnergy: vi.fn(actual.writeStackAcresEnergy) };
});

const REAL_WRITE = vi.mocked(writeStackAcresEnergy).getMockImplementation()!;

const T0 = new Date("2026-10-05T15:00:00.000Z");

beforeEach(() => {
  __resetStackAcresForTest();
  vi.mocked(writeStackAcresEnergy).mockImplementation(REAL_WRITE);
});

async function farmer() {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  return { token, id: profile.id };
}

/** Lets the first `allowed` energy writes land and loses every one after. */
function energyWritesLostAfter(allowed: number) {
  let landed = 0;
  vi.mocked(writeStackAcresEnergy).mockImplementation(async (...args) => {
    if (landed >= allowed) return false;
    landed += 1;
    return REAL_WRITE(...args);
  });
}

describe("swings that arrive together", () => {
  it("lands six swings at six different things, and spends energy for each", async () => {
    const { token, id } = await farmer();
    const obstacles = LAND_OBSTACLES.cropfields.slice(0, 6);
    const swings = await Promise.allSettled(obstacles.map((obstacle) => workStackAcresLand(token, obstacle.id, T0)));
    expect(swings.filter((swing) => swing.status === "rejected")).toEqual([]);
    expect((await readStackAcresEnergy(id))?.level).toBe(ENERGY_MAX - 6 * LAND_SWING_ENERGY);
  });

  it("lands four trees chopped at once", async () => {
    const { token, id } = await farmer();
    const chops = await Promise.allSettled(WOOD_NODE_IDS.slice(0, 4).map((tree) => chopStackAcresWoodTree(token, tree, T0)));
    expect(chops.filter((chop) => chop.status === "rejected")).toEqual([]);
    expect((await readStackAcresEnergy(id))?.level).toBe(ENERGY_MAX - 4 * AXE_SWING_ENERGY);
  });

  it("refuses quietly when the energy never gets written, with the farm to repaint", async () => {
    const { token, id } = await farmer();
    energyWritesLostAfter(0);
    const refused = await workStackAcresLand(token, LAND_OBSTACLES.cropfields[0].id, T0).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(StackAcresRequestError);
    const error = refused as StackAcresRequestError;
    expect(error.status).toBe(409);
    expect(error.message).not.toBe("That moved on.");
    expect(error.round).toBeDefined();
    expect(await readStackAcresEnergy(id)).toBeNull();
  });
});

describe("a swing that misses", () => {
  it("answers a chop at a stump even when its energy refund is lost", async () => {
    const { token } = await farmer();
    const tree = WOOD_NODE_IDS[0];
    for (let swing = 0; swing < 3; swing += 1) await chopStackAcresWoodTree(token, tree, T0);
    energyWritesLostAfter(1);
    const miss = await chopStackAcresWoodTree(token, tree, T0);
    expect(miss.woodChopped).toBeNull();
  });

  it("answers a swing at cleared ground even when its energy refund is lost", async () => {
    const { token } = await farmer();
    const tree = LAND_OBSTACLES.cropfields.find((obstacle) => obstacle.kind === "tree")!;
    for (let swing = 0; swing < LAND_OBSTACLE_DEFS.tree.hits; swing += 1) await workStackAcresLand(token, tree.id, T0);
    energyWritesLostAfter(1);
    const miss = await workStackAcresLand(token, tree.id, T0);
    expect(miss.landCleared).toBeNull();
  });
});
