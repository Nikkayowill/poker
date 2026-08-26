/**
 * The pure half of "has every seated character actually finished loading."
 *
 * `PokerScene` (components/game3d/scene/poker-scene.tsx) reports scene
 * readiness once every expected seat's .glb has actually loaded, not the
 * instant the WebGL context exists — each seat's model loads independently
 * behind its own `<Suspense fallback={null}>`, so a context-only check let
 * characters pop in seat by seat after the room already looked finished.
 * This predicate lives here rather than inline in the R3F component for the
 * same reason `scene-model.ts` and friends do: `vitest.config.ts` only
 * collects `lib/` and `app/`, so a check this easy to get backwards (an
 * empty expected set reading as "loaded", an off-by-one on a departed seat)
 * belongs somewhere `npm test` can actually reach it.
 */
export function allSeatsLoaded(
  expectedSlots: readonly number[],
  loadedSlots: ReadonlySet<number>,
): boolean {
  return expectedSlots.every((slot) => loadedSlots.has(slot));
}
