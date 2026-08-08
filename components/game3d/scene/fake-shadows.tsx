"use client";

/**
 * The felt's fake shadows: one shared soft-edged black disc, instanced
 * once per resting chip pile and once per OPPONENT's hole-card group — one
 * draw call total, zero shadow-map work. See lib/game3d/shadow-decal.ts
 * for why a painted decal replaces a real shadow map for chips and cards
 * specifically (they're this room's only moving geometry), and for the
 * pure sizing math this file turns into instance transforms. Chips
 * (chip-instanced-layer.tsx) and hole cards (cards-instanced.tsx) render
 * with no castShadow/receiveShadow at all — this is what grounds them
 * instead.
 *
 * THE BLEND MODE, VERIFIED AGAINST THE INSTALLED THREE SOURCE.
 * `THREE.MultiplyBlending` darkens whatever is already drawn rather than
 * compositing a shape over it — the right blend for "a patch of felt reads
 * darker here", wrong for "a black shape sits on top here" (which
 * NormalBlending would give, and which looks like a sticker, not a
 * shadow). It has one hard requirement three's own WebGLState logs an
 * error without: `material.premultipliedAlpha = true` — without it,
 * three's blend-func switch falls into an `error()` branch and never
 * programs a blend function at all. With it, the resulting GL blend is
 * `blendFuncSeparate(DST_COLOR, ONE_MINUS_SRC_ALPHA, ZERO, ONE)`
 * (WebGLState.js), and the fragment shader premultiplies
 * `gl_FragColor.rgb *= gl_FragColor.a` first (premultiplied_alpha_
 * fragment.glsl.js) — so for THIS texture, whose RGB is always pure black
 * (0,0,0) and whose alpha alone carries the radial falloff, the premultiplied
 * source RGB is *always* 0 regardless of alpha, and the output becomes
 * `dst.rgb * (1 - alpha)`: fully black at alpha 1, completely unchanged at
 * alpha 0, smoothly in between. That is exactly the soft multiply-shadow
 * this file exists to paint, derived from the real blend arithmetic rather
 * than assumed from the constant's name.
 *
 * THE ALPHA CURVE IS DELIBERATELY SHORT OF 1. A first cut ran the gradient
 * to full opacity (alpha 1) at the disc's centre, which — by the arithmetic
 * above — multiplies the felt straight to pure black directly under a
 * pile: a hard, dark stain rather than the soft occlusion a real overhead
 * spot would cast. `SHADOW_PEAK_ALPHA` caps it at 0.5 (half-darken at the
 * absolute centre, nothing at the rim), which is what a soft shadow
 * actually looks like under this light. The shape of the falloff — the
 * same three-stop radial, just rescaled — is untouched.
 */

/** Alpha at the decal's centre; see the header above for why this is not 1. */
const SHADOW_PEAK_ALPHA = 0.5;
/** Alpha at the gradient's middle stop, scaled from SHADOW_PEAK_ALPHA to
 * keep the same relative falloff shape the original 1 → 0.55 → 0 curve had. */
const SHADOW_MID_ALPHA = SHADOW_PEAK_ALPHA * 0.55;

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { seatHasFeltCards, type SeatModel } from "@/lib/game3d/scene-model";
import { chipBreakdown } from "@/lib/game3d/denominations";
import { holeCardGroupShadowPose, pileShadowPose } from "@/lib/game3d/shadow-decal";
import { CARD } from "@/lib/game3d/dimensions";
import { FELT_TOP_Y, holeCardPosition } from "@/lib/game3d/seat-layout";
import type { RestingChipPile } from "../chips/chip-instanced-layer";

// Mirrors cards-instanced.tsx's own constant — see that file for the
// reasoning. There is no near-seat enlargement to mirror any more: the only
// pairs this grounds are opponents', which are all life-size.
const HOLE_CARD_FAN = CARD.width * 0.52;

/** 7 possible chip piles (6 seats + pot) + 5 possible hole-card groups (every
 * seat but the local one, whose pair is DOM) + headroom — an exact bound for a
 * six-max table, not a guess. */
const MAX_SHADOW_INSTANCES = 20;

let sharedGeometry: THREE.CircleGeometry | null = null;
let sharedTexture: THREE.CanvasTexture | null = null;

function shadowDecalTexture(): THREE.CanvasTexture {
  if (sharedTexture) return sharedTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${SHADOW_PEAK_ALPHA})`);
  gradient.addColorStop(0.65, `rgba(0, 0, 0, ${SHADOW_MID_ALPHA})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  sharedTexture = new THREE.CanvasTexture(canvas);
  return sharedTexture;
}

/** A unit disc, baked flat onto the ground plane once — every instance is
 * then just a position and a radius, no per-instance rotation needed. */
function shadowDecalGeometry(): THREE.CircleGeometry {
  if (sharedGeometry) return sharedGeometry;
  const geometry = new THREE.CircleGeometry(1, 32);
  geometry.rotateX(-Math.PI / 2);
  sharedGeometry = geometry;
  return geometry;
}

export interface FakeShadowsProps {
  piles: RestingChipPile[];
  seats: SeatModel[];
}

export function FakeShadows({ piles, seats }: FakeShadowsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => shadowDecalGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: shadowDecalTexture(),
        transparent: true,
        blending: THREE.MultiplyBlending,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [],
  );

  // Layout-timed for the same reason chip-instanced-layer.tsx and
  // cards-instanced.tsx are: an InstancedMesh starts with every unwritten
  // instance at identity, which would flash a unit-radius disc at the
  // world origin for one frame if this ran after paint.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    let i = 0;

    const place = (pose: { x: number; z: number; radius: number } | null) => {
      if (!pose || i >= MAX_SHADOW_INSTANCES) return;
      dummy.position.set(pose.x, FELT_TOP_Y, pose.z);
      dummy.scale.set(pose.radius, 1, pose.radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      i += 1;
    };

    for (const pile of piles) {
      // The same chipBreakdown a pile's own renderer (chip-instance-
      // model.ts's restingPileChipPoses) uses to decide how many chips it
      // draws — the shadow's chip count must be the DISPLAYED count, not
      // the raw Gold amount, or a huge pot would ground a bigger shadow
      // than the (capped) pile of chips actually sitting on it.
      const chipCount = pile.amount > 0 ? chipBreakdown(pile.amount).length : 0;
      place(pileShadowPose(chipCount, pile.position.x, pile.position.z));
    }

    for (const seat of seats) {
      // `seatHasFeltCards` and not an inline "is this seat in a hand": the
      // local player's pair is DOM, floating off the felt in front of the
      // rail, so grounding it painted a shadow on bare cloth in the middle of
      // that player's own view — under cards which are not there and never
      // were. See that predicate's own header; it is what keeps this file
      // agreeing with the two renderers about what is actually on the table.
      if (!seatHasFeltCards(seat)) continue;
      const spot = holeCardPosition(seat.slot);
      place(holeCardGroupShadowPose(spot.x, spot.z, HOLE_CARD_FAN, CARD.height));
    }

    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, [piles, seats]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_SHADOW_INSTANCES]}
      frustumCulled={false}
    />
  );
}
