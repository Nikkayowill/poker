import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { farmBoardEntry } from "@/lib/stackacres/farm-board";
import { LAND_OBSTACLES, LAND_OBSTACLE_DEFS } from "@/lib/stackacres/land-clearing";
import { ORE_PER_BREAK } from "@/lib/stackacres/stone-nodes";
import { ensureProfile } from "./profile-store";
import { readStackAcres, workStackAcresLand } from "./stackacres-service";
import { __resetStackAcresForTest, readStackAcresInventory } from "./stackacres-store";

const T0 = new Date("2026-10-01T12:00:00.000Z");
const objectiveOf = (code: string) => farmBoardEntry(code)?.objective.kind;

/** A farm whose board drew a line for `kind`, found by trying new farms: the draw depends on the profile. */
async function farmWithLine(kind: "chop" | "mine") {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const token = randomUUID();
    await ensureProfile(token);
    const line = (await readStackAcres(token, T0)).farmBoard.lines.find((l) => objectiveOf(l.code) === kind);
    if (line) return { token, code: line.code };
  }
  throw new Error(`no farm drew a ${kind} line`);
}

async function breakOne(token: string, kind: "tree" | "boulder") {
  const obstacle = LAND_OBSTACLES.cropfields.find((o) => o.kind === kind)!;
  for (let swing = 0; swing < LAND_OBSTACLE_DEFS[kind].hits; swing += 1) await workStackAcresLand(token, obstacle.id, T0);
}

describe("clearing land moves the farm board", () => {
  beforeEach(() => __resetStackAcresForTest());

  it("counts the Wood from a felled tree toward a chop line", async () => {
    const { token, code } = await farmWithLine("chop");
    await breakOne(token, "tree");
    const line = (await readStackAcres(token, T0)).farmBoard.lines.find((l) => l.code === code)!;
    expect(line.progress).toBeGreaterThan(0);
  });

  it("counts the Stone from a broken boulder toward a mine line", async () => {
    const { token, code } = await farmWithLine("mine");
    await breakOne(token, "boulder");
    const line = (await readStackAcres(token, T0)).farmBoard.lines.find((l) => l.code === code)!;
    expect(line.progress).toBeGreaterThan(0);
  });
});

describe("Iron Ore from the wild land", () => {
  beforeEach(() => __resetStackAcresForTest());

  async function farm() {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    return { token, id: profile.id };
  }

  it("pays ore for the swing that breaks a boulder, and shows it in the answer", async () => {
    const { token, id } = await farm();
    const boulder = LAND_OBSTACLES.cropfields.find((o) => o.kind === "boulder")!;
    const hits = LAND_OBSTACLE_DEFS.boulder.hits;
    for (let swing = 0; swing < hits - 1; swing += 1) {
      const result = await workStackAcresLand(token, boulder.id, T0);
      expect(result.landCleared?.ore).toBe(0);
    }
    expect((await readStackAcresInventory(id)).iron_ore ?? 0).toBe(0);
    const last = await workStackAcresLand(token, boulder.id, T0);
    expect(last.landCleared).toMatchObject({ cleared: true, ore: ORE_PER_BREAK });
    expect((await readStackAcresInventory(id)).iron_ore).toBe(ORE_PER_BREAK);
  });

  it("pays no ore for a tree", async () => {
    const { token, id } = await farm();
    await breakOne(token, "tree");
    expect((await readStackAcresInventory(id)).iron_ore ?? 0).toBe(0);
  });

  it("pays once, not again for a boulder that is already down", async () => {
    const { token, id } = await farm();
    const boulder = LAND_OBSTACLES.cropfields.find((o) => o.kind === "boulder")!;
    for (let swing = 0; swing < LAND_OBSTACLE_DEFS.boulder.hits; swing += 1) await workStackAcresLand(token, boulder.id, T0);
    await workStackAcresLand(token, boulder.id, T0);
    expect((await readStackAcresInventory(id)).iron_ore).toBe(ORE_PER_BREAK);
  });
});
