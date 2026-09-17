/**
 * The free camera: how far the view may pan, and which zooms it is allowed to rest at.
 *
 * The camera normally rides the farmer, pinned to him and snapped to device
 * pixels every frame (scene.ts's `placeCamera`, which is what keeps him from
 * shaking against the ground). Two gestures take it off him: a one-finger drag
 * pans, and a two-finger pinch zooms. It goes back on him the moment he moves.
 *
 * Zoom is device pixels per art pixel, so a whole number means one art pixel
 * covers a whole number of device pixels and the art is crisp. A pinch is
 * allowed to sit between whole numbers WHILE the fingers are down, because a
 * gesture that fights the finger reads as broken; the instant they lift, the
 * zoom eases to the nearest whole number and crispness comes back. That is the
 * whole reason `nearestWholeZoom` exists separately from the clamping.
 *
 * Pure, so it is tested without Phaser (camera.test.ts).
 */

import type { Point } from "./movement";

/** How much closer than the follow zoom a pinch may push in, for looking at one crop. */
const EXTRA_ZOOM_IN = 2;

export interface ZoomRange {
  /** The furthest out: the largest whole zoom that still fits the whole area on screen. Never below 1. */
  min: number;
  /** The closest in, a couple of steps past the follow zoom. */
  max: number;
}

/**
 * Which whole zooms the camera may rest at, for an area this big on a canvas
 * this big. `fitZoom` is what topdown-world.tsx's `pickZoom` chose as the
 * follow zoom.
 *
 * The bottom of the range is "the whole field at once", which is the thing a
 * player with hundreds of crops actually wants. It can equal `fitZoom` on a
 * small area, in which case there is nothing to zoom out to and the range is a
 * single step.
 */
export function zoomRange(canvasW: number, canvasH: number, mapW: number, mapH: number, fitZoom: number): ZoomRange {
  const whole = Math.floor(Math.min(canvasW / Math.max(1, mapW), canvasH / Math.max(1, mapH)));
  const min = Math.max(1, Math.min(fitZoom, whole));
  return { min, max: Math.max(min, fitZoom + EXTRA_ZOOM_IN) };
}

export function clampZoom(zoom: number, range: ZoomRange): number {
  return Math.min(range.max, Math.max(range.min, zoom));
}

/** Where a pinch settles when the fingers lift: the nearest whole zoom it is allowed to rest at. */
export function nearestWholeZoom(zoom: number, range: ZoomRange): number {
  return clampZoom(Math.round(clampZoom(zoom, range)), range);
}

/**
 * The centre the camera may actually use, given how much of the area fits on
 * screen. An axis the view is wider than sits centred on the area and cannot
 * pan at all; otherwise the centre is pulled in so the view never shows past
 * an edge.
 */
export function clampCentre(centre: Point, viewW: number, viewH: number, mapW: number, mapH: number): Point {
  const axis = (value: number, view: number, map: number) =>
    view >= map ? map / 2 : Math.min(Math.max(value, view / 2), map - view / 2);
  return { x: axis(centre.x, viewW, mapW), y: axis(centre.y, viewH, mapH) };
}

/**
 * One frame of the camera easing back onto the farmer, or of a pinch settling.
 * `rate` is the share of the remaining distance covered per 16ms frame, so the
 * ease reads the same on a slow phone as a fast one.
 */
export function ease(from: number, to: number, rate: number, deltaMs: number): number {
  const t = 1 - Math.pow(1 - rate, Math.max(0, deltaMs) / 16);
  return from + (to - from) * t;
}

/** Close enough to the target that the ease should stop and take the exact value. */
export function settled(from: number, to: number, epsilon: number): boolean {
  return Math.abs(to - from) <= epsilon;
}
