/**
 * Turns the pure stadium outline math in lib/game3d/table-shape.ts into
 * three.js Shapes and BufferGeometries. Kept out of table-3d.tsx itself so
 * that file stays about *composing* the table's layers, not about how a
 * discretized outline becomes a THREE.Path — same split as chip-textures.ts
 * / card-textures.ts living beside their consuming components rather than
 * inside them.
 *
 * Every geometry returned here is already rotated flat (extrusion axis ->
 * world Y) via `geometry.rotateX(-Math.PI / 2)`, baked into the geometry
 * itself rather than left as a mesh `rotation` prop — the same convention
 * CarpetFloor's hand-built BufferGeometry in table-3d.tsx uses, so every
 * table layer can be positioned with a plain `position` and no `rotation`.
 */

import * as THREE from "three";
import { type StadiumPoint, stadiumOutline } from "@/lib/game3d/table-shape";

export interface StadiumExtent {
  halfLength: number;
  halfWidth: number;
}

function outlineToPoints(points: StadiumPoint[]): THREE.Vector2[] {
  return points.map((p) => new THREE.Vector2(p.x, p.z));
}

/** A filled stadium — the felt, or the outer boundary of a ring. */
export function buildStadiumShape(extent: StadiumExtent, capSegments?: number): THREE.Shape {
  const outline = outlineToPoints(stadiumOutline(extent.halfLength, extent.halfWidth, capSegments));
  const shape = new THREE.Shape(outline);
  shape.closePath();
  return shape;
}

/** A stadium with a smaller stadium cut out of its middle — the padded rail
 * and the inset betting line both need this: a frame, not a plate. */
export function buildStadiumRingShape(
  outer: StadiumExtent,
  inner: StadiumExtent,
  capSegments?: number,
): THREE.Shape {
  const shape = buildStadiumShape(outer, capSegments);
  const hole = new THREE.Path(outlineToPoints(stadiumOutline(inner.halfLength, inner.halfWidth, capSegments)));
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

/** Extrudes a shape and lays it flat, extrusion axis -> world Y. */
export function extrudeFlat(shape: THREE.Shape, options: THREE.ExtrudeGeometryOptions): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, options);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** A zero-thickness filled/ring shape laid flat — for the printed betting
 * line, which has no depth of its own, it just sits a hair above the felt. */
export function flatShapeGeometry(shape: THREE.Shape): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
