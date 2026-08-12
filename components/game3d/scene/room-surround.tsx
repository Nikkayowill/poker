"use client";

/**
 * <RoomSurround> — a modelled brass-and-wood casino rail standing around the
 * table, from public/environments/stackchips-room-surround.glb.
 *
 * WHY THIS EXISTS DESPITE floor-environment.ts's "no wall is possible."
 * That file's claim still holds — `horizonInFrame` is false at every shipped
 * aspect, so a wall standing at the floor's own rim (this asset's `walls`
 * group, radius ~5.58, top ~3.38) is drawn almost entirely off the TOP of
 * the frame, the same way a backdrop plate would have been. What is NOT off
 * screen is the shorter, closer `balustrade` ring (radius ~3.55, top ~1.18)
 * — verified geometrically, not assumed: sampling both rings at 16 angles
 * against `frameCamera`'s actual frustum at every shipped aspect shows the
 * balustrade's TOP visible from a real fraction of angles at every aspect,
 * while the wall's top is visible from none of them, at any aspect. So this
 * component mounts the whole asset — cheap enough (5,378 triangles, 13
 * nodes total) that the invisible parts cost nothing worth trimming for —
 * and the balustrade is what actually reads on screen as "a real railing",
 * with the walls/bar/pendants as a same-palette bonus for whatever sliver of
 * frame or bounce light they contribute.
 *
 * WHAT WAS DELIBERATELY LEFT OUT: `carpet_ring`, the asset's own flat brown
 * floor disc. It sits exactly coplanar with table-3d.tsx's `CarpetFloor` at
 * y=0 out past the same radius, which is a z-fighting pair on a real GPU,
 * and it cannot repaint itself when `RoomTheme` changes the way
 * `carpetColorAt` does — so a theme swap would leave a static brown ring
 * showing through a re-coloured carpet. The floor stays exactly what
 * floor-environment.ts already solved.
 *
 * NOT ROUTED THROUGH `buildInstancedProp` (props/instanced-prop.ts). That
 * helper's `tableMaterial()` clamp is tuned for the chip roster's clay
 * finish (metalness ceiling 0.12) and would dull this asset's brass trim
 * (authored at 0.35) to the same flatness — the wrong trade for a railing
 * that is supposed to catch the spot. There is also nothing here instancing
 * would collapse: 13 mesh nodes, none repeated. A plain recursive clone into
 * a stable container is the whole job, and it is the SAME container/cleanup
 * shape as `HoleCardProp` for the same reason — see that file's header:
 * building inside the effect that disposes, into a container that survives
 * StrictMode's mount→cleanup→mount, is what keeps the double-mount from
 * silently emptying the group `<primitive>` still points at.
 *
 * Materials are left exactly as authored — no clamp, no tint. The palette
 * (`room_wall` #241a1a, `room_carpet` #18110d) already lands in the same
 * warm-brown family as `after_dark`'s own carpet stops, and `room_glow`
 * (emissive amber, intensity 2.2) lights the pendant/bar strips on its own
 * regardless of scene light — a small bit of free atmosphere at the edge of
 * frame.
 */

import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { mm } from "@/lib/game3d/dimensions";

export const ROOM_SURROUND_URL = "/environments/stackchips-room-surround.glb";

/** The asset's own floor disc — dropped; see the header. */
const OMIT_NODE = "carpet_ring__room_carpet";

/**
 * Clears the group off the procedural CarpetFloor's own y=0 plane so the two
 * don't resolve as a coin-flip on a real depth buffer — same reasoning as
 * every other `PROP_LIFT` in this tree (seat-bankrolls.tsx, hole-card-prop.tsx).
 */
const SURROUND_LIFT = mm(3);

function RoomSurroundModel() {
  // (url, useDraco, useMeshopt) — matches every other .glb in this tree; see
  // glb-avatar.tsx for why the two decoders aren't treated alike. This asset
  // ships no textures at all (five flat PBR materials, no images), so
  // neither decoder actually does anything here — the flags are set for
  // consistency with the rest of the loader config, not because this file
  // needs them.
  const { scene } = useGLTF(ROOM_SURROUND_URL, false, true);

  // Stable, empty container — see HoleCardProp's identical one for why this
  // specific shape (build inside the effect that disposes, into a container
  // that outlives both) is required rather than a `useMemo`-built clone.
  const container = useMemo(() => new THREE.Group(), []);

  useEffect(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name === OMIT_NODE) {
        mesh.visible = false;
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    container.add(clone);
    return () => {
      container.remove(clone);
      // Geometries/materials are NOT disposed here — both are owned by
      // drei's cached gltf for this URL and shared with the clone this
      // effect just tore down; disposing them would blank a second mount
      // of the same asset. Same rule as disposeInstancedProp's own note.
    };
  }, [scene, container]);

  return (
    <group position={[0, SURROUND_LIFT, 0]}>
      <primitive object={container} />
    </group>
  );
}

/** Mounted once, at the room's origin — this is scenery, not a per-seat prop. */
export function RoomSurround() {
  return (
    <Suspense fallback={null}>
      <RoomSurroundModel />
    </Suspense>
  );
}

if (typeof window !== "undefined") {
  // Flags must match the hook's exactly — the preload path builds its own
  // loader. See glb-avatar.tsx.
  useGLTF.preload(ROOM_SURROUND_URL, false, true);
}
