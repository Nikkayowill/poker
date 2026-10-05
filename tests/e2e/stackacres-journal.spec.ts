import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The Journal: the one sheet that answers "what now, and why does it matter",
 *
 * Three blocks. The top line is the reactive one, so it is checked against a
 * farm state the test sets up rather than against a fixed string: a brand new
 * farm with Gold and no Wood has to be told about the Wood, and the same line
 * has to be on the chip without opening anything.
 */

test.use({ viewport: { width: 932, height: 430 } });

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
  const { profile } = (await (await context.request.post("/api/profile")).json()) as {
    profile: { id: string; goldBalance: number };
  };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  expect(
    (await context.request.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: 20_000 - profile.goldBalance } })).ok(),
  ).toBe(true);
  await plantOneCrop(context);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);
}

/** At this viewport height the HUD is in its tight-landscape tier, so the
 *  Journal chip lives behind the "More" drawer instead of sitting inline. */
async function openMore(page: Page) {
  await page.getByRole("button", { name: "More" }).click();
}

test("the chip's title and the sheet's line are the same line", async ({ context, page }) => {
  await openStackAcres(context, page);
  await openMore(page);

  // The chip is a compact badge now (icon + "1/4"); the line it used to show
  // in its own text lives in the title and in the sheet, not duplicated on
  // screen. The title is "<chapter>: <now line>".
  const chip = page.getByTitle(/^Chapter 1/);
  const title = (await chip.getAttribute("title")) ?? "";
  const line = title.split(": ").slice(1).join(": ");
  expect(line).toContain("Feed Grinder");
  expect(line).toContain("Wood");

  await chip.click();
  const sheet = page.getByRole("dialog", { name: "The Journal" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".sa-journal-now-line")).toContainText(line);
});

test("the sheet says what filled up while the player was away", async ({ context, page }) => {
  await openStackAcres(context, page);
  await openMore(page);
  await page.getByTitle(/^Chapter 1/).click();
  const sheet = page.getByRole("dialog", { name: "The Journal" });
  await expect(sheet).toBeVisible();

  // A farm with nothing built still has things regrowing, which is the whole
  // point: the return loop starts on day one, not at the Farm Kitchen.
  const waiting = sheet.locator(".sa-journal-waiting > li");
  await expect(waiting.filter({ hasText: "The trees" })).toContainText("4 of 4 ready");
  await expect(waiting.filter({ hasText: "The bushes" })).toContainText("4 of 4 ready");
  // The Mine is gone from the world, so the journal must not wait on it.
  await expect(waiting.filter({ hasText: "The Mine" })).toHaveCount(0);
});

test("the sheet shows both tracks: the buildings and the reach", async ({ context, page }) => {
  await openStackAcres(context, page);
  await openMore(page);
  await page.getByTitle(/^Chapter 1/).click();
  const sheet = page.getByRole("dialog", { name: "The Journal" });
  await expect(sheet).toBeVisible();

  // The production track: every chapter, and the Mill's real cost, where
  // it goes up, where the Wood comes from and what it opens.
  for (const title of ["Bread", "Stew", "Fresh Greens", "Feed the Herd"]) {
    await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
  }
  // Chapter 1's first step. Locate it by position, not by the word "Mill".
  const mill = sheet.locator(".sa-goals-list > li").first().locator("ul > li").first();
  await expect(mill).toContainText("in the Workshop");
  await expect(mill).toContainText("0 / 15 Wood");
  await expect(mill).toContainText("Chop the trees by the workshop and the house");
  await expect(mill).toContainText("Opens Corn and Green Bean seeds");

  // The expansion track, which had no surface at all before this sheet.
  await expect(sheet).toContainText("Standing 1 of 6");
  for (const flag of [
    "Break ground in the Crop Fields",
    "Fill an order for the town",
    "Buy a Sheep Pen",
    "Raise the Greenhouse",
    "Buy a Cattle Pen",
  ]) {
    await expect(sheet.locator(".sa-journal-reach")).toContainText(flag);
  }
  // No remaining traveler is pinned to a flag any more (all three are
  // milestone-gated) -- Knight Arthur left with the six removed districts
  // (lib/stackacres/story/travelers.ts's own header), so no reach step
  // shows a "Brings" line now.
  await expect(sheet.locator(".sa-journal-reach")).not.toContainText("Brings");
  // The first acre prices the Crop Fields, and a sheep prices the Fold.
  await expect(sheet.locator(".sa-journal-reach")).toContainText("300 Gold + 15 Wood + 5 Stone");
  await expect(sheet.locator(".sa-journal-reach")).toContainText("8,500 Gold");
  await expect(sheet.locator(".sa-journal-reach")).not.toContainText("Not open yet");
  await expect(sheet.locator(".sa-journal-foot")).toContainText("Chef Pierre");
});
