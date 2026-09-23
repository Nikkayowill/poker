import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * Fences the player builds (lib/stackacres/fences.ts), from the outside.
 *
 * The rules are covered by the unit tests. What this checks is the round
 * trip: Wood leaves when a piece goes up and comes back when it comes down,
 * the road refuses a piece, a piece is drawn and stops the farmer, and the
 * Fence on the tool belt puts one up where the player taps.
 */

test.use({ viewport: { width: 932, height: 430 } });

const T = 16;
/** Open grass in the yard, south of the farm road (lib/stackacres/homestead-ground.ts). */
const GRASS = { tx: 28, ty: 24 };
const BELT_GRASS = { tx: 33, ty: 23 };
/** The south road out of the yard: road, not grass. */
const ROAD = { tx: 31, ty: 36 };

interface Scene {
  clientPointFor: (x: number, y: number) => { x: number; y: number };
  placeFarmer: (area: string, at: { x: number; y: number }) => void;
  isBlockedAt: (at: { x: number; y: number }) => boolean;
}

type FarmView = { fences: { tx: number; ty: number }[]; inventory: Record<string, number> };

async function admit(context: BrowserContext) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
}

/** Wood off the Homestead's choppable trees, the way a player gets it. */
async function chopWood(context: BrowserContext): Promise<number> {
  let wood = 0;
  for (const nodeId of ["homestead-1", "homestead-2"]) {
    for (let swing = 0; swing < 3; swing += 1) {
      const response = await context.request.post("/api/stackacres/actions", { data: { action: "chop-tree", nodeId, sweet: false } });
      expect(response.ok()).toBe(true);
      wood = ((await response.json()) as FarmView).inventory.wood ?? 0;
    }
  }
  return wood;
}

async function act(context: BrowserContext, data: Record<string, unknown>) {
  return context.request.post("/api/stackacres/actions", { data });
}

function sceneCall<M extends keyof Scene>(page: Page, method: M, ...args: Parameters<Scene[M]>): Promise<ReturnType<Scene[M]>> {
  return page.evaluate(
    ([name, list]) => {
      const scene = (window as unknown as { __stackacres: { scene: Record<string, (...a: unknown[]) => unknown> } }).__stackacres.scene;
      return scene[name as string](...(list as unknown[]));
    },
    [method, args] as const,
  ) as Promise<ReturnType<Scene[M]>>;
}

const centre = (square: { tx: number; ty: number }) => ({ x: square.tx * T + T / 2, y: square.ty * T + T / 2 });

test("a fence piece costs Wood, gives it back, and stays off the road", async ({ context }) => {
  await admit(context);
  const wood = await chopWood(context);
  expect(wood).toBeGreaterThanOrEqual(4);

  const placed = await act(context, { action: "place-fence", ...GRASS });
  expect(placed.ok()).toBe(true);
  const up = (await placed.json()) as FarmView;
  expect(up.fences).toContainEqual(GRASS);
  expect(up.inventory.wood).toBe(wood - 2);

  expect((await act(context, { action: "place-fence", ...ROAD })).status()).toBe(400);
  const removed = await act(context, { action: "remove-fence", ...GRASS });
  const down = (await removed.json()) as FarmView;
  expect(down.fences).not.toContainEqual(GRASS);
  expect(down.inventory.wood).toBe(wood);
});

test("a piece is drawn and stops the farmer, and the Fence on the belt puts one up", async ({ context, page }) => {
  await admit(context);
  await chopWood(context);
  expect((await act(context, { action: "place-fence", ...GRASS })).ok()).toBe(true);

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: the welcome shows, and the test says so.
    }
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);

  expect(await sceneCall(page, "isBlockedAt", centre(GRASS))).toBe(true);

  await sceneCall(page, "placeFarmer", "homestead", { x: BELT_GRASS.tx * T + T / 2, y: (BELT_GRASS.ty + 2) * T + T / 2 });
  await page.waitForTimeout(500);
  await page.getByRole("radio", { name: "Fence" }).click();
  const target = centre(BELT_GRASS);
  const point = await sceneCall(page, "clientPointFor", target.x, target.y);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => sceneCall(page, "isBlockedAt", target), { timeout: 10_000 }).toBe(true);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/fence.png` });
});
