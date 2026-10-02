import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The first loop is taught by people: Ray hands over a pouch of wheat seed in his welcome, the Next panel
 * says to plant it, and every other seed is Cora's at the city market.
 */

interface Handle {
  __stackacres: {
    scene: {
      clientPointFor: (x: number, y: number) => { x: number; y: number };
      placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
      setClock: (hour: number | null) => void;
      areaName: string;
      travelling: boolean;
    };
  };
}

async function admit(context: BrowserContext): Promise<void> {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  // The first-visit tour is its own spec's business.
  expect((await context.request.post("/api/profile/onboarding")).ok()).toBe(true);
}

const farm = async (context: BrowserContext) =>
  (await (await context.request.get("/api/stackacres")).json()) as {
    profile: { goldBalance: number };
    seedStock: Record<string, number>;
  };

async function start(page: Page) {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
}

test("Ray's welcome gives one pouch of wheat seed and the panel says to plant it", async ({ context, page }) => {
  await admit(context);
  await start(page);

  const welcome = page.getByRole("dialog", { name: "Ray" });
  await expect(welcome).toContainText("Cora sells every other seed");
  await welcome.getByRole("button", { name: "Thanks, Ray" }).click();

  await expect.poll(async () => (await farm(context)).seedStock.wheat, { timeout: 10_000 }).toBe(12);
  await expect(page.getByText("Plant your wheat")).toBeVisible();

  // A second claim, from a second tab or a cleared browser, gives nothing more.
  const again = await context.request.post("/api/stackacres/actions", { data: { action: "claim-starter-seeds" } });
  expect(again.ok()).toBe(true);
  expect((await farm(context)).seedStock.wheat).toBe(12);
});

test("Cora sells seed at the city market", async ({ context, page }) => {
  await admit(context);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await start(page);
  await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.setClock(11));

  // Over the west bridge, then to the stalls where Cora stands.
  await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.placeFarmer("city", { x: 330, y: 540 }));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Handle).__stackacres.scene.travelling), { timeout: 10_000 })
    .toBe(false);
  await page.waitForTimeout(400);
  const at = await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.clientPointFor(330, 494));
  await page.mouse.click(at.x, at.y);

  const sheet = page.getByRole("dialog", { name: "Seed seller" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Cora");
  const wheat = sheet.locator(".sa-stock-card", { hasText: "Wheat" });
  await expect(wheat).toBeVisible();

  const before = await farm(context);
  await wheat.getByRole("button", { name: /Buy/ }).first().click();
  await expect.poll(async () => (await farm(context)).seedStock.wheat ?? 0, { timeout: 10_000 }).toBeGreaterThan(before.seedStock.wheat ?? 0);
  expect((await farm(context)).profile.goldBalance).toBeLessThan(before.profile.goldBalance);
});
