import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * Seeing the farmer behind the house and the trees.
 *
 * Which pixels count and how fast the fade runs are covered by
 * lib/stackacres-td/see-through.test.ts. What only the real map can say is
 * that the house and a tree really do go see-through when he stands behind
 * them, and come back when he steps out in front.
 */

interface Sight {
  base: { x: number; y: number };
  alpha: number;
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

function sight(page: Page, tag: string): Promise<Sight | null> {
  return page.evaluate(
    (name) =>
      (window as unknown as { __stackacres: { scene: { propSight: (tag: string) => Sight | null } } }).__stackacres.scene.propSight(name),
    tag,
  );
}

function standAt(page: Page, at: { x: number; y: number }): Promise<void> {
  return page.evaluate(
    (point) =>
      (
        window as unknown as { __stackacres: { scene: { placeFarmer: (area: string, at: { x: number; y: number }) => void } } }
      ).__stackacres.scene.placeFarmer("homestead", point),
    at,
  );
}

// Where he stands to be behind each, from its base point: the farmhouse's roof is open ground he walks in behind,
// 58px up; a tree's crown covers him a step north of its foot.
const BEHIND: Record<string, { dx: number; dy: number }> = { farmhouse: { dx: 0, dy: -58 }, "tree:homestead-1": { dx: 0, dy: -14 } };

for (const tag of ["farmhouse", "tree:homestead-1"]) {
  test(`${tag} goes see-through while the farmer is behind it`, async ({ context, page }) => {
    await openStackAcres(context, page);
    const start = await sight(page, tag);
    expect(start).not.toBeNull();
    const { base } = start!;

    // Up under its picture, behind it.
    await standAt(page, { x: base.x + BEHIND[tag].dx, y: base.y + BEHIND[tag].dy });
    await expect.poll(async () => (await sight(page, tag))!.alpha).toBeLessThan(0.6);

    // He walks out in front of it, where he is drawn over it, and it is solid again.
    const client = await page.evaluate(
      (point) =>
        (
          window as unknown as { __stackacres: { scene: { clientPointFor: (x: number, y: number) => { x: number; y: number } } } }
        ).__stackacres.scene.clientPointFor(point.x, point.y),
      { x: base.x, y: base.y + 24 },
    );
    await page.mouse.click(client.x, client.y);
    await expect.poll(async () => (await sight(page, tag))!.alpha, { timeout: 15_000 }).toBe(1);
  });
}

test("the farmhouse stays solid while the farmer stands in its doorway or beside its wall", async ({ context, page }) => {
  await openStackAcres(context, page);
  const { base } = (await sight(page, "farmhouse"))!;

  // On the steps the porch is behind him, not over him.
  await standAt(page, { x: base.x, y: base.y - 14 });
  await page.waitForTimeout(600);
  expect((await sight(page, "farmhouse"))!.alpha).toBe(1);

  // Beside the east wall, where the roof's edge used to catch his shoulder.
  await standAt(page, { x: base.x + 52, y: base.y - 30 });
  await page.waitForTimeout(600);
  expect((await sight(page, "farmhouse"))!.alpha).toBe(1);
});
