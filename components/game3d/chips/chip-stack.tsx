"use client";

/**
 * The chip asset factory: one shared geometry and one shared material
 * triple per denomination for the whole scene. This used to also be the
 * chip renderer (a `ChipStack` component drawing one JSX `<mesh>` per
 * chip) — that renderer is gone; chip-instanced-layer.tsx is the sole
 * consumer now, feeding `chipGeometry`/`chipMaterials` into one
 * InstancedMesh per denomination instead of one Mesh per chip. The asset
 * factory itself didn't need to change shape for that: "a pile is only
 * ever new transforms, never new GPU resources" was already exactly the
 * contract instancing wants, just enforced one mesh at a time before.
 */

import * as THREE from "three";
import type { ChipDenomination } from "@/lib/game3d/denominations";
import { CHIP } from "@/lib/game3d/dimensions";
import { chipEdgeTexture, chipFaceTexture } from "./chip-textures";

/**
 * A real 39 x 3.3 mm chip, at the scale the felt establishes — see
 * lib/game3d/dimensions.ts.
 *
 * These were 0.095 and hand-tuned, with a note saying a true-scale chip
 * would be a two-pixel dot at this camera distance. That was true of the
 * camera it was written against: a 32-degree rig sitting far enough back to
 * see a table it could not frame. The camera is solved per viewport now
 * (lib/game3d/camera-framing.ts) and sits both higher and closer, and at
 * real scale a chip lands around twenty pixels across — small, as a chip
 * should be, and now carrying enough surface to read as clay rather than
 * needing size to stand in for detail.
 */
export const CHIP_RADIUS = CHIP.radius;
export const CHIP_THICKNESS = CHIP.thickness;

/**
 * Segment count is up from 24 because the disc is now small on screen: a
 * silhouette this size shows faceting immediately, and 40 short segments on
 * one shared geometry costs nothing.
 */
export const chipGeometry = new THREE.CylinderGeometry(
  CHIP_RADIUS,
  CHIP_RADIUS,
  CHIP_THICKNESS,
  40,
);

/** Cylinder material order is [side, top, bottom]. */
const materialCache = new Map<number, THREE.Material[]>();

export function chipMaterials(denom: ChipDenomination): THREE.Material[] {
  const cached = materialCache.get(denom.value);
  if (cached) return cached;
  const side = new THREE.MeshStandardMaterial({
    map: chipEdgeTexture(denom),
    roughness: 0.52,
    metalness: 0.02,
  });
  const face = new THREE.MeshStandardMaterial({
    map: chipFaceTexture(denom),
    roughness: 0.42,
    metalness: 0.02,
  });
  const materials = [side, face, face];
  materialCache.set(denom.value, materials);
  return materials;
}
