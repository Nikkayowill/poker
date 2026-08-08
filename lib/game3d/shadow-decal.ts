/**
 * Sizing/opacity math for the felt's fake shadows. Pure so `npm test`
 * reaches it — a decal's footprint is a function of what it is grounding
 * (how tall a chip pile is, how a fanned card pair is laid out), never of
 * any three.js state. See components/game3d/scene/fake-shadows.tsx for the
 * renderer this feeds.
 *
 * WHY A PAINTED DECAL AND NOT A SHADOW MAP. Chips and cards are this
 * room's only *moving* geometry — the table and the seats are static, so a
 * shadow map only ever needs to update for what's airborne or resting on a
 * pile that just changed, and a chip pile changes on every bet. A flat,
 * unlit, radial-gradient plane costs one instance of one shared draw call
 * total and zero shadow-map re-renders, trading physical correctness (no
 * penumbra that actually responds to STUDIO_SPOT moving or dimming) for a
 * grounding cue that reads correctly at the size and distance this room is
 * ever viewed from. chip-instanced-layer.tsx and cards-instanced.tsx are
 * the two renderers whose meshes stop casting real shadows because of it.
 *
 * WHY WORLD-SPACE CIRCLES/ELLIPSES, NOT A CAMERA-TILT SQUASH. The 2D room
 * this project also ships (lib/scene/) is an orthographic tilt projection
 * onto a flat canvas, where a "circle on the felt" has to be pre-squashed
 * before it is drawn. This room is real perspective 3D: a decal is a flat
 * plane lying on the y = FELT_TOP_Y ground plane, and the camera's own
 * viewing angle is what makes it read as foreshortened on screen — exactly
 * the way a chip's own circular face already does with no special-casing.
 * Squashing the WORLD-SPACE shape here would double-compress it, the same
 * bug bet-style.ts's header warns about for splash-scatter offsets.
 */

import { CHIP } from "./dimensions";

/** A decal sits this far above the felt — enough to clear z-fighting with
 * the felt's own top face, small enough to be invisible as a gap. */
export const SHADOW_DECAL_LIFT = 0.001;

export interface CircularShadowPose {
  x: number;
  z: number;
  radius: number;
  opacity: number;
}

// Chip-pile shadow: grows and darkens gently with how many chips are
// resting on it, capped at MAX_CHIPS_PER_PILE's own ceiling (14) — a
// pile's shadow should never suggest more chips are there than the felt
// actually draws.
const CHIP_SHADOW_MAX_CHIPS = 14;
const CHIP_SHADOW_BASE_RADIUS_FACTOR = 1.7;
const CHIP_SHADOW_GROWTH_PER_CHIP = 0.045;
const CHIP_SHADOW_BASE_OPACITY = 0.26;
const CHIP_SHADOW_OPACITY_PER_CHIP = 0.016;
const CHIP_SHADOW_MAX_OPACITY = 0.5;

/**
 * The ground shadow for one resting chip pile. `null` for an empty pile —
 * there is nothing to ground.
 */
export function pileShadowPose(chipCount: number, x: number, z: number): CircularShadowPose | null {
  if (chipCount <= 0) return null;
  const clamped = Math.min(chipCount, CHIP_SHADOW_MAX_CHIPS);
  const radius = CHIP.radius * (CHIP_SHADOW_BASE_RADIUS_FACTOR + clamped * CHIP_SHADOW_GROWTH_PER_CHIP);
  const opacity = Math.min(
    CHIP_SHADOW_BASE_OPACITY + clamped * CHIP_SHADOW_OPACITY_PER_CHIP,
    CHIP_SHADOW_MAX_OPACITY,
  );
  return { x, z, radius, opacity };
}

/** Slightly larger than the card group's own footprint, so the pool reads
 * as ground contact rather than tracing the cards' outline exactly. */
const CARD_SHADOW_MARGIN = 1.15;
const CARD_SHADOW_OPACITY = 0.32;

/**
 * The ground shadow for one seat's hole-card group (both cards fanned
 * together read as one pool, not two — a real dealt pair casts one
 * combined shadow, and two separate decals this close together would only
 * ever double-darken where they overlap).
 *
 * Circular, not an ellipse fitted to the fan's true footprint — matching a
 * card's own rotation composition (lay flat, then spin in-plane to the
 * seat's facing) precisely enough to orient an ellipse's axes correctly is
 * exactly the kind of thing that's easy to get subtly wrong without a live
 * render to check it against, and a shadow is a cosmetic grounding cue, not
 * a correctness-bearing prop. `radius` is generous enough (the larger
 * half-extent, margined) to comfortably cover both cards at any facing.
 */
export function holeCardGroupShadowPose(
  x: number,
  z: number,
  fanHalfSpan: number,
  cardHeight: number,
): CircularShadowPose {
  const radius = Math.max(fanHalfSpan, cardHeight / 2) * CARD_SHADOW_MARGIN;
  return { x, z, radius, opacity: CARD_SHADOW_OPACITY };
}
