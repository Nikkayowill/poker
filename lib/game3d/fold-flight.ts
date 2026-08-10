import { CARD } from "./dimensions";
import {
  FELT_TOP_Y,
  faceCentreRotationY,
  holeCardPosition,
  type Vec3,
} from "./seat-layout";

/** A brisk muck: readable as a deliberate fold without holding up the hand. */
export const FOLD_FLIGHT_DURATION_S = 0.68;

/** Kept off the pot and board, on the dealer's side of the centre line. */
export const MUCK_POSITION: Vec3 = {
  x: CARD.width * 1.7,
  y: FELT_TOP_Y + CARD.thickness,
  z: -0.24,
};

export interface FoldFlightPose {
  position: Vec3;
  rotationY: number;
  rotationZ: number;
  scale: number;
  done: boolean;
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Pure choreography shared by every seat's physical card flight. */
export function foldFlightPose(slot: number, elapsedSeconds: number): FoldFlightPose {
  const start = holeCardPosition(slot);
  const raw = Math.min(1, Math.max(0, elapsedSeconds / FOLD_FLIGHT_DURATION_S));
  const t = smoothstep(raw);
  const arc = Math.sin(Math.PI * raw) * CARD.height * 0.1;
  const startRotation = faceCentreRotationY(start);

  return {
    position: {
      x: start.x + (MUCK_POSITION.x - start.x) * t,
      y: start.y + (MUCK_POSITION.y - start.y) * t + arc,
      z: start.z + (MUCK_POSITION.z - start.z) * t,
    },
    rotationY: startRotation + (0.28 - startRotation) * t,
    rotationZ: -0.08 - t * 0.34,
    scale: 1 - t * 0.24,
    done: raw >= 1,
  };
}
