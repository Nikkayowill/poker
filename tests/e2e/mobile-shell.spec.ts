import { expect, test, type Page } from "@playwright/test";

/**
 * The phone lobby: three panes on a track, a tab bar, and a swipe.
 *
 * Why this file exists rather than a unit test. `lib/ui/swipe-pager.ts` already
 * pins the gesture maths, and it passes whether or not a finger can reach it --
 * the parts that can silently stop working are all outside that module:
 *
 *   - `usePhoneViewport` is a live `matchMedia` subscription. A subscription
 *     that never fires is indistinguishable from one that does until the
 *     viewport actually changes size, which is the same trap
 *     `racetrack-landscape.spec.ts` was written for.
 *   - The panes are the real `/games` and `/leaderboard` components with
 *     `embedded` set. If either grows a hard dependency on being a route, it
 *     breaks here and nowhere else.
 *   - The tab bar has to stay on screen while a pane scrolls under it. That is
 *     a flex/overflow arrangement, so nothing but a rendered page can check it.
 */

const PHONE = { width: 390, height: 844 };
/** Wider than the shell's own 600px breakpoint, so the hub grid should win. */
const DESKTOP = { width: 1280, height: 900 };

async function enterAsGuest(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Play as guest" }).click();
}

function tabBar(page: Page) {
  return page.getByRole("navigation", { name: "Lobby sections" });
}

function pane(page: Page, name: string) {
  return page.locator(`.mshell-pane[aria-label="${name}"]`);
}

test.describe("phone lobby", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test("opens on Play, with the poker hero and the tab bar", async ({ page }) => {
    await enterAsGuest(page);

    await expect(tabBar(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Take a seat" })).toBeVisible();
    // The hub grid is the desktop layout and must not also be here.
    await expect(page.locator(".hub-grid")).toHaveCount(0);
  });

  test("a tab tap moves to that pane and marks it current", async ({ page }) => {
    await enterAsGuest(page);
    const nav = tabBar(page);

    await nav.getByRole("button", { name: "Ante Up", exact: true }).click();
    await expect(nav.getByRole("button", { name: "Ante Up", exact: true }))
      .toHaveAttribute("aria-current", "page");

    // The arcade floor's own heading, proving the route component rendered
    // inline rather than a second copy of the catalogue.
    await expect(pane(page, "Ante Up").getByText("more ways in.")).toBeVisible();

    await nav.getByRole("button", { name: "You", exact: true }).click();
    await expect(pane(page, "You").getByRole("heading", { name: "The leaderboard." }))
      .toBeVisible();
  });

  /* Panes that are off-screen are still in the document. Without `inert` they
     stay in the tab order and are still announced, so the screen reads as
     three lobbies at once. */
  test("only the current pane is reachable", async ({ page }) => {
    await enterAsGuest(page);

    await expect(pane(page, "Play")).not.toHaveAttribute("inert", /.*/);
    await expect(pane(page, "Ante Up")).toHaveAttribute("inert", /.*/);
    await expect(pane(page, "You")).toHaveAttribute("inert", /.*/);

    await tabBar(page).getByRole("button", { name: "Ante Up", exact: true }).click();
    await expect(pane(page, "Ante Up")).not.toHaveAttribute("inert", /.*/);
    await expect(pane(page, "Play")).toHaveAttribute("inert", /.*/);
  });

  test("a horizontal drag turns the page", async ({ page }) => {
    await enterAsGuest(page);
    const nav = tabBar(page);
    await expect(nav.getByRole("button", { name: "Play", exact: true }))
      .toHaveAttribute("aria-current", "page");

    const box = await page.locator(".mshell-viewport").boundingBox();
    if (!box) throw new Error("no swipe viewport");
    const y = box.y + box.height * 0.6;

    // Right to left, well past the 16% settle threshold.
    await page.mouse.move(box.x + box.width - 40, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(box.x + box.width - 40 - step * 34, y, { steps: 2 });
    }
    await page.mouse.up();

    await expect(nav.getByRole("button", { name: "Ante Up", exact: true }))
      .toHaveAttribute("aria-current", "page");
  });

  /* A mostly-vertical drag is a list scroll. If the axis lock regresses, this
     is the one that catches it: the page must not move. */
  test("a vertical drag scrolls the pane instead of turning the page", async ({ page }) => {
    await enterAsGuest(page);
    const nav = tabBar(page);

    const box = await page.locator(".mshell-viewport").boundingBox();
    if (!box) throw new Error("no swipe viewport");
    const x = box.x + box.width / 2;

    await page.mouse.move(x, box.y + box.height * 0.75);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(x - step * 4, box.y + box.height * 0.75 - step * 24, { steps: 2 });
    }
    await page.mouse.up();

    await expect(nav.getByRole("button", { name: "Play", exact: true }))
      .toHaveAttribute("aria-current", "page");
  });

  test("the tab bar stays on screen while a pane scrolls", async ({ page }) => {
    await enterAsGuest(page);
    await tabBar(page).getByRole("button", { name: "You", exact: true }).click();

    const scrolled = pane(page, "You");
    await expect(scrolled).toBeVisible();
    await scrolled.evaluate((element) => element.scrollTo(0, 4000));

    const nav = await tabBar(page).boundingBox();
    if (!nav) throw new Error("no tab bar");
    expect(Math.round(nav.y + nav.height)).toBe(PHONE.height);
  });
});

test.describe("wider than a phone", () => {
  test.use({ viewport: DESKTOP });

  test("keeps the hub grid and shows no tab bar", async ({ page }) => {
    await enterAsGuest(page);

    await expect(page.locator(".hub-grid")).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
  });

  /* The breakpoint is a subscription, not a measurement taken once at mount.
     Resizing has to swap the layout with no reload -- this is the assertion
     that a `useSyncExternalStore` snapshot which never re-subscribes fails. */
  test("swaps to the shell when the window narrows, and back", async ({ page }) => {
    await enterAsGuest(page);
    await expect(page.locator(".hub-grid")).toBeVisible();

    await page.setViewportSize(PHONE);
    await expect(tabBar(page)).toBeVisible();
    await expect(page.locator(".hub-grid")).toHaveCount(0);

    await page.setViewportSize(DESKTOP);
    await expect(page.locator(".hub-grid")).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
  });
});
