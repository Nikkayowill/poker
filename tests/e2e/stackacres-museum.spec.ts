import { expect, test } from "@playwright/test";

/**
 * Ray's Museum's map entryway: tapping the barn opens the museum, and the
 * first item a player ever collects shows up in it as found.
 *
 * The barn has no DOM element of its own -- it is painted straight into the
 * Phaser scene, the same as every unit and every other prop -- so this spec
 * cannot locate it with a Playwright selector. Instead it computes the exact
 * screen point a real tap would need to land on right now, through
 * `window.__stackacres.screenPointFor`, the dev-only test hook
 * stackacres-world.tsx exposes for exactly this (the mathematical inverse of
 * the scene's own `resolveWorld`, so it is correct under whatever the
 * camera's current pan/zoom happens to be rather than a screenshot-tuned
 * guess). `page.mouse.click` then dispatches a real, trusted pointer press at
 * that point -- the same event the scene's own `bindInput` listens for.
 */

const BARN_WORLD_POINT = { x: 108, y: 3 }; // The centre of lib/stackacres/world.ts's BARN_FOOTPRINT.

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

  // Grandfather Ray's one-time welcome modal covers the whole screen (it is
  // `.profile-overlay`, the same full-bleed backdrop every modal here uses)
  // and would otherwise swallow the very first tap this test sends. It is
  // gated on a plain localStorage flag, not a server fact -- see
  // stackacres-ray-welcome.tsx's own doc comment.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Private browsing or blocked storage: nothing to do here either.
    }
  });

  await page.goto("/games/stackacres");
  // The tap-to-play splash gates everything else (see StackAcresPlayScreen) --
  // a real gesture is required before the canvas mounts input at all.
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

test("tapping the barn opens Ray's Museum", async ({ context, page }) => {
  await grantAndOpenStackAcres(context, page);

  const point = await screenPointFor(page, BARN_WORLD_POINT.x, BARN_WORLD_POINT.y);
  await page.mouse.click(point.x, point.y);

  const dialog = page.getByRole("dialog", { name: /found/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Ray's Choice Crops")).toBeVisible();
  await expect(dialog.getByText("Exotic Livestock Wonders")).toBeVisible();
  await expect(dialog.getByText("Bountiful Forage")).toBeVisible();
  // A fresh farm has donated nothing yet.
  await expect(dialog.getByText("0 of 5 found")).toBeVisible();

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).not.toBeVisible();
});

test("a tap on ordinary district ground does not open the museum", async ({ context, page }) => {
  // BARN_FOOTPRINT and every district's GROW_AREA are held apart in
  // world.test.ts's own "misses ... every district's own ground" case, which
  // is what makes this reachable at all -- this is the wiring-level half of
  // that guarantee: a tap that should open the seed radial must not also (or
  // instead) be read as a barn tap by stackacres-scene.ts's `up()` handler.
  await grantAndOpenStackAcres(context, page);

  // The middle of the Farmstead's own grow area (lib/stackacres/world.ts's
  // GROW_AREA.farmstead), well clear of the barn.
  const point = await screenPointFor(page, 250, 280);
  await page.mouse.click(point.x, point.y);

  // `.sa-radial-ring` itself (role="group") is a zero-size anchor its own
  // buttons are transformed radially around, so it never satisfies
  // Playwright's own bounding-box visibility check even though it (and what
  // it holds) is genuinely on screen -- assert on the option it actually
  // rendered instead.
  await expect(page.locator(".sa-radial-btn").first()).toBeVisible();
  await expect(page.getByRole("dialog", { name: /found/i })).not.toBeVisible();
});
