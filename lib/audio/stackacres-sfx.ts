/**
 * The farm's action sounds, named by what happened rather than by what they
 * are made of.
 *
 * Same split, and the same reasoning, as ./ui-sounds.ts against
 * ./sound-effects.ts: `sowSound()` at a call site says why the farm made a
 * noise, where `playFarmVoice("sow-seed")` only says which recipe ran. The
 * mapping from one to the other is a judgement about the gesture, and it
 * belongs in one file rather than spread across every button.
 *
 * WHY THESE ARE NOT `tapSound()`. Every action on this map used to make the
 * app's single generic chrome click -- collecting eggs, paying to expand a
 * pen, and closing a panel were all one sound. That is fine on a settings
 * screen and wrong here: this is the one surface in StackChips where the
 * press IS the game, and a farm where sowing and harvesting are audibly the
 * same event does not feel like a place, it feels like a form. The chrome
 * cues are still correct for chrome (opening the store sheet, closing the
 * drawer) and are deliberately still used there.
 *
 * Nothing here sounds until `startAmbience()` has run, which happens at the
 * tap-to-play splash: these share its AudioContext, and a context built
 * before a gesture is a suspended one.
 */

import { playFarmAnimal, playFarmVoice } from "./stackacres-ambience";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";

/**
 * Seed going into the ground: `stock`, the Bushels path onto a fresh unit.
 *
 * Two beats, the same shape `collectSound` answers a crop harvest with: the
 * scatter first, then a soft pat as it's pressed into the bed -- a seed that
 * only ever scattered and never landed was the gap here.
 */
export function sowSound() {
  playFarmVoice("sow-seed", 0.9);
  window.setTimeout(() => playFarmVoice("dirt-pat", 0.7), 160);
}

/**
 * A collection landing. The animal answers first and the produce follows --
 * a hen that clucks as the eggs go in the basket is the whole reason to have
 * bothered generating animal recordings, and it is the moment the farm most
 * needs to feel alive.
 *
 * A crop gets the same two-beat shape with no animal to lead it: the CUT
 * (`leaf-snip`) first, then the produce landing (`harvest-pour`) a beat
 * after, rather than the pour alone answering both the stroke and the
 * result.
 */
export function collectSound(stock: StackAcresStock) {
  if (stock === "hen" || stock === "pig" || stock === "cattle") {
    playFarmAnimal(stock, 0.55);
    window.setTimeout(() => playFarmVoice("harvest-pour", 0.85), 220);
    return;
  }
  playFarmVoice("leaf-snip", 0.85);
  window.setTimeout(() => playFarmVoice("harvest-pour", 0.8), 90);
}

/** Feeding an animal: grain thrown, and the animal noticing. */
export function feedSound(stock: StackAcresStock) {
  playFarmVoice("feed-scatter", 0.9);
  if (stock === "hen" || stock === "pig" || stock === "cattle") {
    window.setTimeout(() => playFarmAnimal(stock, 0.45), 340);
  }
}

/**
 * Watering a dry field: a can tipped over the row.
 *
 * Built out of `water-drop` rather than a new synth voice, and staggered
 * rather than played once, because one drop is a plink and three falling
 * away from each other is a pour. The gains descend so the can reads as
 * emptying -- an even three sounds like a machine.
 *
 * The one action cue with no animal in it, deliberately: nothing on the crop
 * track has a voice to answer with, and borrowing a hen for it would put a
 * bird in the Long Meadow, where there are none.
 *
 * `water-drop`'s own trim (synth-voices.ts's `VOICE_TRIM`) is calibrated to
 * the quiet ambience-cue reference, not the louder action-cue one, because
 * the same recipe also plays as a background river/wallow drip. Bumping that
 * shared trim would blast the ambience; these gains carry the ~4dB the
 * action instance needs on top of it instead, so the pour actually reads as
 * an action and not a background drip that happened to sync with the tap.
 */
export function waterSound() {
  playFarmVoice("water-drop", 1.4);
  window.setTimeout(() => playFarmVoice("water-drop", 1.1), 90);
  window.setTimeout(() => playFarmVoice("water-drop", 0.8), 200);
}

/** Clearing a mucked unit: the one genuinely laborious thing on the farm. */
export function muckSound() {
  playFarmVoice("muck-clear", 1);
}

/** Buying stock outright, or anything else that closes a purchase. */
export function buySound() {
  playFarmVoice("buy-latch", 1);
}

/** Gold arriving from the exchange window. The only place coins are heard. */
export function goldSound() {
  playFarmVoice("coins-pour", 0.9);
}

/** Selling produce at the store: a crate going down on the counter. */
export function sellSound() {
  playFarmVoice("crate-down", 0.85);
}

/** Paying Gold to raise a capacity ceiling: a new fence post going in. */
export function expandSound() {
  playFarmVoice("post-hammer", 0.9);
  window.setTimeout(() => playFarmVoice("post-hammer", 0.6), 260);
}

/** Retiring a permanent animal. A gate shutting, once, with nothing after it. */
export function retireSound() {
  playFarmVoice("crate-down", 0.6);
}

/** The scythe cutting standing grass. Fired per stroke, from the scene. */
export function scytheSound() {
  playFarmVoice("scythe-swish", 0.55);
}

/** Travelling to a district via the signpost. */
export function travelSound() {
  playFarmVoice("travel-steps", 0.7);
}

/**
 * A refused action.
 *
 * A dull knock on wood, never a buzzer. Most refusals here are "you cannot
 * afford that yet", which is ordinary and frequent, and a harsh error tone
 * on an ordinary event trains a player to dread their own farm.
 */
export function refusedSound() {
  playFarmVoice("refuse", 0.8);
}

/** The district drawer or the store sheet moving. */
export function panelSound() {
  playFarmVoice("panel-slide", 0.7);
}

/** Picking up a tool from the dock. */
export function toolSound() {
  playFarmVoice("tool-tap", 0.8);
}

/**
 * A Prestige Reset going through.
 *
 * The one moment on this farm big enough for a chord rather than a single
 * cue -- everything else here answers a tap; this answers a permanent,
 * irreversible choice, and a `buy-latch`-sized click would undersell it.
 */
export function prestigeSound() {
  playFarmVoice("prestige-chime", 1);
}
