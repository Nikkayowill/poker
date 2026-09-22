import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * The new StackAcres entry screen (Play / Profile / Settings, replacing the
 * old single tap-to-play affordance) and the spotlight onboarding tour that
 * fires the first time a profile ever reaches the farm world.
 */

const ADMIN_SECRET = "playwright-admin-secret";

async function admitFarmer(context: BrowserContext, admin: APIRequestContext, gold: number) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };

  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);

  const delta = gold - profile.goldBalance;
  if (delta !== 0) {
    const topped = await admin.post("/api/admin/gold/adjust", {
      data: { profileId: profile.id, delta },
    });
    expect(topped.ok()).toBe(true);
  }
  return profile.id;
}

test("the entry screen offers Play, Profile and Settings without leaving StackAcres", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 10_000);

    const page = await farmerContext.newPage();
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => {};
      try {
        window.localStorage.setItem("sa-ray-welcomed", "1");
      } catch {
        // Blocked storage: not what this test is checking.
      }
    });
    await page.goto("/games/stackacres");

    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Profile/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Settings/ })).toBeVisible();

    // Settings opens in place, over the same entry screen.
    await page.getByRole("button", { name: /Settings/ }).click();
    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await expect(settingsDialog).toBeVisible();
    // "In place" means the entry screen is still underneath and the farm has
    // not booted -- not that the menu is unmounted. The panel is an overlay
    // over the same screen, so the Play button stays in the page behind it.
    expect(page.url()).toContain("/games/stackacres");
    expect(await page.evaluate(() => "__stackacres" in window)).toBe(false);
    const soundRow = settingsDialog.getByRole("button", { name: /Sound/ });
    const before = await soundRow.textContent();
    await soundRow.click();
    await expect(soundRow).not.toHaveText(before ?? "");
    await settingsDialog.getByLabel("Close settings").click();
    await expect(settingsDialog).toBeHidden();

    // Profile opens the same overlay the main lobby uses, still without
    // leaving /games/stackacres. Disabled until the background profile fetch
    // (still running under this screen) resolves.
    const profileButton = page.getByRole("button", { name: /Profile/ });
    await expect(profileButton).toBeEnabled({ timeout: 15_000 });
    await profileButton.click();
    const profileDialog = page.getByRole("dialog", { name: "Edit player details" });
    await expect(profileDialog).toBeVisible();
    expect(page.url()).toContain("/games/stackacres");
    await profileDialog.getByLabel("Close profile editor").click();
    await expect(profileDialog).toBeHidden();

    // Play still does what tap-to-play always did: it enters the farm.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("a first-time profile gets the spotlight tour over the tool belt, the world and Gold", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 10_000);

    const page = await farmerContext.newPage();
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => {};
      try {
        window.localStorage.setItem("sa-ray-welcomed", "1");
      } catch {
        // Not what this test is checking; the tour is server-side.
      }
    });
    await page.goto("/games/stackacres");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });

    // driver.js's popover carries this class regardless of which step is live.
    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible({ timeout: 15_000 });
    await expect(popover).toContainText("tool belt");

    await popover.getByRole("button", { name: /next/i }).click();
    await expect(popover).toContainText("Tap to work the land");

    await popover.getByRole("button", { name: /next/i }).click();
    await expect(popover).toContainText("shared balance");

    // Finishing marks it done server-side, so a reload never shows it again.
    await popover.getByRole("button", { name: /done/i }).click();
    await expect(popover).toBeHidden();

    const profile = await (await page.request.get("/api/profile")).json();
    expect(profile.profile.onboardingTourCompletedAt).not.toBeNull();
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
