import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "./fixtures";

/**
 * The tractor, end to end: bought at Ray's counter, parked by the barn, climbed
 * onto with a tap, and a row hoed with one press of Use.
 *
 * The row rule and the money are held in lib/stackacres/tractor.test.ts and
 * lib/server/stackacres-tractor-service.test.ts. What only a browser shows is
 * that the pieces meet: the shelf's Buy reaches the server, the map draws the
 * machine, a tap puts the farmer on it, and Use sends one request for a row.
 */

const ADMIN_SECRET = "playwright-admin-secret";
/** Where the barn's door lets him in (area.json's exit spawn). */
const INSIDE_BARN = { x: 192, y: 150 };
/** The counter inside it (the barn interior's `barn` prop, centre-x and just above its foot). */
const BARN_COUNTER = { x: 296, y: 94 };
/** Where the tractor parks (components/arcade/stackacres-td/tractor-rig.ts), and a step below it. */
const TRACTOR = { x: 752, y: 320 };
const BELOW_TRACTOR = { x: 752, y: 360 };
const WALK_MS = 4_000;

interface TractorHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
    isWalking: () => boolean;
    soilTiles: () => unknown[];
    tractorState: () => { drawn: boolean; driving: boolean; at: { x: number; y: number } };
  };
}

async function tapWorld(page: Page, at: { x: number; y: number }) {
  const point = await page.evaluate(
    (target) => (window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.clientPointFor(target.x, target.y),
    at,
  );
  await page.touchscreen.tap(point.x, point.y);
}

const tractorState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.tractorState());

async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };
  expect((await admin.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok()).toBe(true);
  const delta = 60_000 - profile.goldBalance;
  if (delta !== 0) expect((await admin.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta } })).ok()).toBe(true);
  // Metal is smelted from ore: stone for the Smelter, then eight bars from sixteen ore.
  for (const [item, delta] of [["stone", 25], ["iron_ore", 16]] as const) {
    const granted = await admin.post("/api/admin/stackacres-items", { data: { profileId: profile.id, item, delta } });
    expect(granted.ok(), `could not grant ${item}`).toBe(true);
  }
  const smelter = await context.request.post("/api/stackacres/actions", { data: { action: "place-machine", kind: "smelter" } });
  expect(smelter.ok(), "could not build the Smelter").toBe(true);
  for (let bar = 0; bar < 8; bar += 1) {
    const smelted = await context.request.post("/api/stackacres/actions", { data: { action: "process", recipe: "metal" } });
    expect(smelted.ok(), "could not smelt a bar").toBe(true);
  }
}

test("buy the tractor from Ray, climb on, and hoe a row with one press", async ({ browser }) => {
  const adminContext = await browser.newContext();
  // A phone held sideways: the thumb stick and the Use key only show for a touch screen.
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
    expect((await tractorState(page)).drawn).toBe(false);

    // Ray's counter inside the barn, Tools shelf. Put him just inside the door rather than walking him
    // over: the walk is not what this tests, and the camera can leave the door under the HUD.
    await page.evaluate(
      (at) => (window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.placeFarmer("barn", at),
      INSIDE_BARN,
    );
    await page.waitForTimeout(500);
    await tapWorld(page, BARN_COUNTER);
    await page.waitForTimeout(WALK_MS);
    const sheet = page.getByRole("dialog", { name: "Supply store" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("tab", { name: "Tools" }).click();
    const card = sheet.getByTestId("sa-buy-tractor");
    await expect(card).toBeVisible();
    await expect(card.getByText("8/8 Metal")).toBeVisible();
    const bought = page.waitForResponse(
      (response) =>
        response.url().includes("/api/stackacres/actions") && (response.request().postData() ?? "").includes("buy-equipment"),
    );
    await card.getByRole("button", { name: "Buy" }).click();
    expect((await bought).ok()).toBe(true);
    await expect(card.getByText("Yours. It is parked beside the barn.")).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();

    // Back out in the yard, the tractor is parked by the barn. A tap walks him over and puts him on it.
    await page.evaluate(
      (at) => (window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.placeFarmer("homestead", at),
      BELOW_TRACTOR,
    );
    await page.waitForTimeout(500);
    expect((await tractorState(page)).drawn).toBe(true);
    await tapWorld(page, TRACTOR);
    await page.waitForFunction(
      () => (window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.tractorState().driving,
      null,
      { timeout: 15_000 },
    );
    await expect(page.getByRole("button", { name: "Get off the tractor" })).toBeVisible();

    // The hoe, then one press of Use: one request for the whole row ahead.
    const hoe = page.getByRole("radio", { name: "Hoe" });
    await hoe.click();
    await expect(hoe).toHaveAttribute("aria-checked", "true");
    const bedsBefore = await page.evaluate(
      () => (window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.soilTiles().length,
    );
    const row = page.waitForResponse(
      (response) =>
        response.url().includes("/api/stackacres/actions") && (response.request().postData() ?? "").includes('"tiles"'),
    );
    // Pressed from the keyboard, which the key also answers: a synthetic touch on it never reaches
    // its pointer handler in this harness (the same reason stackacres-toolbelt-touch's hoe test is red).
    await page.locator(".sa-use-key").press(" ");
    const answer = await row;
    expect(answer.ok()).toBe(true);
    const sent = JSON.parse(answer.request().postData() ?? "{}") as { action: string; tiles: unknown[] };
    expect(sent.action).toBe("place-soil-tile");
    expect(sent.tiles.length).toBeGreaterThan(1);
    await page.waitForFunction(
      (was) => (window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.soilTiles().length >= was + 2,
      bedsBefore,
      { timeout: 10_000 },
    );

    // And the belt's key climbs him back down, leaving it parked where it stands.
    await page.getByRole("button", { name: "Get off the tractor" }).click();
    await page.waitForFunction(
      () => !(window as unknown as { __stackacres: TractorHandle }).__stackacres.scene.tractorState().driving,
      null,
      { timeout: 5_000 },
    );
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
