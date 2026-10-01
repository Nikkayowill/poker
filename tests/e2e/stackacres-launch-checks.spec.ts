import { expect, test, type BrowserContext } from "./fixtures";
import { isHoeableMapTile, isWildMapTile, mapToSoilTile } from "../../lib/stackacres/hoeable";

/**
 * The StackAcres launch-checklist items that can be run without a real
 * database: the Mill, refused actions, double taps, time passing while the
 * player is away, and a contract paying once.
 *
 * Memory mode only. What this cannot show is that the real Postgres
 * functions are atomic under two connections; that needs the live project.
 * Run with CHRONO_DELOREAN_MODE=1 so the server clock can move.
 */

/** Open yard grass the hoe can break, as soil tiles, found with the game's own rules. */
const BEDS: { tx: number; ty: number }[] = [];
for (let my = 24; my <= 27 && BEDS.length < 12; my += 1) {
  for (let mx = 26; mx <= 36 && BEDS.length < 12; mx += 1) {
    if (isHoeableMapTile(mx, my) && !isWildMapTile(mx, my)) BEDS.push(mapToSoilTile(mx, my));
  }
}

interface Farm {
  profile: { goldBalance: number };
  inventory: Record<string, number>;
  machines: { kind: string }[];
  contract: { id: string; item: string; quantity: number; status: string } | null;
  units: { id: string; stock: string }[];
}

async function admit(context: BrowserContext): Promise<string> {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as {
    profile: { id: string; goldBalance: number };
  };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  expect(
    (await context.request.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: 400_000 - profile.goldBalance } })).ok(),
  ).toBe(true);
  return profile.id;
}

const act = (context: BrowserContext, data: Record<string, unknown>) => context.request.post("/api/stackacres/actions", { data });

async function must(context: BrowserContext, data: Record<string, unknown>) {
  const response = await act(context, data);
  expect(response.ok(), `${String(data.action)} -> ${response.status()} ${await response.text()}`).toBe(true);
  return response;
}

async function read(context: BrowserContext): Promise<Farm> {
  const response = await context.request.get("/api/stackacres");
  expect(response.ok()).toBe(true);
  return (await response.json()) as Farm;
}

async function grant(context: BrowserContext, profileId: string, item: string, delta: number) {
  const response = await context.request.post("/api/admin/stackacres-items", { data: { profileId, item, delta } });
  expect(response.ok(), `grant ${item} -> ${response.status()} ${await response.text()}`).toBe(true);
}

async function enableClock(context: BrowserContext) {
  const adminCookies = (await context.cookies()).filter((cookie) => cookie.path === "/api/admin");
  await context.addCookies(adminCookies.map((cookie) => ({ ...cookie, path: "/api/dev" })));
  const status = await context.request.get("/api/dev/chrono-delorean");
  test.skip(!status.ok(), "Start the server with CHRONO_DELOREAN_MODE=1 to move its clock");
}

const advance = (context: BrowserContext, ms: number) =>
  context.request.post("/api/dev/chrono-delorean", { data: { op: "advance", deltaMs: ms } });

test("the Mill takes 15 Wood once, survives a refresh, and a double tap builds one", async ({ context }) => {
  const id = await admit(context);

  await grant(context, id, "wood", 14);
  const short = await act(context, { action: "place-machine", kind: "mill" });
  expect(short.ok(), "a Mill with 14 Wood is refused").toBe(false);
  const refused = await read(context);
  expect(refused.inventory.wood).toBe(14);
  expect(refused.machines.filter((machine) => machine.kind === "mill")).toHaveLength(0);

  await grant(context, id, "wood", 1);
  const goldBefore = (await read(context)).profile.goldBalance;
  const taps = await Promise.all([
    act(context, { action: "place-machine", kind: "mill" }),
    act(context, { action: "place-machine", kind: "mill" }),
  ]);
  expect(taps.filter((tap) => tap.ok()), "exactly one of two simultaneous taps lands").toHaveLength(1);

  const built = await read(context);
  expect(built.inventory.wood ?? 0, "15 Wood left once").toBe(0);
  expect(built.machines.filter((machine) => machine.kind === "mill")).toHaveLength(1);
  expect(goldBefore - built.profile.goldBalance, "the Mill's Gold left once").toBe(200);

  const refreshed = await read(context);
  expect(refreshed.machines.filter((machine) => machine.kind === "mill")).toHaveLength(1);
});

test("refused actions spend nothing", async ({ context }) => {
  await admit(context);
  const before = await read(context);

  expect((await act(context, { action: "sell", item: "flour", quantity: 1 })).ok(), "selling what you do not hold").toBe(false);
  expect((await act(context, { action: "sell", item: "wood", quantity: 5 })).ok(), "selling Wood you do not hold").toBe(false);
  expect((await act(context, { action: "place-machine", kind: "mill" })).ok(), "a Mill with no Wood").toBe(false);
  expect((await act(context, { action: "place-machine", kind: "loom" })).ok(), "a Loom with no Wood").toBe(false);

  const after = await read(context);
  expect(after.profile.goldBalance).toBe(before.profile.goldBalance);
  expect(after.inventory).toEqual(before.inventory);
  expect(after.machines).toEqual(before.machines);
});

test("a double-tapped sale pays once and never goes negative", async ({ context }) => {
  const id = await admit(context);

  await grant(context, id, "wood", 2);
  const start = (await read(context)).profile.goldBalance;
  const taps = await Promise.all([
    act(context, { action: "sell", item: "wood", quantity: 2 }),
    act(context, { action: "sell", item: "wood", quantity: 2 }),
  ]);
  expect(taps.filter((tap) => tap.ok()), "exactly one of two simultaneous sales lands").toHaveLength(1);
  const doubled = await read(context);
  const paid = doubled.profile.goldBalance - start;
  expect(paid).toBeGreaterThan(0);
  expect(doubled.inventory.wood ?? 0).toBe(0);

  // The same two Wood sold on their own pay the same, so the double tap paid no extra.
  await grant(context, id, "wood", 2);
  await must(context, { action: "sell", item: "wood", quantity: 2 });
  expect((await read(context)).profile.goldBalance - doubled.profile.goldBalance).toBe(paid);
});

test("crops ripen and the Mill finishes while the player is away, and a contract pays once", async ({ context }) => {
  const id = await admit(context);
  await enableClock(context);

  await grant(context, id, "wood", 15);
  await must(context, { action: "place-machine", kind: "mill" });

  // The only thing this farm can make for the town is Flour, so that is what the order asks for.
  const fits = (contract: Farm["contract"]) => contract !== null && contract.item === "flour" && contract.quantity * 3 <= BEDS.length;
  let order = ((await (await must(context, { action: "request-contract" })).json()) as Farm).contract;
  expect(order, "the town posts an order").not.toBeNull();
  if (!fits(order)) {
    // The board is random. An order that will not fit the beds can be passed once.
    order = ((await (await must(context, { action: "pass-contract" })).json()) as Farm).contract;
  }
  test.skip(!fits(order), `order is ${order?.quantity} ${order?.item}`);
  const wheatNeeded = order!.quantity * 3;

  await must(context, { action: "buy-seed", crop: "wheat", quantity: wheatNeeded });
  for (const bed of BEDS.slice(0, wheatNeeded)) {
    await must(context, { action: "place-soil-tile", ...bed });
    await must(context, { action: "stock", stock: "wheat", ...bed });
  }
  const sown = await read(context);
  expect(sown.inventory.wheat ?? 0, "nothing is ripe the moment it is sown").toBe(0);

  // A seed starts dry. Watering it starts the clock; the can is refilled when it runs out.
  for (const unit of sown.units.filter((candidate) => candidate.stock === "wheat")) {
    let watered = await act(context, { action: "water", unitId: unit.id });
    if (!watered.ok()) {
      await must(context, { action: "draw-water" });
      watered = await act(context, { action: "water", unitId: unit.id });
    }
    expect(watered.ok(), `water -> ${watered.status()} ${await watered.text()}`).toBe(true);
  }

  // Close the tab, come back after the five-minute cycle.
  expect((await advance(context, 6 * 60 * 1000)).ok()).toBe(true);
  await must(context, { action: "collect" });
  const harvested = await read(context);
  expect(harvested.inventory.wheat ?? 0, "the crop ripened while away").toBeGreaterThanOrEqual(wheatNeeded);

  for (let batch = 0; batch < order!.quantity; batch += 1) {
    await must(context, { action: "process", recipe: "flour" });
    expect((await advance(context, 60 * 1000)).ok()).toBe(true);
    await must(context, { action: "work" });
  }
  const milled = await read(context);
  expect(milled.inventory.flour ?? 0, "the Mill finished while away").toBeGreaterThanOrEqual(order!.quantity);

  // Two tabs hand the same order in at once.
  const flourBefore = milled.inventory.flour ?? 0;
  const goldBefore = milled.profile.goldBalance;
  const handed = await Promise.all([act(context, { action: "fulfill-contract" }), act(context, { action: "fulfill-contract" })]);
  expect(handed.filter((hand) => hand.ok()), "the order is filled once").toHaveLength(1);
  const paid = await read(context);
  expect(paid.inventory.flour ?? 0, "the goods left once").toBe(flourBefore - order!.quantity);
  expect(paid.profile.goldBalance - goldBefore, "the reward arrived once").toBeGreaterThan(0);
});

test("a full pen refuses the next animal with a reason and keeps the Gold", async ({ context }) => {
  await admit(context);
  for (let animal = 0; animal < 3; animal += 1) await must(context, { action: "buy-stock", stock: "pig" });
  const full = await read(context);
  expect(full.units.filter((unit) => unit.stock === "pig")).toHaveLength(3);

  const fourth = await act(context, { action: "buy-stock", stock: "pig" });
  expect(fourth.ok()).toBe(false);
  expect(((await fourth.json()) as { error?: string }).error, "the refusal says something").toBeTruthy();
  const after = await read(context);
  expect(after.units.filter((unit) => unit.stock === "pig")).toHaveLength(3);
  expect(after.profile.goldBalance).toBe(full.profile.goldBalance);
});

test("the same intent key sent twice buys one animal", async ({ context }) => {
  await admit(context);
  const before = await read(context);
  const key = "launch-check-replay-0001";
  await must(context, { action: "buy-stock", stock: "cattle", key });
  await act(context, { action: "buy-stock", stock: "cattle", key });
  const after = await read(context);
  expect(after.units.filter((unit) => unit.stock === "cattle")).toHaveLength(1);
  const spent = before.profile.goldBalance - after.profile.goldBalance;
  expect(spent, "debited once").toBeGreaterThan(0);

  // A different key is a real second purchase and costs the same again.
  await must(context, { action: "buy-stock", stock: "cattle", key: "launch-check-replay-0002" });
  expect(after.profile.goldBalance - (await read(context)).profile.goldBalance).toBe(spent);
});

test("double taps on sowing, harvesting and milling each land once", async ({ context }) => {
  const id = await admit(context);
  await enableClock(context);
  const bed = BEDS[0];

  await grant(context, id, "wood", 15);
  await must(context, { action: "place-machine", kind: "mill" });
  await must(context, { action: "place-soil-tile", ...bed });
  await must(context, { action: "buy-seed", crop: "wheat", quantity: 3 });

  const sows = await Promise.all([
    act(context, { action: "stock", stock: "wheat", ...bed }),
    act(context, { action: "stock", stock: "wheat", ...bed }),
  ]);
  expect(sows.filter((sow) => sow.ok()), "one bed takes one seed").toHaveLength(1);
  const planted = (await read(context)).units.filter((unit) => unit.stock === "wheat");
  expect(planted).toHaveLength(1);

  await must(context, { action: "water", unitId: planted[0].id });
  expect((await advance(context, 6 * 60 * 1000)).ok()).toBe(true);
  const picks = await Promise.all([
    act(context, { action: "collect", unitIds: [planted[0].id] }),
    act(context, { action: "collect", unitIds: [planted[0].id] }),
  ]);
  expect(picks.filter((pick) => pick.ok()), "one harvest pays").toHaveLength(1);
  const wheat = (await read(context)).inventory.wheat ?? 0;
  expect(wheat).toBeGreaterThanOrEqual(3);

  // Two simultaneous batches make only as many as the Wheat pays for.
  const batches = await Promise.all([
    act(context, { action: "process", recipe: "flour" }),
    act(context, { action: "process", recipe: "flour" }),
  ]);
  const made = batches.filter((batch) => batch.ok()).length;
  expect(made, "no more batches than the Wheat pays for").toBe(Math.min(2, Math.floor(wheat / 3)));
  expect((await advance(context, 60 * 1000)).ok()).toBe(true);
  await must(context, { action: "work" });
  expect((await read(context)).inventory.flour ?? 0).toBe(made);
});
