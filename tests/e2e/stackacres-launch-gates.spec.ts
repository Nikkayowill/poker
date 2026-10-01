import { expect, test, type Browser, type BrowserContext } from "./fixtures";

/**
 * The StackAcres launch gates that are about who may do what, and what a
 * refusal costs: the paid-access wall, a visitor's view of a farm, money that
 * must not move on a refused action, the daily tend, and the Farm Board
 * paying once.
 *
 * Memory mode only, like stackacres-launch-checks.spec.ts.
 */

const ADMIN_SECRET = "playwright-admin-secret";

interface Farm {
  profile: { goldBalance: number };
  units: { id: string; stock: string }[];
  farmBoard: {
    lines: {
      code: string;
      label: string;
      goldReward: number;
      complete: boolean;
      claimed: boolean;
      claimable: boolean;
    }[];
  };
}

async function newFarmer(browser: Browser, options: { admitted: boolean; gold?: number }) {
  const context = await browser.newContext();
  const { profile } = (await (await context.request.post("/api/profile")).json()) as {
    profile: { id: string; goldBalance: number };
  };
  expect((await context.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
  if (options.admitted) {
    expect(
      (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
    ).toBe(true);
  }
  const gold = options.gold ?? 400_000;
  if (gold !== profile.goldBalance) {
    expect(
      (await context.request.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: gold - profile.goldBalance } })).ok(),
    ).toBe(true);
  }
  return { context, id: profile.id };
}

const act = (context: BrowserContext, data: Record<string, unknown>) => context.request.post("/api/stackacres/actions", { data });

async function must(context: BrowserContext, data: Record<string, unknown>) {
  const response = await act(context, data);
  expect(response.ok(), `${String(data.action)} -> ${response.status()} ${await response.text()}`).toBe(true);
  return response;
}

async function read(context: BrowserContext): Promise<Farm> {
  const response = await context.request.get("/api/stackacres");
  expect(response.ok(), `read -> ${response.status()}`).toBe(true);
  return (await response.json()) as Farm;
}

test("a profile without access is turned away, and so is one whose access is taken back", async ({ browser }) => {
  const { context, id } = await newFarmer(browser, { admitted: false });
  try {
    expect((await context.request.get("/api/stackacres")).status()).toBe(401);
    expect((await act(context, { action: "buy-stock", stock: "pig" })).status()).toBe(401);

    const granted = await context.request.post("/api/admin/stackacres-access", { data: { profileId: id, allowed: true } });
    expect(granted.ok()).toBe(true);
    await must(context, { action: "buy-stock", stock: "pig" });

    // A refund or a lost dispute takes the farm away again.
    const revoked = await context.request.post("/api/admin/stackacres-access", { data: { profileId: id, allowed: false } });
    expect(revoked.ok()).toBe(true);
    expect((await context.request.get("/api/stackacres")).status()).toBe(401);
    expect((await act(context, { action: "buy-stock", stock: "pig" })).status()).toBe(401);
  } finally {
    await context.close();
  }
});

test("another player's farm is a plain 404 whether it is private, missing or yours to see", async ({ browser }) => {
  const owner = await newFarmer(browser, { admitted: true });
  const visitor = await newFarmer(browser, { admitted: true });
  const outsider = await newFarmer(browser, { admitted: false });
  try {
    // Nobody has opened this farm to anyone, so it is private.
    const privateFarm = await visitor.context.request.get(`/api/stackacres/showcase/${owner.id}`);
    expect(privateFarm.status()).toBe(404);

    // A farm that does not exist answers the same, so the answer says nothing about who farms.
    const missing = await visitor.context.request.get("/api/stackacres/showcase/00000000-0000-4000-8000-000000000000");
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toBe(await privateFarm.text());

    // Without access of their own, a visitor does not even get that far.
    const locked = await outsider.context.request.get(`/api/stackacres/showcase/${owner.id}`);
    expect(locked.status()).toBe(401);
  } finally {
    await owner.context.close();
    await visitor.context.close();
    await outsider.context.close();
  }
});

test("a purchase the purse cannot cover is refused and leaves no animal behind", async ({ browser }) => {
  const { context } = await newFarmer(browser, { admitted: true, gold: 10 });
  try {
    const before = await read(context);
    const refused = await act(context, { action: "buy-stock", stock: "cattle" });
    expect(refused.ok()).toBe(false);
    expect(((await refused.json()) as { error?: string }).error).toBeTruthy();

    const after = await read(context);
    expect(after.profile.goldBalance).toBe(before.profile.goldBalance);
    expect(after.units.filter((unit) => unit.stock === "cattle")).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("an animal is tended once a day and the tend costs nothing", async ({ browser }) => {
  const { context } = await newFarmer(browser, { admitted: true });
  try {
    await must(context, { action: "buy-stock", stock: "cattle" });
    const bought = await read(context);
    const cow = bought.units.find((unit) => unit.stock === "cattle")!;

    await must(context, { action: "care", unitId: cow.id });
    const again = await act(context, { action: "care", unitId: cow.id });
    expect(again.status(), "a second tend the same day is refused").toBe(409);
    expect((await read(context)).profile.goldBalance, "tending moves no Gold").toBe(bought.profile.goldBalance);

    // Two taps at once on a fresh animal still tend it once.
    await must(context, { action: "buy-stock", stock: "cattle" });
    const second = (await read(context)).units.find((unit) => unit.stock === "cattle" && unit.id !== cow.id)!;
    const taps = await Promise.all([
      act(context, { action: "care", unitId: second.id }),
      act(context, { action: "care", unitId: second.id }),
    ]);
    expect(taps.filter((tap) => tap.ok())).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("a Farm Board line pays only when it is done, and only once", async ({ browser }) => {
  // The board is drawn at random, so look through a few new farms for one with a chore
  // that can be finished over the API in a few swings.
  const finishable = ["easy_chop_3", "easy_mine_3"];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { context } = await newFarmer(browser, { admitted: true });
    try {
      const farm = await read(context);
      expect(farm.farmBoard.lines.length, "the board has something on it").toBeGreaterThan(0);

      const line = farm.farmBoard.lines.find((candidate) => finishable.includes(candidate.code));
      if (!line) continue;

      // Not done yet: refused, and nothing moves.
      const early = await act(context, { action: "claim-farm-board", code: line.code });
      expect(early.ok(), "an unfinished line cannot be claimed").toBe(false);
      expect((await read(context)).profile.goldBalance).toBe(farm.profile.goldBalance);
      const unknown = await act(context, { action: "claim-farm-board", code: "not_a_real_line" });
      expect(unknown.ok()).toBe(false);

      for (let swing = 0; swing < 3; swing += 1) {
        if (line.code === "easy_chop_3") await must(context, { action: "chop-tree", nodeId: "homestead-1" });
        else await must(context, { action: "mine-stone", nodeId: "stone:mine-1" });
      }
      const done = await read(context);
      const finished = done.farmBoard.lines.find((candidate) => candidate.code === line.code)!;
      expect(finished.claimable, "three swings finish it").toBe(true);

      const taps = await Promise.all([
        act(context, { action: "claim-farm-board", code: line.code }),
        act(context, { action: "claim-farm-board", code: line.code }),
      ]);
      expect(taps.filter((tap) => tap.ok()), "two simultaneous claims pay once").toHaveLength(1);
      const paid = await read(context);
      expect(paid.profile.goldBalance - done.profile.goldBalance).toBe(line.goldReward);
      expect(paid.farmBoard.lines.find((candidate) => candidate.code === line.code)!.claimed).toBe(true);

      const late = await act(context, { action: "claim-farm-board", code: line.code });
      expect(late.ok(), "a claimed line cannot be claimed again").toBe(false);
      expect((await read(context)).profile.goldBalance).toBe(paid.profile.goldBalance);
      return;
    } finally {
      await context.close();
    }
  }
  test.skip(true, "no farm in twelve was drawn a chop or mine chore");
});
