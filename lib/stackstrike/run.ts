import { mulberry32Step } from "@/lib/seeded-random";
import { ARENA, CONTRACTS, DIFFICULTIES } from "./content";
import { distance } from "./geometry";
import type { Arena, ContractId, Guard, LootSpot, Vec } from "./types";
import { roomAt } from "./vision";

/**
 * One run's worth of the building. The walls never change; what is in them
 * does. A seed picks where the gold case is, which valuables are lying about,
 * which guards are on duty and where each stands or walks, and a contract
 * puts a twist on the whole night. The generator is pure so a run can be
 * rebuilt from its seed.
 *
 * It is careful in the way Invisible, Inc.'s generator had to be: random
 * is fine, unfair is not. Nobody is ever posted where the player walks in,
 * the case is always reachable, and every room the case can be in has
 * someone watching it.
 */

/** Where the main prize can be. All far from the way in. */
const VAULT_SPOTS: Vec[] = [
  { x: 1267, y: 130 },
  { x: 1157, y: 130 },
  { x: 1410, y: 110 },
  { x: 1420, y: 430 },
  { x: 1150, y: 830 },
];

/** Where the smaller valuables can be: a few in every part of the building. */
const SIDE_SPOTS: { label: string; pos: Vec; value: number }[] = [
  { label: "Watch", pos: { x: 225, y: 170 }, value: 150 },
  { label: "Cash box", pos: { x: 70, y: 288 }, value: 120 },
  { label: "Petty cash", pos: { x: 250, y: 838 }, value: 100 },
  { label: "Ledger", pos: { x: 1120, y: 470 }, value: 200 },
  { label: "Ingots", pos: { x: 1160, y: 790 }, value: 250 },
  { label: "Bearer bonds", pos: { x: 1420, y: 640 }, value: 220 },
  { label: "Jewels", pos: { x: 900, y: 80 }, value: 180 },
  { label: "Cufflinks", pos: { x: 900, y: 820 }, value: 140 },
  { label: "Drives", pos: { x: 1400, y: 220 }, value: 200 },
  { label: "Medals", pos: { x: 560, y: 700 }, value: 130 },
];

/** Guards that can be on duty. The map's own ten, and a few more so no two nights match. */
const EXTRA_GUARDS: Guard[] = [
  { defId: "grunt", tier: 1, route: [{ x: 940, y: 240 }], watch: Math.PI },
  { defId: "grunt", tier: 1, route: [{ x: 1440, y: 540 }], watch: -Math.PI / 2 },
  { defId: "grunt", tier: 1, route: [{ x: 1080, y: 640 }, { x: 1420, y: 640 }] },
  { defId: "grunt", tier: 1, route: [{ x: 900, y: 820 }], watch: -Math.PI / 2 },
  { defId: "grunt", tier: 1, route: [{ x: 150, y: 70 }, { x: 450, y: 70 }] },
  { defId: "runner", tier: 1, route: [{ x: 560, y: 120 }, { x: 560, y: 380 }, { x: 940, y: 380 }, { x: 940, y: 120 }] },
];

export const GUARD_POOL: Guard[] = [...ARENA.guards, ...EXTRA_GUARDS];

/** Guards on duty by difficulty tier, before the contract adds or removes any. */
const GUARDS_BY_TIER: Record<1 | 2 | 3, number> = { 1: 4, 2: 7, 3: 10 };
const SIDE_LOOT_BASE = 3;
const MAX_PER_ROOM: Record<1 | 2 | 3, number> = { 1: 2, 2: 2, 3: 3 };
/** No guard walks or stands this close to the way in, so the first moments are always safe. */
const SPAWN_CLEARANCE: Record<1 | 2 | 3, number> = { 1: 200, 2: 180, 3: 120 };

type Rng = () => number;

function rngFor(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    const [next, value] = mulberry32Step(state);
    state = next;
    return value;
  };
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

/** A contract for this run, drawn from the ones a player of this level has unlocked. */
export function pickContract(seed: number, level: number): ContractId {
  const rng = rngFor((seed ^ 0x9e3779b9) >>> 0);
  const open = Object.values(CONTRACTS).filter((contract) => contract.unlockLevel <= level);
  const total = open.reduce((sum, contract) => sum + contract.weight, 0);
  let roll = rng() * total;
  for (const contract of open) {
    roll -= contract.weight;
    if (roll < 0) return contract.id;
  }
  return "standard";
}

function roomOf(guard: Guard): string {
  return roomAt(ARENA, guard.route[0])?.id ?? "outside";
}

function farEnough(guard: Guard, clearance: number): boolean {
  return guard.route.every((point) => distance(point, ARENA.playerSpawn) >= clearance);
}

/** The same guard, started somewhere else on its loop and perhaps walking it the other way, or looking a little differently from its post. */
function varied(guard: Guard, rng: Rng): Guard {
  if (guard.route.length > 1) {
    const shift = Math.floor(rng() * guard.route.length);
    const route = [...guard.route.slice(shift), ...guard.route.slice(0, shift)].map((point) => ({ ...point }));
    if (rng() < 0.5) route.reverse();
    return { ...guard, tier: 1, route };
  }
  const watch = guard.watch === undefined ? undefined : guard.watch + (rng() - 0.5) * 1.0;
  return { ...guard, tier: 1, route: guard.route.map((point) => ({ ...point })), watch };
}

export function buildArena(seed: number, difficulty: keyof typeof DIFFICULTIES = "normal", contractId: ContractId = "standard"): Arena {
  const rng = rngFor(seed);
  const contract = CONTRACTS[contractId];
  const tier = DIFFICULTIES[difficulty].tier;

  const main = VAULT_SPOTS[Math.floor(rng() * VAULT_SPOTS.length)];
  const loot: LootSpot[] = [{ id: "gold", label: "GOLD CASE", pos: { ...main }, value: 1000, main: true }];
  const sideCount = Math.max(1, SIDE_LOOT_BASE + contract.lootDelta);
  // Side valuables are never right on top of the case, and never two in one corner of the map.
  const sides = shuffled(SIDE_SPOTS, rng).filter((spot) => distance(spot.pos, main) > 160);
  const chosen: typeof sides = [];
  for (const spot of sides) {
    if (chosen.length >= sideCount) break;
    if (chosen.some((other) => distance(other.pos, spot.pos) < 220)) continue;
    chosen.push(spot);
  }
  chosen.forEach((spot, index) =>
    loot.push({ id: `side-${index}`, label: spot.label, pos: { ...spot.pos }, value: Math.round(spot.value * contract.lootScale), main: false }),
  );

  const want = Math.max(2, GUARDS_BY_TIER[tier] + contract.guardDelta);
  const eligible = shuffled(GUARD_POOL, rng).filter((guard) => farEnough(guard, SPAWN_CLEARANCE[tier]));
  const perRoom = new Map<string, number>();
  const picked: Guard[] = [];
  const take = (guard: Guard): void => {
    picked.push(guard);
    perRoom.set(roomOf(guard), (perRoom.get(roomOf(guard)) ?? 0) + 1);
  };

  // Someone always watches the room the case is in.
  const vaultRoom = roomAt(ARENA, main)?.id;
  const vaultGuard = eligible.find((guard) => roomOf(guard) === vaultRoom);
  if (vaultGuard) take(vaultGuard);
  for (const guard of eligible) {
    if (picked.length >= want) break;
    if (picked.includes(guard) || (perRoom.get(roomOf(guard)) ?? 0) >= MAX_PER_ROOM[tier]) continue;
    take(guard);
  }
  // A crowded room is allowed only when there is nobody else left to post.
  for (const guard of eligible) {
    if (picked.length >= want) break;
    if (!picked.includes(guard)) take(guard);
  }

  return { ...ARENA, loot, guards: picked.map((guard) => varied(guard, rng)), contract: contractId };
}
