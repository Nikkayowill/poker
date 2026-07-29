import { expect, test, type BrowserContext } from "@playwright/test";

test("admin uses an HttpOnly session and bulk deletes a filtered profile group", async ({ browser }) => {
  const seedContexts: BrowserContext[] = [];
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    for (const name of ["Bulk E2E One", "Bulk E2E Two"]) {
      const context = await browser.newContext();
      seedContexts.push(context);
      const response = await context.request.post("/api/games/quick-play", {
        data: { name, tier: "1k", buyIn: 1000 },
      });
      expect(response.ok()).toBe(true);
    }

    const page = await adminContext.newPage();
    await page.goto("/admin");
    const keyInput = page.getByLabel("Admin key");
    await expect(keyInput).toHaveAttribute("type", "password");
    await keyInput.fill("playwright-admin-secret");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("heading", { name: "Players" })).toBeVisible();

    expect(
      await page.evaluate(() => window.sessionStorage.getItem("river-room-admin-secret")),
    ).toBeNull();
    const adminCookie = (await adminContext.cookies()).find(
      (cookie) => cookie.name === "river_room_admin_session",
    );
    expect(adminCookie?.httpOnly).toBe(true);
    expect(adminCookie?.value).not.toContain("playwright-admin-secret");

    await page.getByLabel("Search players").fill("Bulk E2E");
    await expect(page.locator(".admin-table tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "Select all 2 visible" }).click();
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete 2" }).click();
    await expect(page.locator(".admin-empty")).toContainText("No players match");
  } finally {
    await adminContext.close();
    await Promise.all(seedContexts.map((context) => context.close()));
  }
});
