/**
 * Checking and comparing looks. Pure: the server runs `normalizeLook` on every
 * save so a request can only ever name things the catalogue has, in colours
 * they come in, on a body they are drawn for, and paid items the player owns.
 */

import {
  OPTIONAL_SLOTS,
  OUTFIT_SLOTS,
  WARDROBE_SLOTS,
  type FarmerLook,
  type FarmerWardrobeState,
  type WardrobeBody,
  type WardrobeCatalogue,
  type WardrobeItem,
  type WardrobePick,
  type WardrobeSlot,
} from "./types";

/** How an owned paid item is recorded in player_cosmetics. */
export function wardrobeCosmeticId(itemId: string): string {
  return `farmer:${itemId}`;
}

export function wardrobeItem(catalogue: WardrobeCatalogue, id: string): WardrobeItem | null {
  return catalogue.items.find((item) => item.id === id) ?? null;
}

/** Items that go in a slot on a body, in catalogue order. */
export function itemsFor(catalogue: WardrobeCatalogue, slot: WardrobeSlot, body: WardrobeBody): WardrobeItem[] {
  return catalogue.items.filter((item) => item.slot === slot && item.bodies.includes(body));
}

/** Whether the player may wear it: free, or bought. */
export function isWearable(item: WardrobeItem, owned: ReadonlySet<string>): boolean {
  return item.price === null || owned.has(wardrobeCosmeticId(item.id));
}

function isBody(value: unknown): value is WardrobeBody {
  return value === "male" || value === "female";
}

function pickOf(raw: unknown): { item: unknown; colour: unknown } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  return { item: record.item, colour: record.colour };
}

/**
 * A look the catalogue can draw and this player may wear, or null. `owned`
 * holds player_cosmetics ids; pass `null` to skip the ownership check (a try-on
 * preview, never a save).
 */
export function normalizeLook(
  raw: unknown,
  catalogue: WardrobeCatalogue,
  owned: ReadonlySet<string> | null,
): FarmerLook | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!isBody(record.body)) return null;
  const body = record.body;
  const picksRaw = record.picks;
  if (!picksRaw || typeof picksRaw !== "object") return null;
  const picks = {} as Record<WardrobeSlot, WardrobePick>;
  for (const slot of WARDROBE_SLOTS) {
    const pick = pickOf((picksRaw as Record<string, unknown>)[slot]);
    if (!pick) return null;
    if (pick.item === null) {
      if (!OPTIONAL_SLOTS.includes(slot)) return null;
      picks[slot] = { item: null, colour: null };
      continue;
    }
    if (typeof pick.item !== "string") return null;
    const item = wardrobeItem(catalogue, pick.item);
    if (!item || item.slot !== slot || !item.bodies.includes(body)) return null;
    if (owned && !isWearable(item, owned)) return null;
    if (item.colours.length === 0) {
      if (pick.colour !== null && pick.colour !== undefined) return null;
      picks[slot] = { item: item.id, colour: null };
      continue;
    }
    if (typeof pick.colour !== "string" || !item.colours.includes(pick.colour)) return null;
    picks[slot] = { item: item.id, colour: pick.colour };
  }
  return { body, picks };
}

/** A stable key for a look: equal looks, equal keys. Used to cache baked sheets. */
export function lookKey(look: FarmerLook): string {
  return [look.body, ...WARDROBE_SLOTS.map((slot) => `${slot}=${look.picks[slot].item ?? "-"}/${look.picks[slot].colour ?? "-"}`)].join(".");
}

export function sameLook(a: FarmerLook, b: FarmerLook): boolean {
  return lookKey(a) === lookKey(b);
}

/**
 * Switching body keeps every pick the new body can wear and swaps the rest
 * for that slot's first item (or none, where none is allowed).
 */
export function withBody(look: FarmerLook, body: WardrobeBody, catalogue: WardrobeCatalogue): FarmerLook {
  const picks = { ...look.picks };
  for (const slot of WARDROBE_SLOTS) {
    const current = picks[slot].item ? wardrobeItem(catalogue, picks[slot].item!) : null;
    if (!current || current.bodies.includes(body)) continue;
    const first = itemsFor(catalogue, slot, body).find((item) => item.price === null);
    picks[slot] = OPTIONAL_SLOTS.includes(slot) || !first ? { item: null, colour: null } : { item: first.id, colour: first.colours[0] ?? null };
  }
  return { body, picks };
}

/** Wearing another item in a slot: keeps the colour if the new item comes in it. */
export function withItem(look: FarmerLook, slot: WardrobeSlot, item: WardrobeItem | null): FarmerLook {
  const colour = look.picks[slot].colour;
  const pick: WardrobePick = item
    ? { item: item.id, colour: item.colours.length === 0 ? null : colour && item.colours.includes(colour) ? colour : item.colours[0] }
    : { item: null, colour: null };
  return { ...look, picks: { ...look.picks, [slot]: pick } };
}

export function withColour(look: FarmerLook, slot: WardrobeSlot, colour: string): FarmerLook {
  return { ...look, picks: { ...look.picks, [slot]: { ...look.picks[slot], colour } } };
}

/** A fresh wardrobe: today's farmer and empty outfit slots. */
export function startingWardrobe(catalogue: WardrobeCatalogue): FarmerWardrobeState {
  return { look: catalogue.defaultLook, outfits: Array.from({ length: OUTFIT_SLOTS }, () => null) };
}

/**
 * A stored wardrobe read back, with anything the catalogue no longer has
 * dropped: a bad look becomes the default, a bad outfit an empty slot. A farm
 * always loads.
 */
export function readWardrobe(raw: unknown, catalogue: WardrobeCatalogue, owned: ReadonlySet<string>): FarmerWardrobeState {
  const start = startingWardrobe(catalogue);
  if (!raw || typeof raw !== "object") return start;
  const record = raw as Record<string, unknown>;
  const look = normalizeLook(record.look, catalogue, owned) ?? start.look;
  const saved = Array.isArray(record.outfits) ? record.outfits : [];
  const outfits = start.outfits.map((_, index) => (saved[index] == null ? null : normalizeLook(saved[index], catalogue, owned)));
  return { look, outfits };
}
