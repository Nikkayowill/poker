
import { type MachineProcessedItem } from "./machine-items";

/** What one seal takes in, and how many. Cheese only, for now -- the same
 *  "start with one good, grow the ladder later" posture the Mill took when it
 *  was the only machine. */
export const VAT_INPUT_ITEM: MachineProcessedItem = "cheese";

/**
 * One rung of the aging ladder. `durationMs` is measured from the moment the
 * vat was sealed, not from the tier before it -- so `AGING_TIERS[2].
 * durationMs` is the total time to reach Artisan-Aged from a fresh seal, the
 * same "total elapsed, not incremental" convention `wheatPlotProgress` and
 * `machineProgress` already use for `readyAt`.
 *
 * `multiplier` is 1.5x, 2x, 3x, the same ladder as the Cellar. It was 2x/4x/8x
 * until 2026-09-29, which paid about 7.5x the inputs' sell price and beat
 * every other loop. There is no daily cap on earning, so the ladder is what
 * keeps the Vat honest. A Vat left the full 60 minutes is still worth twice
 * what pulling it the moment it is legal to collect is worth, which keeps
 * "seal it and come back later" a real choice. `stars` is the same rung, read by the UI as a quality rating
 * rather than a raw multiplier -- the number a player sees while a batch is
 * still aging should look like a grade, not a spoiler of exactly how much
 * Gold is coming.
 */
export interface AgingTier {
  readonly tier: 1 | 2 | 3;
  readonly label: string;
  readonly durationMs: number;
  readonly multiplier: number;
  readonly stars: 1 | 2 | 3;
}

export const AGING_TIERS: readonly AgingTier[] = [
  { tier: 1, label: "Aged", durationMs: 10 * 60 * 1000, multiplier: 1.5, stars: 1 },
  { tier: 2, label: "Well-Aged", durationMs: 30 * 60 * 1000, multiplier: 2, stars: 2 },
  { tier: 3, label: "Artisan-Aged", durationMs: 60 * 60 * 1000, multiplier: 3, stars: 3 },
];

/** The rung a batch has to clear before it may be collected at all -- there
 *  is no "pull it green" option; sealing the vat is a commitment to at least
 *  this long, the same plain "it ripens, then you collect it" shape
 *  ./wheat-plot.ts already takes. Exported so a caller building `readyAt`
 *  never has to reach into `AGING_TIERS[0]` directly. */
export function firstAgingTier(tiers: readonly AgingTier[] = AGING_TIERS): AgingTier {
  return tiers[0];
}

/**
 * The Preserves Cellar (Chapter 5): the same seal-wait-open shape as the Vat,
 * on a slower ladder built for time away from the farm. It holds jars of
 * Pickles or Sauerkraut, one kind per batch, and prices a batch off what the
 * jars would sell for today, so even the first tier beats selling them now.
 */
export const CELLAR_AGING_TIERS: readonly AgingTier[] = [
  { tier: 1, label: "Aged", durationMs: 60 * 60 * 1000, multiplier: 1.5, stars: 1 },
  { tier: 2, label: "Well-Aged", durationMs: 4 * 60 * 60 * 1000, multiplier: 2, stars: 2 },
  { tier: 3, label: "Cellar-Aged", durationMs: 12 * 60 * 60 * 1000, multiplier: 3, stars: 3 },
];

/** The most jars one batch holds. The cap is what keeps time away honest. */
export const CELLAR_CAPACITY = 12;

/**
 * Which tier `elapsedMs` of sealed time has reached, or null when it has not
 * yet cleared the first one. Walks the ladder from the top down so a batch
 * aged well past the final rung still reads as that rung -- there is no
 * "overflow" tier, the same "surplus reads as done, not as more" posture
 * `contractProgress` takes for a held count above what a rung asks for.
 */
export function vatTierForElapsed(
  elapsedMs: number,
  tiers: readonly AgingTier[] = AGING_TIERS,
): AgingTier | null {
  for (let i = tiers.length - 1; i >= 0; i -= 1) {
    if (elapsedMs >= tiers[i].durationMs) return tiers[i];
  }
  return null;
}

/** The next rung above `tier` (or above nothing, when `tier` is null), or
 *  null once the ladder is exhausted. What the UI reads to say "42 more
 *  minutes to Well-Aged". */
export function nextAgingTier(
  tier: AgingTier | null,
  tiers: readonly AgingTier[] = AGING_TIERS,
): AgingTier | null {
  const index = tier ? tiers.findIndex((t) => t.tier === tier.tier) : -1;
  return tiers[index + 1] ?? null;
}

/** Milliseconds until `elapsedMs` of sealed time reaches `target`, floored at
 *  zero for a target already cleared. */
export function msUntilAgingTier(elapsedMs: number, target: AgingTier): number {
  return Math.max(0, target.durationMs - elapsedMs);
}

/** What a batch worth `baseGoldValue` at 1x actually pays once it has
 *  reached `tier`. Rounded to the nearest Gold -- the ladder's own
 *  multipliers are small integers, so this only ever matters when
 *  `baseGoldValue` itself came from a division upstream. */
export function agedGoldValue(baseGoldValue: number, tier: AgingTier): number {
  return Math.round(baseGoldValue * tier.multiplier);
}

/**
 * The batch locked inside a sealed vat -- the "dedicated data record" a seal
 * writes and a collect deletes. Never re-derived from `RECIPE_CATALOGUE` or
 * from a live Gold price at collection; see this file's header on why
 * `baseGoldValue` is captured once, at seal time.
 */
export interface AgingManifest {
  readonly item: MachineProcessedItem;
  readonly quantity: number;
  /** `recipeRawGoldValue(item) * quantity`, snapshotted the moment this
   *  manifest was created. The number every tier's multiplier scales. */
  readonly baseGoldValue: number;
  /** ISO instant the vat was sealed. Every tier boundary is measured from
   *  here, never from a per-tier timestamp -- there is only one clock. */
  readonly sealedAt: string;
  /** ISO instant the first tier clears -- the earliest this manifest may be
   *  collected at all. Mirrors `sealedAt + firstAgingTier().durationMs`
   *  exactly; carried as its own field only because it is what the database's
   *  guarded collect actually gates on (see `collectStackAcresVatManifest`),
   *  the same "readyAt is the one column the server's own check trusts"
   *  contract every other queued row in StackAcres already uses. */
  readonly readyAt: string;
}

/** The Vat as the client renders it: whichever machine row is `kind ===
 *  "vat"`, plus whatever `AgingManifest` (if any) is currently locked inside
 *  it. `status` names what the player can actually do right now, rather than
 *  making them cross-reference `manifest` and a clock by hand. */
export type VatStatus = "empty" | "aging" | "collectible";

export interface VatContainer {
  readonly machineId: string;
  readonly status: VatStatus;
  readonly manifest: AgingManifest | null;
  /** The rung reached so far, or null while still short of the first one.
   *  Null whenever `manifest` is null too. */
  readonly currentTier: AgingTier | null;
  /** The next rung to aim for, or null once the ladder is fully climbed.
   *  Null whenever `manifest` is null. */
  readonly nextTier: AgingTier | null;
  /** Milliseconds until `nextTier` clears, or null when there is no next
   *  tier (ladder exhausted) or no manifest at all. */
  readonly msUntilNextTier: number | null;
  /** What collecting RIGHT NOW would pay -- zero while `status` is `"empty"`
   *  or still short of the first tier (nothing is collectible to price). */
  readonly collectibleGoldValue: number;
  /** What riding the batch to the final tier would pay, for the UI's own
   *  "wait for Artisan-Aged and this is worth N" line. Equal to
   *  `collectibleGoldValue` once the final tier is already reached. */
  readonly maxGoldValue: number;
}

/** Builds the client-facing snapshot from a machine row and whatever
 *  manifest (if any) is sealed inside it. `machine` is intentionally typed
 *  as just the one field this needs, not the whole `StackAcresMachineRow` --
 *  the Vat's own readiness lives entirely on `manifest`, never on the
 *  machine row's generic `status`/`readyAt` columns the way a Mill's does. */
export function toVatContainer(
  machine: { readonly id: string },
  manifest: AgingManifest | null,
  now: Date,
  tiers: readonly AgingTier[] = AGING_TIERS,
): VatContainer {
  if (!manifest) {
    return {
      machineId: machine.id,
      status: "empty",
      manifest: null,
      currentTier: null,
      nextTier: null,
      msUntilNextTier: null,
      collectibleGoldValue: 0,
      maxGoldValue: 0,
    };
  }

  const elapsedMs = Math.max(0, now.getTime() - Date.parse(manifest.sealedAt));
  const currentTier = vatTierForElapsed(elapsedMs, tiers);
  const nextTier = nextAgingTier(currentTier, tiers);
  const finalTier = tiers[tiers.length - 1];

  return {
    machineId: machine.id,
    status: currentTier ? "collectible" : "aging",
    manifest,
    currentTier,
    nextTier,
    msUntilNextTier: nextTier ? msUntilAgingTier(elapsedMs, nextTier) : null,
    collectibleGoldValue: currentTier ? agedGoldValue(manifest.baseGoldValue, currentTier) : 0,
    maxGoldValue: agedGoldValue(manifest.baseGoldValue, finalTier),
  };
}

