import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  DESKTOP_LANDSCAPE_FRAME,
  FELT_TOP_Y,
  FLOOR_Y,
  HERO_SLOT,
  MOBILE_LANDSCAPE_FRAME,
  RAIL_LIP_HEIGHT,
  SEAT_COUNT,
  SEAT_LABELS,
  SLAB_BOTTOM_Y,
  chipAnchor,
  communityCardsAnchor,
  dealerAnchor,
  dealerButtonAnchor,
  dealerHead,
  feltOutline,
  fitCamera,
  pedestalOutline,
  potAnchor,
  project,
  seatAnchor,
  seatHead,
  seatShoulderRoom,
  tableOutline,
  type Camera,
  type Frame,
  type Vec3,
} from "./table-anchors";

/** Projects everything for one frame, so a static review page can draw the
 * exact geometry this module produces instead of a hand-copied port. */
function dumpFrame(frame: Frame) {
  const camera: Camera = fitCamera(frame);
  const flat = (plan: { x: number; z: number }[], y: number) =>
    plan.map((p) => {
      const s = project(camera, { x: p.x, y, z: p.z });
      return [round(s.x), round(s.y)];
    });

  const people = [];
  for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
    if (slot === HERO_SLOT) continue;
    people.push(person(camera, seatAnchor(slot), seatHead(slot), seatShoulderRoom(slot), `seat${slot}`, "seat"));
  }
  people.push(person(camera, dealerAnchor(), dealerHead(), seatShoulderRoom(3), "DEALER", "dealer"));
  people.sort((a, b) => a.z - b.z);

  return {
    width: frame.width,
    height: frame.height,
    hudY: round(frame.height * (1 - (frame.hudFraction ?? 0))),
    felt: flat(feltOutline(), FELT_TOP_Y),
    railTop: flat(tableOutline(), FELT_TOP_Y + RAIL_LIP_HEIGHT),
    slabBottom: flat(tableOutline(), SLAB_BOTTOM_Y),
    pedestalTop: flat(pedestalOutline(), SLAB_BOTTOM_Y),
    pedestalFloor: flat(pedestalOutline(), FLOOR_Y),
    tableFloor: flat(tableOutline(), FLOOR_Y),
    people,
    feltMarkers: [
      marker(camera, potAnchor(), "pot"),
      marker(camera, communityCardsAnchor(), "board"),
      marker(camera, dealerButtonAnchor(1), "button"),
      marker(camera, chipAnchor(3), "chips (seat3)"),
    ],
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function marker(camera: Camera, position: Vec3, label: string) {
  const s = project(camera, position);
  return { label, x: round(s.x), y: round(s.y) };
}

function person(camera: Camera, floor: Vec3, head: Vec3, shoulderRoom: number, label: string, kind: string) {
  const shoulders = shoulderRoom * 0.72;
  const crown = project(camera, head);
  const left = project(camera, { x: floor.x - shoulders / 2, y: head.y, z: floor.z });
  const right = project(camera, { x: floor.x + shoulders / 2, y: head.y, z: floor.z });
  const chest = project(camera, { ...floor, y: FELT_TOP_Y - 0.06 });
  return {
    label,
    kind,
    z: floor.z,
    crownX: round(crown.x),
    crownY: round(crown.y),
    shoulders: round(Math.abs(right.x - left.x)),
    chestY: round(chest.y),
    world: { x: round(floor.x), z: round(floor.z) },
    shoulderRoom: round(shoulderRoom),
  };
}

describe("geometry dump", () => {
  it("writes the projected geometry for the review page", () => {
    const target = process.env.STACKCHIPS_GEOMETRY_DUMP;
    if (!target) return;
    writeFileSync(
      target,
      JSON.stringify(
        {
          desktop: dumpFrame(DESKTOP_LANDSCAPE_FRAME),
          mobile: dumpFrame(MOBILE_LANDSCAPE_FRAME),
          seatLabels: SEAT_LABELS,
        },
        null,
        0,
      ),
    );
  });
});
