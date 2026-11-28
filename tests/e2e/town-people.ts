import { expect, type Page } from "./fixtures";

interface TownHandle {
  __stackacres: {
    scene: {
      clientPointFor: (x: number, y: number) => { x: number; y: number };
      placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
      npcSprites: Map<string, { sprite: { x: number; y: number; visible: boolean } }>;
      travelling: boolean;
      pos: { x: number; y: number };
    };
  };
}

async function arrived(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as TownHandle).__stackacres.scene.travelling), { timeout: 10_000 }).toBe(false);
  await page.waitForTimeout(300);
}

/**
 * Stands the farmer just below someone in the City and taps them. The Town Square's shopkeepers keep hours
 * and move between spots, so they are found where they are rather than where area.json first put them.
 */
export async function tapTownPerson(page: Page, name: string) {
  await page.evaluate(() => (window as unknown as TownHandle).__stackacres.scene.placeFarmer("city", { x: 480, y: 520 }));
  await arrived(page);
  const at = await page.evaluate((who) => {
    const node = (window as unknown as TownHandle).__stackacres.scene.npcSprites.get(who);
    return node?.sprite.visible ? { x: node.sprite.x, y: node.sprite.y } : null;
  }, name);
  expect(at, `${name} is out in the square`).not.toBeNull();
  await page.evaluate((spot) => (window as unknown as TownHandle).__stackacres.scene.placeFarmer("city", spot), { x: at!.x, y: at!.y + 34 });
  await arrived(page);
  const point = await page.evaluate((who) => {
    const { scene } = (window as unknown as TownHandle).__stackacres;
    const node = scene.npcSprites.get(who)!;
    return scene.clientPointFor(node.sprite.x, node.sprite.y - 12);
  }, name);
  await page.mouse.click(point.x, point.y);
}
