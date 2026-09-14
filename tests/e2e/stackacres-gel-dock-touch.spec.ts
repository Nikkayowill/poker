import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * The gel dock under a thumb, on a phone held sideways.
 *
 * WHY THIS EXISTS AS AN E2E. Everything this covers is the browser's own
 * gesture plumbing: pointer capture, `touch-action`, a transform written
 * straight onto a node, and a row that scrolls under our hand rather than the
 * browser's. None of it is visible to `tsc`, `eslint` or a jsdom test -- jsdom
 * has no layout at all, so the drag arithmetic there would be comparing zeroes.
 * The decision underneath ("is this move a browse or a drag") is held to its
 * values in lib/stackacres/drag-affordance.test.ts; this spec answers the
 * question that one cannot: with a real finger, on a real short landscape
 * viewport, does a token actually come out of the row and land in the circle.
 *
 * The dock itself only opens on a tap on the Crop Fields' own bare ground, so
 * the tap goes through `window.__stackacres`'s `screenPointFor` rather than a
 * guessed pixel.
 */

const ADMIN_SECRET = "playwright-admin-secret";
/** A phone held sideways: short, wide, and the case the dock was reported
 *  rough on. */
const LANDSCAPE_PHONE = { width: 844, height: 390 };

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
    const topped = await admin.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta } });
    expect(topped.ok()).toBe(true);
  }
  return profile.id;
}

test("a thumb drags a gel token out of the row and into the circle", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: LANDSCAPE_PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 400_000);

    // The dock only opens over the Crop Fields' own beds, and the Crop Fields
    // start as uncleared land behind two gates: a couple of things already
    // growing, and the unlock fee. Both paid over the API rather than through
    // the UI -- getting there is this spec's setup, not what it is testing.
    for (let bird = 0; bird < 2; bird += 1) {
      const stocked = await farmerContext.request.post("/api/stackacres/actions", {
        data: { action: "stock", stock: "hen" },
      });
      expect(stocked.ok(), "could not stock a hen").toBe(true);
    }
    const opened = await farmerContext.request.post("/api/stackacres/actions", {
      data: { action: "unlock-crop-fields" },
    });
    expect(opened.ok(), "could not unlock the Crop Fields").toBe(true);

    const page = await farmerContext.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    // Same reason as stackacres-game-feel.spec.ts: the play gate awaits
    // `HTMLAudioElement.play()`, which never settles with no audio device.
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => {};
    });

    await page.goto("/games/stackacres");
    await page.locator(".sa-play-screen").click({ timeout: 15_000 });
    await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
    await page.waitForTimeout(3_000);

    // Ray's welcome gates every canvas tap while it is up, and a snapshot
    // refetch can bring it straight back after it has been dismissed -- so
    // this runs immediately before the tap that matters, not once on load.
    const dismissRay = async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const welcome = page.locator(".profile-overlay .sa-cta");
        if ((await welcome.count()) === 0) return;
        await welcome.first().click();
        await page.waitForTimeout(300);
      }
    };
    await dismissRay();

    // Bare ground inside the Crop Fields' bed lattice, found the way the
    // farm's own dev recipe finds a building: unproject a grid of screen
    // points and keep one that really lands in the rect. Aiming at a guessed
    // pixel unprojects to wherever the iso projection happens to put it.
    const found = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          __stackacres: { worldPointFor: (x: number, y: number) => { x: number; y: number } };
        }
      ).__stackacres;
      // CROP_FIELD_BEDS: `yardRect(464, -81, 512, 512)` shifted by YARD_DELTA
      // (lib/stackacres/yard.ts), which is -256..256 on both axes.
      const inside = (p: { x: number; y: number }) =>
        p.x >= -256 && p.x <= 256 && p.y >= -256 && p.y <= 256;
      const hits: { x: number; y: number }[] = [];
      for (let y = 60; y < window.innerHeight - 60; y += 10) {
        for (let x = 20; x < window.innerWidth - 20; x += 10) {
          if (inside(probe.worldPointFor(x, y))) hits.push({ x, y });
        }
      }
      return hits.length > 0 ? hits[Math.floor(hits.length / 2)] : null;
    });
    expect(found, "no Crop Fields bed on screen to tap").not.toBeNull();
    await dismissRay();
    await page.touchscreen.tap(found!.x, found!.y);

    const dock = page.locator(".sa-gel");
    await expect(dock).toBeVisible({ timeout: 10_000 });
    const tokens = dock.locator(".sa-gel-row .sa-gel-token");
    await expect(tokens.first()).toBeVisible();

    // The circle the token has to land in, and the token it starts on.
    const circle = await dock.locator(".sa-gel-target").boundingBox();
    const token = await tokens.first().boundingBox();
    expect(circle).not.toBeNull();
    expect(token).not.toBeNull();
    const from = { x: token!.x + token!.width / 2, y: token!.y + token!.height / 2 };
    const to = { x: circle!.x + circle!.width / 2, y: circle!.y + circle!.height / 2 };

    // A real finger: press, then walk to the circle a step at a time. The
    // path is deliberately the diagonal one a thumb actually makes -- the
    // reach from a token off to one side of the row up to a circle above its
    // middle -- which the old "must be nearly vertical" rule read as a scroll
    // and refused to pick up.
    const client = await page.context().newCDPSession(page);
    const touch = async (type: "touchStart" | "touchMove" | "touchEnd", at: { x: number; y: number }) => {
      await client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: at.x, y: at.y }],
      });
    };
    await touch("touchStart", from);
    const live = dock.locator(".sa-gel-token-live");
    const carriedTo = () =>
      live.evaluate((el) => ({
        x: el.style.getPropertyValue("--x"),
        y: el.style.getPropertyValue("--y"),
        left: getComputedStyle(el).left,
        hot: el.classList.contains("is-hot"),
      }));
    const STEPS = 14;
    let halfway: Awaited<ReturnType<typeof carriedTo>> | null = null;
    for (let step = 1; step <= STEPS; step += 1) {
      await touch("touchMove", {
        x: from.x + ((to.x - from.x) * step) / STEPS,
        y: from.y + ((to.y - from.y) * step) / STEPS,
      });
      await page.waitForTimeout(16);
      if (step === Math.floor(STEPS / 2)) halfway = await carriedTo();
    }

    // The clone is out of the row and being moved by its transform, not by
    // left/top -- which is the whole reason a thumb drag stopped costing a
    // relayout and a fresh backdrop blur every frame. A clone still sitting
    // at the row's own spot would mean the press never became a drag at all.
    await expect(live).toBeVisible();
    const carried = await carriedTo();
    expect(carried.x).not.toBe("");
    expect(carried.y).not.toBe("");
    expect(carried.left).toBe("0px");
    // And it really tracked the finger the whole way rather than being put
    // down once at pickup.
    expect(halfway).not.toBeNull();
    expect(carried.y).not.toBe(halfway!.y);
    // The finger is on the circle, so the token has to read as about to land.
    expect(carried.hot).toBe(true);

    await touch("touchEnd", to);
    // A drop commits, which closes the dock (or swaps its row, for a token
    // that only opens another choice). Either way the drag itself resolved --
    // a token that sprang back would still be sitting in an open dock with
    // nothing settled.
    await expect(dock.locator(".sa-gel.is-dragging")).toHaveCount(0);
    await page.waitForTimeout(600);

    expect(errors).toEqual([]);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
