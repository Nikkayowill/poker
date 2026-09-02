import { randomUUID } from "crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * Answering a friend request from the notification inbox.
 *
 * Both halves are stubbed rather than played out for real, the same call
 * friends-leaderboard.spec.ts makes and for the same reason: friend requests
 * are registered-only, so a guest cookie cannot create one, and building two
 * linked accounts would test the auth path rather than this. The server half
 * already has lib/server/friends-store.test.ts. What only a browser can
 * answer is whether the row offers the buttons at all, whether Accept
 * actually reaches /api/friends/requests/[id], and whether the row stops
 * offering them afterwards -- which is the whole gap this exists to close,
 * since the inbox shipped read-only.
 */

const REQUESTER = "11111111-1111-1111-1111-111111111111";
const REQUEST_ID = "22222222-2222-2222-2222-222222222222";

const NOTIFICATIONS = {
  notifications: [
    {
      id: "notification-1",
      kind: "friend_request_received",
      payload: { fromProfileId: REQUESTER, fromDisplayName: "chipslinger" },
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      readAt: null,
    },
  ],
  unreadCount: 1,
};

const PENDING_REQUEST = {
  id: REQUEST_ID,
  profileId: REQUESTER,
  displayName: "chipslinger",
  initials: "CH",
  avatarUrl: null,
  avatarPreset: "emerald",
  accent: "#7fd9a8",
  createdAt: new Date(Date.now() - 120_000).toISOString(),
};

/** Records what the inbox posted, so a test can assert the request was actually settled. */
interface Stubs {
  responded: { action: string } | null;
}

async function stubSocialApis(page: Page): Promise<Stubs> {
  const stubs: Stubs = { responded: null };
  // Answering a request empties the pending list, exactly as a real refetch
  // after a real accept would -- the row's own outcome is not the only thing
  // that has to stop offering buttons.
  let incoming = [PENDING_REQUEST];

  await page.route((url) => url.pathname === "/api/notifications", (route) => route.fulfill({ json: NOTIFICATIONS }));
  await page.route((url) => url.pathname === "/api/notifications/read-all", (route) => route.fulfill({ json: {} }));
  await page.route((url) => url.pathname === "/api/friends", (route) => route.fulfill({
    json: { friends: [], incoming, outgoing: [], recentOpponents: [] },
  }));
  await page.route(
    (url) => url.pathname === `/api/friends/requests/${REQUEST_ID}`,
    async (route) => {
      stubs.responded = JSON.parse(route.request().postData() ?? "{}");
      incoming = [];
      await route.fulfill({ json: { status: "accepted" } });
    },
  );
  return stubs;
}

/**
 * Owns a session before the page loads.
 *
 * Minted rather than claimed through POST /api/profile: that route is itself
 * a cookieless request against a 10-per-minute bucket every spec in the suite
 * shares, so the escape hatch drains the thing it is escaping. The token is
 * opaque and unsigned -- readSessionToken (lib/server/session.ts) returns
 * whatever was sent and ensureProfile keys a guest profile off it -- so this
 * is exactly what the server would have issued.
 */
async function enterLobby(page: Page, baseURL: string, path = "/") {
  await page.context().addCookies([{ name: "river_session", value: randomUUID(), url: baseURL }]);
  await page.goto(path);
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.locator(".notification-bell-trigger")).toBeVisible();
}

test("a friend request is accepted from the notification inbox", async ({ page, baseURL }) => {
  const stubs = await stubSocialApis(page);
  await enterLobby(page, baseURL!);

  await page.locator(".notification-bell-trigger").click();
  const row = page.locator(".notification-row").filter({ hasText: "chipslinger" });
  await expect(row).toContainText("sent you a friend request");

  await row.locator(".notification-row-accept").click();
  await expect(row.locator(".notification-row-status")).toContainText("now friends");
  expect(stubs.responded).toEqual({ action: "accept" });

  // The buttons are spent, not merely relabelled.
  await expect(row.locator(".notification-row-accept")).toHaveCount(0);
  await expect(row.locator(".notification-row-decline")).toHaveCount(0);
});

test("tapping the push opens the inbox on a cold start", async ({ page, baseURL }) => {
  await stubSocialApis(page);
  // What lib/server/notifications-store.ts's INBOX_URL sends a tapped push to
  // when there is no tab already open for the service worker to message.
  await enterLobby(page, baseURL!, "/?notifications=1");

  await expect(page.locator(".notification-bell-panel")).toBeVisible();
  await expect(page.locator(".notification-row-accept")).toBeVisible();
  // Stripped once honoured, so a reload doesn't reopen it forever.
  await expect(page).toHaveURL(/\/$/);
});
