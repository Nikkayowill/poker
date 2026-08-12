"use client";

/**
 * The physical table: an elliptical felt plate on a padded rail over a
 * pedestal, plus the floor that catches everyone's shadows and is also, at
 * this camera, most of the background environment (see
 * lib/game3d/floor-environment.ts for why a full wall behind it is still not
 * possible, and lib/game3d/room-theme.ts for the swappable palette that
 * environment paints from — the felt/rail/skirt below are untouched by it,
 * on purpose). A real modelled brass railing stands further out, around the
 * seats — see scene/room-surround.tsx, mounted alongside this component in
 * poker-scene.tsx rather than inside it.
 *
 * Static geometry only — no per-frame work happens here. The carpet's
 * geometry is built once per mount, rebuilt only when the active theme
 * changes (its colours are baked into the geometry's vertex buffer, not
 * read at material time), and disposed on unmount.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  RAIL_LIP_HEIGHT,
} from "@/lib/game3d/seat-layout";
import { offsetStadium } from "@/lib/game3d/table-shape";
import {
  FLOOR_RADIUS,
  FLOOR_RINGS,
  FLOOR_SEGMENTS,
  carpetColorAt,
} from "@/lib/game3d/floor-environment";
import type { RoomTheme } from "@/lib/game3d/room-theme";
import {
  buildStadiumRingShape,
  buildStadiumShape,
  extrudeFlat,
  flatShapeGeometry,
} from "./table-geometry";

/**
 * Felt/rail/skirt sizes below were all tuned against the old, larger
 * FELT_RADIUS_X. Pulling the table in (see seat-layout.ts) without also
 * thinning these left the rail and cloth reading proportionally heavier
 * than before — a smaller table with the same absolute cushion width is a
 * *thicker*-looking one, not just a smaller one. Every constant in this
 * file was rescaled down with the felt, so the table's proportions (rail
 * width vs. felt size, felt vs. cushion thickness) are unchanged from the
 * previous pass; only the whole assembly got smaller.
 *
 * Rescaled a fourth time by 1.2/1.45 = 0.827586 alongside FELT_RADIUS_X
 * going 1.45 → 1.2 (seat-layout.ts). These are absolute world units, not
 * derived from FELT_RADIUS_X, so they have to move by hand every round or
 * the table reads proportionally thicker as it shrinks.
 *
 * Cut again, a fifth time, independent of any felt-radius move: rendered
 * next to a real .glb figure, the rail's pillowed bevel (a big rounded
 * cross-section under a dark, faintly glossy brown) read as a poured,
 * melted-looking mass rather than a stitched cushion, and its raised top
 * was exactly what forearms reaching from the seat ring toward the cloth
 * kept clipping through (see RAIL_LIP_HEIGHT in seat-layout.ts, which the
 * felt-clamp IK now reads instead of guessing). FELT_THICKNESS,
 * RAIL_DEPTH and the two bevel constants below all came down ~35-45%; the
 * rail's own alignTop offset is RAIL_LIP_HEIGHT itself now rather than a
 * second, silently-drifting literal.
 */
const FELT_THICKNESS = 0.013;
const SKIRT_HEIGHT = 0.0869;

/** Felt half-extents, the shared "where does the cloth end" boundary every
 * other stadium below is built as an offset of. */
const FELT_EXTENT = { halfLength: FELT_RADIUS_X, halfWidth: FELT_RADIUS_Z };

/**
 * The padded rail's plan geometry: a stadium *ring*, not a stretched torus.
 *
 * A torus non-uniformly scaled to reach an oval plan also scales its own
 * tube cross-section, so the old rail read visibly fatter along the long
 * sides than at the ends — the padding was a side effect of the scale
 * trick, not a chosen width. `RAIL_WIDTH` is one true width, offset
 * uniformly around the whole stadium via `offsetStadium`, so the cushion
 * reads the same thickness everywhere, straight sides and rounded ends
 * alike. `RAIL_OVERLAP` pulls the ring's inner edge in past the felt
 * boundary by the same amount the old torus's tube did, so the cushion
 * still visually laps the cloth's stapled edge instead of butting against
 * it with a seam.
 */
const RAIL_WIDTH = 0.0869;
const RAIL_OVERLAP = 0.0232;
const RAIL_OUTER = offsetStadium(FELT_EXTENT.halfLength, FELT_EXTENT.halfWidth, RAIL_WIDTH);
const RAIL_INNER = offsetStadium(FELT_EXTENT.halfLength, FELT_EXTENT.halfWidth, -RAIL_OVERLAP);
/**
 * Depth and bevel both cut for the fifth rescale (see the header above):
 * a smaller bevel-to-depth ratio is what turns a rounded, pillowed pour
 * into a cushion with a real flat top and a stitched edge — the shape a
 * padded rail actually has. RAIL_DEPTH 0.0331 → 0.021, bevel 0.0132/0.012
 * → 0.006/0.006.
 */
const RAIL_DEPTH = 0.021;
const RAIL_BEVEL_THICKNESS = 0.006;
const RAIL_BEVEL_SIZE = 0.006;

/** Skirt: the body below the cloth, sized to sit just under the rail's
 * outer lip rather than flush with the felt's own edge. */
const SKIRT_EXTENT = offsetStadium(FELT_EXTENT.halfLength, FELT_EXTENT.halfWidth, RAIL_WIDTH * 0.82);

/** Betting line: an inset stadium ring, stroked thin. Matches the old
 * ring's proportions (inner radius 98.5% of outer) rather than a fixed
 * world-unit stroke width, so it scales the same way with the felt. */
const BETTING_LINE_INSET = 0.72;
const BETTING_LINE_OUTER = offsetStadium(
  FELT_EXTENT.halfLength * BETTING_LINE_INSET,
  FELT_EXTENT.halfWidth * BETTING_LINE_INSET,
  0,
);
const BETTING_LINE_INNER = offsetStadium(
  BETTING_LINE_OUTER.halfLength * 0.985,
  BETTING_LINE_OUTER.halfWidth * 0.985,
  0,
);

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
function CarpetFloor({ theme }: { theme: RoomTheme }) {
  // Depends on `theme`, not an empty array: the gradient is baked into this
  // buffer at build time (see the colour-space note above), so switching
  // themes without rebuilding it would leave the previous theme's carpet
  // painted under the new fog/lights — the exact "stale buffer" bug a
  // per-theme geometry has to avoid.
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
      const rgb = carpetColorAt(radius, theme);
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
  }, [theme]);

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

/**
 * The table's three stadium layers (rail, skirt, felt) plus the printed
 * betting line, built once and disposed on unmount — same lifecycle as
 * CarpetFloor's hand-built geometry above.
 *
 * Each geometry is built at the origin by `extrudeFlat`/`flatShapeGeometry`
 * and then translated to its final height by aligning a bounding-box edge
 * to a named target Y, rather than by hand-computing where an
 * ExtrudeGeometry's bevel puts its front/back faces. That's what CLAUDE.md's
 * "measured, not guessed" rule looks like for a mesh instead of a render:
 * the alternative is a magic vertical offset that silently stops matching
 * the geometry the moment RAIL_DEPTH or a bevel constant changes.
 */
function useTableGeometry() {
  return useMemo(() => {
    const alignTop = (geometry: THREE.BufferGeometry, targetTopY: number) => {
      geometry.computeBoundingBox();
      const top = geometry.boundingBox?.max.y ?? 0;
      geometry.translate(0, targetTopY - top, 0);
      return geometry;
    };

    // Rail: a padded stadium ring, pillowed by an ExtrudeGeometry bevel
    // rather than a torus's round tube — a bevel this size reads as a
    // stitched cushion top without a lathed profile.
    const rail = alignTop(
      extrudeFlat(buildStadiumRingShape(RAIL_OUTER, RAIL_INNER), {
        depth: RAIL_DEPTH,
        bevelEnabled: true,
        bevelThickness: RAIL_BEVEL_THICKNESS,
        bevelSize: RAIL_BEVEL_SIZE,
        bevelSegments: 4,
        curveSegments: 24,
      }),
      // RAIL_LIP_HEIGHT (seat-layout.ts), not a second local literal — the
      // felt-clamp IK reads the exact same number as the obstacle a
      // forearm crossing the rail has to clear, so this offset and that
      // clearance cannot drift apart.
      FELT_TOP_Y + RAIL_LIP_HEIGHT,
    );

    // Skirt: the straight-walled body below the cloth, no bevel.
    const skirt = alignTop(
      extrudeFlat(buildStadiumShape(SKIRT_EXTENT), {
        depth: SKIRT_HEIGHT,
        bevelEnabled: false,
        curveSegments: 24,
      }),
      FELT_TOP_Y - 0.028,
    );

    // Felt: a thin flat stadium slab, top surface exactly at FELT_TOP_Y —
    // chips, cards and the pot all rest against that same constant.
    const felt = alignTop(
      extrudeFlat(buildStadiumShape(FELT_EXTENT), {
        depth: FELT_THICKNESS,
        bevelEnabled: false,
        curveSegments: 24,
      }),
      FELT_TOP_Y,
    );

    // Betting line: a flat inset ring, no thickness of its own.
    const bettingLine = flatShapeGeometry(buildStadiumRingShape(BETTING_LINE_OUTER, BETTING_LINE_INNER));
    bettingLine.translate(0, FELT_TOP_Y + 0.001, 0);

    return { rail, skirt, felt, bettingLine };
  }, []);
}

export function Table3D({ theme }: { theme: RoomTheme }) {
  const { rail, skirt, felt, bettingLine } = useTableGeometry();

  useEffect(
    () => () => {
      rail.dispose();
      skirt.dispose();
      felt.dispose();
      bettingLine.dispose();
    },
    [rail, skirt, felt, bettingLine],
  );

  return (
    <group>
      {/* Floor — everything's shadows land here and on the felt, and at this
          camera it is also the whole background: the frustum never reaches
          the horizon, so there is nothing behind the table to put a wall on.
          Its radius is solved from the framing rather than written down; the
          literal 9 it replaces was already 0.6 units narrower than the frame
          at 2560x1080. */}
      <CarpetFloor theme={theme} />

      {/* Padded rail: a raised stadium ring riding the felt's edge — a true
          uniform-width cushion now, not a torus stretched thinner along its
          own tube by the non-uniform scale an ellipse used to need.
          Colour and roughness were the other half of the "melted
          chocolate" complaint, alongside the bevel shape above: a
          saturated milk-brown at roughness 0.5 caught the overhead spot as
          a broad, wet-looking highlight down the cushion's rounded top —
          read against real vinyl/leather rail padding, that highlight is
          what reads as a pour rather than a stitched surface. Desaturated
          toward near-black with a cool (not warm-brown) cast, and roughened
          so the spot breaks into a much smaller, tighter glint instead of
          a sheen running the cushion's length. */}
      <mesh geometry={rail} castShadow receiveShadow>
        <meshStandardMaterial color="#241b20" roughness={0.82} metalness={0} />
      </mesh>

      {/* Table skirt: the body below the cloth, seen from the side. Same
          desaturation as the rail, kept a shade darker so the two still
          read as one dark leather assembly rather than two materials. */}
      <mesh geometry={skirt} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1417" roughness={0.85} metalness={0} />
      </mesh>

      {/* The felt itself. The table stays green — chrome rules don't reach the cloth. */}
      <mesh geometry={felt} receiveShadow>
        <meshStandardMaterial color="#1c5c40" roughness={0.92} metalness={0} />
      </mesh>

      {/* Inner betting-line ring, painted as a thin darker stadium. */}
      <mesh geometry={bettingLine}>
        <meshBasicMaterial color="#14452f" />
      </mesh>

      {/* Pedestal and base — left circular: centred under the table, they
          read the same under a stadium felt as they did under an ellipse. */}
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
