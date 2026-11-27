import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The "Town Square" and "The Far Field" labels on the Homestead: none in the middle of the field, one by each
 * gate as the farmer walks up to it.
 */

interface TopdownHandle {
  scene: {
    placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
    setClock: (hour: number | null) => void;
  };
}

type Handle = { __stackacres: TopdownHandle };

async function openFarm(context: BrowserContext, page: Page) {
  const profileResponse = await context.request.post("/api/profile");
  expect(profileResponse.ok()).toBe(true);
  const { profile } = (await profileResponse.json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  const access = await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } });
  expect(access.ok()).toBe(true);
  // The first-visit tour would sit over the map; it is its own spec's business.
  expect((await context.request.post("/api/profile/onboarding")).ok()).toBe(true);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: Ray's welcome would show, and no tap here goes near it.
    }
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.setClock(11));
}

async function place(page: Page, area: string, at: { x: number; y: number }) {
  await page.evaluate(({ area, at }) => (window as unknown as Handle).__stackacres.scene.placeFarmer(area, at), { area, at });
  await page.waitForTimeout(300);
}

const pill = (page: Page, to: string) => page.locator(`[data-gate-pointer="${to}"]`);

test("the gate labels show only near their gate", async ({ context, page }) => {
  await openFarm(context, page);

  // The middle of the field is a long way from both gates.
  await place(page, "homestead", { x: 496, y: 344 });
  await expect(pill(page, "city")).toHaveCount(0);
  await expect(pill(page, "empire")).toHaveCount(0);

  // Walking up to the west bridge brings its label, and only its label.
  await place(page, "homestead", { x: 70, y: 464 });
  await expect(pill(page, "city")).toHaveText("Town Square");
  await expect(pill(page, "empire")).toHaveCount(0);

  await place(page, "homestead", { x: 950, y: 480 });
  await expect(pill(page, "empire")).toHaveText("The Far Field");
  await expect(pill(page, "city")).toHaveCount(0);
});
