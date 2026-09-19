import { expect, test, type Page } from "./fixtures";

/**
 * The avatar menu is the only dropdown in the app and M4 moved most of the
 * navigation into it, so a regression here quietly strands whole features.
 *
 * These cover the parts that break silently: a menu that opens but cannot be
 * closed with a keyboard, or that drops focus at the top of the document when
 * it closes, still looks completely fine in a screenshot.
 */

/**
 * Entry that holds at any width.
 *
 * The menu itself is shell chrome and renders on every viewport; the hub grid
 * does not. Below the shell's own 600px breakpoint the phone lobby replaces
 * it (see tests/e2e/mobile-shell.spec.ts), so anything narrow has to stop
 * here rather than wait for a grid that is never coming.
 */
async function enterLobby(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Play as guest" }).click();
  // The trigger, not the player name beside it: the name is hidden by CSS on
  // a narrow viewport, so gating on it would strand every phone-width spec.
  await expect(trigger(page)).toBeVisible();
}

async function openLobby(page: Page) {
  await enterLobby(page);
  // The hub only mounts once a profile exists, and the menu lives beside it.
  await expect(page.locator(".hub-grid")).toBeVisible();
  await expect(page.locator(".app-menu-player-name")).toBeVisible();
  // The heading carries no name: f9e4f04b moved the player's name up into
  // .lobby-kicker on purpose (see the comment above the <h1> in lobby.tsx).
  // Assert the name is rendered somewhere in the head rather than the exact
  // headline copy, so a future wording pass does not fail this again.
  await expect(page.locator(".hub-head h1")).toContainText("Pick your game");
  await expect(page.locator(".hub-head .lobby-kicker")).not.toBeEmpty();
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

/**
 * 640px, not a phone width. The avatar menu is desktop chrome: at or below
 * 600px `usePhoneViewport` swaps DesktopHeader for the tab bar and this
 * trigger does not render at all, so the old 390px version of this test was
 * asserting the containment of a control that is not on the page. 640 is the
 * narrowest viewport where the menu genuinely exists, which is exactly where
 * an overflowing panel would first show up.
 */
const NARROW = { width: 640, height: 844 };

test.describe("narrow viewport", () => {
  // test.use rather than browser.newContext: a hand-built context skips the
  // page fixture that closes the onboarding tour, and the tour would then sit
  // on top of the very panel this measures.
  test.use({ viewport: NARROW });

  test("the panel stays inside a narrow viewport", async ({ page }) => {
    // enterLobby, not openLobby: this test is about the menu, and pinning the
    // desktop hub's own contents here would only couple it to the lobby.
    await enterLobby(page);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();

    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(NARROW.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
