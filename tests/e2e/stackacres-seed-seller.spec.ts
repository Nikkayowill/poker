import { expect, test, type BrowserContext, type Page } from "./fixtures";
import { tapTownPerson } from "./town-people";

/**
 * The first loop is grounded in the world: Ray hands over a pouch of carrot
 * seed in his welcome, and every other seed is Cora's at the city market.
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

test("the opening hands over three carrot seeds for the first watering loop, once", async ({ context, page }) => {
  await admit(context);
  // The opening is off for every fresh farm in this suite; ask for it and skip to the end of it.
  await page.goto("/games/stackacres?opening=1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Skip" }).click();

  await expect.poll(async () => (await farm(context)).seedStock.carrot, { timeout: 10_000 }).toBe(3);

  // A second claim, from a second tab or a cleared browser, gives nothing more.
  const again = await context.request.post("/api/stackacres/actions", { data: { action: "claim-starter-seeds" } });
  expect(again.ok()).toBe(true);
  expect((await farm(context)).seedStock.carrot).toBe(3);
});

test("Cora sells seed at the city market", async ({ context, page }) => {
  await admit(context);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await start(page);
  await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.setClock(11));

  // Over the west bridge, then to the stalls where Cora stands.
  await tapTownPerson(page, "cora");

  const sheet = page.getByRole("dialog", { name: "Seed seller" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Cora");
  await expect(sheet).toContainText("Wheat is a forgiving crop");
  await expect(sheet).not.toContainText("early");
  await expect(sheet).toContainText("The rest can wait");
  const wheat = sheet.locator(".sa-stock-card", { hasText: "Wheat" });
  await expect(wheat).toBeVisible();

  const before = await farm(context);
  await wheat.getByRole("button", { name: /Buy/ }).first().click();
  await expect.poll(async () => (await farm(context)).seedStock.wheat ?? 0, { timeout: 10_000 }).toBeGreaterThan(before.seedStock.wheat ?? 0);
  expect((await farm(context)).profile.goldBalance).toBeLessThan(before.profile.goldBalance);
});
