"use client";

/**
 * Turns a modelled prop into something a real-time scene can afford.
 *
 * THE PROBLEM THESE ASSETS ARRIVE WITH. The chip props are authored as scene
 * dumps, not game assets: every single chip is thirteen separate nodes (a
 * body, six edge spots, two rim grooves, two face inlays, two inlay rings),
 * and a heap repeats that hundreds of times. Measured off the files
 * themselves:
 *
 *     poker-chips-all-in.glb      2444 mesh nodes    864,800 triangles
 *     poker-chips-mid.glb          585 mesh nodes    207,000 triangles
 *     poker-chips-player-set.glb   468 mesh nodes    165,600 triangles
 *     poker-chips-short.glb         91 mesh nodes     32,200 triangles
 *
 * Mounted as authored, six seats would issue thousands of draw calls a frame
 * to draw chips that are twenty pixels across. Nothing about the art is
 * wrong — it is simply not packed for a renderer.
 *
 * WHAT THIS DOES ABOUT IT, IN TWO INDEPENDENT STEPS.
 *
 * 1. INSTANCING, which costs nothing and changes nothing visually. Those
 *    thousands of nodes reuse only eight to twelve distinct meshes, so every
 *    node sharing a (geometry, material) pair collapses into one
 *    InstancedMesh carrying its transform. A player's set goes from 468 draw
 *    calls to twelve, and the picture is identical to the pixel.
 *
 * 2. A DETAIL LEVEL, which is a real trade and is therefore named and
 *    defaulted rather than hidden. 84% of a chip's triangles are in two
 *    features — `rim_groove` at 1024 triangles each and `inlay_ring` at 896 —
 *    against a `chip_body` silhouette of 256. Both are sub-pixel at table
 *    distance. Dropping them cuts a player's set from 165,600 triangles to
 *    27,360, a little over 6x, while keeping the body, the face inlay and the
 *    edge spots, which are the parts that actually read.
 *
 * The two are separable on purpose: instancing is free and always on, and
 * the detail level is one argument. A session tuning performance can move
 * `PROP_DETAIL` or add a tier without touching placement, and a session
 * judging the art can set "full" and see exactly what the artist exported.
 *
 * NOTHING HERE MUTATES THE CACHED GLTF. drei hands back one shared scene per
 * URL and six seats read it; geometries are referenced, not cloned, and
 * material adjustments go through a module cache keyed on the source
 * material's uuid, so the same adjusted material is shared by every seat
 * rather than cloned per mount.
 */

import * as THREE from "three";

/**
 * "full" renders the asset exactly as exported. "table" drops the two
 * decorative features that carry most of the triangles and none of the
 * silhouette — see the header for the measurements.
 */
export type PropDetail = "full" | "table";

/**
 * Node names dropped at "table" detail. Matched on the glTF NODE name, which
 * is what the exporter kept meaningful here (every mesh name in these files
 * is the empty string, so a mesh-name match would drop everything or
 * nothing).
 */
const OMITTED_AT_TABLE_DETAIL = new Set(["rim_groove", "inlay_ring"]);

/**
 * Strip the suffix GLTFLoader adds to make duplicate node names unique.
 *
 * THIS IS LOAD-BEARING AND ITS ABSENCE IS SILENT. These files name all 72
 * copies of a feature `rim_groove`; three's `createUniqueName` renames them
 * `rim_groove`, `rim_groove_1`, `rim_groove_2` and so on, so an exact-match
 * set drops exactly ONE of each and leaves the other 71. Caught on a render —
 * the first cut reported 583 of 585 nodes still drawn while the detail level
 * appeared to be doing its job, because the picture is identical either way
 * and only the triangle count says otherwise. Anything that filters these
 * assets by name has to normalise first.
 *
 * `edge_spot_0` keeps its meaning under this: it normalises to `edge_spot`,
 * which is not in the set, so the spots survive as intended.
 */
function baseNodeName(name: string): string {
  return name.replace(/(_\d+)+$/, "");
}

/**
 * The room's default. "table" — the props are viewed from about two metres
 * at a steep angle, which is exactly the condition the dropped features
 * cannot survive anyway.
 */
export const PROP_DETAIL: PropDetail = "table";

/**
 * A roughness floor, for the same reason glb-avatar.tsx carries one: these
 * exports were authored for a soft many-light preview, and under this room's
 * single hard spotlight a low-roughness clay chip returns a broad mirror
 * highlight that reads as wet plastic. Clamping rather than assigning keeps
 * whatever relative ordering the artist authored — only the top of the range
 * is pulled back.
 */
const CLAY_ROUGHNESS_FLOOR = 0.45;
const CLAY_METALNESS_CEILING = 0.12;

/** Adjusted materials, shared across every seat that mounts the same prop. */
const materialCache = new Map<string, THREE.Material>();

function tableMaterial(source: THREE.Material): THREE.Material {
  const cached = materialCache.get(source.uuid);
  if (cached) return cached;
  const clone = source.clone();
  const standard = clone as THREE.MeshStandardMaterial;
  if (typeof standard.roughness === "number") {
    standard.roughness = Math.max(standard.roughness, CLAY_ROUGHNESS_FLOOR);
  }
  if (typeof standard.metalness === "number") {
    standard.metalness = Math.min(standard.metalness, CLAY_METALNESS_CEILING);
  }
  materialCache.set(source.uuid, clone);
  return clone;
}

export interface InstancedPropStats {
  /** Mesh nodes found in the source graph. */
  sourceNodes: number;
  /** Nodes actually drawn after the detail filter. */
  drawnNodes: number;
  /** InstancedMesh objects emitted — the real draw-call count. */
  batches: number;
  /** Triangles drawn per frame, counting every instance. */
  triangles: number;
}

export interface InstancedProp {
  group: THREE.Group;
  stats: InstancedPropStats;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return index.count / 3;
  const position = geometry.getAttribute("position");
  return position ? position.count / 3 : 0;
}

export interface BuildPropOptions {
  detail?: PropDetail;
  /**
   * Extra node names to leave out, on top of whatever the detail level drops.
   *
   * Exists so a caller can decline a piece of an asset — the hole-card prop's
   * `table_pad` swatch, redundant on a table that already has cloth — WITHOUT
   * mutating drei's shared scene graph. Detaching the child instead would
   * drop it for every other consumer of the same URL, which is the kind of
   * action-at-a-distance that only shows up at the second mount site.
   */
  omitNodes?: readonly string[];
}

/**
 * Flatten `source` into one InstancedMesh per (geometry, material) pair.
 *
 * Transforms are captured relative to `source` itself, not to the world, so
 * the returned group can be positioned and scaled by its caller like any
 * other object — the prop does not care where the seat is.
 */
export function buildInstancedProp(
  source: THREE.Object3D,
  options: BuildPropOptions = {},
): InstancedProp {
  const detail = options.detail ?? PROP_DETAIL;
  const omitNodes = new Set(options.omitNodes ?? []);
  source.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(source.matrixWorld).invert();

  interface Batch {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
    matrices: THREE.Matrix4[];
  }
  const batches = new Map<string, Batch>();
  let sourceNodes = 0;
  let drawnNodes = 0;

  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    sourceNodes++;
    const name = baseNodeName(mesh.name);
    if (omitNodes.has(name)) return;
    if (detail === "table" && OMITTED_AT_TABLE_DETAIL.has(name)) return;
    // A multi-material mesh would need one batch per group; these assets have
    // none, and silently drawing only the first material would be a picture
    // bug nobody could trace. Leave it out of the batch and say so.
    if (Array.isArray(mesh.material)) return;
    drawnNodes++;

    const material = tableMaterial(mesh.material);
    const key = `${mesh.geometry.uuid}|${material.uuid}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { geometry: mesh.geometry, material, matrices: [] };
      batches.set(key, batch);
    }
    batch.matrices.push(new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
  });

  const group = new THREE.Group();
  let triangles = 0;
  for (const batch of batches.values()) {
    const instanced = new THREE.InstancedMesh(
      batch.geometry,
      batch.material,
      batch.matrices.length,
    );
    batch.matrices.forEach((matrix, i) => instanced.setMatrixAt(i, matrix));
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    // These props never move once placed, so three can skip re-deriving their
    // world matrix every frame.
    instanced.matrixAutoUpdate = false;
    // The bounding sphere three computes for an InstancedMesh comes from the
    // source geometry, which here is ONE chip at the origin — so a heap
    // spread across half a metre would be culled the moment that single chip
    // left the frustum, taking the whole pile with it. Computing it from the
    // instances is what keeps a stack on screen at the frame edges.
    instanced.computeBoundingSphere();
    group.add(instanced);
    triangles += triangleCount(batch.geometry) * batch.matrices.length;
  }

  return {
    group,
    stats: {
      sourceNodes,
      drawnNodes,
      batches: batches.size,
      triangles: Math.round(triangles),
    },
  };
}

/**
 * Release the InstancedMesh objects a built prop owns.
 *
 * CALL THIS ONLY FROM THE EFFECT THAT BUILT THE PROP. It ends in
 * `group.clear()`, so it does not merely free GPU handles — it empties the
 * group, permanently, and nothing rebuilds it. Pairing it with a
 * `useMemo`-built prop is therefore a live bug rather than a tidiness point:
 * React is free to run an effect's cleanup and then mount it again with the
 * same memoized value (StrictMode's double-mount, a Suspense boundary hiding
 * and re-revealing — and every caller here sits inside one, because useGLTF
 * suspends). That sequence emptied the group `<primitive>` was still holding,
 * and every chip pile and face-down pair silently disappeared while their
 * stats, shadows and seats all stayed correct.
 *
 * It looked like a driver bug and was not: which group survived depended on
 * suspend/re-render interleaving, so the same code drew the props under
 * headless SwiftShader and drew nothing on a real GPU. Both callers now build
 * inside the effect that disposes, against a stable container — see
 * seat-bankrolls.tsx.
 */
export function disposeInstancedProp(prop: InstancedProp): void {
  prop.group.traverse((object) => {
    const instanced = object as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) instanced.dispose();
  });
  prop.group.clear();
  // Geometries and materials are deliberately NOT disposed: both are shared
  // with drei's cached gltf and with every other seat mounting the same prop,
  // so disposing them here would blank the props at the other five chairs.
}
