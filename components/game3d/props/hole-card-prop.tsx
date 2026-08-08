"use client";

/**
 * <HoleCardProp> — a modelled face-down pair, from public/props/hole-cards.glb.
 *
 * LIVE, for every opponent seat still holding an unrevealed pair —
 * scene/poker-scene.tsx mounts one per seat where
 * lib/game3d/scene-model.ts's `seatHoleCardsHidden` is true. The local
 * player's own pair never uses this: it renders face up, off the felt, as
 * DOM (hud/own-hole-cards.tsx) — this prop has no card faces in it at all.
 * A seat's pair switches to the atlas texture renderer
 * (scene/cards-instanced.tsx) the moment it is actually revealed (a
 * showdown); `seatHoleCardsHidden` is the one predicate both files key off,
 * so the two can never draw the same seat at once or leave one undrawn.
 *
 * WHAT IT BUYS OVER A TEXTURE. scene/cards-3d.tsx's plane-geometry
 * fallback (kept mounted-but-commented as an A/B) draws a face-down card as
 * a zero-thickness plate with a generated back texture. This asset is real
 * card stock — 0.3 mm of edge, a printed crimson lattice back, and a
 * leather pad under the pair — at 6,312 triangles for the whole thing,
 * which is cheap enough that all six seats cost less than a tenth of one
 * chip pile. On a table lit by a single hard spotlight, the edge is the
 * difference between cards lying on the felt and cards printed onto it.
 *
 * THE PAD IS OPTIONAL AND OFF BY DEFAULT. The .glb ships a `table_pad` mesh
 * under the cards — a felt swatch that made sense in the artist's own scene
 * and is redundant on a table that already has cloth, where it reads as a
 * darker rectangle floating under each pair.
 */

import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { UNITS_PER_METRE, mm } from "@/lib/game3d/dimensions";
import type { SeatModel } from "@/lib/game3d/scene-model";
import {
  faceCentreRotationY,
  holeCardPosition,
  type Vec3,
} from "@/lib/game3d/seat-layout";
import { buildInstancedProp, disposeInstancedProp } from "./instanced-prop";

export const HOLE_CARD_PROP_URL = "/props/hole-cards.glb";

/** Lies on the cloth, so it is sized by the horizontal ruler like every prop. */
const PROP_SCALE = UNITS_PER_METRE;

/**
 * Lifts the pair's base a hair off FELT_TOP_Y — see seat-bankrolls.tsx's
 * identical PROP_LIFT for the full reasoning: at zero lift this prop's
 * base is exactly coplanar with the felt's own top face, which a real GPU
 * resolves as invisible z-fighting rather than "the prop is on top."
 */
const PROP_LIFT = mm(2);

/** The artist's felt swatch under the pair — redundant on a real table. */
const PAD_NODE_NAME = "table_pad";

export function HoleCardProp({
  seat,
  showPad = false,
}: {
  seat: SeatModel;
  showPad?: boolean;
}) {
  if (!seat.inHand || seat.holeCards.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <HoleCardPropModel
        spot={holeCardPosition(seat.slot)}
        showPad={showPad}
      />
    </Suspense>
  );
}

function HoleCardPropModel({ spot, showPad }: { spot: Vec3; showPad: boolean }) {
  // (url, useDraco, useMeshopt) — Meshopt on, Draco off, matching every other
  // .glb in this tree now that scripts/compress-3d-assets.sh encodes them all.
  // See glb-avatar.tsx for why the two decoders are not treated alike.
  const { scene } = useGLTF(HOLE_CARD_PROP_URL, false, true);

  /*
   * The pair is built INSIDE the effect that disposes it, and <primitive>
   * mounts a stable empty container instead — see seat-bankrolls.tsx's
   * identical container for the full reasoning. Short version: building in
   * a `useMemo` and clearing in an effect cleanup lets React empty the group
   * `<primitive>` still points at (StrictMode's double-mount, or this very
   * Suspense boundary re-revealing), with nothing left to rebuild it. Both
   * props were invisible on a real GPU because of it.
   */
  const container = useMemo(() => new THREE.Group(), []);

  useEffect(() => {
    // Declining the pad goes through the loader's own omit list rather than by
    // touching the scene graph — `scene` is drei's shared cache, and detaching
    // a child would drop the pad for every other consumer of this URL.
    const built = buildInstancedProp(scene, {
      omitNodes: showPad ? [] : [PAD_NODE_NAME],
      // Cards, not chips: the detail level exists to thin out repeated
      // chip ornament, and there is none of that here. Nine meshes total.
      detail: "full",
    });
    container.add(built.group);
    return () => {
      container.remove(built.group);
      disposeInstancedProp(built);
    };
  }, [scene, showPad, container]);

  return (
    <group
      position={[spot.x, spot.y + PROP_LIFT, spot.z]}
      rotation={[0, faceCentreRotationY(spot), 0]}
      scale={PROP_SCALE}
    >
      <primitive object={container} />
    </group>
  );
}

if (typeof window !== "undefined") {
  // Flags must match the hook's exactly — the preload path builds its own
  // loader. See glb-avatar.tsx.
  useGLTF.preload(HOLE_CARD_PROP_URL, false, true);
}
