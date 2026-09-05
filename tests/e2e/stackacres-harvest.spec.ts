import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * StackAcres' single-currency harvest, from the outside.
 *
 * WHAT ONLY A BROWSER CAN ANSWER, and therefore all this spec tries to:
 *
 *   * the ROUTE's action list really did lose `sell` and `exchange` -- the
 *     unit tests read the source, this actually sends them;
 *   * a seeded unit really debits Gold over HTTP, at the catalogue price,
 *     against the same wallet the poker tables spend;
 *   * the read route really carries `upkeep` and `exchange` to the client,
 *     which is what the store sheet renders;
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
      exchange: { ceiling: number; remaining: number };
      upkeep: { plots: number; fee: number; due: number };
      bushels?: unknown;
      inventory?: unknown;
    };
    expect(view.units).toEqual([]);
    expect(view.exchange.ceiling).toBe(50_000);
    expect(view.exchange.remaining).toBe(50_000);
    // The Farmstead's own three slots are exactly the free base, so a farm
    // that has cleared nothing never sees a bill.
    expect(view.upkeep).toMatchObject({ plots: 3, fee: 0, due: 0 });
    // And the second currency is not merely unused -- it is not in the payload.
    expect(view.bushels).toBeUndefined();
    expect(view.inventory).toBeUndefined();

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

    // The two actions the rewrite removed are rejected by the schema, not
    // quietly accepted and ignored.
    for (const gone of [
      { action: "sell", item: "eggs", quantity: 1 },
      { action: "exchange", bushels: 10 },
    ]) {
      const refused = await api.post("/api/stackacres/actions", { data: gone });
      expect(refused.status()).toBe(400);
    }

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

test("the farm screen shows the day's allowance and its maintenance, and no Harvest key until something is ready", async ({
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
    await page.goto("/games/stackacres");

    // The tap-to-play splash gates everything, and is also the autoplay
    // unlock -- nothing renders behind it until a real gesture lands.
    await page.getByRole("button", { name: /tap|play|start/i }).first().click();

    // Then Grandfather Ray says hello. It is a first-visit localStorage flag,
    // so a fresh browser context ALWAYS gets it, and his card sits over the
    // signpost rail -- including over the very button this test needs next.
    // Dismissing it explicitly rather than force-clicking through it: a click
    // that has to be forced past an overlay is a click a real thumb could not
    // make either, and that is worth failing on.
    await page.getByRole("button", { name: /Thanks, Ray/i }).click();

    // Nothing is ready, so the Harvest key is not on the canvas at all. A
    // permanently-visible disabled key is chrome a player learns to skip.
    await expect(page.locator(".sa-harvest-all")).toHaveCount(0);

    // The purse the farm used to carry is gone; the app's own Gold wallet is
    // the only balance in the HUD now.
    await expect(page.locator(".sa-purse")).toHaveCount(0);
    await expect(page.locator(".sa-theme .gold-balance").first()).toBeVisible();

    await page.getByRole("button", { name: /Buy from Ray/i }).click();
    const sheet = page.getByRole("dialog", { name: "Supply store" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Today.s allowance/i)).toBeVisible();
    await expect(sheet.getByText(/50,000 Gold left today/)).toBeVisible();
    await expect(sheet.getByText(/Land maintenance/i)).toBeVisible();
    await expect(sheet.getByText(/Holding cleared land costs/i)).toBeVisible();

    // Feed is priced in Gold now, and the exchange window it used to sit above
    // is gone entirely.
    await expect(sheet.getByText(/96 Gold/)).toBeVisible();
    await expect(sheet.getByText(/Exchange window/i)).toHaveCount(0);
    await expect(sheet.getByText(/Bushels/i)).toHaveCount(0);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
