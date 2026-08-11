"use client";

/**
 * The physical table: an elliptical felt plate on a padded rail over a
 * pedestal, plus the floor that catches everyone's shadows and is also, at
 * this camera, the entire background environment (see
 * lib/game3d/floor-environment.ts for why there is no wall behind it).
 *
 * Static geometry only — no per-frame work happens here. The carpet's
 * geometry is built once per mount and disposed on unmount; nothing in this
 * file allocates, mutates or invalidates after the first frame, which is
 * what keeps the environment out of the frame budget entirely.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
} from "@/lib/game3d/seat-layout";
import {
  FLOOR_RADIUS,
  FLOOR_RINGS,
  FLOOR_SEGMENTS,
  carpetColorAt,
} from "@/lib/game3d/floor-environment";

const FELT_THICKNESS = 0.05;
const SKIRT_HEIGHT = 0.16;

/**
 * The floor, as a ring-subdivided disc carrying its gradient in vertex
 * colours.
 *
 * A `circleGeometry` is a fan: one centre vertex and one rim, so it can hold
 * exactly two colours and no falloff between them. This lays down the ring
 * radii `FLOOR_RINGS` asks for — dense where the carpet is lit, sparse out
 * in the dark where it is one flat value anyway — and colours every vertex
 * from the same `carpetColorAt` the tests measure. 432 triangles, one
 * material, one draw call: the same budget the flat disc had.
 *
 * WHY THE COLOURS GO THROUGH `THREE.Color` RATHER THAN STRAIGHT INTO THE
 * BUFFER. A vertex colour attribute is read as already being in the
 * renderer's working (linear) space, while `material.color.set("#rrggbb")`
 * converts from sRGB on the way in. Writing the hex values raw would render
 * every stop markedly darker than the literal says — and on a palette that
 * is already nearly black, "markedly darker" is "gone", with nothing on
 * screen to suggest a colour-space bug rather than a bad colour choice.
 * `setRGB(..., SRGBColorSpace)` makes the literals mean what they read as.
 */
function CarpetFloor() {
  const geometry = useMemo(() => {
    const radii = FLOOR_RINGS.map((ring) => ring * FLOOR_RADIUS);
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const scratch = new THREE.Color();

    const push = (radius: number, angle: number) => {
      positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      normals.push(0, 1, 0);
      const rgb = carpetColorAt(radius);
      scratch.setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace);
      colors.push(scratch.r, scratch.g, scratch.b);
    };

    // Centre, then one closed ring of vertices per radius after it.
    push(radii[0], 0);
    for (let ring = 1; ring < radii.length; ring += 1) {
      for (let segment = 0; segment < FLOOR_SEGMENTS; segment += 1) {
        push(radii[ring], (segment / FLOOR_SEGMENTS) * Math.PI * 2);
      }
    }

    const ringStart = (ring: number) => 1 + (ring - 1) * FLOOR_SEGMENTS;
    // Fan from the centre out to the first ring.
    for (let segment = 0; segment < FLOOR_SEGMENTS; segment += 1) {
      const next = (segment + 1) % FLOOR_SEGMENTS;
      indices.push(0, ringStart(1) + next, ringStart(1) + segment);
    }
    // Quads between every consecutive pair of rings after that.
    for (let ring = 1; ring < radii.length - 1; ring += 1) {
      const inner = ringStart(ring);
      const outer = ringStart(ring + 1);
      for (let segment = 0; segment < FLOOR_SEGMENTS; segment += 1) {
        const next = (segment + 1) % FLOOR_SEGMENTS;
        indices.push(inner + segment, outer + next, outer + segment);
        indices.push(inner + segment, inner + next, outer + next);
      }
    }

    const built = new THREE.BufferGeometry();
    built.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    built.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    built.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    built.setIndex(indices);
    return built;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} receiveShadow>
      {/* White base colour so the vertex ramp IS the albedo rather than
          being multiplied down by a second tint. Still Standard, not Basic,
          because this is the surface the whole cast-shadow pass lands on —
          the shadow pool under the near rail is what the near players'
          faded lower halves disappear into, and an unlit material receives
          nothing. */}
      <meshStandardMaterial vertexColors color="#ffffff" roughness={1} metalness={0} />
    </mesh>
  );
}

export function Table3D() {
  return (
    <group>
      {/* Floor — everything's shadows land here and on the felt, and at this
          camera it is also the whole background: the frustum never reaches
          the horizon, so there is nothing behind the table to put a wall on.
          Its radius is solved from the framing rather than written down; the
          literal 9 it replaces was already 0.6 units narrower than the frame
          at 2560x1080. */}
      <CarpetFloor />

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
