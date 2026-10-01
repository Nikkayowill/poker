import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The barn routine, end to end: buy an animal, open the barn off the HUD,
 * find it there by name, tend it, and watch the card and the badge both
 * settle into "done for today" without a reload.
 *
 * The second tend is the point of the last test. One tend per animal per UTC
 * day is enforced in three places -- the button disables itself, the
 * optimistic guess refuses to make one, and the server's own UPDATE carries
 * the day in its where clause -- and this is the only check that all three
 * agree from the outside.
 */

const ADMIN_SECRET = "playwright-admin-secret";
/** A landscape phone: under the 500px height that folds the HUD into the
 *  "More" drawer (components/use-tight-landscape.ts). */
const LANDSCAPE_PHONE = { width: 844, height: 390 };
/** A landscape tablet: over that height, so every HUD badge stays inline and
 *  can be watched while a sheet is open. */
const LANDSCAPE_TABLET = { width: 1024, height: 640 };

async function farmAction(context: BrowserContext, data: Record<string, unknown>) {
  const response = await context.request.post("/api/stackacres/actions", { data });
  expect(response.ok(), `setup ${String(data.action)} failed`).toBe(true);
  return response;
}

/**
 * A funded farm with `animals` cattle already bought, opened on a landscape
 * phone. The animals go in over the API rather than through the shop, which
 * is a different feature's flow and not what this spec is about.
 */
async function openBarnFarm(context: BrowserContext, page: Page, animals = 2) {
  const profileResponse = await context.request.post("/api/profile");
  expect(profileResponse.ok()).toBe(true);
  const { profile } = (await profileResponse.json()) as {
    profile: { id: string; goldBalance: number };
  };

  const sessionResponse = await context.request.post("/api/admin/session", {
    data: { secret: ADMIN_SECRET },
  });
  expect(sessionResponse.ok()).toBe(true);

  const accessResponse = await context.request.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(accessResponse.ok()).toBe(true);

  const topUp = await context.request.post("/api/admin/gold/adjust", {
    data: { profileId: profile.id, delta: 400_000 - profile.goldBalance },
  });
  expect(topUp.ok()).toBe(true);

  for (let bought = 0; bought < animals; bought += 1) {
    await farmAction(context, { action: "stock", stock: "cattle" });
  }

  // Ray's one-time welcome covers the screen and would swallow the first tap.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Private browsing or blocked storage: nothing to do here either.
    }
  });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });

  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  return profile;
}

/**
 * Opens the barn off its HUD badge.
 *
 * On a tablet the badge sits inline and this is one tap. On a landscape
 * phone the whole secondary HUD folds into the "More" drawer, and that
 * drawer closes on any tap inside it (stackacres-hud-overflow.tsx), so the
 * badge is gone by the time the sheet is up -- which is why only the
 * phone-sized test below goes through it, and the badge assertions live on
 * the tablet.
 */
async function openBarn(page: Page) {
  const badge = page.locator(".sa-barn-badge");
  if ((await badge.count()) === 0) {
    await page.getByRole("button", { name: /^more$/i }).first().click();
  }
  await expect(badge.first()).toBeVisible({ timeout: 15_000 });
  await badge.first().click();
  const sheet = page.getByRole("dialog", { name: "Who lives here" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.use({ viewport: LANDSCAPE_TABLET, hasTouch: true });

test("the barn lists every animal by name, with a status and a mood", async ({ context, page }) => {
  await openBarnFarm(context, page, 2);

  const sheet = await openBarn(page);
  const cards = sheet.locator(".sa-barn-card");
  await expect(cards).toHaveCount(2);

  // A name, not "Cattle Pen #2": the whole point of the feature.
  const first = cards.first();
  await expect(first.locator(".sa-barn-who strong")).not.toHaveText("");
  await expect(first.locator(".sa-barn-kind")).toHaveText("Cattle Pen");
  // Fresh animals are fed and untended, so both say the same thing.
  await expect(first.locator(".sa-barn-status")).toHaveText("Needs attention");
  await expect(first.locator(".sa-barn-mood")).toHaveText("Restless");
});

test("tending an animal answers straight away and does not charge anything", async ({
  context,
  page,
}) => {
  await openBarnFarm(context, page, 1);

  const goldBefore = await page.locator(".floor-wallet strong").textContent();
  const sheet = await openBarn(page);
  const card = sheet.locator(".sa-barn-card").first();
  const name = await card.locator(".sa-barn-who strong").textContent();

  await card.getByRole("button", { name: /^Tend/ }).click();

  // Optimistic: the card settles without waiting for the round trip.
  await expect(card.getByRole("button", { name: "Tended" })).toBeVisible({ timeout: 2_000 });
  await expect(card.locator(".sa-barn-status")).toHaveText("Content");
  await expect(card.locator(".sa-barn-streak")).toHaveText("1 day streak");
  // Same animal throughout -- the name is derived from its id, so it cannot
  // change under a re-render.
  await expect(card.locator(".sa-barn-who strong")).toHaveText(name ?? "");

  // Tending is free. Gold must not have moved.
  await expect(page.locator(".floor-wallet strong")).toHaveText(goldBefore ?? "");
});

test("a tend survives a reload, and the same day cannot be tended twice", async ({
  context,
  page,
}) => {
  await openBarnFarm(context, page, 1);

  const sheet = await openBarn(page);
  const card = sheet.locator(".sa-barn-card").first();
  await card.getByRole("button", { name: /^Tend/ }).click();
  await expect(card.getByRole("button", { name: "Tended" })).toBeVisible({ timeout: 2_000 });

  // The server kept it: a fresh page still shows the animal as tended.
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });

  const reopened = await openBarn(page);
  const sameCard = reopened.locator(".sa-barn-card").first();
  await expect(sameCard.getByRole("button", { name: "Tended" })).toBeVisible();
  await expect(sameCard.getByRole("button", { name: "Tended" })).toBeDisabled();
  await expect(sameCard.locator(".sa-barn-streak")).toHaveText("1 day streak");

  // And the server refuses it directly too, not just the greyed-out button.
  const second = await context.request.post("/api/stackacres/actions", {
    data: { action: "care", unitId: await firstUnitId(context) },
  });
  expect(second.status()).toBe(409);
});

/** The id of the farm's first animal, read back off the farm's own read. */
async function firstUnitId(context: BrowserContext): Promise<string> {
  const response = await context.request.get("/api/stackacres");
  expect(response.ok()).toBe(true);
  const { units } = (await response.json()) as { units: { id: string; stock: string }[] };
  const animal = units.find((unit) => unit.stock === "cattle");
  if (!animal) throw new Error("no cattle on this farm");
  return animal.id;
}

test.describe("on a landscape phone", () => {
  test.use({ viewport: LANDSCAPE_PHONE, hasTouch: true, isMobile: true });

  test("the barn is reachable from the folded HUD drawer", async ({ context, page }) => {
    await openBarnFarm(context, page, 1);

    // The secondary HUD is behind "More" at this height, so the badge is not
    // on screen until the drawer is open.
    await expect(page.locator(".sa-barn-badge")).toHaveCount(0);

    const sheet = await openBarn(page);
    const card = sheet.locator(".sa-barn-card").first();
    await card.getByRole("button", { name: /^Tend/ }).click();
    await expect(card.getByRole("button", { name: "Tended" })).toBeVisible({ timeout: 2_000 });
  });
});

test("the badge counts what still wants something and clears when nothing does", async ({
  context,
  page,
}) => {
  await openBarnFarm(context, page, 2);

  const sheet = await openBarn(page);
  const cards = sheet.locator(".sa-barn-card");
  // Two untended animals: the badge is the reminder, and it is lit.
  await expect(page.locator(".sa-barn-badge strong")).toHaveText("2");
  await expect(page.locator(".sa-barn-badge")).toHaveClass(/is-waiting/);

  await cards.nth(0).getByRole("button", { name: /^Tend/ }).click();
  await expect(cards.nth(0).getByRole("button", { name: "Tended" })).toBeVisible({ timeout: 2_000 });
  await expect(page.locator(".sa-barn-badge strong")).toHaveText("1");

  await cards.nth(1).getByRole("button", { name: /^Tend/ }).click();
  await expect(cards.nth(1).getByRole("button", { name: "Tended" })).toBeVisible({ timeout: 2_000 });

  // Nobody wants anything: the badge stops shouting and shows the headcount.
  await expect(page.locator(".sa-barn-badge")).not.toHaveClass(/is-waiting/);
  await expect(page.locator(".sa-barn-badge strong")).toHaveText("2");
  await expect(sheet.getByText("Everyone has had your time today.")).toBeVisible();
});
