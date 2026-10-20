import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The herd (lib/stackacres/herd.ts), from the outside: buy a sheep and a cow,
 * set them down, lift them, and get Wool back after the wait.
 *
 * Run the Wool test with CHRONO_DELOREAN_MODE=1 so the server clock can move.
 */

test.use({ viewport: { width: 932, height: 430 } });

const T = 16;
const GRASS_A = { tx: 28, ty: 24 };
const GRASS_B = { tx: 29, ty: 24 };
const GRASS_C = { tx: 30, ty: 24 };
/** The south road out of the yard: road, not grass. */
const ROAD = { tx: 31, ty: 36 };

interface Scene {
  clientPointFor: (x: number, y: number) => { x: number; y: number };
  placeFarmer: (area: string, at: { x: number; y: number }) => void;
}

interface Unit {
  id: string;
  stock: string;
  mapTx: number | null;
  mapTy: number | null;
  status?: string;
  readyAt?: number | string | null;
}

interface FarmView {
  units: Unit[];
  profile: { goldBalance: number };
  inventory: Record<string, number>;
}

async function admit(context: BrowserContext) {
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

function act(context: BrowserContext, data: Record<string, unknown>) {
  return context.request.post("/api/stackacres/actions", { data });
}

async function view(context: BrowserContext, data: Record<string, unknown>): Promise<FarmView> {
  const response = await act(context, data);
  expect(response.ok(), `${String(data.action)} failed: ${response.status()}`).toBe(true);
  return (await response.json()) as FarmView;
}

async function read(context: BrowserContext): Promise<FarmView> {
  const response = await context.request.get("/api/stackacres");
  expect(response.ok()).toBe(true);
  return (await response.json()) as FarmView;
}

function sceneCall<M extends keyof Scene>(page: Page, method: M, ...args: Parameters<Scene[M]>): Promise<ReturnType<Scene[M]>> {
  return page.evaluate(
    ([name, list]) => {
      const scene = (window as unknown as { __stackacres: { scene: Record<string, (...a: unknown[]) => unknown> } }).__stackacres.scene;
      return scene[name as string](...(list as unknown[]));
    },
    [method, args] as const,
  ) as Promise<ReturnType<Scene[M]>>;
}

async function openFarm(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: the welcome shows, and the test says so.
    }
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres), null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

test("a bought sheep and cow wait unplaced, then stand where the rules allow", async ({ context }) => {
  await admit(context);
  const bought = await view(context, { action: "buy-stock", stock: "pig" });
  const sheep = bought.units.find((unit) => unit.stock === "pig");
  expect(sheep, "the sheep exists after buying").toBeTruthy();
  expect(sheep?.mapTx).toBeNull();
  const afterCow = await view(context, { action: "buy-stock", stock: "cattle" });
  const cow = afterCow.units.find((unit) => unit.stock === "cattle");
  expect(cow?.mapTx).toBeNull();
  const goldAfterBuying = afterCow.profile.goldBalance;

  const placed = await view(context, { action: "place-animal", unitId: sheep!.id, ...GRASS_A });
  expect(placed.units.find((unit) => unit.id === sheep!.id)).toMatchObject({ mapTx: GRASS_A.tx, mapTy: GRASS_A.ty });

  // One animal to a square, nothing on the road, nothing off the map.
  expect((await act(context, { action: "place-animal", unitId: cow!.id, ...GRASS_A })).status()).toBe(409);
  expect((await act(context, { action: "place-animal", unitId: cow!.id, ...ROAD })).status()).toBe(400);
  expect((await act(context, { action: "place-animal", unitId: cow!.id, tx: 250, ty: 250 })).status()).toBe(400);
  expect((await read(context)).units.find((unit) => unit.id === cow!.id)?.mapTx).toBeNull();

  // The same animal may move to another square, and the old one is free again.
  await view(context, { action: "place-animal", unitId: sheep!.id, ...GRASS_B });
  const cowDown = await view(context, { action: "place-animal", unitId: cow!.id, ...GRASS_A });
  expect(cowDown.units.find((unit) => unit.id === cow!.id)).toMatchObject({ mapTx: GRASS_A.tx, mapTy: GRASS_A.ty });

  // Lifting one puts it back to unplaced and moves no Gold either way.
  const lifted = await view(context, { action: "pick-up-animal", unitId: sheep!.id });
  expect(lifted.units.find((unit) => unit.id === sheep!.id)?.mapTx).toBeNull();
  expect(lifted.profile.goldBalance).toBe(goldAfterBuying);
});

test("the herd bar opens on its own and a tap on grass sets the sheep down", async ({ context, page }, testInfo) => {
  await admit(context);
  const bought = await view(context, { action: "buy-stock", stock: "pig" });
  const sheep = bought.units.find((unit) => unit.stock === "pig")!;

  await openFarm(page);
  const bar = page.getByRole("toolbar", { name: "Herd" });
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await expect(bar).toContainText("set down your sheep.");
  await page.screenshot({ path: testInfo.outputPath("herd-bar-open.png") });

  await sceneCall(page, "placeFarmer", "homestead", { x: GRASS_C.tx * T + T / 2, y: (GRASS_C.ty + 3) * T + T / 2 });
  await page.waitForTimeout(500);
  const point = await sceneCall(page, "clientPointFor", GRASS_C.tx * T + T / 2, GRASS_C.ty * T + T / 2);
  await page.mouse.click(point.x, point.y);

  await expect
    .poll(async () => (await read(context)).units.find((unit) => unit.id === sheep.id)?.mapTx, { timeout: 10_000 })
    .toBe(GRASS_C.tx);
  await expect(bar).toContainText("Tap an animal to pick it up");
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath("herd-placed.png") });

  // Done closes the bar and leaves no key on the map; the Animals sheet opens it again.
  await bar.getByRole("button", { name: "Done" }).click();
  await expect(bar).toBeHidden();
  await expect(page.getByRole("button", { name: "Herd" })).toHaveCount(0);
  // A phone on its side keeps the Animals badge in the More drawer.
  await page.getByRole("button", { name: "More" }).click();
  await page.locator('[data-label="Animals"]').click();
  await page.getByRole("button", { name: "Move animals" }).click();
  await expect(bar).toBeVisible();
  // A reload keeps the sheep where it stands.
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres), null, { timeout: 60_000 });
  expect((await read(context)).units.find((unit) => unit.id === sheep.id)).toMatchObject({ mapTx: GRASS_C.tx, mapTy: GRASS_C.ty });
});

test("a fed sheep gives Wool after its wait, and a second collect pays nothing", async ({ context }) => {
  await admit(context);
  const adminCookies = (await context.cookies()).filter((cookie) => cookie.path === "/api/admin");
  await context.addCookies(adminCookies.map((cookie) => ({ ...cookie, path: "/api/dev" })));
  const status = await context.request.get("/api/dev/chrono-delorean");
  test.skip(!status.ok(), "Start the server with CHRONO_DELOREAN_MODE=1 to move its clock");

  const bought = await view(context, { action: "buy-stock", stock: "pig" });
  const sheep = bought.units.find((unit) => unit.stock === "pig")!;
  // Left unplaced on purpose. A sheep standing on open ground can be away for a night
  // (lib/stackacres/herd-risk.ts) and this test is about the Wool, not the layout.

  const feedBought = await act(context, { action: "buy-feed", itemId: "feed_sack", quantity: 1 });
  expect(feedBought.ok(), `buy-feed: ${feedBought.status()} ${await feedBought.text()}`).toBe(true);
  // Fed too early, a sheep says it is not hungry: it asks for food two hours in.
  expect((await act(context, { action: "feed", unitId: sheep.id })).status()).toBe(409);

  await act(context, { action: "collect", unitIds: [sheep.id] });
  expect((await read(context)).inventory.wool ?? 0, "nothing to collect before the wait").toBe(0);

  const hour = 60 * 60 * 1000;
  const toHungry = await context.request.post("/api/dev/chrono-delorean", { data: { op: "advance", deltaMs: 2 * hour + 60_000 } });
  expect(toHungry.ok()).toBe(true);
  const fed = await act(context, { action: "feed", unitId: sheep.id });
  expect(fed.ok(), `feed: ${fed.status()} ${await fed.text()}`).toBe(true);

  const moved = await context.request.post("/api/dev/chrono-delorean", { data: { op: "advance", deltaMs: 5 * hour } });
  expect(moved.ok()).toBe(true);

  // Fed at the two-hour mark it is hungry again by the time it finishes, and a hungry
  // sheep is not collected: it is fed once more first.
  expect((await act(context, { action: "collect", unitIds: [sheep.id] })).status()).toBe(409);
  await act(context, { action: "buy-feed", itemId: "feed_sack", quantity: 1 });
  const fedAgain = await act(context, { action: "feed", unitId: sheep.id });
  expect(fedAgain.ok(), `second feed: ${fedAgain.status()} ${await fedAgain.text()}`).toBe(true);
  const sheepNow = (await read(context)).units.find((unit) => unit.id === sheep.id);

  let collected = await act(context, { action: "collect", unitIds: [sheep.id] });
  if (collected.status() === 409) {
    // The wait it spent hungry is added back on, so it may need a little longer.
    await context.request.post("/api/dev/chrono-delorean", { data: { op: "advance", deltaMs: 4 * hour } });
    collected = await act(context, { action: "collect", unitIds: [sheep.id] });
  }
  expect(collected.ok(), `collect: ${collected.status()} ${await collected.text()} (sheep ${JSON.stringify(sheepNow)})`).toBe(true);
  const wool = (await read(context)).inventory.wool ?? 0;
  expect(wool, `inventory after collecting: ${JSON.stringify((await read(context)).inventory)}`).toBeGreaterThan(0);

  await act(context, { action: "collect", unitIds: [sheep.id] });
  expect((await read(context)).inventory.wool ?? 0).toBe(wool);
});
