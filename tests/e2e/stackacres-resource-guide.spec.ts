import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The Resource Guide, from the outside: open it from the HUD, pick an item
 * the farmer is holding, read what it is for, and follow a use to the screen
 * that spends it.
 *
 * Wood is the item because it is the one a fresh farmer can get over HTTP
 * (three swings at a tree) and it has a use that opens a real screen: the
 * Mill and the Loom are built from it at the Workshop.
 */

const ADMIN_SECRET = "playwright-admin-secret";

test.use({ viewport: { width: 1280, height: 800 } });

async function openStackAcresWithWood(context: BrowserContext, page: Page) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);

  for (let swing = 0; swing < 3; swing += 1) {
    const chopped = await context.request.post("/api/stackacres/actions", {
      data: { action: "chop-tree", nodeId: "homestead-1" },
    });
    expect(chopped.ok()).toBe(true);
  }

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: the welcome would show, and the test would say so.
    }
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
}

/** On a short landscape phone the HUD badges sit behind a More button. */
async function openGuide(page: Page) {
  const guideButton = page.getByRole("button", { name: "Resource Guide" });
  if (!(await guideButton.isVisible())) await page.getByRole("button", { name: "More" }).click();
  await guideButton.click();
  return page.getByRole("dialog", { name: "What you are carrying" });
}

test("a resource guide opens from the inventory and leads to the screen that uses it", async ({ context, page }) => {
  await openStackAcresWithWood(context, page);

  const guide = await openGuide(page);
  await expect(guide).toBeVisible();

  await guide.getByRole("button", { name: /^Wood, \d+ held$/ }).click();
  const detail = page.getByRole("dialog", { name: "Wood" });
  await expect(detail.getByText(/^You have [1-9]/)).toBeVisible();

  // What it is for: the machines built from it, and selling it.
  const uses = detail.getByRole("list", { name: "Uses" });
  await expect(uses.getByText("Build the Mill")).toBeVisible();
  await expect(uses.getByText("Build the Loom")).toBeVisible();

  // Where to get more: an open source, with no "not open yet" on it.
  const sources = detail.getByRole("list", { name: "Sources" });
  await expect(sources.getByText("Chop the trees on the Homestead")).toBeVisible();
  await expect(sources.getByText(/Not open yet/)).toHaveCount(0);

  // Follow a use: the guide closes and the Workshop opens.
  await uses.getByRole("listitem").filter({ hasText: "Build the Mill" }).getByRole("button", { name: "Open the Workshop" }).click();
  await expect(page.getByRole("dialog", { name: "What you are carrying" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "The Workshop" })).toBeVisible();
});

test("an item whose source is shut says so instead of pointing at it", async ({ context, page }) => {
  await openStackAcresWithWood(context, page);

  const guide = await openGuide(page);
  await guide.getByRole("button", { name: /^Show all \d+ items$/ }).click();
  await guide.getByRole("button", { name: /^Stone, 0 held$/ }).click();

  const detail = page.getByRole("dialog", { name: "Stone" });
  const sources = detail.getByRole("list", { name: "Sources" });
  await expect(sources.getByText(/Not open yet/)).toBeVisible();
  await expect(sources.getByRole("button")).toHaveCount(0);
});
