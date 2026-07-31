import { expect, test, type Page } from "@playwright/test";

/**
 * The avatar menu is the only dropdown in the app and M4 moved most of the
 * navigation into it, so a regression here quietly strands whole features.
 *
 * These cover the parts that break silently: a menu that opens but cannot be
 * closed with a keyboard, or that drops focus at the top of the document when
 * it closes, still looks completely fine in a screenshot.
 */

async function openLobby(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Play as guest" }).click();
  // The hub only mounts once a profile exists, and the menu lives beside it.
  await expect(page.locator(".hub-grid")).toBeVisible();
}

const trigger = (page: Page) => page.getByRole("button", { name: "Open player menu" });
const panel = (page: Page) => page.getByRole("menu", { name: "Open player menu" });

test("the player menu opens, closes, and reports its state", async ({ page }) => {
  await openLobby(page);

  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page)).toHaveCount(0);

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");

  await trigger(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
});

test("Escape closes the menu and puts focus back on the trigger", async ({ page }) => {
  await openLobby(page);
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  // The part that matters. Without an explicit focus return, a keyboard user
  // is dropped at the top of the document and has to tab back through the
  // whole header to reach where they already were.
  const focusedLabel = await page.evaluate(() =>
    document.activeElement?.getAttribute("aria-label"),
  );
  expect(focusedLabel).toBe("Open player menu");
});

test("clicking outside closes the menu", async ({ page }) => {
  await openLobby(page);
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  await page.locator(".hub-head h1").click();
  await expect(panel(page)).toHaveCount(0);
});

test("arrow keys move through the items and wrap", async ({ page }) => {
  await openLobby(page);
  await trigger(page).focus();
  // ArrowDown on the trigger opens onto the first item, the way a native
  // menu button does -- not merely opens.
  await page.keyboard.press("ArrowDown");
  await expect(panel(page)).toBeVisible();

  const items = panel(page).getByRole("menuitem");
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();

  // Up from the first entry wraps to the last, because a menu is a ring and
  // stopping dead at the end is what makes keyboard nav feel broken.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(items.last()).toBeFocused();
});

test("choosing an item runs it and closes the menu", async ({ page }) => {
  await openLobby(page);
  await trigger(page).click();
  await panel(page).getByRole("menuitem", { name: "Edit profile" }).click();

  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /edit player details/i })).toBeVisible();
});

test("the panel stays inside a 390px viewport", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await openLobby(page);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();

    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});
