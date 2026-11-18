import { expect, test } from "./fixtures";

test.use({ viewport: { width: 932, height: 430 } });

test("a new farm opens in the morning, whatever time it is when the player arrives", async ({ context, page }) => {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));

  // 6 AM at the first open. The label moves every few seconds, so allow the boot to take it a little past.
  await expect(page.locator(".sa-clock")).toHaveText(/^\s*[67]:\d0 AM/);

  const view = (await (await page.request.get("/api/stackacres")).json()) as { clock: { fresh: boolean } };
  expect(view.clock.fresh).toBe(false);
});
