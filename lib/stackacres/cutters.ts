/**
 * What cuts the Long Meadow, and which one is in hand.
 *
 * Split off the spade ladder (./equipment.ts) on 2026-09-10. The spades used
 * to set how wide the scythe cut, and the mow ghost drew whatever rung was
 * owned, so a player with the Golden Spade was mowing grass with a spade and
 * had no way back to the scythe. Now the Scythe is everyone's, the Mower is
 * bought, and the player picks which one to hold. The spades only change
 * harvest luck.
 *
 * Which cutter is held is a client choice. The meadow is client-side scenery
 * (the scene keeps cut tiles in its own map and never saves them), so nothing
 * is at stake in which one swings. Owning the Mower is a server fact because
 * it costs Gold.
 */

import type { StackAcresShopLock } from "./shop-locks";
import { MEADOW_REGROW_MS, SCYTHE_REACH } from "./zones";

export const STACKACRES_CUTTERS = ["scythe", "mower"] as const;

export type StackAcresCutter = (typeof STACKACRES_CUTTERS)[number];

/** Everyone holds this one. Never bought, never lost. */
export const STACKACRES_STARTING_CUTTER = "scythe" satisfies StackAcresCutter;

/** The cutters Ray sells. Kept in step with the CHECK on homestead_cutter. */
export const STACKACRES_BUYABLE_CUTTERS = ["mower"] as const satisfies readonly Exclude<
  StackAcresCutter,
  typeof STACKACRES_STARTING_CUTTER
>[];

export type StackAcresBuyableCutter = (typeof STACKACRES_BUYABLE_CUTTERS)[number];

export interface StackAcresCutterDef extends StackAcresShopLock {
  /** What the shelf and the picker say, and what a screen reader announces. */
  label: string;
  /** One line saying what holding it does. */
  blurb: string;
  /** Gold, or null for the one nobody buys. */
  price: number | null;
  /** Painter name in stackacres-art.ts. A plain string so this file stays free
   *  of a components/ import, same as StackAcresToolDef.icon. */
  icon: string;
  /** How far either side of the drag line one stroke cuts, world units. */
  reach: number;
  /** How long one level of grass takes to grow back after this cutter. */
  regrowMs: number;
}

/**
 * The Scythe is exactly what the meadow already did (SCYTHE_REACH and
 * MEADOW_REGROW_MS, imported rather than retyped), so a player who never buys
 * the Mower sees nothing change. The Mower's regrow is a multiple because its
 * blurb quotes it, and cutters.test.ts holds the two together.
 */
export const STACKACRES_CUTTER_DEFS: Readonly<Record<StackAcresCutter, StackAcresCutterDef>> = {
  scythe: {
    label: "Scythe",
    blurb: "The blade you started with. Cuts a narrow swathe.",
    price: null,
    icon: "ico-scythe",
    reach: SCYTHE_REACH,
    regrowMs: MEADOW_REGROW_MS,
  },
  mower: {
    label: "Mower",
    blurb: "Rolls where you steer it and leaves lawn lines. Cuts so low the grass takes three times as long to grow back.",
    price: 20_000,
    icon: "cutterMower",
    // About the width of its deck on screen, so the cut matches the machine.
    reach: SCYTHE_REACH * 1.2,
    regrowMs: MEADOW_REGROW_MS * 3,
    // The meadow you mow is in the Crop Fields, and the scene refuses a mow
    // stroke until they are unlocked, so a Mower before then cuts nothing.
    requiredQuestFlag: "crop_fields_unlocked",
  },
};

export function stackacresCutterDef(cutter: StackAcresCutter): StackAcresCutterDef {
  return STACKACRES_CUTTER_DEFS[cutter];
}

export function isStackAcresCutter(value: unknown): value is StackAcresCutter {
  return typeof value === "string" && (STACKACRES_CUTTERS as readonly string[]).includes(value);
}

export function isStackAcresBuyableCutter(value: unknown): value is StackAcresBuyableCutter {
  return typeof value === "string" && (STACKACRES_BUYABLE_CUTTERS as readonly string[]).includes(value);
}

/** A stored or remembered value read back as a cutter, falling back to the Scythe. */
export function toStackAcresCutter(value: unknown): StackAcresCutter {
  return isStackAcresCutter(value) ? value : STACKACRES_STARTING_CUTTER;
}

/** Position in STACKACRES_CUTTERS. 0 is the Scythe. */
export function cutterRank(cutter: StackAcresCutter): number {
  return STACKACRES_CUTTERS.indexOf(cutter);
}

/**
 * Every cutter a player owns, in catalogue order, from the bought list the
 * server keeps. The Scythe is always first. Unknown or repeated names are
 * dropped rather than thrown on, so a row from a newer build cannot break the
 * farm's load.
 */
export function ownedStackAcresCutters(bought: readonly unknown[]): StackAcresCutter[] {
  const have = new Set<StackAcresCutter>([STACKACRES_STARTING_CUTTER]);
  for (const name of bought) if (isStackAcresBuyableCutter(name)) have.add(name);
  return STACKACRES_CUTTERS.filter((cutter) => have.has(cutter));
}

/**
 * Which cutter is in hand: the one the player last picked, if they still own
 * it, otherwise the best one they own. So buying the Mower puts it in hand
 * straight away, and picking the Scythe afterward sticks.
 */
export function heldStackAcresCutter(
  picked: unknown,
  owned: readonly StackAcresCutter[],
): StackAcresCutter {
  if (isStackAcresCutter(picked) && owned.includes(picked)) return picked;
  return owned[owned.length - 1] ?? STACKACRES_STARTING_CUTTER;
}

/** How far one stroke reaches with this cutter, world units. */
export function cutterReach(cutter: StackAcresCutter): number {
  return STACKACRES_CUTTER_DEFS[cutter].reach;
}

/** How long one level of grass takes to grow back after this cutter. */
export function cutterRegrowMs(cutter: StackAcresCutter): number {
  return STACKACRES_CUTTER_DEFS[cutter].regrowMs;
}

/**
 * How many straight passes it takes to clear a band of meadow `widthWorld`
 * wide. One pass cuts `reach` either side of the line, so it is `reach * 2`
 * wide. Ceiling, not round: two and a half passes' worth takes three.
 */
export function strokesToClearWidth(widthWorld: number, cutter: StackAcresCutter): number {
  if (!Number.isFinite(widthWorld) || widthWorld <= 0) return 0;
  return Math.ceil(widthWorld / (cutterReach(cutter) * 2));
}
