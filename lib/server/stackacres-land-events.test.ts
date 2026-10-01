import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { farmBoardEntry } from "@/lib/stackacres/farm-board";
import { LAND_OBSTACLES, LAND_OBSTACLE_DEFS } from "@/lib/stackacres/land-clearing";
import { ensureProfile } from "./profile-store";
import { readStackAcres, workStackAcresLand } from "./stackacres-service";
import { __resetStackAcresForTest } from "./stackacres-store";

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
