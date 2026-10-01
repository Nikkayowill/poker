import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "./fixtures";

/**
 * The town board: several open orders, one pin, one swap a day, and a
 * delivery from the sheet itself.
 *
 * The HTTP half checks the board's rules. The browser half grows the goods
 * an order asks for, pins that order, watches the HUD follow it, and
 * delivers it from the board. A bare farm can only be asked for Wheat (its
 * seed is the one always on sale), so the board it draws is the same every
 * run: an order for 8 Wheat and one for 16. Two beds of Wheat ripen into 8
 * with the farm clock moved five minutes by the dev time-shift route.
 */

const ADMIN_SECRET = "playwright-admin-secret";
/** Two grass squares west of the spawn that the hoe accepts
 *  (lib/stackacres/hoeable.ts's `isHoeableSoilTile`). */
const BEDS = [
  { tx: 24, ty: 18 },
  { tx: 25, ty: 18 },
];
const WHEAT_CYCLE_MS = 5 * 60 * 1000;
/** The Town Board's signpost on the Homestead, a step from the spawn
 *  (public/stackacres-td/areas/homestead/area.json, the `signpost` prop:
 *  centre-x, bottom-y, so the tap lands a little above its foot). */
const SIGNPOST = { x: 540, y: 350 };

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
  };
}

interface ContractLine {
  item: string;
  quantity: number;
}
interface ContractRow {
  id: string;
  title: string;
  requirements: ContractLine[];
  status: string;
  pinned: boolean;
  goldReward: number;
}
interface BoardView {
  contracts: ContractRow[];
  inventory: Record<string, number>;
  units: { id: string; stock: string; state: string }[];
}

async function admitFarmer(context: BrowserContext, admin: APIRequestContext, gold: number) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };
  expect(
    (await admin.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  expect(
    (await admin.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: gold - profile.goldBalance } })).ok(),
  ).toBe(true);
  return profile.id;
}

async function farmAction(api: APIRequestContext, data: Record<string, unknown>): Promise<BoardView> {
  const response = await api.post("/api/stackacres/actions", { data });
  expect(response.ok(), `${String(data.action)}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as BoardView;
}

async function board(api: APIRequestContext): Promise<BoardView> {
  return (await (await api.get("/api/stackacres")).json()) as BoardView;
}

test("the board fills to several orders, one can be pinned, and one can be swapped a day", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext();
  try {
    expect((await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 100_000);
    const api = farmerContext.request;

    // The Oven asks for Gold alone, and it opens Eggplant and Broccoli seed,
    // so the town has more than Wheat to ask for.
    await farmAction(api, { action: "place-machine", kind: "oven" });

    const opened = await farmAction(api, { action: "request-contract" });
    expect(opened.contracts.length).toBeGreaterThan(1);
    expect(opened.contracts.length).toBeLessThanOrEqual(4);
    for (const order of opened.contracts) {
      expect(order.status).toBe("open");
      expect(order.pinned).toBe(false);
      expect(order.requirements.length).toBeGreaterThan(0);
      for (const line of order.requirements) expect(["wheat", "eggplant", "broccoli"]).toContain(line.item);
    }
    const [first, second] = opened.contracts;

    // One pin, and it moves.
    const pinned = await farmAction(api, { action: "pin-contract", contractId: first.id });
    expect(pinned.contracts.filter((order) => order.pinned).map((order) => order.id)).toEqual([first.id]);
    const moved = await farmAction(api, { action: "pin-contract", contractId: second.id });
    expect(moved.contracts.filter((order) => order.pinned).map((order) => order.id)).toEqual([second.id]);
    const cleared = await farmAction(api, { action: "pin-contract", contractId: null });
    expect(cleared.contracts.some((order) => order.pinned)).toBe(false);

    // A swap moves nothing and draws another into the slot.
    const goldBefore = ((await (await api.get("/api/profile")).json()) as { profile: { goldBalance: number } }).profile.goldBalance;
    const swapped = await farmAction(api, { action: "replace-contract", contractId: first.id });
    expect(swapped.contracts.some((order) => order.id === first.id)).toBe(false);
    expect(swapped.contracts.length).toBe(opened.contracts.length);
    const goldAfter = ((await (await api.get("/api/profile")).json()) as { profile: { goldBalance: number } }).profile.goldBalance;
    expect(goldAfter).toBe(goldBefore);

    // And there is only one a day.
    const again = await api.post("/api/stackacres/actions", { data: { action: "replace-contract", contractId: second.id } });
    expect(again.status()).toBe(409);
    expect((await again.json()) as { error?: string }).toMatchObject({ error: expect.stringContaining("already swapped") });
    expect((await board(api)).contracts.some((order) => order.id === second.id)).toBe(true);

    // An order that is not on the board cannot be pinned, swapped or delivered.
    const stray = "00000000-0000-4000-8000-000000000000";
    for (const action of ["pin-contract", "replace-contract", "fulfill-contract"]) {
      const refused = await api.post("/api/stackacres/actions", { data: { action, contractId: stray } });
      expect(refused.ok(), action).toBe(false);
    }
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("delivering without the goods is refused and spends nothing", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext();
  try {
    expect((await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 100_000);
    const api = farmerContext.request;
    const opened = await farmAction(api, { action: "request-contract" });
    const goldBefore = ((await (await api.get("/api/profile")).json()) as { profile: { goldBalance: number } }).profile.goldBalance;

    const refused = await api.post("/api/stackacres/actions", {
      data: { action: "fulfill-contract", contractId: opened.contracts[0].id },
    });
    expect(refused.status()).toBe(409);

    const goldAfter = ((await (await api.get("/api/profile")).json()) as { profile: { goldBalance: number } }).profile.goldBalance;
    expect(goldAfter).toBe(goldBefore);
    expect((await board(api)).contracts.some((order) => order.id === opened.contracts[0].id)).toBe(true);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test.describe("from the sheet", () => {
  test.use({ viewport: { width: 932, height: 430 } });

  async function openFarm(page: Page) {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("sa-ray-welcomed", "1");
      } catch {
        // Blocked storage: the welcome would show, and the test would say so.
      }
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => {};
    });
    await page.goto("/games/stackacres");
    await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
    await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
    await page.waitForTimeout(1_500);
  }

  test("an order is pinned, the HUD follows it, and it is delivered from the board", async ({ context, page }) => {
    const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
    expect((await context.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
    expect(
      (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
    ).toBe(true);
    expect(
      (await context.request.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: 100_000 } })).ok(),
    ).toBe(true);
    // The admin cookie is scoped to /api/admin; the dev time-shift route
    // lives under /api/dev and wants the same cookie.
    const adminCookies = (await context.cookies()).filter((cookie) => cookie.path === "/api/admin");
    await context.addCookies(adminCookies.map((cookie) => ({ ...cookie, path: "/api/dev" })));
    const api = context.request;

    // Two beds of Wheat, watered, then five minutes forward on the farm clock.
    await farmAction(api, { action: "buy-seed", crop: "wheat", quantity: BEDS.length });
    for (const bed of BEDS) {
      await farmAction(api, { action: "place-soil-tile", tx: bed.tx, ty: bed.ty });
      await farmAction(api, { action: "stock", stock: "wheat", tx: bed.tx, ty: bed.ty });
    }
    await farmAction(api, { action: "draw-water" });
    const sown = (await board(api)).units.filter((unit) => unit.stock === "wheat");
    expect(sown).toHaveLength(BEDS.length);
    for (const unit of sown) await farmAction(api, { action: "water", unitId: unit.id });
    const shifted = await api.post("/api/dev/chrono-delorean", { data: { op: "advance", deltaMs: WHEAT_CYCLE_MS + 1_000 } });
    expect(shifted.ok(), `time shift: ${shifted.status()} ${await shifted.text()}`).toBe(true);
    const collected = await farmAction(api, { action: "collect" });
    expect(collected.inventory.wheat).toBe(8);

    // A bare farm is only ever asked for Wheat, so the board is known.
    const opened = await farmAction(api, { action: "request-contract" });
    const order = opened.contracts.find((row) => row.requirements.length === 1 && row.requirements[0].quantity === 8);
    expect(order, JSON.stringify(opened.contracts)).toBeDefined();
    expect(order!.requirements[0].item).toBe("wheat");

    await openFarm(page);

    // Nothing pinned yet, so no chip on the HUD.
    await expect(page.getByTestId("sa-pinned-order")).toHaveCount(0);

    // The signpost beside the spawn opens the board.
    const signpost = await page.evaluate(
      (at) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.clientPointFor(at.x, at.y),
      SIGNPOST,
    );
    await page.mouse.click(signpost.x, signpost.y);
    const sheet = page.getByRole("dialog", { name: "What the town wants" });
    await expect(sheet).toBeVisible();
    const row = sheet.locator(`[data-contract-id="${order!.id}"]`);
    await expect(row).toContainText("Grown in a bed from Wheat seed");
    await expect(row).toContainText("Ready to deliver");

    // Pin it from the sheet; the HUD picks it up once the sheet closes.
    await row.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(row).toContainText("Pinned");
    await sheet.getByRole("button", { name: "Done" }).click();
    const chip = page.getByTestId("sa-pinned-order");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("8/8");
    expect((await board(api)).contracts.find((candidate) => candidate.id === order!.id)?.pinned).toBe(true);

    // The chip opens the board again, where the pinned order is delivered.
    await chip.click();
    await expect(sheet).toBeVisible();
    await row.getByRole("button", { name: "Deliver it" }).click();

    await expect(sheet.getByRole("status")).toContainText(`Delivered. ${order!.goldReward.toLocaleString()} Gold`);
    await expect(row).toHaveCount(0);
    await sheet.getByRole("button", { name: "Done" }).click();

    // Delivered means gone from the HUD too, and the Wheat left the shelf.
    await expect(page.getByTestId("sa-pinned-order")).toHaveCount(0);
    const after = await board(api);
    expect(after.inventory.wheat ?? 0).toBe(0);
    expect(after.contracts.some((row) => row.id === order!.id)).toBe(false);
  });
});
