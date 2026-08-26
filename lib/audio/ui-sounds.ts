/**
 * The three chrome cues, named by what the press meant.
 *
 * `SoundEffect` is the vocabulary; this is the intent. A call site reading
 * `selectSound()` says why it makes a noise, where `playSound("select")` only
 * says which file. That matters here more than it usually would, because the
 * split between these three is a judgement about the press and not about the
 * screen; see the comment over SOUND_FILES in ./manifest.
 *
 *   tapSound()     you moved: a menu opened, a link was followed, a panel closed
 *   selectSound()  you chose: a mode, a tier, a toggle, a tab, state changed
 *   gameOnSound()  you are in: a table or a game actually took you
 *
 * Something on the route has to have applied the mute first. `setSoundEnabled`
 * in ./sound-effects is a module-level flag that defaults to ON, and
 * components/poker-app.tsx is the only thing that syncs it with the player's
 * stored mute. Anything under PokerApp (the lobby, the table, every modal
 * they mount) is therefore free to call these directly.
 *
 * The arcade lives on its own routes (/games/*) where PokerApp isn't
 * mounted, so a page there that just called these would be loud for a
 * player who had muted the app, on a screen with no control to fix it.
 * That's the bug components/arcade/use-arcade-sound.ts exists to close.
 *
 * Because the flag is module-global rather than per-component, one
 * `useArcadeSound()` anywhere on an arcade page is enough to make these
 * helpers honest for that whole page; the hook's return value is only
 * needed by callers that want to name a non-chrome effect. Call it at the
 * route's root component and treat that call as load-bearing, not
 * decorative: delete it and every button below it silently stops
 * respecting the mute.
 */
import { playSound } from "./sound-effects";

/** A navigation press: menus, links, back arrows, closing a panel. */
export function tapSound() {
  playSound("ui");
}

/** A choice that changed something: a mode, a tier, a toggle, a tab. */
export function selectSound() {
  playSound("select");
}

/**
 * You are in.
 *
 * Fired once, on the edge of actually arriving, never on the button that
 * requests it. A press that fails (the table is full, the buy-in is refused)
 * must not sound like it worked, and the request's own button already answers
 * with `selectSound`.
 */
export function gameOnSound() {
  playSound("game-on");
}
