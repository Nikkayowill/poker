/**
 * The barn routine: who lives on this farm, how they are doing, and what
 * looking after them every day is worth.
 *
 * An animal was a production slot with a feed timer. This gives it a name, a
 * mood, a status line and one thing to do with it a day. Nothing here is a
 * second economy: the daily tend spends nothing, costs no energy and no Gold
 * (the direction doc's rule on never charging for a basic action), and what
 * it pays is extra PRODUCE on the batch the animal is already growing --
 * the same lever a serving of Spinach has always pulled (`feedBonus` in
 * lib/server/stackacres-store.ts). Produce reaches Gold only through a sale,
 * which is already under the daily Gold ceiling, so care can never mint
 * Gold on its own.
 *
 * NO CLOCK HERE, the same posture ./units.ts takes: every function is handed
 * `today` or `now`. The care day is `stackacresExchangeDay`'s UTC day, the
 * boundary ./friendship.ts and ./feed-silo.ts already share, so a player's
 * whole farm rolls over at one instant rather than three.
 *
 * OFFLINE IS DERIVED, NEVER SIMULATED. A streak is stored as "the last day
 * tended" plus a count, and whether it survived is a comparison against
 * `today` -- so a player who was away for a week is answered by arithmetic
 * on two stored fields, with no background job and nothing to replay.
 */

import { isLivestock, type StackAcresStock } from "./catalogue";
import { stackacresExchangeDay } from "./exchange";
import type { StackAcresUnitRow } from "./units";

/**
 * How many days of unbroken care an animal can bank. A streak past this is
 * held at this number rather than climbing: the ladder below tops out well
 * under it, and an unbounded counter is a number that only exists to get
 * large.
 */
export const CARE_STREAK_CAP = 30;

/**
 * The most extra produce care may add to ONE cycle, ever.
 *
 * THIS IS THE ECONOMIC CAP, and it is deliberately a hard clamp on a stored
 * column rather than a property that happens to fall out of the tend
 * cadence. A tend is once per animal per day and the longest cycle on the
 * farm is the Cattle Pen's 24 hours, so in practice a cycle sees one tend;
 * but a shorter cycle retuned later, or a cycle straddling a UTC rollover,
 * could see two, and the clamp is what makes "care is worth at most +2"
 * true by construction instead of true by timing. `careBonus` is stored
 * separately from `feedBonus` for exactly this reason -- so this cap can be
 * asserted without also capping the Spinach bonus it would otherwise share
 * a column with.
 */
export const CARE_BONUS_CAP = 2;

/**
 * What one tend adds to the current batch, by the streak it lands on.
 *
 * The first two days pay nothing on purpose. Care is meant to read as a
 * habit rather than a button with a prize behind it, and a reward on the
 * very first tap would make the mood and the name decoration on a vending
 * machine. A handful of real steps, not a grind.
 */
export function careYieldBonus(streak: number): number {
  if (streak >= 7) return 2;
  if (streak >= 3) return 1;
  return 0;
}

/**
 * The Barn's comfort multiplier on every animal's hunger window.
 *
 * COMFORT, NOT PRODUCTION. A barn does not make an animal grow faster or
 * yield more -- it makes it easier to keep. A wider hunger window means
 * fewer trips to the trough for the same farm, which is what a late-game
 * Gold sink should buy (direction doc s20: automation represents "my farm
 * has become a serious operation", it does not remove the game).
 */
export const BARN_COMFORT_MULTIPLIER = 1.5;

/** Free livestock slots per kind the Barn grants, on top of anything bought. */
export const BARN_CAPACITY_BONUS = 2;

/** The hunger-window multiplier in force for a farm, Barn or no Barn. */
export function barnComfort(hasBarn: boolean): number {
  return hasBarn ? BARN_COMFORT_MULTIPLIER : 1;
}

/**
 * Names, drawn from the unit's own id.
 *
 * A PURE DERIVATION, NOT A STORED COLUMN. The id never changes for the life
 * of the row, so neither does the name -- which buys a stable name with no
 * migration, no rename action, no length or charset guard, and no
 * user-authored text to moderate. A player who wants to rename an animal is
 * a later, deliberate change (it would need all four of those), not
 * something to leave a half-open door for here.
 */
const HEN_NAMES = [
  "Clover", "Pip", "Nugget", "Maple", "Biscuit", "Dot", "Poppy", "Sunny",
  "Wren", "Pebble", "Hazel", "Ginger", "Mabel", "Olive", "Juniper", "Fig",
] as const;

const SHEEP_NAMES = [
  "Wooly", "Cloud", "Thistle", "Barnaby", "Marshmallow", "Pudding", "Bramble", "Willow",
  "Tuft", "Snowdrop", "Comet", "Mossy", "Bumble", "Pilgrim", "Shadow", "Fern",
] as const;

const CATTLE_NAMES = [
  "Bessie", "Clementine", "Rosie", "Buttercup", "Daisy", "Nell", "Primrose", "Marigold",
  "Bluebell", "Hattie", "Winnie", "Agnes", "Constance", "Dorothy", "Edith", "Florence",
] as const;

const HOG_NAMES = [
  "Porky", "Truffle", "Hamlet", "Rosie", "Biscuit", "Peanut", "Wilbur", "Clover",
  "Muddy", "Pickles", "Dumpling", "Sprout", "Button", "Taffy", "Spud", "Waddles",
] as const;

const STEER_NAMES = [
  "Duke", "Rusty", "Buck", "Tex", "Boots", "Moose", "Chester", "Rocky",
  "Buster", "Dusty", "Bandit", "Tank", "Ranger", "Copper", "Gus", "Jasper",
] as const;

const NAME_POOLS: Readonly<Record<string, readonly string[]>> = {
  hen: HEN_NAMES,
  pig: SHEEP_NAMES,
  cattle: CATTLE_NAMES,
  hog: HOG_NAMES,
  steer: STEER_NAMES,
};

/** FNV-1a over the id. Any stable spread would do; this one is short, has no
 *  dependency, and gives the same answer in the browser and on the server,
 *  which is the whole requirement -- the client must name an animal exactly
 *  as the server would, or an optimistic tend would flash a second name. */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** What this animal is called. Empty for a crop -- a cabbage has no name. */
export function animalNameFor(unitId: string, stock: StackAcresStock): string {
  const pool = NAME_POOLS[stock];
  if (!pool || !isLivestock(stock)) return "";
  return pool[hashId(unitId) % pool.length];
}

/** One animal's stored care, as it sits on the unit row. */
export interface AnimalCare {
  /** `YYYY-MM-DD` in UTC, or null before this animal was ever tended. */
  caredOn: string | null;
  /** Days tended in a row, up to CARE_STREAK_CAP. 0 before a first tend. */
  careStreak: number;
  /** Extra produce care has put on the CURRENT cycle, never over
   *  CARE_BONUS_CAP. Back to 0 when the cycle restarts. */
  careBonus: number;
}

export function freshAnimalCare(): AnimalCare {
  return { caredOn: null, careStreak: 0, careBonus: 0 };
}

/** Whether this animal has already been tended on `today`. The duplicate
 *  guard, and the same question the Tend button asks to grey itself out. */
export function hasCaredToday(care: AnimalCare, today: string): boolean {
  return care.caredOn === today;
}

/** Yesterday, as a care day. */
function previousDay(today: string): string {
  const parsed = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return "";
  return stackacresExchangeDay(new Date(parsed - 24 * 60 * 60 * 1000));
}

/**
 * The streak a tend on `today` lands on.
 *
 * Tended yesterday, it continues; tended any longer ago (or never), it
 * starts over at 1. That "any longer ago" branch is the entire offline
 * story: a player away for a week comes back to a streak of 1, worked out
 * from two stored fields at the moment they tend, with nothing having run
 * while they were gone.
 */
export function careStreakAfter(care: AnimalCare, today: string): number {
  if (care.caredOn === previousDay(today)) {
    return Math.min(CARE_STREAK_CAP, care.careStreak + 1);
  }
  return 1;
}

/** What one tend on `today` writes back: the whole new care row, clamped. */
export function applyCare(care: AnimalCare, today: string): AnimalCare {
  const careStreak = careStreakAfter(care, today);
  return {
    caredOn: today,
    careStreak,
    careBonus: Math.min(CARE_BONUS_CAP, care.careBonus + careYieldBonus(careStreak)),
  };
}

/**
 * The streak as it READS right now, without tending.
 *
 * A streak is only broken by the act of tending again, as far as storage is
 * concerned -- but a player who last tended four days ago should not be
 * shown "6 day streak" on a card. This is what the barn panel displays: the
 * stored count while it is still live (tended today or yesterday), and 0
 * once it has lapsed.
 */
export function liveCareStreak(care: AnimalCare, today: string): number {
  if (care.caredOn === today || care.caredOn === previousDay(today)) return care.careStreak;
  return 0;
}

/**
 * What the barn card says this animal is doing. One of exactly four, and
 * they are ordered by what the player should deal with first.
 *
 * - `producing`  -- its batch is ready to collect.
 * - `hungry`     -- past its feed window. Its clock is frozen; this is the
 *                   only one of the four that is actually costing the player
 *                   something right now.
 * - `needs-attention` -- nothing is wrong, but there is something to do: the
 *                   daily tend is unclaimed, or its next meal is due soon.
 * - `content`    -- fed, tended, working. Nothing to do.
 *
 * Read off the same snapshot the map already renders, so the panel and the
 * world can never disagree about an animal.
 */
export type BarnStatus = "producing" | "hungry" | "needs-attention" | "content";

/** How soon a meal has to be due for an animal to start asking for it. */
export const ATTENTION_LEAD_MS = 5 * 60 * 1000;

export interface BarnAnimalInput {
  state: "working" | "hungry" | "dry" | "ready" | "mucked";
  hungryAt: string | null;
  care: AnimalCare;
}

export function barnStatusFor(animal: BarnAnimalInput, now: Date, today: string): BarnStatus {
  if (animal.state === "ready") return "producing";
  if (animal.state === "hungry") return "hungry";
  if (!hasCaredToday(animal.care, today)) return "needs-attention";
  const hungryAt = animal.hungryAt ? Date.parse(animal.hungryAt) : NaN;
  if (Number.isFinite(hungryAt) && hungryAt - now.getTime() <= ATTENTION_LEAD_MS) {
    return "needs-attention";
  }
  return "content";
}

/**
 * The mood word under the name. Presentation only -- nothing reads this to
 * decide anything, which is why it is allowed to be softer than
 * `barnStatusFor` and to mention the streak at all.
 */
export type AnimalMood = "unhappy" | "restless" | "settled" | "happy" | "thriving";

export function animalMoodFor(animal: BarnAnimalInput, today: string): AnimalMood {
  if (animal.state === "hungry") return "unhappy";
  const streak = liveCareStreak(animal.care, today);
  if (!hasCaredToday(animal.care, today)) return streak >= 3 ? "settled" : "restless";
  if (streak >= 7) return "thriving";
  if (streak >= 3) return "happy";
  return "settled";
}

export const MOOD_LABELS: Readonly<Record<AnimalMood, string>> = {
  unhappy: "Unhappy",
  restless: "Restless",
  settled: "Settled",
  happy: "Happy",
  thriving: "Thriving",
};

export const BARN_STATUS_LABELS: Readonly<Record<BarnStatus, string>> = {
  producing: "Producing",
  hungry: "Hungry",
  "needs-attention": "Needs attention",
  content: "Content",
};

/**
 * Ray's standing gift for keeping animals well.
 *
 * A story moment with something in its hand, and the something is FEED --
 * the animal loop's own currency, not Gold. Ray taught this farm to keep
 * stock; a sack dropped off when he notices you doing it properly is the
 * shape of gift he already gives. It is once per rung for the whole farm,
 * ever (the server stores which rungs have been handed out), so the total
 * a player can ever receive from this is the sum below and nothing more --
 * which is what keeps it a moment rather than a feed subscription.
 */
export interface CareGiftRung {
  /** The care streak on one animal that earns it. */
  streak: number;
  /** Servings Ray leaves in the barn. */
  servings: number;
  /** What he says. */
  line: string;
}

export const CARE_GIFT_LADDER: readonly CareGiftRung[] = [
  {
    streak: 3,
    servings: 5,
    line: "Three days running you've been out there before I was. Take the sack, I've no use for it.",
  },
  {
    streak: 7,
    servings: 10,
    line: "A week. Your grandmother kept hers like that. Nobody else did.",
  },
  {
    streak: 14,
    servings: 15,
    line: "Fortnight straight. They know your step now -- you can hear it when you come up the track.",
  },
];

/** The most feed Ray's care gifts can ever hand out to one farm. Asserted in
 *  the tests: the ladder is closed, so this number is the whole exposure. */
export const CARE_GIFT_TOTAL_SERVINGS = CARE_GIFT_LADDER.reduce(
  (total, rung) => total + rung.servings,
  0,
);

/**
 * The gift rung a tend that lands on `streak` earns, given the rungs already
 * handed out. Null when it earns nothing -- which is every tend but three,
 * for the life of the farm.
 */
export function careGiftFor(
  streak: number,
  claimedRungs: readonly number[],
): { index: number; rung: CareGiftRung } | null {
  for (let index = 0; index < CARE_GIFT_LADDER.length; index += 1) {
    const rung = CARE_GIFT_LADDER[index];
    if (streak >= rung.streak && !claimedRungs.includes(index)) return { index, rung };
  }
  return null;
}

/** Whether this row is something that can be tended at all. */
export function isTendable(row: Pick<StackAcresUnitRow, "stock" | "status">): boolean {
  return row.status === "working" && isLivestock(row.stock);
}
