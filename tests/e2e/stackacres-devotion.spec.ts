import { expect, test } from "@playwright/test";

/**
 * The Pixel Pilgrim: tapping him opens his dialogue, declining costs
 * nothing, and saying "yes" advances the devotion streak.
 *
 * Same tap-hook approach as stackacres-museum.spec.ts's own header: he has
 * no DOM element of his own (painted straight into the Phaser scene), so
 * this computes the exact screen point a real tap needs through
 * `window.__stackacres.screenPointFor` and dispatches a real pointer press
 * there.
 */

const MONK_WORLD_POINT = { x: -826, y: -11 }; // Centre of lib/stackacres/monk.ts's MONK_TAP_ZONE.

async function grantAndOpenStackAcres(
  context: import("@playwright/test").BrowserContext,
  page: import("@playwright/test").Page,
) {
  const profileResponse = await context.request.post("/api/profile");
  expect(profileResponse.ok()).toBe(true);
  const { profile } = (await profileResponse.json()) as { profile: { id: string } };

  const sessionResponse = await context.request.post("/api/admin/session", {
    data: { secret: "playwright-admin-secret" },
  });
  expect(sessionResponse.ok()).toBe(true);

  const accessResponse = await context.request.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(accessResponse.ok()).toBe(true);

  // Grandfather Ray's one-time welcome modal covers the whole screen and
  // would otherwise swallow the very first tap this test sends -- see
  // stackacres-museum.spec.ts's own note on the same gate.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Private browsing or blocked storage: nothing to do here either.
    }
  });

  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Tap to start StackAcres" }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  return profile;
}

async function screenPointFor(page: import("@playwright/test").Page, worldX: number, worldY: number) {
  return page.evaluate(
    ({ x, y }) =>
      (
        window as unknown as {
          __stackacres: { screenPointFor: (x: number, y: number) => { x: number; y: number } };
        }
      ).__stackacres.screenPointFor(x, y),
    { x: worldX, y: worldY },
  );
}

async function tapMonk(page: import("@playwright/test").Page) {
  const point = await screenPointFor(page, MONK_WORLD_POINT.x, MONK_WORLD_POINT.y);
  await page.mouse.click(point.x, point.y);
}

test("declining his prompt sends nothing and leaves the streak untouched", async ({ context, page }) => {
  await grantAndOpenStackAcres(context, page);

  await tapMonk(page);
  const dialog = page.getByRole("dialog", { name: "The Pixel Pilgrim" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Will you pray with me?")).toBeVisible();

  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/stackacres/actions")) requests.push(request.url());
  });

  await dialog.getByRole("button", { name: "Not today" }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toHaveLength(0);
});

test("praying with him advances the devotion streak, once per day", async ({ context, page }) => {
  await grantAndOpenStackAcres(context, page);

  await tapMonk(page);
  const dialog = page.getByRole("dialog", { name: "The Pixel Pilgrim" });
  await dialog.getByRole("button", { name: "Pray with him" }).click();

  await expect(dialog.getByText("Devotion, day 1.")).toBeVisible();

  await dialog.getByRole("button", { name: "Amen" }).click();
  await expect(dialog).toBeHidden();

  // A second prayer the same UTC day is a no-op, not a second streak day.
  await tapMonk(page);
  await dialog.getByRole("button", { name: "Pray with him" }).click();
  await expect(dialog.getByText(/already prayed with him today/i)).toBeVisible();
});
