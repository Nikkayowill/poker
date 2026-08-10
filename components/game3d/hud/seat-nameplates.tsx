"use client";

/**
 * Floating HTML nameplates over the canvas — name and stack per seat, plus
 * the house dealer. Positioned by running each figure's head through the
 * same pure projection the camera itself is solved with
 * (lib/game3d/camera-framing.ts), so the plates land where the heads are at
 * every viewport aspect without a single three.js query. Folded seats are
 * projected at their slid-back position, exactly where the figure went.
 *
 * DOM on purpose, like the action HUD: text stays crisp at any DPI and
 * readable by screen readers, and z-order over the canvas is a CSS fact
 * rather than a depth-buffer negotiation.
 */

import { useMemo } from "react";
import type { SceneModel } from "@/lib/game3d/scene-model";
import { frameCamera, projectToNdc } from "@/lib/game3d/camera-framing";
import type { Vec3 } from "@/lib/game3d/seat-layout";
import { spriteCrownWorld } from "@/lib/game3d/avatar-sprites";
import { cameraBasis } from "@/lib/game3d/camera-framing";
import styles from "../game3d.module.css";

/** Air between the sprite's crown and its plate, world units. */
const PLATE_LIFT = 0.16;

/** Plates for heads this far past the frame edge are dropped, not clamped —
 * a plate pinned to an edge names nobody. Slightly past 1 so a head at the
 * very rim (a folded landscape side seat) keeps its label. */
const NDC_LIMIT = 1.08;

interface Plate {
  key: string;
  left: number;
  top: number;
  name: string;
  sub: string;
  className: string;
}

function project(point: Vec3, aspect: number): { left: number; top: number } | null {
  const framing = frameCamera(aspect);
  const ndc = projectToNdc(point, framing, aspect);
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
  if (Math.abs(ndc.x) > NDC_LIMIT || Math.abs(ndc.y) > NDC_LIMIT) return null;
  // A plate at the very rim clamps inward a step so it stays whole; one
  // past the limit above was dropped instead — half a nameplate names
  // nobody, but a nudged one still points at its figure.
  return {
    left: Math.min(97, Math.max(3, ((ndc.x + 1) / 2) * 100)),
    top: Math.min(97, Math.max(3, ((1 - ndc.y) / 2) * 100)),
  };
}

export function SeatNameplates({ model, aspect }: { model: SceneModel; aspect: number }) {
  const plates = useMemo<Plate[]>(() => {
    const list: Plate[] = [];
    for (const seat of model.seats) {
      const folded = seat.status === "folded" || seat.status === "out";
      // The quads are screen-aligned, so a crown is the base plus a rise
      // along the CAMERA's up axis — not a fixed world height. Both the
      // fold recede and that rise come from the same helpers the renderer
      // uses, so a plate cannot drift off the head it names.
      const framing = frameCamera(aspect);
      const crown = spriteCrownWorld(seat.slot, framing, folded);
      const { up } = cameraBasis(framing);
      const screen = project(
        {
          x: crown.x + up.x * PLATE_LIFT,
          y: crown.y + up.y * PLATE_LIFT,
          z: crown.z + up.z * PLATE_LIFT,
        },
        aspect
      );
      if (!screen) continue;
      const classNames = [styles.plate];
      if (folded) classNames.push(styles.plateFolded);
      if (seat.isCurrent) classNames.push(styles.plateCurrent);
      if (seat.isWinner) classNames.push(styles.plateWinner);
      // The far-middle seat's head shares the top band with the pot pill
      // and table message; its plate flips below the chin instead. 17% is
      // measured against the shortest stage (844×390), where the message
      // line reaches ~15% down.
      if (screen.top < 17) classNames.push(styles.plateBelow);
      list.push({
        key: seat.id,
        ...screen,
        name:
          seat.isMine && seat.name.toLowerCase() !== "you"
            ? `${seat.name} (you)`
            : seat.name,
        sub: seat.isWinner
          ? `+${seat.winAmount.toLocaleString()}`
          : folded
            ? "FOLDED"
            : seat.isCurrent
              ? `TO ACT · ${seat.stack.toLocaleString()}`
              : seat.lastAction
                ? `${seat.lastAction} · ${seat.stack.toLocaleString()}`
                : seat.stack.toLocaleString(),
        className: classNames.join(" "),
      });
    }
    // No dealer plate: the geometric DealerFigure is unmounted until the
    // house has illustrated artwork, and a nameplate over an empty patch of
    // carpet would name nobody.
    return list;
  }, [model, aspect]);

  return (
    <div className={styles.plateLayer} aria-hidden={false}>
      {plates.map((plate) => (
        <div
          key={plate.key}
          className={plate.className}
          style={{ left: `${plate.left}%`, top: `${plate.top}%` }}
        >
          <span className={styles.plateName}>{plate.name}</span>
          <span className={styles.plateStack}>{plate.sub}</span>
        </div>
      ))}
    </div>
  );
}
