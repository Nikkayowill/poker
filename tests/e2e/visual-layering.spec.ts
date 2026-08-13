import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

type ViewportCase = {
  name: string;
  width: number;
  height: number;
  screenshot?: string;
};

const viewports: ViewportCase[] = [
  {
    name: "reference desktop",
    width: 1144,
    height: 846,
    screenshot: "artifacts/screenshots/table-layering-after-1144x846.png",
  },
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile landscape", width: 844, height: 390 },
  { name: "mobile portrait", width: 390, height: 844 },
];

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

async function openIsolatedTable(browser: Browser, viewport: ViewportCase, baseURL: string) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  // A private table, deliberately, rather than quick play.
  //
  // Quick play seats you at the oldest open *public* table at this tier, so
  // the moment any other spec file leaves one behind, this one stops
  // measuring what it thinks it is measuring: it inherits that table at
  // whatever street, turn and seat those tests left it in. That is not a
  // layout this file asserts anything about, and it made the suite's result
  // depend on file order. findOpenPublicGame filters on is_private, so a
  // private table can never be handed to another test -- every viewport
  // below now gets its own fresh six-max table with this context at seat 0.
  // Own a session before creating anything, and mint it here rather than
  // asking the server for one. `callerKey` in lib/server/rate-limit.ts keys
  // the limiter on the river_session cookie and only falls back to the source
  // IP -- and local dev has no proxy headers, so every *cookieless* caller in
  // the suite shares one `ip:unknown` bucket. POST /api/games allows 10 per
  // five minutes, and a full run creates far more than that, so whichever spec
  // ran last got a 429 rather than a table.
  //
  // This used to POST /api/profile first to get out of that bucket, which is
  // the idiom the rest of the suite uses -- but that request is cookieless
  // too, and `profile:create` is a tighter 10 per *sixty seconds* on the same
  // shared key. This file opens four contexts in one test, so as the last spec
  // in a 41-test run it lost the race there instead: the profile POST 429'd,
  // no cookie came back, and the games POST then fell into the exhausted IP
  // bucket. The session token is an opaque unsigned cookie -- readSessionToken
  // takes whatever is sent and ensureProfile keys a guest off it -- so setting
  // our own is the same thing the server would have done, minus the request
  // that could be refused. Nothing here touches the shared bucket at all now.
  await context.addCookies([
    { name: "river_session", value: randomUUID(), url: baseURL },
  ]);
  const response = await context.request.post("/api/games", {
    data: { name: "Visual QA", isPrivate: true, tier: "1k", buyIn: 1000 },
  });
  // Status and body in the message: a bare `toBe(true)` here reported only
  // "expected true, received false", which is the same for a 429, a 400 and a
  // 500 -- and telling them apart is the whole diagnosis.
  expect(response.ok(), `POST /api/games ${response.status()}: ${await response.text()}`)
    .toBe(true);
  const payload = await response.json();
  const page = await context.newPage();
  await page.goto(`/?table=${payload.game.id}`);
  // Returning/table links still pass through the one intentional entry
  // surface. The table opens only after the player chooses how to continue.
  await expect(page.locator(".account-entry-page")).toBeVisible();
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.locator(".poker-table-wrap")).toBeVisible();
  return { context, page };
}

async function verifyLocalLayout(page: Page) {
  const local = page.locator(".seat-mine");
  const avatar = local.locator(".seat-figure");
  const cards = local.locator(".own-cards");
  const plate = local.locator(".seat-plate");

  await expect(avatar).toBeVisible();
  await expect(cards).toBeVisible();
  await expect(plate).toBeVisible();
  await expect(local.locator(".seat-turn-status")).toHaveCount(0);

  // Let the deal finish first. The shells inside .own-cards fly in from the
  // middle of the felt under a transform, and a parent's bounding box
  // includes its children's transformed boxes -- so measuring mid-flight
  // reports a hand that is several times its resting size and in the wrong
  // place. Caught as one spurious failure in four runs of the overlap check
  // below, which is exactly the sort of thing that gets dismissed as noise.
  await page.locator(".seat-mine .dealt-card-shell").first().evaluate((shell) =>
    Promise.all(shell.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  );

  // One synchronous pass in the page, not four round trips.
  //
  // ActionBar is keyed on game.version, so it remounts every time the table
  // moves -- and since continuous play landed, the table moves on its own
  // whether or not this test is doing anything. Four separate boundingBox()
  // calls could therefore read four different renders, and the bar's node
  // could be detached by the time its turn came, which surfaced as a null box
  // and a test that passed alone and failed in the suite. Comparing four
  // rectangles only means something if they were all measured at once anyway.
  const boxes = await page.evaluate(() => {
    const read = (selector: string, root: ParentNode = document) => {
      const element = root.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const seat = document.querySelector(".seat-mine");
    return {
      avatarBox: seat ? read(".seat-figure", seat) : null,
      cardsBox: seat ? read(".own-cards", seat) : null,
      plateBox: seat ? read(".seat-plate", seat) : null,
      actionBox: read(".action-bar"),
      // Every other seat's nameplate, measured in the same pass for the same
      // reason the four above are.
      neighbourPlates: [...document.querySelectorAll(".player-seat:not(.seat-mine)")]
        .map((other) => {
          const plate = other.querySelector(".seat-plate");
          if (!plate) return null;
          const rect = plate.getBoundingClientRect();
          const name = other.querySelector(".seat-name-row strong");
          return {
            name: name?.textContent ?? "?",
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    };
  });
  const { avatarBox, cardsBox, plateBox, actionBox, neighbourPlates } = boxes;
  expect(avatarBox).not.toBeNull();
  expect(cardsBox).not.toBeNull();
  expect(plateBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(neighbourPlates.length).toBeGreaterThan(0);

  // Your seat is on the ring now, so the old vertical stack -- cards above
  // status above plate, all below the felt -- is not what this is any more.
  // Two things still have to hold, and they are the two that were actually
  // load-bearing.
  //
  // Your hand sits beside the figure rather than over it: it is the largest
  // thing on the table and would otherwise bury the player it belongs to.
  expect(overlaps(avatarBox!, cardsBox!)).toBe(false);
  // And it does not bury anyone else either. Held beside your figure, the
  // pair reaches sideways into the seat on your right at chest height, and it
  // is drawn above everything (z-index 12) -- so an overlap here is not a
  // near miss, it is a neighbour's chip stack hidden behind your cards.
  //
  // Third time this placement has regressed: once overlapping your own
  // figure, once when the seats grew for Slot 0, and once when they grew
  // again. All three were found by measuring and none by looking, so it is
  // asserted rather than watched. One pixel of tolerance for the rotated
  // bounding box a fanned pair reports.
  for (const neighbour of neighbourPlates) {
    const overlapX = Math.min(cardsBox!.x + cardsBox!.width, neighbour.x + neighbour.width)
      - Math.max(cardsBox!.x, neighbour.x);
    const overlapY = Math.min(cardsBox!.y + cardsBox!.height, neighbour.y + neighbour.height)
      - Math.max(cardsBox!.y, neighbour.y);
    expect({ seat: neighbour.name, covered: overlapX > 1 && overlapY > 1 })
      .toEqual({ seat: neighbour.name, covered: false });
  }
  // And defect D1, which is the reason --table-height-cap exists: whatever
  // the table does, your own name never ends up underneath the controls.
  expect(plateBox!.y + plateBox!.height).toBeLessThanOrEqual(actionBox!.y);
}

async function verifyOpponentLayout(page: Page) {
  // Everyone except you. Your seat is on the ring too now, but the rule below
  // -- a card back must never ride up over a face -- is about cards drawn
  // across a figure, and yours are held beside it. verifyLocalLayout asserts
  // the thing that actually matters for your seat, which is that the two do
  // not overlap at all.
  const seats = page.locator(".seat-ring:not(.seat-mine)");
  const count = await seats.count();
  for (let index = 0; index < count; index += 1) {
    const seat = seats.nth(index);
    const figure = seat.locator(".seat-figure");
    const cards = seat.locator(".seat-cards");
    const figureBox = await figure.boundingBox();
    const cardsBox = await cards.boundingBox();
    expect(figureBox).not.toBeNull();
    expect(figureBox!.y).toBeGreaterThanOrEqual(0);
    if (cardsBox) {
      // Cards sit above the portrait now, centred on it rather than tucked
      // beside it (08-seat.css's .seat-cards) -- they overlap only its
      // crown, not the face below it. Measured across every viewport this
      // loop runs (1144x846 down to 390x844 portrait): the pair's own bottom
      // edge lands 16-19% of the way down the figure box. 0.3 leaves real
      // margin above that range while still catching a regression that let
      // the pair sink down toward eye level.
      expect(cardsBox.y + cardsBox.height).toBeLessThanOrEqual(figureBox!.y + figureBox!.height * 0.3);
    }
  }
}

test("table layers keep cards, portraits, status and controls in reserved space", async ({ browser, baseURL }) => {
  for (const viewport of viewports) {
    const { context, page } = await openIsolatedTable(browser, viewport, baseURL!);
    try {
      await test.step(viewport.name, async () => {
        await verifyLocalLayout(page);
        await verifyOpponentLayout(page);
        const rearRailContent = await page.locator(".poker-table-wrap").evaluate((element) =>
          getComputedStyle(element, "::before").content,
        );
        expect(rearRailContent).toBe("none");
        if (viewport.screenshot) {
          await page.screenshot({ path: viewport.screenshot, fullPage: true });
        }
      });
    } finally {
      await context.close();
    }
  }
});
