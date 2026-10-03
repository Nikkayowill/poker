import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * Hank at the sale barn (lib/stackacres/sale-barn.ts) sells feeder pigs and calves, and ships the farm's
 * ready hogs and steers back to market by weight. Cloned from stackacres-town-buyers.spec.ts.
 */

interface Handle {
  __stackacres: {
    scene: {
      clientPointFor: (x: number, y: number) => { x: number; y: number };
      placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
      setClock: (hour: number | null) => void;
      travelling: boolean;
    };
  };
}

async function admit(context: BrowserContext): Promise<string> {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  expect((await context.request.post("/api/profile/onboarding")).ok()).toBe(true);
  return profile.id;
}

const farm = async (context: BrowserContext) =>
  (await (await context.request.get("/api/stackacres")).json()) as {
    profile: { goldBalance: number };
    units: { stock: string }[];
  };

async function start(page: Page) {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.localStorage.setItem("sa-ray-welcomed", "1");
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.setClock(11));
}

/** Stands the farmer just below someone in the City and taps them. */
async function tapPerson(page: Page, at: { x: number; y: number }) {
  await page.evaluate(
    (spot) => (window as unknown as Handle).__stackacres.scene.placeFarmer("city", spot),
    { x: at.x, y: at.y + 34 },
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Handle).__stackacres.scene.travelling), { timeout: 10_000 })
    .toBe(false);
  await page.waitForTimeout(400);
  const point = await page.evaluate(
    (spot) => (window as unknown as Handle).__stackacres.scene.clientPointFor(spot.x, spot.y),
    { x: at.x, y: at.y - 12 },
  );
  await page.mouse.click(point.x, point.y);
}

// Where public/stackacres-td/areas/city/area.json stands him.
const HANK = { x: 614, y: 422 };

test("Hank sells a feeder pig, and has nothing to ship until it's grown", async ({ context, page }) => {
  await admit(context);
  const before = await farm(context);
  expect(before.profile.goldBalance).toBeGreaterThanOrEqual(250);
  expect(before.units.filter((unit) => unit.stock === "hog")).toHaveLength(0);

  // A hog is never bought outright, and there is nothing ready to ship yet.
  const outright = await context.request.post("/api/stackacres/actions", { data: { action: "buy-stock", stock: "hog" } });
  expect(outright.ok()).toBe(false);
  const early = await context.request.post("/api/stackacres/actions", { data: { action: "ship-livestock" } });
  expect(early.status()).toBe(409);

  await start(page);
  await tapPerson(page, HANK);
  const saleBarn = page.getByRole("dialog", { name: "Sale Barn" });
  await expect(saleBarn).toBeVisible();
  await expect(saleBarn.getByRole("button", { name: "Ship to market" })).toBeDisabled();

  await saleBarn.getByRole("button", { name: "Buy a feeder pig" }).click();
  await expect(saleBarn.getByRole("status")).toContainText("Your feeder pig is on its way home.");
  await expect
    .poll(async () => (await farm(context)).units.filter((unit) => unit.stock === "hog").length, { timeout: 10_000 })
    .toBe(1);
  expect((await farm(context)).profile.goldBalance).toBe(before.profile.goldBalance - 250);
  await expect(saleBarn).toContainText("You have 1 of 3 hogs.");
  await expect(saleBarn).toContainText("Nothing is ready yet.");
});
