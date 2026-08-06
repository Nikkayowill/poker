import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Snapshot = {
  id: string;
  version: number;
  handNumber: number;
  status: "playing" | "complete";
  street: string;
  currentPlayer: number | null;
  pot: number;
  rake: number;
  community: unknown[];
  log: unknown[];
  legalActions: {
    canFold: boolean;
    canCheck: boolean;
    canCall: boolean;
    canRaise: boolean;
    canAllIn: boolean;
    minRaiseTo: number;
  } | null;
  seats: Array<{
    position: number;
    stack: number;
    isMine: boolean;
    isCurrent: boolean;
    holeCards: unknown[];
  }>;
};

async function readGame(context: BrowserContext, id: string): Promise<Snapshot> {
  const response = await context.request.get(`/api/games/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).game as Snapshot;
}

async function assertFixedActionBar(page: Page) {
  const actionBar = page.locator(".action-bar");
  await expect(actionBar).toBeVisible();
  const box = await actionBar.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
}

async function continueAsGuest(page: Page) {
  await expect(page.locator(".account-entry-page")).toBeVisible();
  await page.getByRole("button", { name: "Play as guest" }).click();
}

test("a first-time mobile player can join from the lobby and always see their stack", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await continueAsGuest(page);

    // The hub tile is named for its game, not for the verb -- it read
    // "Join table" until b8cfabf, when it became one of five game tiles and
    // was the only one that never said what it dealt. The dialog's confirm
    // button below is still the verb, which is why these two differ.
    const joinButton = page.getByRole("button", { name: /Texas Hold/i });
    await expect(joinButton).toBeEnabled();
    await page.getByLabel("Player name").fill("Mobile Player");
    await joinButton.click();
    await page.getByRole("dialog").getByRole("button", { name: /^Join table$/i }).click();

    await expect(page.locator(".poker-table-wrap")).toBeVisible();
    const mine = page.locator(".player-seat:has(.you-chip)");
    const cards = mine.locator(".own-cards");
    const stack = mine.locator(".seat-stack");
    await expect(stack).toBeVisible();
    await expect(stack).toHaveAttribute("aria-label", /chips$/);

    const cardsBox = await cards.boundingBox();
    const stackBox = await stack.boundingBox();
    expect(cardsBox).not.toBeNull();
    expect(stackBox).not.toBeNull();
    expect(cardsBox!.y + cardsBox!.height).toBeLessThanOrEqual(stackBox!.y);
    await assertFixedActionBar(page);

    await page.screenshot({
      path: "artifacts/screenshots/mobile-quick-play-stack.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("six isolated players keep private cards, action order, layout, pot, and refresh state", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    for (let index = 0; index < 7; index += 1) {
      contexts.push(await browser.newContext({
        viewport: index === 1 ? { width: 390, height: 844 } : { width: 1440, height: 800 },
      }));
    }

    // Own a session first: the rate limiter keys on the session token and
    // only falls back to the source IP, so cookieless callers all share one
    // bucket in local dev. See tests/e2e/visual-layering.spec.ts.
    await contexts[0].request.post("/api/profile");
    const hostResponse = await contexts[0].request.post("/api/games", {
      data: { name: "Host", isPrivate: true },
    });
    expect(hostResponse.ok()).toBe(true);
    const hosted = await hostResponse.json();
    const id = hosted.game.id as string;
    const code = hosted.game.roomCode as string;

    const outsiderRead = await contexts[6].request.get(`/api/games/${id}`);
    expect(outsiderRead.status()).toBe(403);

    for (let index = 1; index < 6; index += 1) {
      const joined = await contexts[index].request.post("/api/games/join", {
        data: { code, name: `Player ${index + 1}` },
      });
      expect(joined.ok()).toBe(true);
    }

    const fullTableAttempt = await contexts[6].request.post("/api/games/join", {
      data: { code, name: "Seventh Player" },
    });
    expect(fullTableAttempt.status()).toBe(409);

    const pages: Page[] = [];
    for (let index = 0; index < 6; index += 1) {
      const page = await contexts[index].newPage();
      pages.push(page);
      await page.goto(`/?table=${id}`);
      await continueAsGuest(page);
      await expect(page.locator(".poker-table-wrap")).toBeVisible();
      const mine = page.locator(".player-seat:has(.you-chip)");
      await expect(mine.locator(".own-cards .playing-card")).toHaveCount(2);
      await expect(mine.locator(".own-cards .card-back")).toHaveCount(0);
      await expect(page.locator(".player-seat:not(:has(.you-chip)) .seat-cards .card-back")).toHaveCount(10);
      await assertFixedActionBar(page);
    }
    await pages[0].screenshot({
      path: "artifacts/screenshots/table-desktop.png",
      fullPage: true,
    });
    await pages[1].screenshot({
      path: "artifacts/screenshots/table-mobile-390.png",
      fullPage: true,
    });

    const beforeRefresh = await readGame(contexts[1], id);
    const beforeMine = beforeRefresh.seats.find((seat) => seat.isMine)!;
    await pages[1].reload();
    await continueAsGuest(pages[1]);
    await expect(pages[1].locator(".poker-table-wrap")).toBeVisible();
    const afterRefresh = await readGame(contexts[1], id);
    const afterMine = afterRefresh.seats.find((seat) => seat.isMine)!;
    expect(afterMine.position).toBe(beforeMine.position);
    expect(afterMine.stack).toBe(beforeMine.stack);
    expect(afterMine.holeCards).toEqual(beforeMine.holeCards);
    expect(afterRefresh.pot).toBe(beforeRefresh.pot);
    expect(afterRefresh.community).toEqual(beforeRefresh.community);
    expect(afterRefresh.street).toBe(beforeRefresh.street);

    let raised = false;
    let called = false;
    let folded = false;
    let safety = 0;
    const boardSizes = new Set<number>();
    let state = await readGame(contexts[0], id);
    while (state.status === "playing" && safety < 60) {
      expect(state.currentPlayer).not.toBeNull();
      const actor = state.currentPlayer!;
      const actorState = await readGame(contexts[actor], id);
      const legal = actorState.legalActions;
      expect(legal).not.toBeNull();

      let action: { type: string; amount?: number };
      if (!raised && legal!.canRaise) {
        action = { type: "raise", amount: legal!.minRaiseTo };
        raised = true;
      } else if (raised && !called && legal!.canCall) {
        action = { type: "call" };
        called = true;
      } else if (!folded) {
        action = { type: "fold" };
        folded = true;
      } else if (legal!.canCall) {
        action = { type: "call" };
      } else if (legal!.canCheck) {
        action = { type: "check" };
      } else {
        action = { type: "fold" };
      }

      const response = await contexts[actor].request.post(`/api/games/${id}/actions`, { data: action });
      expect(response.ok()).toBe(true);
      state = (await response.json()).game as Snapshot;
      boardSizes.add(state.community.length);
      safety += 1;
    }

    expect(state.status).toBe("complete");
    expect(raised).toBe(true);
    expect(called).toBe(true);
    expect(folded).toBe(true);
    expect([...boardSizes]).toEqual(expect.arrayContaining([3, 4, 5]));
    expect(state.community).toHaveLength(5);
    expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.rake).toBe(6000);

    const nextActor = state.seats.find((seat) => seat.stack > 0)!.position;
    const next = await contexts[nextActor].request.post(`/api/games/${id}/actions`, {
      data: { type: "next-hand" },
    });
    expect(next.ok()).toBe(true);
    const nextState = (await next.json()).game as Snapshot;
    expect(nextState.handNumber).toBe(state.handNumber + 1);
    expect(nextState.status).toBe("playing");
    await pages[0].reload();
    await continueAsGuest(pages[0]);
    await assertFixedActionBar(pages[0]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
