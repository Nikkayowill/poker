import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicantsFor, hiringFee } from "@/lib/stackacres/grocery-crew";
import { groceryRates, readTill } from "@/lib/stackacres/grocery-economy";
import { GROCERY_ITEMS, isPlacedItem, layoutCapacity } from "@/lib/stackacres/grocery-layout";
import { STARTING_CREW, storePerson } from "@/lib/stackacres-td/store-cast";
import type { Job } from "@/lib/stackacres-td/work-board";
import { adjustGold, ensureProfile } from "./profile-store";
import * as groceryStore from "./stackacres-grocery-store";
import { __resetStackAcresGroceryForTest } from "./stackacres-grocery-store";
import {
  StackAcresRequestError,
  buyStackAcresGroceryItem,
  collectStackAcresGroceryTill,
  fireStackAcresGroceryWorker,
  hireStackAcresGroceryWorker,
  placeStackAcresGroceryItem,
  readStackAcres,
  storeStackAcresGroceryItem,
  takeOverStackAcresGrocery,
} from "./stackacres-service";
import { __resetStackAcresForTest } from "./stackacres-store";

const T0 = new Date("2026-09-30T12:00:00Z");
const HOUR = 3_600_000;
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

vi.mock("./stackacres-grocery-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stackacres-grocery-store")>();
  return { ...real, writeGrocery: vi.fn(real.writeGrocery) };
});
const REAL_STORE = await vi.importActual<typeof import("./stackacres-grocery-store")>("./stackacres-grocery-store");

beforeEach(() => {
  vi.mocked(groceryStore.writeGrocery).mockImplementation(REAL_STORE.writeGrocery);
  __resetStackAcresForTest();
  __resetStackAcresGroceryForTest();
});

async function owner(gold = 50_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  await adjustGold(profile.id, gold - profile.goldBalance);
  await takeOverStackAcresGrocery(token, T0);
  return { token, id: profile.id };
}

const goldOf = async (token: string) => (await ensureProfile(token)).goldBalance;

/** Someone doing `job` on this player's board on some day from T0 on, and that day. */
function applicant(id: string, job: Job, staff: readonly string[]): { name: string; now: Date } {
  for (let day = 0; day < 60; day++) {
    const now = at(day * 24);
    const hit = applicantsFor(id, now.toISOString().slice(0, 10), staff).find((p) => p.job === job);
    if (hit) return { name: hit.name, now };
  }
  throw new Error(`no ${job} applied in 60 days`);
}

async function refusal(promise: Promise<unknown>): Promise<StackAcresRequestError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StackAcresRequestError);
  return error as StackAcresRequestError;
}

describe("the city grocery", () => {
  it("isn't anyone's until it's taken over, and then comes with its crew and floor plan", async () => {
    const token = randomUUID();
    await ensureProfile(token);
    const before = await readStackAcres(token, T0);
    expect(before.grocery?.owned).toBe(false);
    await refusal(hireStackAcresGroceryWorker(token, { name: "nell" }, T0));

    const after = await takeOverStackAcresGrocery(token, T0);
    expect(after.grocery?.owned).toBe(true);
    expect(after.grocery?.staff).toEqual([...STARTING_CREW]);
    expect(after.grocery?.layout.filter(isPlacedItem).length).toBeGreaterThan(10);
    expect(after.grocery?.applicants).toHaveLength(4);
    expect(after.empire.workers).toBe(STARTING_CREW.length);
  });

  it("hiring someone off today's board takes their fee and puts them on the staff", async () => {
    const { token, id } = await owner();
    const { name, now } = applicant(id, "produce", STARTING_CREW);
    const before = await goldOf(token);
    const view = await hireStackAcresGroceryWorker(token, { name }, now);
    expect(view.grocery?.staff).toContain(name);
    expect(await goldOf(token)).toBe(before - hiringFee(storePerson(name)!));
  });

  it("won't hire someone who isn't on today's board, and takes nothing for it", async () => {
    const { token, id } = await owner();
    const board = applicantsFor(id, T0.toISOString().slice(0, 10), STARTING_CREW).map((p) => p.name);
    const stranger = ["nell", "theo", "ravi", "noor", "lucia", "ines", "kofi", "sade", "otto", "cole", "wren", "zeke"].find((n) => !board.includes(n))!;
    const before = await goldOf(token);
    const error = await refusal(hireStackAcresGroceryWorker(token, { name: stranger }, T0));
    expect(error.message).toMatch(/isn't looking for work today/);
    expect(await goldOf(token)).toBe(before);
  });

  it("won't hire a cashier with no till to put them on", async () => {
    const { token, id } = await owner();
    // Down to the two lanes the two cashiers already work.
    const lanes = (await readStackAcres(token, T0)).grocery!.layout.filter((i) => i.kind === "lane");
    await storeStackAcresGroceryItem(token, { id: lanes[2].id }, T0);
    await storeStackAcresGroceryItem(token, { id: lanes[3].id }, T0);
    const { name, now } = applicant(id, "cashier", STARTING_CREW);
    const before = await goldOf(token);
    const error = await refusal(hireStackAcresGroceryWorker(token, { name }, now));
    expect(error.message).toMatch(/checkout lane/);
    expect(await goldOf(token)).toBe(before);
  });

  it("gives the fee back once if the hire can't be written", async () => {
    const { token, id } = await owner();
    const { name, now } = applicant(id, "stocker", STARTING_CREW);
    const before = await goldOf(token);
    vi.mocked(groceryStore.writeGrocery).mockResolvedValue(false);
    await refusal(hireStackAcresGroceryWorker(token, { name }, now));
    expect(await goldOf(token)).toBe(before);
  });

  it("lets someone go for nothing, and the wages drop", async () => {
    const { token } = await owner();
    const before = (await readStackAcres(token, T0)).grocery!.rates.wagesPerHour;
    const view = await fireStackAcresGroceryWorker(token, { name: "dale" }, T0);
    expect(view.grocery?.staff).not.toContain("dale");
    expect(view.grocery!.rates.wagesPerHour).toBeLessThan(before);
    await refusal(fireStackAcresGroceryWorker(token, { name: "dale" }, T0));
  });

  it("empties the till into the wallet: takings less wages, once", async () => {
    const { token } = await owner();
    const view = await readStackAcres(token, T0);
    const rates = view.grocery!.rates;
    const expected = Math.floor((rates.takingsPerHour - rates.wagesPerHour) * 3);
    expect(expected).toBeGreaterThan(0);
    const before = await goldOf(token);
    const result = await collectStackAcresGroceryTill(token, at(3));
    expect(result.groceryPaid).toBe(expected);
    expect(await goldOf(token)).toBe(before + expected);
    expect(result.grocery?.collected).toBe(expected);
    const again = await refusal(collectStackAcresGroceryTill(token, at(3)));
    expect(again.message).toMatch(/Nothing in the till/);
  });

  it("holds a day's takings, and staff aren't paid for the wait after", async () => {
    const { token } = await owner();
    const rates = (await readStackAcres(token, T0)).grocery!.rates;
    const result = await collectStackAcresGroceryTill(token, at(40));
    expect(result.groceryPaid).toBe(Math.floor((rates.takingsPerHour - rates.wagesPerHour) * 24));
  });

  it("banks what the till earned at the old rate before a hire changes it", async () => {
    const { token, id } = await owner();
    const { name, now } = applicant(id, "produce", STARTING_CREW);
    const start = (await readStackAcres(token, now)).grocery!;
    const hired = await hireStackAcresGroceryWorker(token, { name }, new Date(now.getTime() + 2 * HOUR));
    const till = hired.grocery!.till;
    const earned = readTill(start.till, start.rates, new Date(now.getTime() + 2 * HOUR));
    expect(till.takings).toBeCloseTo(earned.takings, 6);
    expect(till.wages).toBeCloseTo(earned.wages, 6);
    expect(hired.grocery!.rates.takingsPerHour).toBeGreaterThan(start.rates.takingsPerHour);
  });

  it("buying a rug takes its price and lays it down; a spot that won't do takes nothing", async () => {
    const { token } = await owner();
    const before = await goldOf(token);
    const view = await buyStackAcresGroceryItem(token, { kind: "rug-small", tx: 21, ty: 12 }, T0);
    expect(view.grocery?.layout.some((i) => i.kind === "rug-small" && i.tx === 21 && i.ty === 12)).toBe(true);
    expect(await goldOf(token)).toBe(before - GROCERY_ITEMS["rug-small"].gold);

    const mid = await goldOf(token);
    // On top of the first lane's belt.
    await refusal(buyStackAcresGroceryItem(token, { kind: "fern", tx: 2, ty: 13 }, T0));
    expect(await goldOf(token)).toBe(mid);
  });

  it("moves and stores what it owns for free, but never its last till", async () => {
    const { token } = await owner();
    const before = await goldOf(token);
    let layout = (await readStackAcres(token, T0)).grocery!.layout;
    const fig = layout.find((i) => i.kind === "fig")!;
    layout = (await placeStackAcresGroceryItem(token, { id: fig.id, tx: 21, ty: 12 }, T0)).grocery!.layout;
    expect(layout.find((i) => i.id === fig.id)).toMatchObject({ tx: 21, ty: 12 });
    const lanes = layout.filter((i) => i.kind === "lane");
    for (const lane of lanes.slice(1)) await storeStackAcresGroceryItem(token, { id: lane.id }, T0);
    const error = await refusal(storeStackAcresGroceryItem(token, { id: lanes[0].id }, T0));
    expect(error.message).toMatch(/at least one till/);
    expect(await goldOf(token)).toBe(before);
    const view = await readStackAcres(token, T0);
    expect(layoutCapacity(view.grocery!.layout).tills).toBe(1);
    expect(groceryRates(view.grocery!.staff, layoutCapacity(view.grocery!.layout)).idle).toEqual(["omar"]);
  });
});
