import { expect, test, type BrowserContext } from "@playwright/test";

test("admin uses an HttpOnly session and bulk deletes a filtered profile group", async ({ browser }) => {
  const seedContexts: BrowserContext[] = [];
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    for (const name of ["Bulk E2E One", "Bulk E2E Two"]) {
      const context = await browser.newContext();
      seedContexts.push(context);
      // Own a session first: the rate limiter keys on the session token and
      // only falls back to the source IP, so cookieless callers all share one
      // bucket in local dev. See tests/e2e/visual-layering.spec.ts.
      await context.request.post("/api/profile");
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

    // Scanned by value rather than by key name. This used to read one
    // hardcoded key that no source file has ever written, so it returned null
    // and passed whatever the dashboard did with the secret -- including
    // storing it under any other name. The point of the assertion is that the
    // key the operator typed does not survive in client-readable storage, so
    // that is what it checks.
    const storedSecret = await page.evaluate(() => {
      const readAll = (storage: Storage) =>
        Object.keys(storage).map((key) => `${key}=${storage.getItem(key) ?? ""}`);
      return [...readAll(window.sessionStorage), ...readAll(window.localStorage)];
    });
    expect(storedSecret.filter((entry) => entry.includes("playwright-admin-secret"))).toEqual([]);

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
