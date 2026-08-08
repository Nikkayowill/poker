"use client";

/**
 * The physical table: an elliptical felt plate on a padded rail over a
 * pedestal, plus the floor that catches everyone's shadows. Static geometry
 * only — no per-frame work happens here.
 */

import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
} from "@/lib/game3d/seat-layout";

const FELT_THICKNESS = 0.05;
const SKIRT_HEIGHT = 0.16;

export function Table3D() {
  return (
    <group>
      {/* Floor — one big disc; everything's shadows land here and on the
          felt. Darker than it was: with the camera raised, far more floor
          sits in front of the table, and that foreground is where the
          near players' faded lower halves have to disappear. A floor the
          light can lift to grey turns their falloff into a visible cut. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[9, 48]} />
        <meshStandardMaterial color="#0a080d" roughness={1} metalness={0} />
      </mesh>

      {/* Padded rail: a raised leather ring riding the felt's edge. A torus,
          not a solid plate — a plate whose top sits above the felt hides the
          entire cloth (measured on a real render, not hypothetical). */}
      <mesh
        position={[0, FELT_TOP_Y + 0.005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[FELT_RADIUS_X, FELT_RADIUS_Z, 1]}
        castShadow
        receiveShadow
      >
        <torusGeometry args={[1, 0.075, 14, 64]} />
        <meshStandardMaterial color="#2b1f15" roughness={0.5} metalness={0.05} />
      </mesh>

      {/* Table skirt: the body below the cloth, seen from the side. */}
      <mesh
        position={[0, FELT_TOP_Y - 0.02 - SKIRT_HEIGHT / 2, 0]}
        scale={[FELT_RADIUS_X * 1.05, 1, FELT_RADIUS_Z * 1.05]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[1, 1.03, SKIRT_HEIGHT, 56]} />
        <meshStandardMaterial color="#241a12" roughness={0.55} metalness={0.05} />
      </mesh>

      {/* The felt itself. The table stays green — chrome rules don't reach the cloth. */}
      <mesh
        position={[0, FELT_TOP_Y - FELT_THICKNESS / 2, 0]}
        scale={[FELT_RADIUS_X, 1, FELT_RADIUS_Z]}
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, FELT_THICKNESS, 56]} />
        <meshStandardMaterial color="#1c5c40" roughness={0.92} metalness={0} />
      </mesh>

      {/* Inner betting-line ring, painted as a thin darker ellipse. */}
      <mesh
        position={[0, FELT_TOP_Y + 0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[FELT_RADIUS_X * 0.72, FELT_RADIUS_Z * 0.72, 1]}
      >
        <ringGeometry args={[0.985, 1, 64]} />
        <meshBasicMaterial color="#14452f" />
      </mesh>

      {/* Pedestal and base. */}
      <mesh position={[0, (FELT_TOP_Y - SKIRT_HEIGHT) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.75, FELT_TOP_Y - SKIRT_HEIGHT, 24]} />
        <meshStandardMaterial color="#1b1420" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[1.15, 1.25, 0.06, 32]} />
        <meshStandardMaterial color="#100c14" roughness={0.8} />
      </mesh>
    </group>
  );
}
