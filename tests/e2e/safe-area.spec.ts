import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * What the app looks like on a phone that keeps part of its own screen.
 *
 * Installed to an iOS home screen this app is genuinely full-screen --
 * app/layout.tsx asks for `viewportFit: "cover"` and a black-translucent
 * status bar -- so the web view starts at y=0, underneath the clock, the
 * notch and the battery, and ends under the home indicator. The browser
 * reports those strips through `env(safe-area-inset-*)`.
 *
 * That value cannot be set. On a desktop, in CI, and in every headless run it
 * is 0, which is why this whole class of bug shipped: the lobby header was
 * fixed for it and the in-game header was not, and nothing could tell.
 *
 * So the insets are read from --safe-* custom properties (01-tokens.css),
 * which default to env() and *can* be overridden. This spec sets them to a
 * real iPhone 14's numbers and asserts the two things that must hold:
 *
 *   1. nothing a player has to read or press is inside a strip the OS owns;
 *   2. nothing overlaps anything it is not inside.
 *
 * Both failed before: the in-game header's contents were pushed down by the
 * inset while its box stayed 68px tall, so the pot, the blinds and Leave
 * table were painted across the top of the felt.
 */

/** iPhone 14, portrait, installed. Landscape moves the insets to the sides. */
const PORTRAIT = { top: 59, right: 0, bottom: 34, left: 0 };
const LANDSCAPE = { top: 0, right: 59, bottom: 21, left: 59 };

type Insets = typeof PORTRAIT;

/**
 * Applied as an init script on the context rather than a <style> tag on the
 * page, for two reasons. It runs before the app's first paint on every
 * document in the context, so there is no window where the layout is measured
 * without the insets; and addStyleTag resolves through the page's error
 * channel, so an unrelated console failure -- the ad script's CSP-blocked
 * beacon, in practice -- rejected it and failed this spec for something that
 * has nothing to do with insets.
 */
async function withInsets(context: BrowserContext, insets: Insets) {
  await context.addInitScript((values: Insets) => {
    // A stylesheet rather than an inline style on <html>: React hydrates that
    // element, so setting the properties on it directly makes every run log a
    // server/client attribute mismatch, and noise like that is what stops a
    // real failure from being read.
    const apply = () => {
      const style = document.createElement("style");
      style.dataset.testInsets = "";
      style.textContent = `:root{--safe-top:${values.top}px;--safe-right:${values.right}px;`
        + `--safe-bottom:${values.bottom}px;--safe-left:${values.left}px}`;
      document.head.appendChild(style);
    };
    if (document.head) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  }, insets);
}

/**
 * Every box that carries its own text, plus the controls. Deliberately not
 * "all elements": a decorative full-bleed layer is *supposed* to run under
 * the notch, and asserting on it would only teach the next person to add
 * exceptions.
 */
const WATCHED = [
  ".game-header > *",
  ".game-header-actions > *",
  ".table-hud > *",
  ".action-slot-controls > *",
  ".lobby-header > *",
].join(", ");

async function collect(page: Page, watched: string) {
  return page.evaluate((selector) => {
    const seen = new Set<Element>();
    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        if (seen.has(el)) return false;
        seen.add(el);
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          name: `${el.tagName.toLowerCase()}.${String(el.className).split(" ").filter(Boolean)[0] ?? ""}`,
          // Does this element contain the other? A child inside its own parent
          // is not an overlap, and every container here has one.
          depth: (() => { let d = 0, node: Element | null = el; while ((node = node.parentElement)) d += 1; return d; })(),
          contains: [...document.querySelectorAll(selector)].filter((other) => other !== el && el.contains(other)).length,
          top: box.top, bottom: box.bottom, left: box.left, right: box.right,
          width: box.width, height: box.height,
        };
      })
      .filter((b) => b.width > 0 && b.height > 0);
  }, watched);
}

test.describe("safe-area insets", () => {
  test("the in-game HUD clears an iPhone's notch and home indicator", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await withInsets(context, PORTRAIT);
    try {
      // A private table of our own, for the reason table-feed.spec.ts gives:
      // quick play draws on the shared matchmaking bucket and makes a layout
      // assertion flaky exactly when the whole suite runs.
      await context.request.post("/api/profile");
      const response = await context.request.post("/api/games", {
        data: { name: "Safe area QA", isPrivate: true, tier: "1k", buyIn: 1000 },
      });
      expect(response.ok()).toBe(true);
      const payload = await response.json();

      const page = await context.newPage();
      await page.goto(`/?table=${payload.game.id}`);
      await page.getByRole("button", { name: "Play as guest" }).click();
      await expect(page.locator(".poker-table-wrap")).toBeVisible();
      await expect(page.locator(".game-header")).toBeVisible();

      const viewport = page.viewportSize()!;
      const boxes = await collect(page, WATCHED);
      expect(boxes.length).toBeGreaterThan(2);

      const intruding = boxes.filter((b) =>
        b.top < PORTRAIT.top - 0.5
        || b.bottom > viewport.height - PORTRAIT.bottom + 0.5
        || b.left < PORTRAIT.left - 0.5
        || b.right > viewport.width - PORTRAIT.right + 0.5);
      expect(intruding.map((b) => b.name)).toEqual([]);

      // Nothing that is not an ancestor of the other may overlap it. The
      // header's own contents spilling onto the table is what this catches.
      const collisions: string[] = [];
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const x = boxes[a];
          const y = boxes[b];
          if (x.contains > 0 || y.contains > 0) continue;
          const overlapX = Math.min(x.right, y.right) - Math.max(x.left, y.left);
          const overlapY = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
          if (overlapX > 1 && overlapY > 1) collisions.push(`${x.name} over ${y.name}`);
        }
      }
      expect(collisions).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("the header grows by the inset instead of absorbing it", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto("/");

      // This one measures the same page before and after, so the insets go on
      // live rather than through the context's init script.
      const bare = await page.locator(".lobby-header").boundingBox();
      await page.evaluate((values: Insets) => {
        const root = document.documentElement;
        root.style.setProperty("--safe-top", `${values.top}px`);
        root.style.setProperty("--safe-right", `${values.right}px`);
        root.style.setProperty("--safe-bottom", `${values.bottom}px`);
        root.style.setProperty("--safe-left", `${values.left}px`);
      }, PORTRAIT);
      const inset = await page.locator(".lobby-header").boundingBox();

      // Exactly the inset taller, and its contents move down by it rather
      // than being squeezed into the same box.
      expect(Math.round(inset!.height - bare!.height)).toBe(PORTRAIT.top);

      // And the page below it gives back the same amount, or the app runs off
      // the bottom of the screen by however much the header grew.
      const sums = await page.evaluate(() => {
        const header = document.querySelector(".lobby-header")!.getBoundingClientRect();
        const page_ = document.querySelector(".account-entry-page, .lobby")!.getBoundingClientRect();
        return { total: Math.round(header.height + page_.height), viewport: window.innerHeight };
      });
      expect(sums.total).toBe(sums.viewport);
    } finally {
      await context.close();
    }
  });

  test("a landscape phone keeps its side insets clear", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
    await withInsets(context, LANDSCAPE);
    try {
      await context.request.post("/api/profile");
      const response = await context.request.post("/api/games", {
        // Under 18 characters: /api/games rejects longer, and the refusal is
        // otherwise silent until a property read fails much further down.
        data: { name: "Inset QA wide", isPrivate: true, tier: "1k", buyIn: 1000 },
      });
      // Asserted, not assumed: without this a refused create surfaces as
      // "cannot read properties of undefined" twenty lines later, which says
      // nothing about what actually went wrong.
      expect(response.ok(), await response.text()).toBe(true);
      const payload = await response.json();
      const page = await context.newPage();
      await page.goto(`/?table=${payload.game.id}`);
      await page.getByRole("button", { name: "Play as guest" }).click();
      await expect(page.locator(".poker-table-wrap")).toBeVisible();

      const viewport = page.viewportSize()!;
      const boxes = await collect(page, ".game-header > *, .action-slot-controls > *");
      const intruding = boxes.filter((b) =>
        b.left < LANDSCAPE.left - 0.5 || b.right > viewport.width - LANDSCAPE.right + 0.5);
      expect(intruding.map((b) => b.name)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
