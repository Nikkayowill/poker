import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * Selling happens in town, to the person who buys that good: Dale at the grain elevator, Iris at the
 * general store and Hank at the sale barn (lib/stackacres/town-buyers.ts). Ray's barn no longer buys.
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
    inventory: Record<string, number>;
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

// Where public/stackacres-td/areas/city/area.json stands them.
const IRIS = { x: 467, y: 389 };
const DALE = { x: 728, y: 573 };
const HANK = { x: 614, y: 422 };

test("nobody in town buys Stone, so the farm keeps it for building", async ({ context, page }) => {
  const profileId = await admit(context);
  const granted = await context.request.post("/api/admin/stackacres-items", { data: { profileId, item: "stone", delta: 3 } });
  expect(granted.ok()).toBe(true);

  // No buyer takes it: the sale is refused and the Stone stays put.
  for (const buyer of ["grain-elevator", "general-store"]) {
    const refused = await context.request.post("/api/stackacres/actions", {
      data: { action: "sell", buyer, item: "stone", quantity: 3 },
    });
    expect(refused.ok()).toBe(false);
  }
  expect((await farm(context)).inventory.stone).toBe(3);

  await start(page);

  await tapPerson(page, DALE);
  const elevator = page.getByRole("dialog", { name: "Grain Elevator" });
  await expect(elevator).toBeVisible();
  await expect(elevator).toContainText("Nothing on hand that Dale buys.");
  await elevator.getByRole("button", { name: "Close" }).click();
  await expect(elevator).toHaveCount(0);

  await tapPerson(page, IRIS);
  const store = page.getByRole("dialog", { name: "General Store" });
  await expect(store).toBeVisible();
  await expect(store).toContainText("Nothing on hand that Iris buys.");
  await expect(store.locator(".sa-stock-card", { hasText: "Stone" })).toHaveCount(0);
});

test("Hank at the sale barn sells young stock and buys it back", async ({ context, page }) => {
  await admit(context);
  await start(page);
  await tapPerson(page, HANK);
  const saleBarn = page.getByRole("dialog", { name: "Sale Barn" });
  await expect(saleBarn).toBeVisible();
  await expect(saleBarn).toContainText("Raise them fat and I'll buy them back by weight.");
});

test("a sale that names no buyer is refused", async ({ context }) => {
  await admit(context);
  const response = await context.request.post("/api/stackacres/actions", {
    data: { action: "sell", item: "eggs", quantity: 1 },
  });
  expect(response.status()).toBe(400);
});
