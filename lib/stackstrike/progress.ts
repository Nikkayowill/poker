import { CONTRACTS } from "./content";
import { rating } from "./sim";
import type { DifficultyId, SimState } from "./types";

/**
 * Rank. Every run earns XP, escaping and staying unseen earns far more, and
 * harder jobs pay better, so rank is wins weighted by difficulty and not time
 * spent. Rank opens up guns and the stranger contracts. It lives in the
 * player's browser for now: there is no account or Gold behind it.
 */

export const MAX_LEVEL = 10;
/** The XP step grows by this much each level. */
const LEVEL_STEP = 250;

/** The level at which each gun is handed over, in the order they sit in the kit. */
export const WEAPON_UNLOCKS: readonly { id: string; level: number }[] = [
  { id: "pistol", level: 1 },
  { id: "smg", level: 3 },
  { id: "shotgun", level: 5 },
];

const DIFFICULTY_XP: Record<DifficultyId, number> = { easy: 0.8, normal: 1, hard: 1.4 };
const ESCAPE_XP = 60;
const GHOST_XP = 80;
const SHADOW_XP = 30;
/** Dying still pays a little, so a bad run is never nothing. */
const MIN_RUN_XP = 10;

export interface Progress {
  xp: number;
  runs: number;
  escapes: number;
  bestScore: number;
}

export const NEW_PROGRESS: Progress = { xp: 0, runs: 0, escapes: 0, bestScore: 0 };

/** Total XP needed to be at `level`. */
export function xpToReach(level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return (LEVEL_STEP * (n - 1) * n) / 2;
}

export interface Rank {
  level: number;
  /** XP earned since this level began, and what the next level needs on top of that. Both 0 at the cap. */
  into: number;
  needed: number;
  /** 0..1 toward the next level. 1 at the cap. */
  fraction: number;
}

export function rankFor(xp: number): Rank {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpToReach(level + 1)) level += 1;
  if (level >= MAX_LEVEL) return { level, into: 0, needed: 0, fraction: 1 };
  const into = xp - xpToReach(level);
  const needed = xpToReach(level + 1) - xpToReach(level);
  return { level, into, needed, fraction: Math.min(1, into / needed) };
}

/** The guns carried at this level, in kit order. */
export function loadoutFor(level: number): string[] {
  return WEAPON_UNLOCKS.filter((unlock) => unlock.level <= level).map((unlock) => unlock.id);
}

/** What a run was worth, once it has ended. */
export function runXp(state: SimState): number {
  let xp = Math.round(state.score / 10);
  if (state.status === "escaped") {
    xp += ESCAPE_XP;
    const grade = rating(state);
    if (grade === "GHOST") xp += GHOST_XP;
    else if (grade === "SHADOW") xp += SHADOW_XP;
  }
  return Math.max(MIN_RUN_XP, Math.round(xp * DIFFICULTY_XP[state.difficulty]));
}

/** What reaching `to` from `from` hands over, as short names for the screen. */
export function unlocksBetween(from: number, to: number): string[] {
  const names: string[] = [];
  for (const unlock of WEAPON_UNLOCKS) {
    if (unlock.level > from && unlock.level <= to) names.push(unlock.id === "smg" ? "SMG" : unlock.id[0].toUpperCase() + unlock.id.slice(1));
  }
  for (const contract of Object.values(CONTRACTS)) {
    if (contract.unlockLevel > from && contract.unlockLevel <= to) names.push(`${contract.name} job`);
  }
  return names;
}

export interface RunResult {
  progress: Progress;
  xp: number;
  from: number;
  to: number;
  unlocked: string[];
}

export function applyRun(progress: Progress, state: SimState): RunResult {
  const xp = runXp(state);
  const next: Progress = {
    xp: progress.xp + xp,
    runs: progress.runs + 1,
    escapes: progress.escapes + (state.status === "escaped" ? 1 : 0),
    bestScore: Math.max(progress.bestScore, state.score),
  };
  const from = rankFor(progress.xp).level;
  const to = rankFor(next.xp).level;
  return { progress: next, xp, from, to, unlocked: unlocksBetween(from, to) };
}

const STORAGE_KEY = "stackstrike:progress";

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** Reads saved progress, or a fresh start if there is none or it is unreadable. Never throws: storage can be blocked. */
export function loadProgress(storage: Pick<Storage, "getItem"> | null = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...NEW_PROGRESS };
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return { ...NEW_PROGRESS };
    const record = data as Record<string, unknown>;
    return { xp: count(record.xp), runs: count(record.runs), escapes: count(record.escapes), bestScore: count(record.bestScore) };
  } catch {
    return { ...NEW_PROGRESS };
  }
}

export function saveProgress(progress: Progress, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Not saved this time; the run still counted on screen.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
