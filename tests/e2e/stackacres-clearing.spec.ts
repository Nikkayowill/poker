import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * Taking land by clearing it, from the outside.
 *
 * The arithmetic (what a swing pays, what a demolition costs, when the
 * sector opens) is covered by lib/stackacres/land-clearing.test.ts and the
 * service tests. What only a browser can say is the part this spec asserts:
 * the Fold stands open with nothing paid for it, the obstacles are really
 * drawn and really stop the farmer, tapping one opens the swing popup, and
 * a swing takes it down without waiting on the server.
 *
 * The Fold is off the map right now (HOMESTEAD_ONLY in scene.ts), so this
 * spec puts the farmer on it directly rather than walking him through the
 * gate. Everything after that is the real thing.
 */

interface Handle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    isBlockedAt: (at: { x: number; y: number }) => boolean;
    landObstaclePoint: (id: string) => { x: number; y: number } | null;
  };
}

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

function sceneCall<M extends SceneMethod>(page: Page, method: M, ...args: Parameters<Handle["scene"][M]>): Promise<SceneResult<M>> {
  return page.evaluate(
    ([name, list]) => {
      const target = (window as unknown as { __stackacres: { scene: Record<string, (...a: unknown[]) => unknown> } }).__stackacres.scene;
      return target[name as string](...(list as unknown[]));
    },
    [method, args] as const,
  ) as Promise<SceneResult<M>>;
}

/** The ids the Fold's obstacles are dealt under (lib/stackacres/land-clearing.ts). */
const FOLD_IDS = Array.from({ length: 24 }, (_, i) => `wallow-${String(i + 1).padStart(2, "0")}`);

/** The first obstacle still standing on this map, and where it stands. */
async function standingObstacle(page: Page): Promise<{ id: string; at: { x: number; y: number } }> {
  for (const id of FOLD_IDS) {
    const at = await sceneCall(page, "landObstaclePoint", id);
    if (at) return { id, at };
  }
  throw new Error("nothing is standing on the Fold");
}

test("what stands on the Fold is drawn, and a swing takes it down", async ({ context, page }) => {
  await openStackAcres(context, page);

  // Nothing bought, nothing asked for: the farmer is simply on it.
  await sceneCall(page, "placeFarmer", "fold", { x: 24, y: 184 });
  await page.waitForTimeout(600);

  const target = await standingObstacle(page);
  // It is really standing there: the farmer cannot walk through it.
  expect(await sceneCall(page, "isBlockedAt", target.at)).toBe(true);

  await sceneCall(page, "placeFarmer", "fold", { x: target.at.x, y: target.at.y + 40 });
  await page.waitForTimeout(400);
  const point = await sceneCall(page, "clientPointFor", target.at.x, target.at.y);
  await page.mouse.click(point.x, point.y);

  const popup = page.locator(".sa-chop-popup-card");
  await expect(popup).toBeVisible({ timeout: 10_000 });
  // The Gold way past it is offered beside the swing, never instead of it.
  await expect(popup.locator(".sa-chop-popup-blow")).toContainText("Gold");

  const line = popup.locator(".sa-chop-popup-line");
  const before = await line.textContent();
  const swing = popup.locator(".sa-chop-popup-swing");

  // Swing until it comes down. The popup closes on the blow that clears it,
  // and the count drops on every one before that -- optimistically, so this
  // never waits on a round trip.
  for (let hit = 0; hit < 6 && (await popup.count()) > 0 && (await popup.isVisible()); hit += 1) {
    await expect(swing).toBeEnabled();
    await swing.click();
    await page.waitForTimeout(400);
  }

  await expect(popup).toBeHidden();
  expect(await sceneCall(page, "landObstaclePoint", target.id)).toBeNull();
  expect(await sceneCall(page, "isBlockedAt", target.at)).toBe(false);
  expect(before).toMatch(/swing/);
});

/** The Crop Fields' own obstacle ids: 80 of them (lib/stackacres/land-clearing.ts). */
const CROP_FIELD_IDS = Array.from({ length: 80 }, (_, i) => `cropfields-${String(i + 1).padStart(2, "0")}`);

test("the Crop Fields start overgrown, and a swing clears a square", async ({ context, page }) => {
  await openStackAcres(context, page);

  let target: { id: string; at: { x: number; y: number } } | null = null;
  for (const id of CROP_FIELD_IDS) {
    const at = await sceneCall(page, "landObstaclePoint", id);
    if (at) {
      target = { id, at };
      break;
    }
  }
  if (!target) throw new Error("nothing is standing in the Crop Fields");
  expect(await sceneCall(page, "isBlockedAt", target.at)).toBe(true);

  await sceneCall(page, "placeFarmer", "homestead", { x: target.at.x, y: target.at.y + 40 });
  await page.waitForTimeout(600);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/fields.png` });
  const point = await sceneCall(page, "clientPointFor", target.at.x, target.at.y);
  await page.mouse.click(point.x, point.y);

  const popup = page.locator(".sa-chop-popup-card");
  await expect(popup).toBeVisible({ timeout: 10_000 });
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/popup.png` });
  const swing = popup.locator(".sa-chop-popup-swing");
  for (let hit = 0; hit < 6 && (await popup.count()) > 0 && (await popup.isVisible()); hit += 1) {
    await expect(swing).toBeEnabled();
    await swing.click();
    await page.waitForTimeout(400);
  }

  await expect(popup).toBeHidden();
  expect(await sceneCall(page, "landObstaclePoint", target.id)).toBeNull();
  expect(await sceneCall(page, "isBlockedAt", target.at)).toBe(false);
});
