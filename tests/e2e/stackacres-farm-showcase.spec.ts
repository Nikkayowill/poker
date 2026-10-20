import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * Visitor Mode in a browser: the owner's own setting, and looking at a farm.
 *
 * TWO HALVES, AND ONLY ONE OF THEM CAN BE HONEST HERE.
 *
 * The owner's half is real end to end -- a live profile, the real sheet, the
 * real PUT, and the real GET behind the visitor page they are sent to. Nothing
 * is stubbed in it.
 *
 * The friend's half is fulfilled from a stubbed snapshot, for the reason
 * notification-inbox.spec.ts and friends-leaderboard.spec.ts already state
 * for themselves: a friendship needs two REGISTERED accounts (POST
 * /api/friends/requests is registered-only), and this suite runs against the
 * in-memory store with the Supabase variables blanked (playwright.config.ts),
 * so no account in it can register. Building a friendship over HTTP here is
 * not possible, not merely inconvenient.
 *
 * So the authorization -- who may open a farm, who may react, and that a
 * visitor's own actions land on their own farm -- is covered against the real
 * stores in lib/server/farm-showcase-visits.test.ts, and what only a browser
 * can answer is covered here: that the read-only screen renders a friend's
 * farm, that it offers no controls that could touch it, and that a reaction
 * sends and then reads as spent.
 */

test.use({ viewport: { width: 932, height: 430 } });

/** A stranger's id, shaped like a real one so the route's uuid check passes. */
const FRIEND_ID = "aaaaaaaa-1111-2222-3333-444444444444";

const FRIEND_FARM = {
  owner: {
    profileId: FRIEND_ID,
    displayName: "Marisol",
    initials: "MA",
    avatarUrl: null,
    avatarPreset: "ace",
    accent: "#e7c66a",
  },
  stats: {
    farmLevel: 3,
    chapter: { number: 2, title: "Stew" },
    chaptersDone: 1,
    favoriteProduction: { stock: "carrot", label: "Carrot", count: 12 },
  },
  world: {
    units: [],
    soilTiles: [],
    fences: [],
    guardDogs: [],
    empireBuildings: [],
    woodNodes: [],
    stoneNodes: [],
    forageNodes: [],
    landObstacles: [],
    grocery: null,
    clock: { offsetMs: 0, serverNowMs: Date.parse("2026-09-30T12:00:00.000Z") },
  },
  reactions: { nice_layout: 2, great_farm: 0, impressive_production: 1 },
  sent: [],
  own: false,
};

/** A guest with StackAcres access, which is the door on every route here. */
async function letIn(context: BrowserContext) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as {
    profile: { id: string };
  };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  return profile.id;
}

/** The map is up. Set by the world itself on ready, so it means the canvas
 *  exists rather than that the page has merely navigated. */
async function waitForWorld(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres), {
    timeout: 30_000,
  });
}

test("the owner opens their farm to friends and previews it as a visitor", async ({ context, page }) => {
  const profileId = await letIn(context);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await waitForWorld(page);

  // At this viewport height the HUD is in its tight-landscape tier, so the
  // badge lives behind the "More" drawer rather than sitting inline.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Farm visitors" }).click();

  const sheet = page.getByRole("dialog", { name: "Farm visitors" });
  await expect(sheet).toBeVisible();
  // Private is where every farm starts, and the sheet has to say so rather
  // than showing nothing selected.
  await expect(sheet.getByRole("button", { name: /Only me/ })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet).toContainText("Nobody has left a reaction yet.");

  await sheet.getByRole("button", { name: /My friends/ }).click();
  await expect(sheet.getByRole("button", { name: /My friends/ })).toHaveAttribute("aria-pressed", "true");

  // The PUT really landed, asked of the server rather than of the button that
  // sent it. Checked over the API instead of by reloading the page: a second
  // farm boot costs most of this test's budget, and the reload would only
  // prove the same one fact less directly.
  const saved = await (await context.request.get("/api/stackacres/showcase")).json();
  expect(saved).toMatchObject({ visibility: "friends" });

  // Straight through to the visitor page, on the real API and the owner's
  // real farm: their own farm is the one nobody is ever refused.
  await page.getByRole("link", { name: /See your farm the way a visitor does/ }).click();
  await expect(page).toHaveURL(new RegExp(`/games/stackacres/visit/${profileId}$`), { timeout: 30_000 });
  await waitForWorld(page);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".sa-visit-card")).toContainText("Farm level");
  // Their own farm offers no reactions, and says why.
  await expect(page.locator(".sa-visit-react")).toContainText("This is how your farm looks to a visitor");
  await expect(page.locator(".sa-visit-reaction")).toHaveCount(0);
});

test("a friend's farm is read-only, and a reaction sends once", async ({ context, page }) => {
  await letIn(context);

  await page.route(
    (url) => url.pathname === `/api/stackacres/showcase/${FRIEND_ID}`,
    async (route) => { await route.fulfill({ json: FRIEND_FARM }); },
  );
  let posted = 0;
  await page.route(
    (url) => url.pathname === `/api/stackacres/showcase/${FRIEND_ID}/reactions`,
    async (route) => {
      posted += 1;
      // What the real route answers: the new tallies, and what this viewer
      // has now spent. See app/api/stackacres/showcase/[profileId]/reactions.
      await route.fulfill({
        json: {
          reactions: { ...FRIEND_FARM.reactions, nice_layout: 3 },
          sent: ["nice_layout"],
          counted: true,
        },
      });
    },
  );

  await page.goto(`/games/stackacres/visit/${FRIEND_ID}`);
  await waitForWorld(page);

  // The header: who, and the lines the spec asked for.
  const card = page.locator(".sa-visit-card");
  await expect(card.getByRole("heading", { level: 1 })).toHaveText("Marisol");
  await expect(card).toContainText("Nothing here can be touched");
  // The three stat values in order, read off the values rather than off the
  // card's whole text -- "3" appears in an accent colour and a timestamp too.
  await expect(card.locator("dd")).toHaveText(["3", "2 · Stew", "Carrot · 12"]);

  // Read-only, in the two places a visitor could otherwise act: the thumb
  // stick and the Use key are the whole input surface of the farm, and
  // neither is on the page at all.
  await expect(page.locator(".sa-joystick")).toHaveCount(0);
  await expect(page.locator(".sa-use-key")).toHaveCount(0);

  const nice = page.getByRole("button", { name: /Nice layout/ });
  await expect(nice).toContainText("2");
  await nice.click();

  await expect(nice).toContainText("3");
  await expect(nice).toBeDisabled();
  await expect(page.locator(".sa-visit-thanks")).toContainText("Nice layout");

  // A second press cannot go out: the button it would come from is spent.
  await expect(nice).toBeDisabled();
  expect(posted).toBe(1);
});

test("a farm that isn't open says so, and offers the way back rather than a retry", async ({ context, page }) => {
  await letIn(context);

  // The real route, not a stub: a guest asking for a stranger's farm is
  // exactly the refusal this screen exists to render.
  await page.goto(`/games/stackacres/visit/${FRIEND_ID}`);

  const error = page.locator(".sa-loading-error");
  await expect(error).toContainText("That farm isn't open to visitors.");
  await expect(error.getByRole("link", { name: "Back to your farm" })).toBeVisible();
  await expect(error.getByRole("button", { name: "Try again" })).toHaveCount(0);
});
