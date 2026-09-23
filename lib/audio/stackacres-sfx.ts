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

import { playFarmAnimal, playFarmSample, playFarmVoice } from "./stackacres-ambience";
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
  window.setTimeout(() => playFarmSample("seed-pat", 0.6), 160);
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

/** Watering a dry field: a splash over the row. */
export function waterSound() {
  playFarmSample("water-splash", 0.9);
}

/** Clearing a mucked unit: the one genuinely laborious thing on the farm. */
export function muckSound() {
  playFarmVoice("muck-clear", 1);
}

/** The hoe blade biting into the soil, on the swing's strike. */
export function hoeSound() {
  playFarmSample("hoe-crunch", 1);
}

/** The axe biting into a tree or scrub, on the swing's strike. */
export function axeSound() {
  playFarmSample("axe-chop", 1);
}

/** The pick cracking rock, on the swing's strike. */
export function pickSound() {
  playFarmSample("pick-crack", 1);
}

/** The pieces of something he broke arriving in his hands. */
export function piecesSound() {
  playFarmSample("pieces-gather", 0.8, 0);
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
  playFarmSample("crate-drop", 0.8);
  window.setTimeout(() => playFarmSample("coins-small", 0.6, 0), 220);
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
  playFarmSample("whoosh", 0.7);
}

/** Travelling to a district via the signpost. */
export function travelSound() {
  playFarmVoice("travel-steps", 0.7);
}

/**
 * A refused action, usually "you cannot afford that yet". A short soft blip
 * rather than a buzzer: it is frequent and ordinary, and a harsh error tone
 * would train a player to dread their own farm.
 */
export function refusedSound() {
  playFarmSample("refuse-blip", 1, 0);
}

/** The district drawer or the store sheet moving. */
export function panelSound() {
  playFarmSample("whoosh", 0.45);
}

/** Picking up a tool from the dock. */
export function toolSound() {
  playFarmVoice("tool-tap", 0.8);
}

/**
 * A Town Favor rung reached: a glass ping struck twice. Kept apart from
 * `prestigeSound`, which is reserved for a Prestige Reset and nothing else.
 */
export function townFavorSound() {
  playFarmSample("glass-ping", 0.6, 0);
  window.setTimeout(() => playFarmSample("glass-ping", 0.45, 0), 300);
}

/**
 * A Prestige Reset going through. The one moment on this farm big enough for
 * a whole phrase rather than a single cue: it answers a permanent choice, not
 * a tap.
 */
export function prestigeSound() {
  playFarmSample("prestige-music-box", 0.8, 0);
}

/** One footstep indoors, on the floorboards of the house, barn or workshop. */
export function floorStepSound(step: number) {
  const names = ["step-floor-1", "step-floor-2", "step-floor-3", "step-floor-4"] as const;
  playFarmSample(names[step % names.length], step % 2 ? 0.38 : 0.45);
}

/** Walking into or out of a building. */
export function doorSound() {
  playFarmSample("door-open", 0.6);
}

/** Opening the Journal. */
export function journalSound() {
  playFarmSample("page-turn", 0.7);
}

/** The area map opening or closing. */
export function mapSound() {
  playFarmSample("map-rustle", 0.7);
}

/** Picking a forage bush: the leaves, then the berries coming away. */
export function forageSound() {
  playFarmSample("leaf-rustle", 0.6);
  window.setTimeout(() => playFarmSample("berry-pop", 0.5), 220);
}

/** A traveler's quest moving on a step. */
export function questStepSound() {
  playFarmSample("quest-chime", 0.7, 0);
}
