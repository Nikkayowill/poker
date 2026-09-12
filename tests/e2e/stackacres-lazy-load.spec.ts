import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * The farm must cost a poker player nothing until they open it. StackAcres is
 * the heaviest thing in the app and it sits behind one tile on a lobby whose
 * job is to come up fast.
 *
 * Only a browser can assert this: an eager import, or a stray url() in a
 * stylesheet, pulls farm assets onto the lobby without changing how any of
 * the source reads. This caught the tile fetching cattle.png from CSS alone.
 *
 * WHAT IT CANNOT CHECK: Next only prefetches <Link> targets in production
 * builds and this suite runs `next dev`, so the `prefetch={false}` on both
 * links is unverified here. A prod-mode run needs a real throwaway Supabase
 * project -- runtime-config.ts refuses the in-memory store under NODE_ENV
 * production, and global-setup.ts refuses anything else.
 */

/**
 * `localhost`, not the suite's usual `127.0.0.1`, and not cosmetic. This spec
 * signs up through the page, and middleware.ts rejects a POST whose Origin
 * does not match `nextUrl.origin` -- which in dev resolves to localhost
 * whatever Host was sent, so a browser at 127.0.0.1 can never match and every
 * in-page mutation 403s. It is why the specs that sign up through the UI
 * currently fail. Dev-only: in production the Host is the real domain.
 */
test.use({ baseURL: process.env.LAZY_LOAD_BASE_URL ?? "http://localhost:3107" });

const ADMIN_SECRET = "playwright-admin-secret";

/** Has the admin let a profile into StackAcres -- the lobby only renders the
 *  tile as a link for a player who has access. */
async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const current = await context.request.post("/api/profile");
  expect(current.ok()).toBe(true);
  const { profile } = (await current.json()) as { profile: { id: string } };

  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);
  return profile.id;
}

/** Anything that only exists to serve the farm. */
function isFarmAsset(url: string): boolean {
  return (
    url.includes("/stackacres/")
    || url.includes("/audio/stackacres/")
    || url.includes("/games/stackacres")
    || /phaser/i.test(url)
  );
}

test("the lobby does not fetch the farm until the tile is clicked", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);

    // Become a player the ordinary way first. The hub only mounts once the
    // client has a profile, so a session minted purely over the API leaves
    // the browser sitting on the landing page with no tile to test.
    const page = await playerContext.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.locator(".hub-grid")).toBeVisible();
    await admitFarmer(playerContext, adminContext.request);

    const requested: string[] = [];
    playerContext.on("request", (request) => {
      const url = request.url();
      if (isFarmAsset(url)) requested.push(`${request.method()} ${new URL(url).pathname}`);
    });

    // Reload rather than open a second tab: the guest session lives per-tab,
    // so a new page would land back on the sign-in screen with no tile on it.
    // This is still a full document load -- the initial visit this is about.
    await page.reload();
    await expect(page.locator(".hub-grid")).toBeVisible();

    // The tile has to be ON SCREEN for this to mean anything: auto-prefetch
    // fires on intersection, so asserting against a link that never entered
    // the viewport would prove nothing at all.
    //
    // `a.` matters: the locked "Coming soon" tile carries the same
    // hub-tile-stackacres class and renders as an inert div, so a bare class
    // selector would happily pass against a tile that is not a link at all.
    const tile = page.locator("a.hub-tile-stackacres");
    await expect(tile).toBeVisible();
    await tile.scrollIntoViewIfNeeded();

    // Give a prefetch room to happen. It is idle-scheduled, so an immediate
    // assertion could pass simply by outrunning it.
    await page.waitForTimeout(3000);

    expect(
      requested,
      `the lobby pulled farm assets before anyone asked for the farm:\n  ${requested.join("\n  ")}`,
    ).toEqual([]);

    // And the other half of the claim: clicking really does bring it down,
    // so the emptiness above is laziness rather than a broken tile.
    await tile.click();
    await page.waitForURL("**/games/stackacres");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });

    const sprites = requested.filter((entry) => entry.includes("/stackacres/sprites/"));
    expect(sprites.length).toBeGreaterThan(0);
  } finally {
    await playerContext.close();
    await adminContext.close();
  }
});
