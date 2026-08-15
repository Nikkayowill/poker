/**
 * TEMP placeholder art for the landscape-band 2D.5 opponent cutouts.
 *
 * No per-character full-body cutout art exists yet -- the app's real
 * characters are `.glb` rigs or bust-only 2D crops (see lib/cosmetics/catalog.ts),
 * neither of which is a seated, torso-up render. These two files are generic
 * test renders, not tied to any character identity, the same way the design
 * mock itself reused them across every opponent seat with a horizontal flip.
 *
 * Swap this out once real per-character art exists: the call site
 * (SeatFigure in components/table/player-seat.tsx) only needs a `src`, so
 * pointing this at a per-character lookup keyed on `seat.avatarCosmetic` is a
 * path change here, not a rendering change there.
 */

const LANDSCAPE_CUTOUT_PLACEHOLDERS = [
  "/pokertable/landscape-cutout-a.png",
  "/pokertable/landscape-cutout-b.png",
] as const;

/**
 * Which placeholder render an opponent seat gets, and whether to mirror it.
 *
 * Deterministic on the seat's slot (0-indexed among the five opponents, same
 * convention as `landscapeTopArcGeometry`), not on identity -- there are only
 * two source images, so this alternates them and flips every other one purely
 * for visual variety, the same trick the design mock used.
 */
export function resolveLandscapeCutout(opponentSlot: number): { src: string; flip: boolean } {
  const index = ((opponentSlot % LANDSCAPE_CUTOUT_PLACEHOLDERS.length) + LANDSCAPE_CUTOUT_PLACEHOLDERS.length)
    % LANDSCAPE_CUTOUT_PLACEHOLDERS.length;
  return {
    src: LANDSCAPE_CUTOUT_PLACEHOLDERS[index],
    flip: opponentSlot % 2 === 1,
  };
}
