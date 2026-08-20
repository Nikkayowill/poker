import { expect, test } from "@playwright/test";

/**
 * The leaderboard's Friends tab: your own record against each friend.
 *
 * The board is fulfilled from a stubbed /api/leaderboard response rather than
 * played out for real. Building the state honestly would mean two registered
 * accounts (friend requests are registered-only, so a guest cookie cannot
 * make one), a friendship, and five settled duels between them -- and none of
 * that would test anything this spec is for. The server half is covered in
 * lib/server/head-to-head-store.test.ts and leaderboard-store.test.ts; what
 * only a browser can answer is whether the row renders, whether it expands,
 * and whether the per-game split lines up under it.
 */

const BOARD = {
  game: "friends",
  entries: [
    {
      profileId: "11111111-1111-1111-1111-111111111111",
      displayName: "Jasmine",
      avatarUrl: null,
      accent: "#e7c66a",
      wins: 3,
      losses: 8,
      draws: 0,
      currentStreak: 0,
      bestStreak: 2,
      games: [
        { gameId: "chess", label: "Chess", wins: 1, losses: 4, draws: 0, currentStreak: -3 },
        { gameId: "cribbage", label: "Cribbage", wins: 2, losses: 4, draws: 0, currentStreak: 1 },
      ],
    },
    {
      profileId: "22222222-2222-2222-2222-222222222222",
      displayName: "Mike",
      avatarUrl: null,
      accent: "#8f7bd6",
      wins: 0,
      losses: 5,
      draws: 0,
      currentStreak: -5,
      bestStreak: 0,
      games: [
        { gameId: "checkers", label: "Checkers", wins: 0, losses: 5, draws: 0, currentStreak: -5 },
      ],
    },
    {
      profileId: "33333333-3333-3333-3333-333333333333",
      displayName: "Newcomer",
      avatarUrl: null,
      accent: "#7fd9a8",
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
      games: [],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  // A predicate, not a glob: Playwright's URL globs treat "?" as a wildcard
  // character, so "**/api/leaderboard?game=friends" is not the literal query
  // string it looks like.
  await page.route(
    (url) => url.pathname === "/api/leaderboard" && url.searchParams.get("game") === "friends",
    async (route) => { await route.fulfill({ json: BOARD }); },
  );
});

/**
 * Opens the tab, retrying the click.
 *
 * The page is a client component served statically, so the tab strip is on
 * screen and inert for the moment before React hydrates -- a single click
 * lands on nothing and the board never changes. Retried until the header copy
 * says the switch actually happened.
 */
async function openFriendsTab(page: import("@playwright/test").Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Friends", exact: true }).click();
    await expect(page.locator(".leaderboard-header p")).toContainText("Your record against each friend");
  }).toPass({ timeout: 30_000 });
}

test("the Friends tab shows a record against each friend, and expands into the per-game split", async ({ page }) => {
  await page.goto("/leaderboard");
  await openFriendsTab(page);

  // Scoped through the wrapper: the head row reuses .leaderboard-row-friend
  // for its own grid, and only a friend's row is wrapped.
  const rows = page.locator(".leaderboard-friend .leaderboard-row-friend");
  await expect(page.getByText("Jasmine")).toBeVisible();

  // A single-game record reports its streak; a mixed one leaves it to the
  // per-game rows, because the order across games isn't recoverable.
  const mike = page.locator(".leaderboard-friend").filter({ hasText: "Mike" });
  await expect(mike).toContainText("0-5");
  await expect(mike).toContainText("L5");

  const jasmine = page.locator(".leaderboard-friend").filter({ hasText: "Jasmine" });
  await expect(jasmine).toContainText("3-8");
  await expect(jasmine).toContainText("27%");

  // Collapsed until asked for.
  await expect(jasmine.locator(".leaderboard-friend-games")).toHaveCount(0);
  await jasmine.locator(".leaderboard-row-friend").click();
  const split = jasmine.locator(".leaderboard-friend-game");
  await expect(split).toHaveCount(2);
  await expect(split.first()).toContainText("Chess");
  await expect(split.first()).toContainText("1-4");
  await expect(split.first()).toContainText("L3");

  // A friend with no shared history is a row, not a hole -- and nothing to open.
  const newcomer = page.locator(".leaderboard-friend").filter({ hasText: "Newcomer" });
  await expect(newcomer).toContainText("No games yet");
  await expect(newcomer.locator(".leaderboard-row-friend")).toBeDisabled();
  expect(await rows.count()).toBe(3);
});

test("the friends board keeps its columns inside the page on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/leaderboard");
  await openFriendsTab(page);

  const jasmine = page.locator(".leaderboard-friend").filter({ hasText: "Jasmine" });
  await jasmine.locator(".leaderboard-row-friend").click();
  await expect(jasmine.locator(".leaderboard-friend-game")).toHaveCount(2);

  // The whole point of the narrow grid: no horizontal scroll, and the record
  // column still on screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await jasmine.locator(".leaderboard-stat").first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
