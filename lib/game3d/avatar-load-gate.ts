/**
 * The pure half of "has every seated character actually finished loading."
 *
 * `PokerScene` (components/game3d/scene/poker-scene.tsx) used to report
 * `sceneReady = true` the instant the WebGL context existed -- which is
 * essentially immediate -- while each seat's .glb kept loading independently
 * behind its own `<Suspense fallback={null}>`. That let the room present
 * itself as finished and then have characters pop in seat by seat, which is
 * what read as "avatars falling out of the sky." This predicate is the other
 * half of the fix: the true gate. It stays here, not inline in the R3F
 * component, for the same reason `scene-model.ts` and friends do --
 * `vitest.config.ts` only collects `lib/` and `app/`, so a check this easy to
 * get backwards (an empty expected set reading as "loaded," an off-by-one on
 * a departed seat) belongs somewhere `npm test` can actually reach it.
 */
export function allSeatsLoaded(
  expectedSlots: readonly number[],
  loadedSlots: ReadonlySet<number>,
): boolean {
  return expectedSlots.every((slot) => loadedSlots.has(slot));
}
