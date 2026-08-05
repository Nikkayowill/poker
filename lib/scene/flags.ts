/**
 * The staging switch for Layer C.
 *
 * The WebGL room ships on for everyone -- floor, chairs, rim, lighting and
 * every chip on the felt -- and so do the sprite avatars: Layer C is on by
 * default now that alignment (the DOM/room seat ring agreeing to within a
 * few px) and the DOM-figure handoff have both been verified against a live
 * table. `SeatFigure` and its CSS are still in the tree rather than deleted,
 * so this stays a real kill switch rather than a one-way door: an explicit
 * `?webglAvatars=0` on a link falls back to the flat DOM figures if the
 * sprite layer ever needs to be pulled without a redeploy.
 *
 * Pure and parameterised on the query string rather than reading `location`
 * itself, so it is reachable by `npm test` -- `vitest.config.ts` collects
 * `lib/` and `app/`, and a flag that decides what a player sees should not be
 * the one piece of this that nothing checks.
 */

export const WEBGL_AVATARS_PARAM = "webglAvatars";

/**
 * Whether Layer C should draw.
 *
 * On unless explicitly turned off (`?webglAvatars=0` or `=false`), so an
 * ordinary table with no query string at all still gets the sprite layer.
 */
export function webglAvatarsEnabled(search: string): boolean {
  if (!search) return true;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!params.has(WEBGL_AVATARS_PARAM)) return true;
  const value = params.get(WEBGL_AVATARS_PARAM);
  if (value === null || value === "") return true;
  return value !== "0" && value.toLowerCase() !== "false";
}
