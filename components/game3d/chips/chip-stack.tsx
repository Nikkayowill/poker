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
 *
 * WHY THE GEOMETRY IS HAND-BUILT AND NOT A CylinderGeometry. A cylinder
 * meets its own cap at a perfectly sharp 90 degrees, which under a single
 * hard studio spot gives the rim exactly one shading value and reads as a
 * printed counter. A real chip has a small moulded break there
 * (CHIP.bevel), and that break is what catches the light as a bright line
 * along the top of every disc in a pile — the single cheapest thing that
 * separates a stack of chips from a stack of discs. Three's own cylinder
 * cannot express it, so the profile is lathed here.
 *
 * It stays ONE shared geometry with the same three material groups a
 * cylinder has ([side, top, bottom]), so nothing downstream changes: the
 * InstancedMesh still draws every chip of a denomination in one call, and
 * the extra vertices are paid for once for the entire session, not per
 * chip.
 */

import * as THREE from "three";
import type { ChipDenomination } from "@/lib/game3d/denominations";
import { CHIP } from "@/lib/game3d/dimensions";
import {
  chipEdgeBumpTexture,
  chipEdgeRoughnessTexture,
  chipEdgeTexture,
  chipFaceBumpTexture,
  chipFaceRoughnessTexture,
  chipFaceTexture,
} from "./chip-textures";

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

/**
 * Segment count is up from 24 because the disc is now small on screen: a
 * silhouette this size shows faceting immediately, and 40 short segments on
 * one shared geometry costs nothing.
 */
const RADIAL_SEGMENTS = 40;

/** Material-group order, matching CylinderGeometry's so the material array
 * fed to every InstancedMesh keeps the shape it always had. */
const SIDE_GROUP = 0;
const TOP_GROUP = 1;
const BOTTOM_GROUP = 2;

/**
 * The chip lathed from its real profile: flat face, rounded break, straight
 * wall, rounded break, flat face.
 *
 * Normals are written rather than computed. `computeVertexNormals` would
 * average across the wrap seam (where the last angular column meets the
 * first, which are distinct vertices) and leave a visible line down every
 * chip; stating the profile normal per ring gives a clean rounded rim and
 * is what a lathe would produce analytically anyway.
 */
function bevelledChipGeometry(): THREE.BufferGeometry {
  const radius = CHIP.radius;
  const half = CHIP.thickness / 2;
  const bevel = Math.min(CHIP.bevel, half * 0.9, radius * 0.5);
  const inner = radius - bevel;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const sideIndices: number[] = [];
  const topIndices: number[] = [];
  const bottomIndices: number[] = [];

  // Profile from top to bottom, as (radius, y) pairs with the surface
  // normal's radial/vertical split. 22.5 and 67.5 degrees split each
  // quarter-round break into a smooth two-step rather than one hard 45.
  const COS_22 = Math.cos(Math.PI / 8);
  const SIN_22 = Math.sin(Math.PI / 8);
  const profile = [
    { r: inner, y: half, nr: SIN_22, ny: COS_22 },
    { r: radius, y: half - bevel, nr: COS_22, ny: SIN_22 },
    { r: radius, y: -half + bevel, nr: COS_22, ny: -SIN_22 },
    { r: inner, y: -half, nr: SIN_22, ny: -COS_22 },
  ];

  // v runs 0 at the bottom rim to 1 at the top, by arc length along the
  // profile, so the edge strip's art is not stretched over the breaks.
  const spans = [
    Math.hypot(bevel, bevel),
    CHIP.thickness - 2 * bevel,
    Math.hypot(bevel, bevel),
  ];
  const total = spans[0] + spans[1] + spans[2];
  const v = [1, (spans[1] + spans[2]) / total, spans[2] / total, 0];

  // --- the side: three bands over four rings ---
  const sideStart = positions.length / 3;
  for (let ix = 0; ix <= RADIAL_SEGMENTS; ix += 1) {
    const u = ix / RADIAL_SEGMENTS;
    const theta = u * Math.PI * 2;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    for (let iy = 0; iy < profile.length; iy += 1) {
      const point = profile[iy];
      positions.push(sin * point.r, point.y, cos * point.r);
      normals.push(sin * point.nr, point.ny, cos * point.nr);
      uvs.push(u, v[iy]);
    }
  }
  for (let ix = 0; ix < RADIAL_SEGMENTS; ix += 1) {
    for (let iy = 0; iy < profile.length - 1; iy += 1) {
      const a = sideStart + ix * profile.length + iy;
      const b = a + 1;
      const d = sideStart + (ix + 1) * profile.length + iy;
      const c = d + 1;
      sideIndices.push(a, b, d, b, c, d);
    }
  }

  // --- the caps: one centre vertex and the flat disc out to `inner` ---
  const cap = (y: number, top: boolean, indices: number[]) => {
    const centreIndex = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, top ? 1 : -1, 0);
    uvs.push(0.5, 0.5);

    const ringStart = positions.length / 3;
    for (let ix = 0; ix <= RADIAL_SEGMENTS; ix += 1) {
      const theta = (ix / RADIAL_SEGMENTS) * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      positions.push(sin * inner, y, cos * inner);
      normals.push(0, top ? 1 : -1, 0);
      // Unit-circle UVs, exactly CylinderGeometry's cap mapping, so the
      // painted face art fills the flat disc it was drawn for.
      uvs.push(cos * 0.5 + 0.5, sin * 0.5 * (top ? 1 : -1) + 0.5);
    }
    for (let ix = 0; ix < RADIAL_SEGMENTS; ix += 1) {
      const i = ringStart + ix;
      if (top) indices.push(i, i + 1, centreIndex);
      else indices.push(i + 1, i, centreIndex);
    }
  };
  cap(half, true, topIndices);
  cap(-half, false, bottomIndices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...sideIndices, ...topIndices, ...bottomIndices]);
  geometry.addGroup(0, sideIndices.length, SIDE_GROUP);
  geometry.addGroup(sideIndices.length, topIndices.length, TOP_GROUP);
  geometry.addGroup(sideIndices.length + topIndices.length, bottomIndices.length, BOTTOM_GROUP);
  return geometry;
}

export const chipGeometry = bevelledChipGeometry();

/**
 * How deep the moulded detail reads. Tiny in absolute terms because the
 * chip itself is ~0.04 world units across — a bump scale tuned by eye on a
 * unit cube would emboss a chip like a coin.
 */
const BUMP_SCALE = 0.014;

/** Cylinder material order is [side, top, bottom]. */
const materialCache = new Map<number, THREE.Material[]>();

export function chipMaterials(denom: ChipDenomination): THREE.Material[] {
  const cached = materialCache.get(denom.value);
  if (cached) return cached;
  // Roughness comes from a map, so the scalar is left at 1 and modulated by
  // it — three multiplies the two, and any scalar under 1 would silently
  // cap the map's matte end. Metalness stays a scalar: clay is not a metal
  // anywhere on the chip, and a map of zeroes is a texture fetch per
  // fragment for no information.
  const side = new THREE.MeshStandardMaterial({
    map: chipEdgeTexture(denom),
    roughnessMap: chipEdgeRoughnessTexture(denom),
    bumpMap: chipEdgeBumpTexture(denom),
    bumpScale: BUMP_SCALE,
    roughness: 1,
    metalness: 0.02,
  });
  const face = new THREE.MeshStandardMaterial({
    map: chipFaceTexture(denom),
    roughnessMap: chipFaceRoughnessTexture(denom),
    bumpMap: chipFaceBumpTexture(denom),
    bumpScale: BUMP_SCALE,
    roughness: 1,
    metalness: 0.02,
  });
  const materials = [side, face, face];
  materialCache.set(denom.value, materials);
  return materials;
}
