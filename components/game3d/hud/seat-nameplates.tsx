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

/**
 * How far down this container the pot pill (.liveHudTop) + turn banner
 * (.liveTurn) actually reach, in real pixels from the container's own top —
 * not a percentage of it. Those two live at fixed pixel offsets in
 * game3d.module.css regardless of how tall the canvas is, so a
 * percentage-based avoidance threshold drifts out of sync with them at every
 * viewport height it wasn't tuned against.
 *
 * Was a percentage (17, then 24) gating a flip between "grow up" and "grow
 * down" from the SAME point — which fixed nothing when the point itself
 * sits inside the band, the case a folded seat's receded position can reach
 * that no active seat's ordinary crown does. Measured directly at 1440x900:
 * .liveHudTop ends ~54px down, .liveTurn ~88px down; the short-viewport
 * variant (game3d.module.css's own max-height:620px query) pulls both bands
 * UP, so 88px is already the more conservative of the two cases, not less.
 * 104px keeps real margin past that reading.
 */
const HUD_BAND_SAFE_PX = 104;

/**
 * Vertical spacing between two plates that both get pinned to the floor
 * above, in real pixels. Pinning alone was a second bug, found on the same
 * render that found the first: a folded seat's receded crown and the
 * currently-acting seat's ordinary one can land within a few percent of
 * each other near the top of a landscape-phone frame, and clamping both to
 * an identical line stacked their text directly on top of each other —
 * worse than the overlap the clamp exists to fix. Only plates whose
 * unclamped X positions are within PROXIMITY_PERCENT of one another are
 * staggered; two pinned plates on opposite sides of the felt have no reason
 * to give up the floor line just because a third one nearby needed to.
 */
const PIN_ROW_GAP_PX = 30;
const PROXIMITY_PERCENT = 15;

interface Plate {
  key: string;
  left: number;
  top: number;
  pinned: boolean;
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

export function SeatNameplates({
  model,
  aspect,
  containerHeight,
  hideMine = false,
}: {
  model: SceneModel;
  aspect: number;
  containerHeight: number;
  /** Drop the local player's own plate entirely, not just visually -- the
   * desktop corner HUD (player-hud-corner.tsx) is what names that seat
   * instead. Skipped at the source rather than filtered afterward so it
   * takes no row in the pinned-collision pass below either. */
  hideMine?: boolean;
}) {
  const plates = useMemo<Plate[]>(() => {
    const safeFloorPercent =
      containerHeight > 0 ? (HUD_BAND_SAFE_PX / containerHeight) * 100 : 0;
    const rowGapPercent =
      containerHeight > 0 ? (PIN_ROW_GAP_PX / containerHeight) * 100 : 0;

    // Pass one: project every seat at its true position, unclamped.
    const raw: Array<{
      seatId: string;
      left: number;
      top: number;
      folded: boolean;
      isCurrent: boolean;
      isWinner: boolean;
      name: string;
      sub: string;
    }> = [];
    for (const seat of model.seats) {
      if (hideMine && seat.isMine) continue;
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
      raw.push({
        seatId: seat.id,
        ...screen,
        folded,
        isCurrent: seat.isCurrent,
        isWinner: seat.isWinner,
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
      });
    }

    // Pass two: pin whoever landed inside the HUD band, stacking any that
    // are horizontally close enough to have collided at a shared line. Each
    // pinned plate takes the smallest row (0 = the floor line itself) that
    // no already-placed pinned plate within PROXIMITY_PERCENT is already
    // occupying — so two pinned plates far apart in X both sit on row 0,
    // and only ones close enough to actually overlap give way.
    const placedPins: Array<{ left: number; row: number }> = [];
    const list: Plate[] = raw.map((entry) => {
      const pinned = entry.top < safeFloorPercent;
      let top = entry.top;
      if (pinned) {
        let row = 0;
        while (
          placedPins.some(
            (p) => p.row === row && Math.abs(p.left - entry.left) < PROXIMITY_PERCENT
          )
        ) {
          row += 1;
        }
        placedPins.push({ left: entry.left, row });
        top = safeFloorPercent + row * rowGapPercent;
      }
      const classNames = [styles.plate];
      if (entry.folded) classNames.push(styles.plateFolded);
      if (entry.isCurrent) classNames.push(styles.plateCurrent);
      if (entry.isWinner) classNames.push(styles.plateWinner);
      // Pinned means the point itself is inside (or right at the edge of)
      // the chrome band, so growing upward from it — the ordinary direction
      // — would draw straight back into the pot pill or turn banner it was
      // just pulled clear of. Below is the only direction left once pinning
      // has happened.
      if (pinned) classNames.push(styles.plateBelow);
      return {
        key: entry.seatId,
        left: entry.left,
        top,
        pinned,
        name: entry.name,
        sub: entry.sub,
        className: classNames.join(" "),
      };
    });
    // No dealer plate: the geometric DealerFigure is unmounted until the
    // house has illustrated artwork, and a nameplate over an empty patch of
    // carpet would name nobody.
    return list;
  }, [model, aspect, containerHeight, hideMine]);

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
