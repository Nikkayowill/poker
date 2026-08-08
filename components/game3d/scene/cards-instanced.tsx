"use client";

/**
 * Every live hole card as instances of ONE InstancedMesh sharing ONE atlas
 * material — a single draw call for however many cards are in play,
 * instead of one material (and one texture bind) per unique card. The
 * board is out of scope here: it renders as DOM overlay now
 * (hud/board-cards.tsx), not in-scene — see that file's own header for why
 * a texture can't be made to read at a lazy glance on a phone. This
 * component is the in-scene card renderer's entire remaining job:
 * `HoleCards` in cards-3d.tsx is what this replaces.
 *
 * WHICH SEATS THIS DRAWS. Not every hole card on the felt any more: the
 * local player's own pair is DOM now (hud/own-hole-cards.tsx — it needs the
 * board's own crisp resolution, not a baked texture), and an opponent
 * still holding an unrevealed pair is a modelled face-down prop
 * (props/hole-card-prop.tsx), not a texture. What lands here is exactly
 * the remainder: any other seat's pair once it is actually showing faces
 * (a showdown reveal). lib/game3d/scene-model.ts's seatHoleCardsHidden is
 * the one predicate that split is built on, so this file and the prop
 * agree on who owns a seat without either having to ask the other.
 *
 * HOW ONE DRAW CALL CAN SHOW N DIFFERENT CARD FACES. InstancedMesh shares
 * geometry AND material across every instance by design — only the
 * transform (and, with three's stock features, an optional per-instance
 * colour) varies per instance. A card atlas needs a THIRD per-instance
 * value: which rect of the shared texture this instance samples. There is
 * no stock material property for that, so this file patches
 * MeshStandardMaterial's own vertex shader via `onBeforeCompile` — the
 * documented, standard three.js extension point for exactly this — adding
 * one instanced attribute (`instanceUvRect`, a vec4: u0, v0, du, dv) and
 * remapping `vMapUv` (the varying the stock fragment shader already
 * samples `map` through) by it, right after `#include <uv_vertex>`.
 * Verified against the installed three@0.185.1 source rather than assumed:
 * `uv_vertex.glsl.js` computes
 * `vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;` inside
 * `#ifdef USE_MAP` — appending a second assignment after the `#include`
 * composes with that instead of fighting it, and needs no knowledge of
 * what is inside the chunk beyond "vMapUv holds the map UV afterward",
 * which is the one thing the rest of the PBR pipeline depends on being
 * true regardless of three's internal chunk wording changing later.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { WebGLProgramParametersWithUniforms } from "three";
import type { Card } from "@/lib/game/types";
import {
  seatHasFeltCards,
  seatHoleCardsHidden,
  type SeatModel,
} from "@/lib/game3d/scene-model";
import { atlasKeyFor, cardAtlasRect } from "@/lib/game3d/card-atlas";
import { CARD } from "@/lib/game3d/dimensions";
import { faceCentreRotationY, holeCardPosition } from "@/lib/game3d/seat-layout";
import { cardAtlasTexture } from "./card-atlas-texture";

// Mirrors HoleCards' own constants in cards-3d.tsx exactly — see that file
// for the reasoning behind each. Not imported from there because they are
// private to CardPlate/HoleCards; duplicated here rather than exported
// solely for this file's sake would be the wrong direction, but these
// numbers ARE the visual contract, so if HoleCards' constants ever change,
// this file's copy has to change with them by hand until one of the two
// renderers is retired.
//
// The near-seat pair's enlargement and prop-up tilt are deliberately NOT
// mirrored: this renderer never draws the local player's hand (see
// seatCardInstances), so a scale and a tilt that could only ever apply to it
// were dead numbers reading as live ones — and scene/fake-shadows.tsx had
// copied the scale across, where it sized a shadow for cards that are not on
// the felt at all.
const CARD_LIFT = CARD.thickness;
const HOLE_CARD_FAN = CARD.width * 0.52;

/** 5 opponents x 2 cards, plus headroom — the local player's pair is DOM, so
 * a six-max table can never show more than 10 here. An exact bound, not a
 * guess. */
const MAX_CARD_INSTANCES = 12;

let sharedMaterial: THREE.MeshStandardMaterial | null = null;
let sharedGeometry: THREE.PlaneGeometry | null = null;

function patchAtlasShader(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <uv_pars_vertex>",
      "#include <uv_pars_vertex>\nattribute vec4 instanceUvRect;",
    )
    .replace(
      "#include <uv_vertex>",
      [
        "#include <uv_vertex>",
        "#ifdef USE_MAP",
        "\tvMapUv = vMapUv * instanceUvRect.zw + instanceUvRect.xy;",
        "#endif",
      ].join("\n"),
    );
}

/** One shared geometry (life-size card plate) and one shared atlas
 * material for the whole session — matching chip-stack.tsx's "a pile is
 * only ever new transforms, never new GPU resources" contract. */
function cardAtlasAssets(): { geometry: THREE.PlaneGeometry; material: THREE.MeshStandardMaterial } {
  if (!sharedGeometry) {
    sharedGeometry = new THREE.PlaneGeometry(CARD.width, CARD.height);
  }
  if (!sharedMaterial) {
    const material = new THREE.MeshStandardMaterial({
      map: cardAtlasTexture(),
      roughness: 0.88,
      alphaTest: 0.5,
    });
    material.onBeforeCompile = patchAtlasShader;
    sharedMaterial = material;
  }
  return { geometry: sharedGeometry, material: sharedMaterial };
}

interface CardInstance {
  card: Card | null;
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationZ: number;
  scale: number;
}

function seatCardInstances(seat: SeatModel): CardInstance[] {
  // The local player's own pair is DOM (hud/own-hole-cards.tsx), and an
  // opponent's still-hidden pair is the modelled prop
  // (props/hole-card-prop.tsx) — this atlas only ever draws a revealed
  // opponent hand. Both exclusions go through the shared predicates so this
  // file, the prop and scene/fake-shadows.tsx cannot disagree about what is
  // on the cloth.
  if (!seatHasFeltCards(seat) || seatHoleCardsHidden(seat)) return [];
  const spot = holeCardPosition(seat.slot);
  const facing = faceCentreRotationY(spot);
  const tangentX = Math.cos(-facing);
  const tangentZ = Math.sin(-facing);

  // Life-size and flat on the cloth. Every pair this draws is an opponent's,
  // so there is no near-seat case to branch on — the local player's enlarged,
  // propped-up hand is DOM (hud/own-hole-cards.tsx).
  return seat.holeCards.map((card, i) => {
    const side = i === 0 ? -1 : 1;
    return {
      card,
      x: spot.x + tangentX * side * HOLE_CARD_FAN,
      y: spot.y + CARD_LIFT + i * CARD.thickness,
      z: spot.z + tangentZ * side * HOLE_CARD_FAN,
      rotationX: -Math.PI / 2,
      rotationZ: facing + Math.PI + side * 0.12,
      scale: 1,
    };
  });
}

export function HoleCardsInstanced({ seats }: { seats: SeatModel[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { geometry, material } = useMemo(() => cardAtlasAssets(), []);
  // A ref, not useMemo: this attribute is mutated imperatively every time
  // `seats` changes (setXYZW/needsUpdate below), and react-hooks'
  // immutability analysis treats a useMemo result as read-only after
  // render — correctly, since three.js buffer attributes are exactly the
  // kind of non-React-tracked mutable object useRef exists for (same
  // reason the InstancedMesh handles in chip-instanced-layer.tsx and
  // fake-shadows.tsx are refs, not memoized state).
  const uvRectAttributeRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  if (uvRectAttributeRef.current === null) {
    uvRectAttributeRef.current = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_CARD_INSTANCES * 4),
      4,
    );
  }

  // Layout-timed for the same reason chip-instanced-layer.tsx writes its
  // first pass before paint: an InstancedMesh starts with every instance
  // matrix at identity, which here would flash a life-size card sitting at
  // the world origin for one frame if this ran after paint instead of
  // before it.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    const uvRectAttribute = uvRectAttributeRef.current;
    if (!mesh || !uvRectAttribute) return;
    mesh.geometry.setAttribute("instanceUvRect", uvRectAttribute);

    const dummy = new THREE.Object3D();
    // Flattened first, then capped once — a per-seat `break` on its own
    // only exits that seat's own (≤2) card instances, not the loop over
    // `seats`, so a table with more seats than MAX_CARD_INSTANCES/2 would
    // keep writing later seats' cards past the cap instead of stopping the
    // whole pass. Six-max never reaches it (6 x 2 == the cap exactly), but
    // the guard should hold on its own arithmetic, not on that equality.
    const instances = seats.flatMap((seat) => seatCardInstances(seat)).slice(0, MAX_CARD_INSTANCES);
    let i = 0;
    for (const instance of instances) {
      dummy.position.set(instance.x, instance.y, instance.z);
      dummy.rotation.set(instance.rotationX, 0, instance.rotationZ);
      dummy.scale.set(instance.scale, instance.scale, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const rect = cardAtlasRect(atlasKeyFor(instance.card));
      uvRectAttribute.setXYZW(i, rect.u0, rect.v0, rect.du, rect.dv);
      i += 1;
    }

    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    uvRectAttribute.needsUpdate = true;
    // Hole cards change on every street/deal/showdown — every one of those
    // arrives as a new `seats` prop from a new SceneModel, which already
    // invalidates the demand-mode render loop on its own (see
    // demand-loop.ts's header on React-driven commits). Cards never
    // animate frame-to-frame the way chip flights do, so unlike
    // chip-instanced-layer.tsx this file needs no useFrame at all.
  }, [seats]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_CARD_INSTANCES]}
      // Same reasoning as chip-instanced-layer.tsx: every card position on
      // this felt sits inside the fixed camera framing at every supported
      // viewport, so there is nothing frustum culling would ever cull.
      frustumCulled={false}
    />
  );
}
