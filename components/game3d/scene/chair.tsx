"use client";

/**
 * <Chair> — a plain seat back and pan behind each figure, so a real .glb
 * character sitting in one place reads as sitting IN something rather than
 * floating over the felt. Deliberately simple: a padded pan, a backrest,
 * two visible front legs (the rear legs and most of the seat live behind
 * the rail from every camera angle at this table, so they are skipped
 * rather than modelled and never seen).
 *
 * The old CSS-era room had chairs and dropped them — its comment in
 * poker-scene.tsx says the near-side backrests cut hard, flat-shaded edges
 * across the rail's corner. That was a painter's-algorithm/2D-quad problem
 * (the sprite seats and their chairs had no shared depth buffer with the
 * table); real geometry sharing one WebGL depth buffer with Table3D doesn't
 * have that failure mode, which is what makes bringing chairs back safe now.
 *
 * Sized and placed against dimensions.ts and seat-layout.ts rather than by
 * eye where those give a real number (seat height ~ real chair-seat height,
 * matched loosely against where a sitting figure's hips land); the exact
 * pan height is still tuned against a render like the avatar's own scale.
 */

import { useMemo } from "react";
import * as THREE from "three";
import { UNITS_PER_METRE_Y } from "@/lib/game3d/dimensions";

/**
 * A CHAIR IS BUILT ON THE CHARACTER'S RULER, NOT THE FELT'S, and getting
 * that wrong is what made the first version a doll's chair.
 *
 * dimensions.ts's `mm()` converts through UNITS_PER_METRE, which is derived
 * from the felt's length — correct for a chip or a card, which the eye
 * judges against the cloth they lie on. A chair is judged against the person
 * sitting in it, and glb-avatar scales that person by UNITS_PER_METRE_Y,
 * the ruler the table's *height* actually has. In a room where those two
 * disagree by 1.76x (see UNITS_PER_METRE_Y), a chair measured through `mm()`
 * would come out nearly twice the width of its own sitter. So every number
 * below is real furniture in metres, through the same ruler the sitter uses.
 */
function chairM(metres: number): number {
  return metres * UNITS_PER_METRE_Y;
}

/**
 * Top of the seat pan cushion — a real 0.45 m chair seat. glb-avatar posts
 * each rig's *posed* hip bone onto this plane, so this single number is what
 * decides where six differently-authored characters all sit; it is not a
 * value to nudge by eye against one seat's render.
 */
export const CHAIR_SEAT_Y = chairM(0.45);
/**
 * A real dining/casino chair: 0.46 m across, 0.45 m deep, with the backrest
 * reaching ~0.87 m off the floor — shoulder-blade height on a seated adult,
 * not over their head. The earlier 0.42/0.34/0.3 triple was tuned against
 * characters that were themselves ~40% undersized, so it inherited their
 * error; sizing from the furniture instead means the chair cannot drift
 * again the next time the avatar scale is corrected.
 */
const SEAT_WIDTH = chairM(0.46);
const SEAT_DEPTH = chairM(0.45);
const SEAT_THICKNESS = chairM(0.06);
const BACK_HEIGHT = chairM(0.42);
/** Extra clearance behind the hip bone so the pad doesn't clip a spine/hair. */
const BACK_MARGIN = chairM(0.05);
const BACK_THICKNESS = chairM(0.05);
/** Backrest leans back a little, like a real chair rather than a school one. */
const BACK_TILT = -0.12;
const LEG_RADIUS = chairM(0.022);
const LEG_HEIGHT = CHAIR_SEAT_Y - SEAT_THICKNESS;

export function Chair() {
  const woodMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#2c1c12", roughness: 0.55, metalness: 0.05 }),
    []
  );
  const padMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a1f22", roughness: 0.85 }),
    []
  );

  return (
    <group>
      {/* Seat pan */}
      <mesh
        position={[0, CHAIR_SEAT_Y - SEAT_THICKNESS / 2, 0]}
        material={padMaterial}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[SEAT_WIDTH, SEAT_THICKNESS, SEAT_DEPTH]} />
      </mesh>
      {/* Backrest, behind the seat. +Z is toward the table centre once the
          parent group has already been rotated to face the table, so the
          back — away from the table, behind the sitter — is −Z. (First cut
          had this sign flipped, which put the backrest between the camera
          and the far seat's character and occluded them entirely.) */}
      <mesh
        position={[0, CHAIR_SEAT_Y + BACK_HEIGHT / 2, -SEAT_DEPTH / 2 - BACK_MARGIN]}
        rotation={[BACK_TILT, 0, 0]}
        material={padMaterial}
        castShadow
      >
        <boxGeometry args={[SEAT_WIDTH, BACK_HEIGHT, BACK_THICKNESS]} />
      </mesh>
      {/* Two front legs, on the table-facing (+Z) side — the only pair a
          camera ever has a sightline to. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[(side * SEAT_WIDTH) / 2 - side * LEG_RADIUS, LEG_HEIGHT / 2, SEAT_DEPTH / 2 - LEG_RADIUS]}
          material={woodMaterial}
          castShadow
        >
          <cylinderGeometry args={[LEG_RADIUS, LEG_RADIUS, LEG_HEIGHT, 8]} />
        </mesh>
      ))}
    </group>
  );
}
