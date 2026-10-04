import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "./fixtures";
import { isHoeableMapTile, isWildMapTile, mapToSoilTile } from "@/lib/stackacres/hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "@/lib/stackacres/homestead-ground";

/**
 * Earl, end to end: hired at Ray's counter, standing on the Homestead, and his
 * first chores pass watering the seed sown before he was hired.
 *
 * The wage and the pass are held in lib/server/stackacres-hired-hand-service.test.ts.
 * What only a browser shows is that the pieces meet: the shelf's Hire reaches the
 * server, the map draws him, and the page keeps asking for his chores on its own.
 */

const ADMIN_SECRET = "playwright-admin-secret";
const INSIDE_BARN = { x: 192, y: 150 };
const BARN_COUNTER = { x: 296, y: 94 };
const WALK_MS = 4_000;
/** Six bare yard squares in a row, read off the real map so a redrawn yard cannot leave this digging a road. */
const BEDS = (() => {
  const yard = (mx: number, my: number) => isHoeableMapTile(mx, my) && !isWildMapTile(mx, my);
  for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
    for (let mx = 0; mx + 6 <= HOMESTEAD_MAP_WIDTH; mx++) {
      if ([0, 1, 2, 3, 4, 5].every((dx) => yard(mx + dx, my))) return [0, 1, 2, 3, 4, 5].map((dx) => mapToSoilTile(mx + dx, my));
    }
  }
  throw new Error("no six bare yard squares in a row on the Homestead");
})();
/** The page asks every 20 seconds, and his first pass waits that long after the hire. */
const FIRST_PASS_MS = 50_000;

interface HandHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
    handState: () => { drawn: boolean; busy: boolean; at: { x: number; y: number } };
  };
}

const scene = (page: Page) => page.evaluate(() => (window as unknown as { __stackacres: HandHandle }).__stackacres.scene.handState());

async function farmAction(context: BrowserContext, data: Record<string, unknown>) {
  const response = await context.request.post("/api/stackacres/actions", { data });
  expect(response.ok(), `setup ${String(data.action)}: ${response.status()} ${await response.text()}`).toBe(true);
}

async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };
  expect((await admin.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok()).toBe(true);
  const delta = 5_000 - profile.goldBalance;
  if (delta !== 0) expect((await admin.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta } })).ok()).toBe(true);
  await farmAction(context, { action: "claim-starter-seeds" });
  for (const bed of BEDS) await farmAction(context, { action: "place-soil-tile", tx: bed.tx, ty: bed.ty });
  await farmAction(context, { action: "stock", stock: "wheat", tx: BEDS[0].tx, ty: BEDS[0].ty });
}

test("hire Earl at Ray's, see him on the farm, and watch him water the seed", async ({ browser }) => {
  test.setTimeout(180_000);
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  try {
    expect((await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request);

    const page = await farmerContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("sa-ray-welcomed", "1");
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => {};
    });
    await page.goto("/games/stackacres");
    await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
    await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres), null, {
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    expect((await scene(page)).drawn).toBe(false);

    await page.evaluate(
      (at) => (window as unknown as { __stackacres: HandHandle }).__stackacres.scene.placeFarmer("barn", at),
      INSIDE_BARN,
    );
    await page.waitForTimeout(500);
    const counter = await page.evaluate(
      (at) => (window as unknown as { __stackacres: HandHandle }).__stackacres.scene.clientPointFor(at.x, at.y),
      BARN_COUNTER,
    );
    await page.touchscreen.tap(counter.x, counter.y);
    await page.waitForTimeout(WALK_MS);
    const sheet = page.getByRole("dialog", { name: "Supply store" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("tab", { name: "Tools" }).click();
    const card = sheet.getByTestId("sa-hire-hand");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    const hired = page.waitForResponse(
      (response) => response.url().includes("/api/stackacres/actions") && (response.request().postData() ?? "").includes("hire-hand"),
    );
    await card.getByRole("button", { name: "Hire" }).click();
    expect((await hired).ok()).toBe(true);
    await expect(card.getByText("Working your farm.")).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();

    await page.evaluate(
      (at) => (window as unknown as { __stackacres: HandHandle }).__stackacres.scene.placeFarmer("homestead", at),
      { x: 700, y: 380 },
    );
    await page.waitForTimeout(500);
    expect((await scene(page)).drawn).toBe(true);

    // The page asks for his chores by itself. His first pass waters the wheat seed.
    const watered = page.waitForResponse(
      async (response) => {
        if (!response.url().includes("/api/stackacres/actions")) return false;
        if (!(response.request().postData() ?? "").includes("hand-chores")) return false;
        const body = (await response.json().catch(() => null)) as { handChores?: { watered: string[] } } | null;
        return (body?.handChores?.watered.length ?? 0) > 0;
      },
      { timeout: FIRST_PASS_MS },
    );
    expect((await watered).ok()).toBe(true);
    await page.waitForFunction(
      () => (window as unknown as { __stackacres: HandHandle }).__stackacres.scene.handState().busy,
      null,
      { timeout: 5_000 },
    );
    await page.screenshot({ path: test.info().outputPath("earl-at-work.png") });
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
