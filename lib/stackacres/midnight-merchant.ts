/**
 * The Midnight Merchant: a temporary, high-impact NPC visit on the StackAcres
 * farm. Everything in this file is pure and dependency-free -- no Supabase,
 * no Phaser, no fetch -- the same contract farmhand-machine.ts holds, and for
 * the same reason: it has to be unit-testable without a renderer or a
 * database, and it must never be the thing that decides Gold moves.
 *
 * SERVER IS AUTHORITATIVE (see CLAUDE.md). Nothing here spawns a visit,
 * charges Gold, or grants an item -- `lib/server/midnight-merchant-service.ts`
 * does that, backed by the row-locked RPCs in
 * supabase/migrations/20260905130000_stackacres_midnight_merchant.sql. This
 * module supplies:
 *
 *   1. The item catalog and the price-ladder function
 *      (`priceForNextPurchase`), so the server and any client preview compute
 *      the exact same number from the exact same inputs -- the client-side
 *      copy here is a PREVIEW only; the server's own copy inside
 *      `redeem_midnight_merchant_item` is what actually charges Gold, and the
 *      two are required to agree only because they read the same formula,
 *      never because the client's answer is trusted.
 *   2. `MidnightMerchantManager`, a small class the Phaser-facing shell
 *      (stackacres-farm.tsx) owns one instance of per mounted farm. It ticks
 *      forward with the farm's own render loop the same way
 *      `FarmhandStateMachine.update(deltaMs)` does, and its only job is
 *      deriving what to RENDER (is the NPC on the lot, how long is left,
 *      should a spawn/despawn transition play) from the last snapshot the
 *      server sent -- it never invents a visit the server hasn't confirmed,
 *      and it never runs a purchase.
 */

/* ------------------------------------------------------------------ */
/* Catalog                                                              */
/* ------------------------------------------------------------------ */

/**
 * What the Merchant can sell. A short, deliberately non-overlapping list --
 * none of these are also sold by Ray or the district stalls, so a visit is
 * never just a discount/markup on something already on the farm.
 */
export const MIDNIGHT_MERCHANT_ITEM_IDS = [
  "gilded_scarecrow",
  "lucky_horseshoe",
  "moonlit_lantern",
] as const;

export type MidnightMerchantItemId = (typeof MIDNIGHT_MERCHANT_ITEM_IDS)[number];

export function isMidnightMerchantItemId(value: string): value is MidnightMerchantItemId {
  return (MIDNIGHT_MERCHANT_ITEM_IDS as readonly string[]).includes(value);
}

export interface MidnightMerchantCatalogEntry {
  readonly itemId: MidnightMerchantItemId;
  readonly label: string;
  readonly basePrice: number;
  /** How many of this item one visit ever offers, total, before it sells
   *  out -- independent of Gold; a player at unlimited Gold still can't buy
   *  a fourth. */
  readonly stockPerVisit: number;
}

export const MIDNIGHT_MERCHANT_CATALOG: readonly MidnightMerchantCatalogEntry[] = [
  { itemId: "gilded_scarecrow", label: "Gilded Scarecrow", basePrice: 4_000, stockPerVisit: 1 },
  { itemId: "lucky_horseshoe", label: "Lucky Horseshoe", basePrice: 2_500, stockPerVisit: 2 },
  { itemId: "moonlit_lantern", label: "Moonlit Lantern", basePrice: 1_200, stockPerVisit: 3 },
];

export function catalogEntry(itemId: MidnightMerchantItemId): MidnightMerchantCatalogEntry {
  const entry = MIDNIGHT_MERCHANT_CATALOG.find((row) => row.itemId === itemId);
  if (!entry) throw new Error(`No Midnight Merchant catalog entry for "${itemId}".`);
  return entry;
}

/* ------------------------------------------------------------------ */
/* Spawn gating                                                         */
/* ------------------------------------------------------------------ */

/** Not every critical harvest summons a visit -- see
 *  lib/server/stackacres-service.ts's `harvestStackAcres`, step 5c: a
 *  critical is already a dice-rolled rarity (`rollHarvestCrit`), and this is
 *  a second, independent roll on top of it, the same "a secret find
 *  piggybacks on a critical harvest rather than adding a second guarded
 *  write" shape `rollSecretArtifact` already uses -- gating a SEPARATE roll
 *  off the same trigger, not a second write. */
export const MIDNIGHT_MERCHANT_SPAWN_CHANCE_ON_CRIT = 0.35;

/** How long a spawned visit lasts, in ms, before it lapses on its own even
 *  if the session that triggered it stays live the whole time -- "midnight"
 *  is a mood, not a literal clock hour; this is deliberately short (a single
 *  sitting) rather than a real overnight window; see the file header. */
export const MIDNIGHT_MERCHANT_WINDOW_MS = 20 * 60 * 1000;

/** Pure injected-RNG gate, the same shape `rollHarvestCrit(tool, Math.random,
 *  critChance)` already takes, so a test can hand it a fake and assert both
 *  branches without patching global Math.random. */
export function shouldSpawnMidnightMerchantOnCriticalHarvest(random: () => number): boolean {
  return random() < MIDNIGHT_MERCHANT_SPAWN_CHANCE_ON_CRIT;
}

/* ------------------------------------------------------------------ */
/* Stock valuation                                                      */
/* ------------------------------------------------------------------ */

/** 20% steeper for every consecutive item this SAME visit has already sold
 *  this player. `1.2^0 === 1`, so the first purchase of a visit is always
 *  exactly `basePrice`. */
export const MIDNIGHT_MERCHANT_PRICE_GROWTH = 1.2;

/**
 * The price of the NEXT item, given how many this visit has already sold.
 * `purchaseStreak` is the count BEFORE this purchase (0 for the first item),
 * matching `stackacres_midnight_merchant_state.purchase_streak` exactly as
 * `redeem_midnight_merchant_item` reads it under its own row lock -- this
 * function and that RPC must stay the same formula, restated independently
 * (SQL can't import TypeScript), not shared.
 *
 * Rounded UP (never down): a fractional Gold cost would either round the
 * house's own price down for free or require inventing sub-Gold currency,
 * and every other priced thing in this app is a whole number of Gold.
 */
export function priceForNextPurchase(basePrice: number, purchaseStreak: number): number {
  if (!Number.isInteger(basePrice) || basePrice <= 0) {
    throw new Error(`Invalid base price: ${basePrice}`);
  }
  if (!Number.isInteger(purchaseStreak) || purchaseStreak < 0) {
    throw new Error(`Invalid purchase streak: ${purchaseStreak}`);
  }
  return Math.ceil(basePrice * MIDNIGHT_MERCHANT_PRICE_GROWTH ** purchaseStreak);
}

/** The full price ladder for one catalog entry, `count` rungs deep, starting
 *  at streak 0 -- what the storefront shows next to each item so a player
 *  can see the second and third purchase get pricier before committing to
 *  the first. Pure preview; never charged from. */
export function priceLadder(basePrice: number, count: number): readonly number[] {
  const rungs: number[] = [];
  for (let streak = 0; streak < count; streak += 1) {
    rungs.push(priceForNextPurchase(basePrice, streak));
  }
  return rungs;
}

/* ------------------------------------------------------------------ */
/* Volatile visit snapshot -- the server's answer, never invented locally */
/* ------------------------------------------------------------------ */

export interface MidnightMerchantStockLine {
  readonly itemId: MidnightMerchantItemId;
  readonly basePrice: number;
  readonly remaining: number;
}

/** What triggers a visit. Restated here (not imported from
 *  lib/domain-events.ts) because a Merchant visit is not itself a
 *  DomainEvent -- it is CAUSED by one (`critical_harvest` mirrors
 *  DomainEvent's `museum_secret_set_completed`-style "a rare thing just
 *  happened" shape) or by a session-idle tick that owes nothing to any
 *  particular play event. Kept as a closed union matching the SQL CHECK
 *  constraint on `stackacres_midnight_merchant_state.trigger` exactly. */
export type MidnightMerchantTrigger = "critical_harvest" | "session_idle_tick" | "admin_grant";

/** The server-confirmed state of a visit, or null for "no visit right now".
 *  This is the ENTIRE input `MidnightMerchantManager` is allowed to render
 *  from -- there is no local field anywhere in this file that can turn a
 *  null snapshot into a visible NPC. */
export interface MidnightMerchantSnapshot {
  readonly trigger: MidnightMerchantTrigger;
  readonly spawnedAtIso: string;
  readonly expiresAtIso: string;
  readonly purchaseStreak: number;
  readonly stock: readonly MidnightMerchantStockLine[];
}

/* ------------------------------------------------------------------ */
/* MidnightMerchantManager                                             */
/* ------------------------------------------------------------------ */

/** What the manager currently believes should be rendered. `"absent"` and
 *  `"present"` are steady states; `"arriving"`/`"departing"` are one-shot
 *  transitions the scene plays once and that `tick` then advances out of on
 *  its own -- see `MIDNIGHT_MERCHANT_TRANSITION_MS`. */
export type MidnightMerchantRenderState = "absent" | "arriving" | "present" | "departing";

/** How long the arrival/departure animation gets before the manager settles
 *  into the steady state either side of it. */
export const MIDNIGHT_MERCHANT_TRANSITION_MS = 900;

/** Below this much real time left, the storefront shows an urgency cue
 *  ("leaving soon") rather than a bare countdown -- purely a render hint,
 *  never gates a purchase (the server's own `expires_at` check inside
 *  `redeem_midnight_merchant_item` is what actually refuses a late buy). */
export const MIDNIGHT_MERCHANT_URGENT_MS = 60_000;

export interface MidnightMerchantRenderSnapshot {
  readonly state: MidnightMerchantRenderState;
  /** Milliseconds of the visit left, clamped to >= 0; 0 whenever `state` is
   *  `"absent"`. Ticks down locally between snapshots so the storefront's
   *  countdown does not visibly stall between polls -- it is corrected back
   *  to the server's own number on every `applySnapshot`, so client clock
   *  drift can never extend a visit past what the server will actually
   *  honor. */
  readonly msRemaining: number;
  readonly urgent: boolean;
  readonly visit: MidnightMerchantSnapshot | null;
}

/**
 * Owns exactly one farm's worth of Midnight Merchant render state.
 *
 * `applySnapshot` is the only way a visit becomes visible or invisible --
 * called every time `readStackAcres`'s response carries a fresh
 * `midnightMerchant` field (mount, tab-return, and after every action, the
 * same cadence the rest of the StackAcres view already refreshes on; see
 * app/api/stackacres/route.ts's own header on why this is poll-free). `tick`
 * is called every rendered frame purely to age `msRemaining` down and to
 * step `"arriving"`/`"departing"` through to their steady state -- it never
 * reads a clock external to the deltas it is handed, so it is exactly as
 * testable with a fake clock as `FarmhandStateMachine.update` already is.
 */
export class MidnightMerchantManager {
  private state: MidnightMerchantRenderState = "absent";
  private msRemaining = 0;
  private transitionRemaining = 0;
  private visit: MidnightMerchantSnapshot | null = null;

  /** Feeds in the server's own truth. Safe to call with the same visit
   *  (by `spawnedAtIso`) repeatedly -- only a change in IDENTITY (a new
   *  visit) or PRESENCE (visit -> null or null -> visit) starts a
   *  transition; a snapshot that just refreshes the same visit's numbers
   *  (e.g. `purchaseStreak` after a purchase) updates in place with no
   *  animation. */
  applySnapshot(next: MidnightMerchantSnapshot | null, now: Date = new Date()): void {
    const wasPresent = this.visit !== null;
    const isPresent = next !== null;
    const sameVisit = wasPresent && isPresent && this.visit!.spawnedAtIso === next!.spawnedAtIso;

    this.visit = next;
    this.msRemaining = next
      ? Math.max(0, Date.parse(next.expiresAtIso) - now.getTime())
      : 0;

    if (sameVisit) {
      // Same visit, fresher numbers (e.g. a purchase just landed) -- no
      // transition, whatever steady/transitional state was already running
      // keeps running.
      return;
    }

    if (!wasPresent && isPresent) {
      this.state = "arriving";
      this.transitionRemaining = MIDNIGHT_MERCHANT_TRANSITION_MS;
      return;
    }

    if (wasPresent && !isPresent) {
      this.state = "departing";
      this.transitionRemaining = MIDNIGHT_MERCHANT_TRANSITION_MS;
      return;
    }

    // wasPresent && isPresent but NOT the same visit: the old one expired
    // and a new one spawned between two snapshots (a session-idle sweep and
    // a fresh spawn can both land inside one poll gap). Play the full
    // departure-then-arrival rather than snapping straight to the new
    // visit's art, so the old NPC is never seen to instantly become the new
    // one mid-frame.
    this.state = "departing";
    this.transitionRemaining = MIDNIGHT_MERCHANT_TRANSITION_MS;
  }

  /** Advances local render-only state by `deltaMs` of wall-clock time that
   *  has actually elapsed since the last tick -- called once per Phaser
   *  scene update, the same cadence `FarmhandStateMachine.update` already
   *  runs at. */
  tick(deltaMs: number): void {
    if (deltaMs <= 0) return;

    if (this.msRemaining > 0) {
      this.msRemaining = Math.max(0, this.msRemaining - deltaMs);
    }

    if (this.state === "arriving" || this.state === "departing") {
      this.transitionRemaining = Math.max(0, this.transitionRemaining - deltaMs);
      if (this.transitionRemaining > 0) return;

      if (this.state === "arriving") {
        this.state = "present";
        return;
      }

      // A departure just finished. `this.visit` is whatever the LAST
      // `applySnapshot` call left it as -- for an ordinary disappearance
      // that is null and this settles at "absent" same as always, but for
      // the "old visit expired and a new one spawned in the same poll gap"
      // case `applySnapshot` documents, `this.visit` is already the NEW
      // visit by the time this runs. Rolling straight into that visit's own
      // arrival, rather than settling at "absent" first, is what actually
      // delivers the "full departure-then-arrival" `applySnapshot` promises
      // instead of only ever playing the departure half of it.
      if (this.visit !== null) {
        this.state = "arriving";
        this.transitionRemaining = MIDNIGHT_MERCHANT_TRANSITION_MS;
      } else {
        this.state = "absent";
      }
      return;
    }

    // A visit can run out locally (msRemaining hits 0) before the next
    // server snapshot confirms it -- start the departure animation on our
    // own rather than leaving a dead-looking NPC standing until the next
    // poll lands.
    //
    // `this.visit` is cleared HERE, not merely left for the eventual
    // `applySnapshot(null)` to clear -- and that is load-bearing, not
    // cosmetic. Two things depend on `this.visit` reading null the instant
    // the local clock runs out:
    //   1. `isInteractive()`/the storefront's own `visit` prop must stop
    //      offering purchases from a visit this client's own clock has
    //      already decided is over, without waiting on a network round
    //      trip that has not happened yet.
    //   2. The "departing transition finished" branch above keys its OWN
    //      "roll into a fresh arrival vs. settle at absent" decision on
    //      whether `this.visit` is null. Leaving the expired visit sitting
    //      in that field until the server confirmed it would make THIS
    //      exact departure -- an ordinary, unconfirmed local expiry -- look
    //      identical to the "replaced by a new visit" case and incorrectly
    //      restart the arrival animation on the very same expired visit,
    //      forever, since nothing ever nulls it out.
    // A real, later `applySnapshot(null)` still runs normally afterward: by
    // then `wasPresent` reads false (this field is already null), so it is
    // correctly a no-op rather than a second departure on an already-gone
    // NPC. A later `applySnapshot` with a genuinely new visit is likewise
    // just an ordinary fresh arrival at that point, not a "replace".
    if (this.state === "present" && this.msRemaining === 0) {
      this.state = "departing";
      this.transitionRemaining = MIDNIGHT_MERCHANT_TRANSITION_MS;
      this.visit = null;
    }
  }

  snapshot(): MidnightMerchantRenderSnapshot {
    return {
      state: this.state,
      msRemaining: this.msRemaining,
      urgent: this.msRemaining > 0 && this.msRemaining <= MIDNIGHT_MERCHANT_URGENT_MS,
      visit: this.visit,
    };
  }

  /** Whether the NPC sprite should currently be drawn at all -- the one
   *  question stackacres-scene.ts's paint pass needs answered every frame.
   *  True for every state except `"absent"`, so the arrival/departure
   *  animation has something on screen to animate. */
  isRendered(): boolean {
    return this.state !== "absent";
  }

  /** Whether a tap on the NPC should currently open the storefront --
   *  narrower than `isRendered`: a mid-transition NPC is visible but not yet
   *  (or no longer) interactive, matching how a unit mid-pop-tween still
   *  blocks taps on nothing else changing underneath it. */
  isInteractive(): boolean {
    return this.state === "present";
  }
}
