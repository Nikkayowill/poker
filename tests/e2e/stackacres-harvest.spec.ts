import { expect, test, type APIRequestContext, type BrowserContext } from "./fixtures";

/**
 * StackAcres' single-currency harvest, from the outside.
 *
 * WHAT ONLY A BROWSER CAN ANSWER, and therefore all this spec tries to:
 *
 *   * the ROUTE's action list really did lose `sell` and `exchange` -- the
 *     unit tests read the source, this actually sends them;
 *   * a seeded unit really debits Gold over HTTP, at the catalogue price,
 *     against the same wallet the poker tables spend;
 *   * the read route really carries `upkeep` and the processing inventory to
 *     the client, and no longer carries the removed `exchange` block;
 *   * and the Harvest key is absent while nothing is ready, which is the one
 *     piece of the design that cannot be asserted from the server.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS HARVEST. Every tier takes at least
 * fifteen minutes of wall clock to ripen and there is no way to fast-forward
 * the server from a browser -- the clock is `new Date()` inside the service,
 * injectable from a test but not over HTTP. The arithmetic of a harvest (the
 * synergies, the maintenance, the daily ceiling and the ordering around it) is
 * covered against the real service in lib/server/stackacres-service.test.ts and
 * lib/stackacres/{harvest,bounty,upkeep}.test.ts, with an injected clock. A
 * browser-driven version would be the same assertions behind a fifteen-minute
 * sleep.
 */

const ADMIN_SECRET = "playwright-admin-secret";

/** The barn on the Homestead, and the shop counter inside it. Prop
 *  coordinates are centre-x, bottom-y. */
const BARN_DOOR = { x: 360, y: 738 };
const BARN_COUNTER = { x: 280, y: 75 };
const WALK_MS = 2_500;

async function tapWorld(page: import("@playwright/test").Page, at: { x: number; y: number }) {
  const point = await page.evaluate(
    (target) =>
      (
        window as unknown as { __stackacres: { scene: { clientPointFor: (x: number, y: number) => { x: number; y: number } } } }
      ).__stackacres.scene.clientPointFor(target.x, target.y),
    at,
  );
  await page.mouse.click(point.x, point.y);
}

/** Mints a session, then has the admin let that profile into StackAcres and
 *  top up its purse. Access is per-profile now: without it, every route 401s. */
async function admitFarmer(context: BrowserContext, admin: APIRequestContext, gold: number) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };

  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);

  const delta = gold - profile.goldBalance;
  if (delta !== 0) {
    const topped = await admin.post("/api/admin/gold/adjust", {
      data: { profileId: profile.id, delta },
    });
    expect(topped.ok()).toBe(true);
  }
  return profile.id;
}

test("StackAcres runs on Gold alone: seeding debits it, and the sell/exchange actions are gone", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);

    await admitFarmer(farmerContext, adminContext.request, 100_000);
    const api = farmerContext.request;

    // The read route carries both of the new blocks the store sheet renders.
    const opened = await api.get("/api/stackacres");
    expect(opened.ok()).toBe(true);
    const view = (await opened.json()) as {
      units: unknown[];
      upkeep: { plots: number; fee: number; due: number };
      inventory: Record<string, number>;
      exchange?: unknown;
      bushels?: unknown;
    };
    expect(view.units).toEqual([]);
    // The Farmstead's own three slots are exactly the free base, so a farm
    // that has cleared nothing never sees a bill.
    expect(view.upkeep).toMatchObject({ plots: 3, fee: 0, due: 0 });
    // Neither removed currency is merely unused: neither is in the payload.
    // The flat daily Gold ceiling went with `exchange` on 2026-09-12 (see
    // lib/stackacres/exchange.ts's header), and Bushels before it.
    expect(view.exchange).toBeUndefined();
    expect(view.bushels).toBeUndefined();
    // The processing inventory IS carried: it is what the Sell tab, the
    // Workshop and the build buttons all read.
    expect(view.inventory).toEqual({});

    // Seeding spends Gold, at the catalogue's price, from the real wallet.
    const before = (await (await api.get("/api/profile")).json()) as {
      profile: { goldBalance: number };
    };
    const seeded = await api.post("/api/stackacres/actions", {
      data: { action: "stock", stock: "hen" },
    });
    expect(seeded.ok()).toBe(true);
    const after = (await seeded.json()) as {
      units: { stock: string; state: string }[];
      profile: { goldBalance: number };
      upkeep: { plots: number; fee: number };
    };
    expect(after.units).toHaveLength(1);
    expect(after.units[0]).toMatchObject({ stock: "hen", state: "working" });
    expect(after.profile.goldBalance).toBe(before.profile.goldBalance - 50);
    // Still inside the free base: a Hen Coop at the Farmstead is one of the
    // three slots a new farm never pays for. The fee arrives with cleared land,
    // which is its own describe block in the service tests.
    expect(after.upkeep.plots).toBe(3);
    expect(after.upkeep.fee).toBe(0);

    // Three of the four districts start under wild growth, so the only kind a
    // new farm can keep is the Hen Coop at the Farmstead -- which is why every
    // stocking in this file is a hen.
    const walled = await api.post("/api/stackacres/actions", {
      data: { action: "stock", stock: "cattle" },
    });
    expect(walled.status()).toBe(409);

    // `exchange` was removed with the second currency and is rejected by the
    // schema, not quietly accepted and ignored.
    const exchanged = await api.post("/api/stackacres/actions", { data: { action: "exchange", bushels: 10 } });
    expect(exchanged.status()).toBe(400);

    // `sell` came BACK (the Sell tab), so it is a real action again -- and
    // selling something never held is refused rather than paid for. That
    // refusal is the hole the wood/stone migration closed: the RPC used to
    // write a zero row and return 0, which every caller read as success.
    const nothing = await api.post("/api/stackacres/actions", {
      data: { action: "sell", item: "eggs", quantity: 1 },
    });
    expect(nothing.status()).toBe(409);
    expect((await nothing.json()) as { error?: string }).toMatchObject({ error: "Not enough on hand." });

    // Nothing is ready for another fifteen minutes, so the collect route says
    // so rather than paying for a unit still growing.
    const early = await api.post("/api/stackacres/actions", { data: { action: "collect" } });
    expect(early.status()).toBe(409);
    expect((await early.json()) as { error?: string }).toMatchObject({
      error: "Nothing is ready yet.",
    });
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("the farm screen keeps one purse, hides the Harvest key until something is ready, and prices feed in Gold", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  // Landscape: the farm is a landscape-first surface and the store sheet is
  // what this test is looking at.
  const farmerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 100_000);
    await farmerContext.request.post("/api/stackacres/actions", {
      data: { action: "stock", stock: "hen" },
    });

    const page = await farmerContext.newPage();
    // Ray's welcome is a first-visit localStorage flag and a fresh context
    // always gets it; skipping it from the start is steadier than racing the
    // card that sits over the very world this test has to tap.
    await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
    await page.goto("/games/stackacres");
    await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
    await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
    await page.waitForTimeout(1500);

    // Nothing is ready, so the Harvest key is not on the canvas at all. A
    // permanently-visible disabled key is chrome a player learns to skip.
    await expect(page.locator(".sa-harvest-all")).toHaveCount(0);

    // The purse the farm used to carry is gone; the app's own Gold wallet is
    // the only balance in the HUD now.
    await expect(page.locator(".sa-purse")).toHaveCount(0);
    await expect(page.locator(".sa-theme .gold-balance").first()).toBeVisible();

    // The store is behind the barn door: tap the barn to walk in, then tap
    // the counter inside. See tests/e2e/stackacres-house.spec.ts.
    await tapWorld(page, BARN_DOOR);
    await page.waitForTimeout(WALK_MS);
    await tapWorld(page, BARN_COUNTER);
    await page.waitForTimeout(WALK_MS);
    const sheet = page.getByRole("dialog", { name: "Supply store" });
    await expect(sheet).toBeVisible();

    // Feed is its own tab now, one of five shelves instead of the whole
    // sheet stacked in one scroll -- and it is still priced in Gold, with
    // no exchange window in sight.
    await sheet.getByRole("tab", { name: "Feed" }).click();
    // A price is a coin badge and a number (`StoreCost`), not the words
    // "96 Gold" it used to spell out.
    await expect(sheet.locator(".sa-stock-card", { hasText: "Feed Sack" }).locator(".sa-store-cost").first()).toHaveText("96");
    await expect(sheet.getByText(/Exchange window/i)).toHaveCount(0);
    await expect(sheet.getByText(/Bushels/i)).toHaveCount(0);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
