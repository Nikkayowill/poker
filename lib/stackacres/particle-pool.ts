/**
 * One frame of a fixed-size particle pool: age every live entry, drop what
 * is spent, and refill every freed slot so the live count never exceeds a
 * fixed ceiling.
 *
 * Three fields share this exact shape -- ./sunlight.ts's `sparkleField` and
 * ./weather.ts's `solarDustField`/`rainStreakField` -- each written from
 * scratch before this existed. Lives here once now so a fix to the
 * refill-to-ceiling contract only has to be found and applied in one place;
 * missing one of the three previously left that field silently behaving
 * differently under the same conditions.
 *
 * `step` returns the entry's next state, or null once it is spent -- a rain
 * streak that wraps past the bottom of the frame never returns null (it
 * "spawns" a fresh one in place instead of being dropped and refilled), which
 * is why `rainStreakField` fits this same shape despite never losing an
 * entry to the ceiling-refill branch below.
 */
export function stepParticlePool<T>(
  live: readonly T[],
  max: number,
  step: (item: T) => T | null,
  spawn: () => T,
): T[] {
  const next: T[] = [];
  for (const item of live) {
    if (next.length >= max) break;
    const stepped = step(item);
    if (stepped) next.push(stepped);
  }
  while (next.length < max) next.push(spawn());
  return next;
}
