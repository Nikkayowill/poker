/**
 * Makes this tab's sound obey the iPhone's hardware silent switch.
 *
 * Safari plays a plain `<audio>` element through the ringer regardless of
 * the mute switch by default -- a long-standing WebKit quirk, unrelated to
 * this app's own mute toggle, that is exactly what got reported as "the
 * music plays even with my phone on silent." The new (Safari-only)
 * AudioSession API is the fix: setting the session's `type` to "ambient"
 * tells WebKit this page's sound should mix quietly with, and defer to, the
 * rest of the device -- which is the one type the switch is honored for.
 *
 * Feature-detected and safe to call from every module that opens an
 * `<audio>` element (./sound-effects and ./menu-music both do): the
 * property is a page-wide session, not a per-element setting, so the first
 * caller wins and every later call is a harmless no-op re-assignment.
 */
export function respectSilentSwitch() {
  if (typeof navigator === "undefined") return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    session.type = "ambient";
  } catch {
    // Older/other engines may expose the property but reject the value;
    // silent audio effects are the pre-existing behavior, not a regression.
  }
}
