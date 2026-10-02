import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The Farm Planner panel, from the outside: the objective it names, what it
 * says is missing and where that comes from, the button it offers, and the
 * one thing a unit test cannot show -- that finishing the objective moves the
 * panel on to the next one without the player asking it to.
 *
 * Wood is granted through /api/admin/stackacres-items rather than chopped:
 * felling the Homestead's trees is its own spec (stackacres-wood.spec.ts) and
 * three swings a tree is a lot of canvas taps to prove a panel updates.
 */

const ADMIN_SECRET = "playwright-admin-secret";

/** Tall enough that the HUD is in its roomy tier, so the panel shows its
 *  "why it matters" line rather than dropping it for a short phone. */
test.use({ viewport: { width: 1280, height: 720 } });

/** Gets one crop into the ground so the farm is past the seed cues and on to its first building. A truly
 *  empty farm is told to sow or to see Cora instead (stackacres-seed-seller.spec.ts). */
async function plantOneCrop(context: BrowserContext) {
  const act = (data: Record<string, unknown>) => context.request.post("/api/stackacres/actions", { data });
  expect((await act({ action: "buy-seed", crop: "wheat", quantity: 1 })).ok()).toBe(true);
  expect((await act({ action: "place-soil-tile", tx: -6, ty: 2 })).ok()).toBe(true);
  expect((await act({ action: "stock", stock: "wheat", tx: -6, ty: 2 })).ok()).toBe(true);
  // Ray is how a new player is first pointed at things, so meet him; a person waiting to be met would lead the panel.
  expect((await act({ action: "story-meet", traveler: "ray" })).ok()).toBe(true);
  // A seed starts dry, and a dry bed is its own cue, so water it.
  const farm = (await (await context.request.get("/api/stackacres")).json()) as { units: { id: string }[] };
  expect((await act({ action: "water", unitId: farm.units[0].id })).ok()).toBe(true);
}

async function openStackAcres(context: BrowserContext, page: Page) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };

  expect((await context.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  // Plenty of Gold and no Wood, so the first objective is short of exactly one
  // thing and the panel has something real to name.
  expect(
    (await context.request.post("/api/admin/gold/adjust", {
      data: { profileId: profile.id, delta: 20_000 - profile.goldBalance },
    })).ok(),
  ).toBe(true);

  await plantOneCrop(context);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await enterFarm(page);
  return profile.id;
}

async function enterFarm(page: Page) {
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);
}

async function grantWood(context: BrowserContext, profileId: string, delta: number) {
  const granted = await context.request.post("/api/admin/stackacres-items", {
    data: { profileId, item: "wood", delta },
  });
  expect(granted.ok()).toBe(true);
}

test("the planner names the Mill, then advances to the Oven once the Mill is up", async ({ context, page }) => {
  const profileId = await openStackAcres(context, page);

  const panel = page.locator(".sa-next");
  await expect(panel).toBeVisible();

  // One objective, why it matters, what is missing, and where the missing
  // thing comes from. Every one of those numbers is the machine catalogue's.
  await expect(panel.getByRole("heading", { name: "Build the Feed Grinder" })).toBeVisible();
  await expect(panel).toContainText("Grow wheat");
  await expect(panel).toContainText("Missing:");
  await expect(panel).toContainText("15 Wood");
  await expect(panel).toContainText("Chop the trees");
  // The Gold is already in hand, so it is not on the missing list.
  await expect(panel.locator(".sa-next-missing")).not.toContainText("Gold");

  // Hand over the Wood. The objective is the same piece of work, so the panel
  // stays on it and only stops asking for anything.
  await grantWood(context, profileId, 15);
  await enterFarm(page);
  await expect(panel.getByRole("heading", { name: "Build the Feed Grinder" })).toBeVisible();
  await expect(panel).toContainText("Everything it needs is in hand");

  // The button goes to the room the Mill actually goes up in.
  await panel.getByRole("button", { name: "Open Workshop" }).click();
  const workshop = page.getByRole("dialog", { name: "The Workshop" });
  await expect(workshop).toBeVisible();

  await workshop
    .locator(".sa-workshop-machine", { hasText: "Feed Grinder" })
    .getByRole("button", { name: /Build/ })
    .first()
    .click();
  await expect(workshop.locator(".sa-workshop-machine", { hasText: "Feed Grinder" }).getByRole("button", { name: /Build/ })).toHaveCount(
    0,
    { timeout: 10_000 },
  );
  await workshop.getByRole("button", { name: "Done" }).click();
  await expect(workshop).toBeHidden();

  // Nobody asked the panel to refresh: the objective was derived from the
  // snapshot, the snapshot changed, so the panel is already on the next one.
  await expect(panel.getByRole("heading", { name: "Build the Oven" })).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("heading", { name: "Build the Feed Grinder" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Open your kitchen" })).toBeVisible();
});

test("the planner can be hidden, and the Next button brings it back", async ({ context, page }) => {
  await openStackAcres(context, page);

  const panel = page.locator(".sa-next");
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Hide what to do next" }).click();
  await expect(panel).toHaveCount(0);

  // Scoped to the class, not the accessible name: `next dev` puts its own
  // "Next.js Dev Tools" button on every page and that matches "Next" too.
  await expect(page.locator(".sa-next-reopen")).toBeVisible();

  // It stays hidden across a visit -- the choice is remembered on the device.
  await enterFarm(page);
  await expect(page.locator(".sa-next")).toHaveCount(0);
  await page.locator(".sa-next-reopen").click();
  await expect(page.locator(".sa-next")).toBeVisible();
});
