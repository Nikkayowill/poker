import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPIRE_BUILDINGS, EMPIRE_MAP, isPlaced, placementProblem, type PlacedEmpireBuilding } from "@/lib/stackacres/empire-buildings";
import * as profileStore from "./profile-store";
import { adjustGold, ensureProfile, setUnlimitedGold } from "./profile-store";
import * as buildingStore from "./stackacres-empire-building-store";
import {
  __resetStackAcresEmpireBuildingsForTest,
  listEmpireBuildings,
  placeEmpireBuilding,
} from "./stackacres-empire-building-store";
import { layoutFingerprint } from "@/lib/stackacres/empire-buildings";
import {
  StackAcresRequestError,
  buyEmpireBuilding,
  pickUpOwnedEmpireBuilding,
  placeOwnedEmpireBuilding,
  readStackAcres,
} from "./stackacres-service";
import { __resetStackAcresForTest, adjustStackAcresInventory, readStackAcresInventory } from "./stackacres-store";

const T0 = new Date("2026-09-30T12:00:00Z");

async function player({ gold = 100_000, wood = 500, metal = 100 } = {}) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  await adjustGold(profile.id, gold - profile.goldBalance);
  if (wood) await adjustStackAcresInventory(profile.id, "wood", wood);
  if (metal) await adjustStackAcresInventory(profile.id, "metal", metal);
  return { token, id: profile.id };
}

async function purse(token: string, id: string) {
  const inventory = await readStackAcresInventory(id);
  return { gold: (await ensureProfile(token)).goldBalance, wood: inventory.wood ?? 0, metal: inventory.metal ?? 0 };
}

/** The first top-left tile where `kind` fits beside `placed`. */
function spot(kind: "barn", placed: PlacedEmpireBuilding[] = []): { tx: number; ty: number } {
  for (let ty = 0; ty < EMPIRE_MAP.height; ty++) {
    for (let tx = 0; tx < EMPIRE_MAP.width; tx++) if (placementProblem(kind, tx, ty, placed) === null) return { tx, ty };
  }
  throw new Error("no room");
}

vi.mock("./profile-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./profile-store")>();
  return { ...real, debitGoldByProfile: vi.fn(real.debitGoldByProfile), creditGoldByProfile: vi.fn(real.creditGoldByProfile) };
});
vi.mock("./stackacres-empire-building-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stackacres-empire-building-store")>();
  return { ...real, placeEmpireBuilding: vi.fn(real.placeEmpireBuilding) };
});
const REAL_PROFILES = await vi.importActual<typeof import("./profile-store")>("./profile-store");
const REAL_BUILDINGS = await vi.importActual<typeof import("./stackacres-empire-building-store")>("./stackacres-empire-building-store");

beforeEach(() => {
  vi.mocked(profileStore.debitGoldByProfile).mockImplementation(REAL_PROFILES.debitGoldByProfile);
  vi.mocked(profileStore.creditGoldByProfile).mockClear().mockImplementation(REAL_PROFILES.creditGoldByProfile);
  vi.mocked(buildingStore.placeEmpireBuilding).mockImplementation(REAL_BUILDINGS.placeEmpireBuilding);
  __resetStackAcresForTest();
  __resetStackAcresEmpireBuildingsForTest();
});

describe("Far Field buildings", () => {
  it("buying one takes its Gold, Wood and Metal and puts it down", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);
    const at = spot("barn");
    const view = await buyEmpireBuilding(token, { kind: "barn", ...at }, T0);
    const after = await purse(token, id);
    const def = EMPIRE_BUILDINGS.barn;
    expect(after.gold).toBe(before.gold - def.gold);
    expect(after.wood).toBe(before.wood - def.materials.find((m) => m.item === "wood")!.quantity);
    expect(after.metal).toBe(before.metal - def.materials.find((m) => m.item === "metal")!.quantity);
    expect(view.empire.buildings).toEqual([expect.objectContaining({ kind: "barn", ...at })]);
    expect(view.empire.metal).toBe(after.metal);
  });

  it("short on Metal, nothing is taken", async () => {
    const { token, id } = await player({ metal: 1 });
    const before = await purse(token, id);
    await expect(buyEmpireBuilding(token, { kind: "barn", ...spot("barn") }, T0)).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await purse(token, id)).toEqual(before);
    expect((await readStackAcres(token, T0)).empire.buildings).toHaveLength(0);
  });

  it("short on Gold, the Wood and Metal come back", async () => {
    const { token, id } = await player({ gold: 10 });
    const before = await purse(token, id);
    await expect(buyEmpireBuilding(token, { kind: "barn", ...spot("barn") }, T0)).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await purse(token, id)).toEqual(before);
  });

  it("a spot the rules refuse costs nothing", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);
    await expect(buyEmpireBuilding(token, { kind: "barn", tx: 0, ty: 0 }, T0)).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await purse(token, id)).toEqual(before);
  });

  it("won't let a second building stand on the first, and refunds it", async () => {
    const { token, id } = await player();
    const at = spot("barn");
    await buyEmpireBuilding(token, { kind: "barn", ...at }, T0);
    const before = await purse(token, id);
    await expect(buyEmpireBuilding(token, { kind: "barn", ...at }, T0)).rejects.toBeInstanceOf(StackAcresRequestError);
    expect(await purse(token, id)).toEqual(before);
  });

  it("moving, picking up and putting back down are free", async () => {
    const { token, id } = await player();
    const first = spot("barn");
    let view = await buyEmpireBuilding(token, { kind: "barn", ...first }, T0);
    const barn = view.empire.buildings[0];
    const before = await purse(token, id);

    const next = spot("barn", [{ ...barn, tx: first.tx, ty: first.ty, id: "elsewhere" }]);
    // Somewhere that isn't where it stands: the first fit with the barn itself in the way.
    view = await placeOwnedEmpireBuilding(token, { id: barn.id, ...next }, T0);
    expect(view.empire.buildings[0]).toMatchObject({ id: barn.id, ...next });

    view = await pickUpOwnedEmpireBuilding(token, { id: barn.id }, T0);
    expect(view.empire.buildings[0]).toMatchObject({ id: barn.id, tx: null, ty: null });
    expect(view.empire.buildings.filter(isPlaced)).toHaveLength(0);

    view = await placeOwnedEmpireBuilding(token, { id: barn.id, ...first }, T0);
    expect(view.empire.buildings[0]).toMatchObject({ id: barn.id, ...first });
    expect(await purse(token, id)).toEqual(before);
  });

  it("gives the Wood and Metal back when the Gold charge itself fails", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);
    vi.mocked(profileStore.debitGoldByProfile).mockRejectedValueOnce(new Error("network down"));
    await expect(buyEmpireBuilding(token, { kind: "barn", ...spot("barn") }, T0)).rejects.toThrow("network down");
    expect(await purse(token, id)).toEqual(before);
  });

  it("keeps the building and the charge when the write landed but its answer was lost", async () => {
    const { token, id } = await player();
    const before = await purse(token, id);
    vi.mocked(buildingStore.placeEmpireBuilding).mockImplementationOnce(async (...args) => {
      await REAL_BUILDINGS.placeEmpireBuilding(...args);
      throw new Error("timed out");
    });
    await buyEmpireBuilding(token, { kind: "barn", ...spot("barn") }, T0);
    expect((await listEmpireBuildings(id)).filter(isPlaced)).toHaveLength(1);
    const barn = EMPIRE_BUILDINGS.barn;
    const wood = barn.materials.find((m) => m.item === "wood")?.quantity ?? 0;
    const metal = barn.materials.find((m) => m.item === "metal")?.quantity ?? 0;
    expect(await purse(token, id)).toEqual({ gold: before.gold - barn.gold, wood: before.wood - wood, metal: before.metal - metal });
  });

  it("doesn't pay Gold back to an account that was never charged it", async () => {
    const { token, id } = await player();
    await setUnlimitedGold(id, true);
    const before = await purse(token, id);
    vi.mocked(buildingStore.placeEmpireBuilding).mockResolvedValueOnce("overlap");
    await expect(buyEmpireBuilding(token, { kind: "barn", ...spot("barn") }, T0)).rejects.toThrow();
    expect(profileStore.creditGoldByProfile).not.toHaveBeenCalled();
    expect(await purse(token, id)).toEqual(before);
  });

  it("the store refuses a write checked against a layout that has since changed", async () => {
    const { token, id } = await player();
    const at = spot("barn");
    const stale = layoutFingerprint(await listEmpireBuildings(id));
    await buyEmpireBuilding(token, { kind: "barn", ...at }, T0);
    const elsewhere = spot("barn", (await listEmpireBuildings(id)).filter(isPlaced));
    expect(await placeEmpireBuilding(id, null, "barn", elsewhere.tx, elsewhere.ty, stale)).toBe("stale");
    const fresh = layoutFingerprint(await listEmpireBuildings(id));
    expect(await placeEmpireBuilding(id, null, "barn", elsewhere.tx, elsewhere.ty, fresh)).toMatchObject({ placed: expect.any(String) });
  });

  it("won't move someone else's building", async () => {
    const owner = await player();
    const view = await buyEmpireBuilding(owner.token, { kind: "barn", ...spot("barn") }, T0);
    const stranger = await player();
    await expect(
      placeOwnedEmpireBuilding(stranger.token, { id: view.empire.buildings[0].id, ...spot("barn") }, T0),
    ).rejects.toBeInstanceOf(StackAcresRequestError);
  });
});
