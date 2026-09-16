import { expect, test } from "@playwright/test";

/**
 * The Pixel Pilgrim: tapping him opens his dialogue, declining costs
 * nothing, and saying "yes" advances the devotion streak.
 *
 * He has no DOM element of his own (he's drawn in the Phaser scene), so this
 * puts the farmer beside him through the dev-only `window.__stackacres`
 * handle, asks it where he is on screen, and taps there for real.
 */

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    npcPoint: (name: string) => { x: number; y: number } | null;
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
  };
}

async function grantAndOpenStackAcres(
  context: import("@playwright/test").BrowserContext,
  page: import("@playwright/test").Page,
) {
  const profileResponse = await context.request.post("/api/profile");
  expect(profileResponse.ok()).toBe(true);
  const { profile } = (await profileResponse.json()) as { profile: { id: string } };

  const sessionResponse = await context.request.post("/api/admin/session", {
    data: { secret: "playwright-admin-secret" },
  });
  expect(sessionResponse.ok()).toBe(true);

  const accessResponse = await context.request.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(accessResponse.ok()).toBe(true);

  // Grandfather Ray's one-time welcome modal covers the whole screen and
  // would otherwise swallow the very first tap this test sends.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Private browsing or blocked storage: nothing to do here either.
    }
  });

  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Tap to start StackAcres" }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  // Stand a few steps below him so he's on screen; the tap still walks the farmer up before the dialogue opens.
  await page.evaluate(() => {
    const { scene } = (window as unknown as { __stackacres: TopdownHandle }).__stackacres;
    const pilgrim = scene.npcPoint("pilgrim");
    if (!pilgrim) throw new Error("the Pilgrim isn't on the Homestead");
    scene.placeFarmer("homestead", { x: pilgrim.x + 32, y: pilgrim.y + 24 });
  });
  await page.waitForTimeout(200);
  return profile;
}

async function tapMonk(page: import("@playwright/test").Page) {
  const point = await page.evaluate(() => {
    const { scene } = (window as unknown as { __stackacres: TopdownHandle }).__stackacres;
    const pilgrim = scene.npcPoint("pilgrim");
    if (!pilgrim) throw new Error("the Pilgrim isn't on the Homestead");
    return scene.clientPointFor(pilgrim.x, pilgrim.y);
  });
  await page.mouse.click(point.x, point.y);
}

test("declining his prompt sends nothing and leaves the streak untouched", async ({ context, page }) => {
  await grantAndOpenStackAcres(context, page);

  await tapMonk(page);
  const dialog = page.getByRole("dialog", { name: "The Pixel Pilgrim" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Will you pray with me?")).toBeVisible();

  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/stackacres/actions")) requests.push(request.url());
  });

  await dialog.getByRole("button", { name: "Not today" }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toHaveLength(0);
});

test("praying with him advances the devotion streak, once per day", async ({ context, page }) => {
  await grantAndOpenStackAcres(context, page);

  await tapMonk(page);
  const dialog = page.getByRole("dialog", { name: "The Pixel Pilgrim" });
  await dialog.getByRole("button", { name: "Pray with him" }).click();

  await expect(dialog.getByText("Devotion, day 1.")).toBeVisible();

  await dialog.getByRole("button", { name: "Amen" }).click();
  await expect(dialog).toBeHidden();

  // A second prayer the same UTC day is a no-op, not a second streak day.
  await tapMonk(page);
  await dialog.getByRole("button", { name: "Pray with him" }).click();
  await expect(dialog.getByText(/already prayed with him today/i)).toBeVisible();
});
