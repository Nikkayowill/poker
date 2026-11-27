import { HORDE } from "./content";

/**
 * What each wave sends in. Walkers are the crowd and grow every wave, runners
 * join from wave 3 to punish standing still, bloaters (they burst when they
 * die) come from wave 4, riot zombies (they stop half of
 * every bullet) come from wave 6, and a brute lumbers in every fifth wave (two
 * on the tenth, and so on). `horde` is the difficulty's crowd size.
 */
export interface WaveMix {
  walker: number;
  runner: number;
  bloater: number;
  armored: number;
  brute: number;
}

export function waveMix(wave: number, horde: number): WaveMix {
  const n = Math.max(1, Math.floor(wave));
  return {
    walker: Math.max(1, Math.round((8 + 3 * n) * horde)),
    runner: n >= 3 ? Math.round(Math.floor(1.4 * (n - 2)) * horde) : 0,
    bloater: n >= 4 ? Math.round(Math.floor((n - 2) / 2) * horde) : 0,
    armored: n >= 6 ? Math.round(Math.floor((n - 4) / 2) * horde) : 0,
    brute: n % 5 === 0 ? n / 5 : 0,
  };
}

/** Seconds between batches walking in: quick at the start of a run, frantic later. */
export function spawnInterval(wave: number): number {
  const { start, end } = HORDE.spawnInterval;
  const t = Math.min(1, Math.max(0, (wave - 1) / HORDE.rampWaves));
  return start + (end - start) * t;
}

/** A shuffled list of zombie kinds for the wave, with any brutes held back to the second half so the crowd comes first. */
export function waveQueue(wave: number, horde: number, roll: () => number): string[] {
  const mix = waveMix(wave, horde);
  const crowd: string[] = [
    ...Array<string>(mix.walker).fill("walker"),
    ...Array<string>(mix.runner).fill("runner"),
    ...Array<string>(mix.bloater).fill("bloater"),
    ...Array<string>(mix.armored).fill("armored"),
  ];
  for (let i = crowd.length - 1; i > 0; i -= 1) {
    const j = Math.floor(roll() * (i + 1));
    [crowd[i], crowd[j]] = [crowd[j], crowd[i]];
  }
  const half = Math.floor(crowd.length / 2);
  const brutes = Array<string>(mix.brute).fill("brute");
  return [...crowd.slice(0, half), ...brutes, ...crowd.slice(half)];
}
