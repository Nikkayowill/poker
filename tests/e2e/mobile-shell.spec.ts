import { expect, test, type Page } from "./fixtures";

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

  test("opens on Texas Hold'em, with the poker hero and the tab bar", async ({ page }) => {
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
    await expect(pane(page, "Ante Up").getByRole("heading", { name: "Wager against the House or challenge a friend." }))
      .toBeVisible();

    await nav.getByRole("button", { name: "Leaderboard", exact: true }).click();
    await expect(pane(page, "Leaderboard").getByRole("heading", { name: "The leaderboard." }))
      .toBeVisible();
  });

  /* Panes that are off-screen are still in the document. Without `inert` they
     stay in the tab order and are still announced, so the screen reads as
     three lobbies at once. */
  test("only the current pane is reachable", async ({ page }) => {
    await enterAsGuest(page);

    await expect(pane(page, "Texas Hold'em")).not.toHaveAttribute("inert", /.*/);
    await expect(pane(page, "Ante Up")).toHaveAttribute("inert", /.*/);
    await expect(pane(page, "Profile")).toHaveAttribute("inert", /.*/);

    await tabBar(page).getByRole("button", { name: "Ante Up", exact: true }).click();
    await expect(pane(page, "Ante Up")).not.toHaveAttribute("inert", /.*/);
    await expect(pane(page, "Texas Hold'em")).toHaveAttribute("inert", /.*/);
  });

  /* Off-screen panes stay unpainted between slides, which is what keeps iOS
     from showing a pane blank or frozen mid-slide. They must still be painted
     during the slide itself. A held drag is a slide that has not landed. */
  test("off-screen panes are parked once a slide lands", async ({ page }) => {
    await enterAsGuest(page);
    await expect(pane(page, "Ante Up")).toHaveCSS("visibility", "hidden");

    const box = await page.locator(".mshell-viewport").boundingBox();
    if (!box) throw new Error("no swipe viewport");
    await page.mouse.move(box.x + box.width - 40, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 90, box.y + 60, { steps: 5 });
    await expect(pane(page, "Ante Up")).toHaveCSS("visibility", "visible");
    await expect(page.locator(".mshell-track-moving")).toHaveCount(1);
    await page.mouse.up();

    await tabBar(page).getByRole("button", { name: "Profile", exact: true }).click();
    await expect(pane(page, "Profile")).toHaveCSS("visibility", "visible");
    await expect(pane(page, "Texas Hold'em")).toHaveCSS("visibility", "hidden");
    await expect(pane(page, "Ante Up")).toHaveCSS("visibility", "hidden");
    await expect(page.locator(".mshell-track-moving")).toHaveCount(0);
  });

  test("a horizontal drag turns the page", async ({ page }) => {
    await enterAsGuest(page);
    const nav = tabBar(page);
    await expect(nav.getByRole("button", { name: "Play", exact: true }))
      .toHaveAttribute("aria-current", "page");

    const box = await page.locator(".mshell-viewport").boundingBox();
    if (!box) throw new Error("no swipe viewport");
    // Start on the empty right side of the "Play" heading row: outside the
    // sideways rails, and not a link, which the browser would drag natively.
    const play = pane(page, "Texas Hold'em");
    // The first-run strip arrives with the session and moves everything below
    // it, so measure only once the session is ready.
    await expect(play.getByRole("button", { name: "Take a seat" })).toBeEnabled();
    const head = play.locator(".mshell-section-head").first();
    // Settled means the same top edge on two reads a frame apart.
    let last = -1;
    await expect.poll(async () => {
      const top = (await head.boundingBox())?.y ?? -1;
      const settled = top === last;
      last = top;
      await page.waitForTimeout(150);
      return settled;
    }).toBe(true);
    const headBox = await head.boundingBox();
    if (!headBox) throw new Error("no section head");
    const y = headBox.y + headBox.height / 2;

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

  test("the Play tab shows the Ante Up rail, and All games opens the full floor", async ({ page }) => {
    await enterAsGuest(page);
    const play = pane(page, "Texas Hold'em");

    await expect(play.getByRole("heading", { name: "Ante Up" })).toBeVisible();
    await expect(play.locator(".mshell-game-card").first()).toBeVisible();

    await play.getByRole("button", { name: /^All \d+ games$/ }).click();
    await expect(tabBar(page).getByRole("button", { name: "Ante Up", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await expect(pane(page, "Ante Up").getByRole("heading", { name: "Wager against the House or challenge a friend." }))
      .toBeVisible();
  });

  /* The rails scroll sideways, so a drag that starts on one must not also turn
     the page. HORIZONTAL_SCROLLER in mobile-shell.tsx is what keeps them apart. */
  test("a horizontal drag on a rail does not turn the page", async ({ page }) => {
    await enterAsGuest(page);
    const rail = pane(page, "Texas Hold'em").locator(".mshell-rail").last();
    await rail.scrollIntoViewIfNeeded();
    const box = await rail.boundingBox();
    if (!box) throw new Error("no rail");
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width - 40, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(box.x + box.width - 40 - step * 34, y, { steps: 2 });
    }
    await page.mouse.up();

    await expect(tabBar(page).getByRole("button", { name: "Play", exact: true }))
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

  /* A press inside a pane must still be a press.
     The pager used to take pointer capture on pointerdown, and a captured
     pointer redirects the click that follows it to the capture target -- so
     the link never saw it and nothing navigated. Touch happened to survive
     that (the browser retargets it back), which is exactly why a mouse is the
     input this test uses: it is the one that regressed silently. */
  test("a link inside a pane still follows on a plain click", async ({ page }) => {
    await enterAsGuest(page);
    await tabBar(page).getByRole("button", { name: "Profile", exact: true }).click();

    await pane(page, "Profile").getByRole("link", { name: /Collection/ }).click();

    await expect(page).toHaveURL(/\/collection$/);
  });

  test("the tab bar stays on screen while a pane scrolls", async ({ page }) => {
    await enterAsGuest(page);
    await tabBar(page).getByRole("button", { name: "Profile", exact: true }).click();

    const scrolled = pane(page, "Profile");
    await expect(scrolled).toBeVisible();
    await scrolled.evaluate((element) => element.scrollTo(0, 4000));

    const nav = await tabBar(page).boundingBox();
    if (!nav) throw new Error("no tab bar");
    // The bar is a floating pill now, not flush against the edge -- it sits
    // `max(--safe-bottom, 10px) + 10px` above the bottom (20px here, since
    // this test has no safe-area inset to report). Checking it's still
    // *fixed* there (not scrolled away with the pane) is the point of this
    // test, not the exact flush position a floating bar no longer has.
    expect(Math.round(nav.y + nav.height)).toBe(PHONE.height - 20);
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
