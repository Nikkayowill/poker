import { expect, test, type BrowserContext, type Page } from "./fixtures";

/** What a player sees when they gather: stumps, rubble and walk-through bushes. The server rules are in the wood and mining specs. */

interface Handle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    farmerPoint: () => { x: number; y: number };
    isWalking: () => boolean;
    isBlockedAt: (at: { x: number; y: number }) => boolean;
    nodeDrawn: (tag: string) => "standing" | "spent" | null;
  };
}

/** Where things stand on the Homestead (public/stackacres-td/areas/homestead/area.json). */
const TREE_3 = { x: 159, y: 29 };
/** Trunk tiles that only one tree stands on: tree 3's outer tile, and tree 4's middle one. */
const TREE_3_OUTER = { x: 168, y: 24 };
const TREE_4_MIDDLE = { x: 584, y: 24 };
/** Bush 1 of the four berried ones, which are the forage nodes (lib/stackacres/forage.ts). */
const BUSH = { x: 208, y: 132 };
/** Bush 2, picked by the forage test below so the walk-through test above keeps its own. */
const FORAGE_BUSH = { x: 452, y: 250 };
/** Boulders are shared by every player and the mining spec breaks the first, so this uses the third. It can only run once per server. */
const MINE_3 = { x: 300, y: 236 };
const MINE_3_TILE = { x: 296, y: 232 };
const HOUSE_WALL = { x: 120, y: 136 };

test.use({ viewport: { width: 932, height: 430 } });

async function openStackAcres(context: BrowserContext, page: Page) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: the welcome would show, and the test would say so.
    }
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);
}

type SceneMethod = keyof Handle["scene"];
type SceneResult<M extends SceneMethod> = ReturnType<Handle["scene"][M]>;

/** Calls one of the dev-handle scene methods in the page. */
function sceneCall<M extends SceneMethod>(page: Page, method: M, ...args: Parameters<Handle["scene"][M]>): Promise<SceneResult<M>> {
  return page.evaluate(
    ([name, list]) => {
      const target = (window as unknown as { __stackacres: { scene: Record<string, (...a: unknown[]) => unknown> } }).__stackacres.scene;
      return target[name as string](...(list as unknown[]));
    },
    [method, args] as const,
  ) as Promise<SceneResult<M>>;
}

test("felling a tree in the game leaves a stump, and only that tree", async ({ context, page }) => {
  await openStackAcres(context, page);
  expect(await sceneCall(page, "nodeDrawn", "tree:homestead-3")).toBe("standing");

  expect(await sceneCall(page, "isBlockedAt", TREE_3_OUTER)).toBe(true);
  await sceneCall(page, "placeFarmer", "homestead", { x: TREE_3.x, y: TREE_3.y + 40 });
  await page.waitForTimeout(500);
  const point = await sceneCall(page, "clientPointFor", TREE_3.x, TREE_3.y - 6);
  await page.mouse.click(point.x, point.y);

  const popup = page.getByRole("dialog", { name: "Tree" });
  await expect(popup).toBeVisible({ timeout: 10_000 });
  const swing = popup.locator(".sa-chop-popup-swing");
  for (let hit = 1; hit <= 3; hit++) {
    await expect(swing).toBeEnabled();
    await swing.click();
    if (hit < 3) expect(await sceneCall(page, "nodeDrawn", "tree:homestead-3")).toBe("standing");
  }

  await expect.poll(() => sceneCall(page, "nodeDrawn", "tree:homestead-3")).toBe("spent");
  expect(await sceneCall(page, "nodeDrawn", "tree:homestead-4")).toBe("standing");
  // A standing trunk is three tiles wide; the stump only stops you at its middle.
  expect(await sceneCall(page, "isBlockedAt", TREE_3_OUTER)).toBe(false);
});

test("a tree felled earlier is already a stump when the farm opens", async ({ context, page }) => {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  for (let swing = 0; swing < 3; swing++) {
    const response = await context.request.post("/api/stackacres/actions", {
      data: { action: "chop-tree", nodeId: "homestead-4", sweet: false },
    });
    expect(response.ok()).toBe(true);
  }
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));

  await expect.poll(() => sceneCall(page, "nodeDrawn", "tree:homestead-4")).toBe("spent");
  expect(await sceneCall(page, "nodeDrawn", "tree:homestead-3")).toBe("standing");
  expect(await sceneCall(page, "isBlockedAt", TREE_4_MIDDLE)).toBe(true);
});

test("a bush is walked through, and a house wall still stops you", async ({ context, page }) => {
  await openStackAcres(context, page);
  expect(await sceneCall(page, "isBlockedAt", BUSH)).toBe(false);
  expect(await sceneCall(page, "isBlockedAt", HOUSE_WALL)).toBe(true);

  await sceneCall(page, "placeFarmer", "homestead", { x: BUSH.x - 40, y: BUSH.y + 10 });
  await page.waitForTimeout(500);
  const point = await sceneCall(page, "clientPointFor", BUSH.x, BUSH.y - 4);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => sceneCall(page, "isWalking"), { timeout: 10_000 }).toBe(false);

  const arrived = await sceneCall(page, "farmerPoint");
  expect(Math.abs(arrived.x - BUSH.x)).toBeLessThan(10);
  expect(Math.abs(arrived.y - BUSH.y)).toBeLessThan(14);
});

test("picking a bush gives crop seed and leaves it picked over", async ({ context, page }) => {
  await openStackAcres(context, page);
  expect(await sceneCall(page, "nodeDrawn", "forage:homestead-2")).toBe("standing");

  // What the bush is carrying is a pure function of its pick count, so the
  // view can name the seed before the pick -- which is what makes the pick
  // fully predictable client-side (lib/stackacres/forage.ts).
  const before = (await (await context.request.get("/api/stackacres")).json()) as {
    forageNodes?: { nodeId: string; ready: boolean; crop: string }[];
    seedStock?: Record<string, number>;
  };
  const bush = before.forageNodes?.find((node) => node.nodeId === "homestead-2");
  expect(bush?.ready).toBe(true);
  const crop = bush!.crop;
  const held = before.seedStock?.[crop] ?? 0;

  await sceneCall(page, "placeFarmer", "homestead", { x: FORAGE_BUSH.x - 40, y: FORAGE_BUSH.y + 10 });
  await page.waitForTimeout(500);
  const point = await sceneCall(page, "clientPointFor", FORAGE_BUSH.x, FORAGE_BUSH.y - 4);
  await page.mouse.click(point.x, point.y);

  // No popup, unlike a tree or a boulder: a pick is one stoop.
  await expect
    .poll(async () => {
      const view = (await (await context.request.get("/api/stackacres")).json()) as {
        seedStock?: Record<string, number>;
      };
      return view.seedStock?.[crop] ?? 0;
    })
    .toBeGreaterThan(held);

  await expect.poll(() => sceneCall(page, "nodeDrawn", "forage:homestead-2")).toBe("spent");
  // Only that bush: the other three still carry seed.
  expect(await sceneCall(page, "nodeDrawn", "forage:homestead-3")).toBe("standing");
  // And it is still walked through once picked.
  expect(await sceneCall(page, "isBlockedAt", FORAGE_BUSH)).toBe(false);
});

test("mining a boulder from the map pays Stone, and four swings leave rubble", async ({ context, page }) => {
  await openStackAcres(context, page);
  await sceneCall(page, "placeFarmer", "mine", { x: MINE_3.x, y: MINE_3.y + 40 });
  await page.waitForTimeout(500);
  expect(await sceneCall(page, "nodeDrawn", "stone:mine-3")).toBe("standing");
  expect(await sceneCall(page, "isBlockedAt", MINE_3_TILE)).toBe(true);
  const point = await sceneCall(page, "clientPointFor", MINE_3.x, MINE_3.y - 6);
  await page.mouse.click(point.x, point.y);

  const popup = page.getByRole("dialog", { name: "Boulder" });
  await expect(popup).toBeVisible({ timeout: 10_000 });
  const swing = popup.locator(".sa-chop-popup-swing");
  for (let hit = 1; hit <= 4; hit++) {
    await expect(swing).toBeEnabled();
    await swing.click();
    if (hit === 1) {
      await expect
        .poll(async () => {
          const view = (await (await context.request.get("/api/stackacres")).json()) as { inventory?: Record<string, number> };
          return view.inventory?.stone ?? 0;
        })
        .toBeGreaterThan(0);
    }
  }

  await expect.poll(() => sceneCall(page, "nodeDrawn", "stone:mine-3")).toBe("spent");
  expect(await sceneCall(page, "nodeDrawn", "stone:mine-1")).toBe("standing");
  expect(await sceneCall(page, "isBlockedAt", MINE_3_TILE)).toBe(false);
});
