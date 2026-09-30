import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * The StackAcres title screen (Play / Settings / Credits / Leave) and the
 * spotlight onboarding tour that fires the first time a profile reaches the
 * farm world.
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

test("the title screen offers Play, Settings, Credits and Leave", async ({ browser }) => {
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
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Credits", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave", exact: true })).toBeVisible();

    // Settings opens over the title screen; the farm hasn't booted.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await expect(settingsDialog).toBeVisible();
    expect(page.url()).toContain("/games/stackacres");
    expect(await page.evaluate(() => "__stackacres" in window)).toBe(false);
    const soundRow = settingsDialog.getByRole("button", { name: /Sound/ });
    const before = await soundRow.textContent();
    await soundRow.click();
    await expect(soundRow).not.toHaveText(before ?? "");

    // The player profile moved into Settings. Enabled once the background
    // profile fetch resolves.
    const profileRow = settingsDialog.getByRole("button", { name: /Player profile/ });
    await expect(profileRow).toBeEnabled({ timeout: 15_000 });
    await profileRow.click();
    const profileDialog = page.getByRole("dialog", { name: "Edit player details" });
    await expect(profileDialog).toBeVisible();
    await profileDialog.getByLabel("Close profile editor").click();
    await expect(profileDialog).toBeHidden();
    await page.getByRole("dialog", { name: "Settings" }).getByLabel("Close settings").click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

    // Credits names the artists and links the full list.
    await page.getByRole("button", { name: "Credits", exact: true }).click();
    const credits = page.getByRole("dialog", { name: "Credits" });
    await expect(credits).toBeVisible();
    await expect(credits.getByRole("link", { name: /Every credit/ })).toHaveAttribute("href", "/credits");
    await credits.getByLabel("Close credits").click();
    await expect(credits).toBeHidden();

    // Play enters the farm.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("Leave goes back to the arcade", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 10_000);

    const page = await farmerContext.newPage();
    await page.goto("/games/stackacres");
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/games/stackacres"), { timeout: 30_000 });
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
