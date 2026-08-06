"use client";

/**
 * Resting chip piles. One shared CylinderGeometry and one material triple
 * per denomination for the whole scene — a pile is only ever new transforms,
 * never new GPU resources.
 */

import { useMemo } from "react";
import * as THREE from "three";
import {
  chipBreakdown,
  type ChipDenomination,
} from "@/lib/game3d/denominations";
import { landingOffset } from "@/lib/game3d/chip-trajectory";
import type { Vec3 } from "@/lib/game3d/seat-layout";

/** Real 39mm x 3.3mm proportions: thickness ≈ radius * 0.17. Oversized
 * against a real table on purpose — at this camera distance a true-scale
 * chip is a two-pixel dot (measured; same judge-at-rendered-size lesson as
 * the dealer avatar). */
export const CHIP_RADIUS = 0.095;
export const CHIP_THICKNESS = CHIP_RADIUS * 0.17;

export const chipGeometry = new THREE.CylinderGeometry(
  CHIP_RADIUS,
  CHIP_RADIUS,
  CHIP_THICKNESS,
  24
);

/** Cylinder material order is [side, top, bottom]. */
const materialCache = new Map<string, THREE.Material[]>();

export function chipMaterials(denom: ChipDenomination): THREE.Material[] {
  const cached = materialCache.get(denom.color);
  if (cached) return cached;
  const side = new THREE.MeshStandardMaterial({
    color: denom.color,
    roughness: 0.45,
  });
  const face = new THREE.MeshStandardMaterial({
    color: denom.face,
    roughness: 0.38,
  });
  const materials = [side, face, face];
  materialCache.set(denom.color, materials);
  return materials;
}

/**
 * Settle jitter for the nth chip of a resting column. Deliberately smaller
 * than a landing scatter and unequal by axis (depth squashed against width)
 * so a column reads as one pile — the same unequal-axes lesson the 2D
 * room's chipSettleJitter carries.
 */
function settleJitter(index: number, seed: number): { dx: number; dz: number } {
  const wave = landingOffset(index + seed);
  return { dx: wave.dx * 0.35, dz: wave.dz * 0.2 };
}

export function ChipStack({
  amount,
  position,
  seed = 0,
}: {
  amount: number;
  position: Vec3;
  /** Distinguishes piles so two equal amounts don't jitter identically. */
  seed?: number;
}) {
  const chips = useMemo(() => chipBreakdown(amount), [amount]);
  if (chips.length === 0) return null;
  return (
    <group position={[position.x, position.y, position.z]}>
      {chips.map((denom, i) => {
        const { dx, dz } = settleJitter(i, seed);
        return (
          <mesh
            key={i}
            geometry={chipGeometry}
            material={chipMaterials(denom)}
            position={[dx, CHIP_THICKNESS / 2 + i * CHIP_THICKNESS, dz]}
            rotation={[0, ((i + seed) * 0.73) % Math.PI, 0]}
            castShadow
            receiveShadow
          />
        );
      })}
    </group>
  );
}
