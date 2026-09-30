import { expect, test } from "./fixtures";

/**
 * The leaderboard's Friends tab: you and your friends ranked by Rank Points.
 *
 * The board is fulfilled from a stubbed /api/leaderboard response rather than
 * played out for real. Building the state honestly would mean two registered
 * accounts, a friendship and settled solo wagers, and none of that tests what
 * this spec is for. The server half is covered in
 * lib/server/rank-board-store.test.ts and app/api/leaderboard/route.test.ts;
 * what only a browser can answer is whether the rows render, carry no
 * win/loss counters, and stay inside the page on a phone.
 */

const entry = (rank: number, name: string, points: number, title: string, level: number, difficulty: string | null) => ({
  profileId: `${rank}`.repeat(8) + "-1111-1111-1111-111111111111",
  rank,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  avatarUrl: null,
  avatarPreset: "ace",
  avatarCosmetic: "default",
  accent: "#e7c66a",
  points,
  level,
  title,
  difficulty,
});

const BOARD = {
  game: "friends",
  entries: [
    entry(1, "Jasmine", 4200, "Grinder", 6, "Top stakes"),
    entry(2, "Mike", 900, "Rail Bird", 3, "Standard rules"),
    entry(3, "Newcomer", 0, "Rail Bird", 1, null),
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
    await expect(page.locator(".leaderboard-header p")).toContainText("You and your friends");
  }).toPass({ timeout: 30_000 });
}

test("the Friends tab ranks friends by Rank Points, with no win-loss record", async ({ page }) => {
  await page.goto("/leaderboard");
  await openFriendsTab(page);

  const rows = page.locator(".leaderboard-table .leaderboard-row:not(.leaderboard-row-head)");
  await expect(rows).toHaveCount(3);

  await expect(rows.nth(0)).toContainText("Jasmine");
  await expect(rows.nth(0)).toContainText("4,200 RP");
  await expect(rows.nth(0)).toContainText("Grinder");
  await expect(rows.nth(0)).toContainText("Top stakes");
  await expect(rows.nth(2)).toContainText("0 RP");

  // The old board's counters must not come back.
  await expect(page.locator(".leaderboard-table")).not.toContainText("W-L");
  await expect(page.locator(".leaderboard-table")).not.toContainText("Win %");
  await expect(page.locator(".leaderboard-table")).not.toContainText("Streak");
});

test("the friends board keeps its columns inside the page on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/leaderboard");
  await openFriendsTab(page);

  const first = page.locator(".leaderboard-table .leaderboard-row:not(.leaderboard-row-head)").first();
  await expect(first).toContainText("Jasmine");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await first.locator(".leaderboard-points").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
