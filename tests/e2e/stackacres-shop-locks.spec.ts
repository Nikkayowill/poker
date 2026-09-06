import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * Ray's shelf, gated on what the farm has done -- from the outside.
 *
 * WHAT ONLY A BROWSER CAN ANSWER, and therefore all this spec tries to:
 *
 *   * a locked row really renders as a row -- greyed, named, priced and
 *     carrying the one line that says what to go and do -- rather than
 *     vanishing off the shelf;
 *   * and the gate really is a SERVER gate. Every unit test around it calls
 *     the service directly; this sends the request the greyed-out button
 *     cannot send, over real HTTP, and checks that the purse did not move.
 *     That second half is the whole security claim, and a disabled attribute
 *     is not evidence for it.
 *
 * The arithmetic of which rows open when is covered in
 * lib/stackacres/shop-locks.test.ts against every farm shape; this file only
 * needs one farm, the brand-new one, because that is the only shape where the
 * locks are visible at all.
 */

const ADMIN_SECRET = "playwright-admin-secret";

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

async function goldOf(api: APIRequestContext): Promise<number> {
  const read = (await (await api.get("/api/profile")).json()) as {
    profile: { goldBalance: number };
  };
  return read.profile.goldBalance;
}

test("Ray refuses a locked row over HTTP, not just in the browser", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext();
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);

    // Deliberately rich and deliberately landless: the exact account the gate
    // exists for. A StackChips purse is shared with the poker tables, so
    // price alone has never asked anything of the farm.
    await admitFarmer(farmerContext, adminContext.request, 5_000_000);
    const api = farmerContext.request;
    const before = await goldOf(api);

    // The volume feed. Well-formed, real item id, plenty of Gold -- and the
    // Fold is still under wild growth.
    const bulk = await api.post("/api/stackacres/actions", {
      data: { action: "buy-feed", itemId: "bulk_shipment" },
    });
    expect(bulk.status()).toBe(409);
    expect((await bulk.json()) as { error?: string }).toMatchObject({
      error: "Ray won't sell you a Bulk Shipment yet. Requires: Clear the Fold.",
    });

    // The equipment ladder names no rung in its request -- the server walks
    // it -- so this is the same attack with nothing at all to tamper with,
    // and it still stops.
    const rung = await api.post("/api/stackacres/actions", { data: { action: "upgrade-tool" } });
    expect(rung.status()).toBe(409);
    expect(((await rung.json()) as { error?: string }).error).toContain("Iron Shovel");

    // Nothing moved. Refused before the debit, so there is no refund that
    // could have quietly gone wrong.
    expect(await goldOf(api)).toBe(before);
    const view = (await (await api.get("/api/stackacres")).json()) as {
      feed: number;
      tool: string;
    };
    expect(view.feed).toBe(0);
    expect(view.tool).toBe("trowel");

    // And the row that is NOT gated still sells, so this is a gate rather
    // than a shelf that has stopped working.
    const sack = await api.post("/api/stackacres/actions", {
      data: { action: "buy-feed", itemId: "feed_sack" },
    });
    expect(sack.ok()).toBe(true);
    expect(await goldOf(api)).toBe(before - 96);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("the supply store shows a locked row greyed, named and told what it wants", async ({
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
    await admitFarmer(farmerContext, adminContext.request, 5_000_000);

    const page = await farmerContext.newPage();
    await page.goto("/games/stackacres");
    await page.getByRole("button", { name: /tap|play|start/i }).first().click();
    await page.getByRole("button", { name: /Thanks, Ray/i }).click();

    await page.getByRole("button", { name: /Buy from Ray/i }).click();
    const sheet = page.getByRole("dialog", { name: "Supply store" });
    await expect(sheet).toBeVisible();

    // The Bulk Shipment is still ON the shelf. Hiding it would make the
    // progression invisible: a row that is simply missing looks like a bug,
    // and teaches nothing about what to go and do next.
    const bulk = sheet.locator(".sa-stock-card", { hasText: "Bulk Shipment" });
    await expect(bulk).toBeVisible();
    await expect(bulk).toHaveClass(/is-locked/);
    await expect(bulk.getByText("Requires: Clear the Fold")).toBeVisible();
    // Priced while locked, on purpose -- you cannot decide to save up for a
    // number you have never been shown.
    await expect(bulk.getByText(/280 Gold/)).toBeVisible();
    await expect(bulk.getByRole("button", { name: "Locked" })).toBeDisabled();

    // The cheapest shipment is the shelf's floor and carries no gate at all.
    const sack = sheet.locator(".sa-stock-card", { hasText: "Feed Sack" });
    await expect(sack).not.toHaveClass(/is-locked/);
    await expect(sack.getByRole("button", { name: "Buy" })).toBeEnabled();

    // The equipment rung counts milestones instead of naming one quest, so
    // its hint says how far along the farm is as well as what is next.
    const rung = sheet.locator(".sa-stock-card", { hasText: "Iron Shovel" });
    await expect(rung).toHaveClass(/is-locked/);
    await expect(rung.getByText(/Requires 1 farm milestone \(0 done\)/)).toBeVisible();
    await expect(rung.getByText(/next: Clear the Long Meadow/)).toBeVisible();
    await expect(rung.getByRole("button", { name: "Locked" })).toBeDisabled();
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
