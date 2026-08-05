import * as THREE from "three";
import {
  AMBIENT,
  CAMERA,
  FELT,
  FOG,
  LAYERS,
  ROOM,
  SPOTLIGHT,
  spotlightIntensityFor,
} from "@/lib/scene/scene-config";
import { ringPoint, seatPlacement } from "@/lib/scene/seat-ring";
import { carpetTexture, radialFalloffTexture } from "./chip-texture";

/**
 * The room: everything in the scene that does not change when the game does.
 *
 * Layers A, B and D of the sandwich (floor, chair backs, rim mask) plus the
 * lighting rig, built once at mount and then left alone. Layer C -- the
 * players -- is the only part that reacts to a snapshot, and it lives in
 * `avatars.ts` for exactly that reason.
 *
 * NO SHADOW MAPS ANYWHERE IN HERE, DELIBERATELY. A single shadow-casting
 * spotlight means a second full render pass into a depth texture every frame,
 * which on the phones this scene is built for is most of the frame budget --
 * spent on shadows that would be almost entirely swallowed by the fog and the
 * falloff. The two shadows that actually sell the picture are faked for
 * roughly nothing: a blurred disc under each player (`avatars.ts`) and a
 * darkened contact ring under the rim (below). The spotlight's `penumbra` is
 * about the softness of its own cone edge, not about shadow maps, so the
 * moody falloff the spec asks for is intact.
 */

export interface Room {
  /**
   * Everything scaled by the room-fit solve. The lights are outside it, so
   * fitting the table to the DOM box cannot change the exposure.
   */
  group: THREE.Group;
  scene: THREE.Scene;
  /** The felt's own mesh, whose projected width is what the fit solves for. */
  felt: THREE.Mesh;
  dispose: () => void;
}

/** An ellipse matching the felt, scaled outward. Used for every ring in here. */
function ellipseScale(object: THREE.Object3D, scale: number): void {
  object.scale.set(FELT.radiusX * scale, 1, FELT.radiusZ * scale);
}

export function buildRoom(seatCount: number): Room {
  const scene = new THREE.Scene();
  // Left transparent rather than filled with FOG.color. An opaque background
  // would paint over `.table-area`'s own backdrop across the full width of
  // the canvas -- which is the whole play area -- replacing the app's
  // existing dark gradient with a flat rectangle. The floor covers most of
  // the frame anyway, and the fog below fades it into the same near-black the
  // page is already using, so the seam does not show.
  scene.background = null;
  // Fog rather than a shorter far plane: the floor has to *fade*, because a
  // 100-unit plane ending in mid-air is the one thing that would give away
  // that this is a box and not a room.
  scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);

  const group = new THREE.Group();
  scene.add(group);

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  /* ------------------------------------------------------------------ *
   * Lighting. Outside `group`, so the room-fit scale never touches it.
   * ------------------------------------------------------------------ */
  const ambient = new THREE.AmbientLight(AMBIENT.color, AMBIENT.intensity);
  scene.add(ambient);

  // Distance-compensated: `SPOTLIGHT.intensity` is the illuminance wanted on
  // the cloth, not the candela figure the light takes. See
  // `spotlightIntensityFor`.
  const lampToFelt = SPOTLIGHT.position.y - FELT.y;
  const spotlight = new THREE.SpotLight(
    SPOTLIGHT.color,
    spotlightIntensityFor(lampToFelt),
    SPOTLIGHT.distance,
    SPOTLIGHT.angle,
    SPOTLIGHT.penumbra,
    SPOTLIGHT.decay,
  );
  spotlight.position.set(SPOTLIGHT.position.x, SPOTLIGHT.position.y, SPOTLIGHT.position.z);
  spotlight.target.position.set(SPOTLIGHT.target.x, SPOTLIGHT.target.y, SPOTLIGHT.target.z);
  scene.add(spotlight);
  scene.add(spotlight.target);

  /* ------------------------------------------------------------------ *
   * Layer A -- the floor.
   * ------------------------------------------------------------------ */
  const carpet = track(carpetTexture());
  const floorGeometry = track(new THREE.PlaneGeometry(LAYERS.floor.size, LAYERS.floor.size));
  const floorMaterial = track(new THREE.MeshStandardMaterial({
    map: carpet,
    color: ROOM.floorColor,
    roughness: ROOM.floorRoughness,
    metalness: ROOM.floorMetalness,
  }));
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = LAYERS.floor.y;
  group.add(floor);

  /* ------------------------------------------------------------------ *
   * The table itself: a plinth, a felt top, and a contact shadow.
   * ------------------------------------------------------------------ */
  // The body. Sixty-four segments is plenty for an ellipse this size on
  // screen, and it is the single most-visible silhouette in the scene.
  //
  // OPEN-ENDED, WHICH IS LOAD-BEARING. Capped, its top face lands at exactly
  // FELT.y -- the same plane as the felt disc below -- and two coplanar
  // triangle fans z-fight. That does not look like z-fighting at a glance: it
  // renders as a green starburst radiating out of the middle of the table,
  // which reads as a deliberate (if hideous) texture rather than a depth bug.
  // The cap is invisible anyway, since the felt covers it and the floor
  // covers the bottom.
  const bodyGeometry = track(new THREE.CylinderGeometry(1, 0.96, FELT.y, 64, 1, true));
  const bodyMaterial = track(new THREE.MeshStandardMaterial({
    color: ROOM.railColor,
    roughness: 0.7,
    metalness: 0.08,
  }));
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = FELT.y / 2;
  ellipseScale(body, 1.02);
  body.scale.y = 1;
  group.add(body);

  const feltGeometry = track(new THREE.CircleGeometry(1, 64));
  const feltMaterial = track(new THREE.MeshStandardMaterial({
    color: ROOM.feltColor,
    roughness: ROOM.feltRoughness,
    metalness: 0,
  }));
  const felt = new THREE.Mesh(feltGeometry, feltMaterial);
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = FELT.y;
  felt.scale.set(FELT.radiusX, FELT.radiusZ, 1);
  group.add(felt);

  // The contact shadow the table casts on the floor. This is the whole reason
  // the table reads as standing on something rather than floating: without it
  // the plinth's base and the carpet are two dark shapes meeting at a line.
  const contactTexture = track(radialFalloffTexture(256, 0.85));
  const contactGeometry = track(new THREE.PlaneGeometry(2, 2));
  const contactMaterial = track(new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  }));
  const contact = new THREE.Mesh(contactGeometry, contactMaterial);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = LAYERS.floor.y + 0.008;
  contact.scale.set(FELT.radiusX * 1.5, FELT.radiusZ * 1.7, 1);
  group.add(contact);

  /* ------------------------------------------------------------------ *
   * Layer B -- the chair backs.
   * ------------------------------------------------------------------ */
  // A curved panel rather than a box: an open-ended cylinder segment is six
  // vertices' worth of geometry more expensive and is the difference between
  // an upholstered chair and a plank.
  const chairGeometry = track(new THREE.CylinderGeometry(
    LAYERS.chair.width / 2,
    LAYERS.chair.width / 2,
    LAYERS.chair.height,
    14,
    1,
    true,
    -Math.PI / 3,
    (Math.PI * 2) / 3,
  ));
  const chairMaterial = track(new THREE.MeshStandardMaterial({
    color: ROOM.chairColor,
    roughness: ROOM.chairRoughness,
    metalness: 0.06,
    // Open-ended geometry has no back faces to hide behind, so both sides
    // have to be lit or a chair turns into a hole from half the table.
    side: THREE.DoubleSide,
  }));
  for (let slot = 0; slot < seatCount; slot += 1) {
    const placement = seatPlacement(slot, seatCount);
    const chair = new THREE.Mesh(chairGeometry, chairMaterial);
    chair.position.set(
      placement.chairPosition.x,
      LAYERS.chair.height / 2,
      placement.chairPosition.z,
    );
    // The cylinder's open side faces the table, so the player sits *in* the
    // curve rather than in front of a shield.
    chair.rotation.y = placement.facing + Math.PI;
    // A slight recline. Two degrees is not something anyone will name, and
    // without it six identical uprights read as a fence.
    chair.rotation.x = -0.04;
    group.add(chair);
  }

  /* ------------------------------------------------------------------ *
   * Layer D -- the rim. The front mask.
   * ------------------------------------------------------------------ */
  // A torus, squashed onto the felt's ellipse. Its near arc has a greater Z
  // than the far seats' sprites, which is the entire depth illusion: a flat
  // cut-out passes behind solid geometry and gets cut off at the stomach.
  const rimGeometry = track(new THREE.TorusGeometry(1, LAYERS.rim.thickness / 2, 12, 72));
  const rimMaterial = track(new THREE.MeshStandardMaterial({
    color: ROOM.railColor,
    roughness: ROOM.railRoughness,
    metalness: 0.12,
  }));
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.rotation.x = -Math.PI / 2;
  // Scale is applied in the torus's own XY plane, before the rotation puts it
  // flat -- so the ellipse's depth axis is `y` here, not `z`.
  rim.scale.set(FELT.radiusX * LAYERS.rim.innerScale, FELT.radiusZ * LAYERS.rim.innerScale, 1);
  rim.position.y = LAYERS.rim.y - LAYERS.rim.thickness / 2;
  group.add(rim);

  // The felt's own pool of light, painted rather than lit. The spotlight
  // gives the falloff across the room; this gives the cloth its centre, which
  // a single light on a flat matte disc cannot do on its own.
  const poolTexture = track(radialFalloffTexture(256, 0.5, "255, 236, 200"));
  const poolGeometry = track(new THREE.PlaneGeometry(2, 2));
  const poolMaterial = track(new THREE.MeshBasicMaterial({
    map: poolTexture,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  const pool = new THREE.Mesh(poolGeometry, poolMaterial);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = FELT.y + 0.004;
  pool.scale.set(FELT.radiusX * 0.95, FELT.radiusZ * 1.05, 1);
  group.add(pool);

  return {
    group,
    scene,
    felt,
    dispose: () => {
      for (const item of disposables) item.dispose();
      scene.clear();
      group.clear();
    },
  };
}

/**
 * The camera the whole composition is. Fixed, and with no controls attached
 * anywhere in this module -- there is no OrbitControls import to remove
 * later, which is the point.
 */
export function buildCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
  camera.position.set(CAMERA.position.x, CAMERA.position.y, CAMERA.position.z);
  camera.lookAt(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
  return camera;
}

/**
 * The felt's projected width in CSS pixels at a given room scale.
 *
 * This is the measurement `solveRoomScale` bisects on. It samples the
 * ellipse's rim rather than trusting its major axis: under a camera looking
 * down at it, the widest point on screen is not the point at maximum world X,
 * because the near and far halves foreshorten differently.
 */
export function projectedFeltWidth(
  camera: THREE.PerspectiveCamera,
  viewportWidth: number,
  scale: number,
): number {
  const point = new THREE.Vector3();
  let min = Infinity;
  let max = -Infinity;
  for (let step = 0; step < 48; step += 1) {
    const theta = (step / 48) * Math.PI * 2;
    point.set(
      FELT.radiusX * Math.cos(theta) * scale,
      FELT.y * scale,
      FELT.radiusZ * Math.sin(theta) * scale,
    );
    point.project(camera);
    const x = ((point.x + 1) / 2) * viewportWidth;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return max - min;
}

/**
 * The projected vertical centre of the felt, in viewport CSS pixels.
 *
 * The quantity `solveRoomLift` bisects on. Sampled around the rim rather than
 * taken from the middle of the table, because the near and far edges
 * foreshorten by different amounts under this camera -- the point at world
 * origin does not project to the middle of the table's on-screen silhouette,
 * and centring on it would leave the table visibly low in its own box.
 */
export function projectedFeltCentreY(
  camera: THREE.PerspectiveCamera,
  scale: number,
  lift: number,
  viewport: { width: number; height: number },
): number {
  const point = new THREE.Vector3();
  let top = Infinity;
  let bottom = -Infinity;
  for (let step = 0; step < 48; step += 1) {
    const theta = (step / 48) * Math.PI * 2;
    point.set(
      FELT.radiusX * Math.cos(theta) * scale,
      FELT.y * scale + lift,
      FELT.radiusZ * Math.sin(theta) * scale,
    ).project(camera);
    const y = ((1 - point.y) / 2) * viewport.height;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return (top + bottom) / 2;
}

/**
 * The projected bounding box of the seat ring, in viewport CSS pixels.
 *
 * Not used by the fit any more -- see the note in `table-scene.tsx` on why
 * fitting the ring shrank the room -- but kept as the measurement that
 * answers "where did the room actually put the seats", which is what the
 * alignment check in `verify-scene.mjs` and any future registration work
 * needs.
 */
export function projectedRingBox(
  camera: THREE.PerspectiveCamera,
  seatCount: number,
  scale: number,
  lift: number,
  viewport: { width: number; height: number },
): { left: number; right: number; top: number; bottom: number; width: number; centreY: number } {
  const point = new THREE.Vector3();
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let slot = 0; slot < seatCount; slot += 1) {
    // The rim's height rather than the sprite's base: this is the point on a
    // player that the DOM nameplate is pinned to, which is what has to line
    // up. The sprite's feet are under the rail and match nothing in the DOM.
    const placement = ringPoint(slot, seatCount, LAYERS.avatar.ringScale, LAYERS.rim.y);
    point.set(placement.x * scale, placement.y * scale + lift, placement.z * scale).project(camera);
    const x = ((point.x + 1) / 2) * viewport.width;
    const y = ((1 - point.y) / 2) * viewport.height;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return { left, right, top, bottom, width: right - left, centreY: (top + bottom) / 2 };
}

/**
 * Where the DOM has actually drawn its seat ring, measured rather than
 * recomputed.
 *
 * `lib/game/table-geometry.ts` has three different radius pairs -- wide,
 * narrow and portrait -- and picks between them from the table's measured
 * box. Re-deriving that here would be a second copy of a rule that already
 * changed twice, and the failure mode of the copy drifting is a WebGL ring
 * that quietly disagrees with the DOM one on phones only. Reading the boxes
 * back off the rendered seats cannot drift.
 *
 * Returns null until the seats have mounted, which is a real state: the room
 * builds before React has drawn a single seat.
 */
export function measureDomRing(
  root: ParentNode,
): { width: number; centreY: number; count: number } | null {
  const seats = root.querySelectorAll<HTMLElement>(".player-seat");
  if (seats.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const seat of seats) {
    const rect = seat.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { width: right - left, centreY: (top + bottom) / 2, count: seats.length };
}

/**
 * Every seat's projected position as a percentage of a target box, which is
 * the form `.player-seat`'s existing inline `left`/`top` already take.
 *
 * Percentages of `.poker-table-wrap` rather than pixels of the canvas,
 * because that is the element the seats are absolutely positioned inside --
 * handing back canvas pixels would make every consumer redo the same
 * subtraction, and get it wrong the first time the two boxes stopped being
 * concentric.
 */
export function projectSeatRing(
  camera: THREE.PerspectiveCamera,
  seatCount: number,
  roomScale: number,
  roomLift: number,
  canvas: { left: number; top: number; width: number; height: number },
  target: { left: number; top: number; width: number; height: number },
): Array<{ x: number; y: number; depth: number }> {
  const point = new THREE.Vector3();
  const seats: Array<{ x: number; y: number; depth: number }> = [];
  for (let slot = 0; slot < seatCount; slot += 1) {
    const placement = seatPlacement(slot, seatCount);
    // The rim's height, not the sprite's base: this is the point on a player
    // the nameplate hangs from, and the sprite's feet are under the rail.
    point.set(
      placement.position.x * roomScale,
      LAYERS.rim.y * roomScale + roomLift,
      placement.position.z * roomScale,
    ).project(camera);
    const viewportX = canvas.left + ((point.x + 1) / 2) * canvas.width;
    const viewportY = canvas.top + ((1 - point.y) / 2) * canvas.height;
    seats.push({
      x: ((viewportX - target.left) / target.width) * 100,
      y: ((viewportY - target.top) / target.height) * 100,
      depth: placement.nearness,
    });
  }
  return seats;
}

/** Where a seat's nameplate should be pinned, in CSS pixels within the canvas. */
export function projectSeatToViewport(
  camera: THREE.PerspectiveCamera,
  slot: number,
  count: number,
  roomScale: number,
  roomLift: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const placement = ringPoint(slot, count, LAYERS.avatar.ringScale, LAYERS.rim.y);
  const point = new THREE.Vector3(
    placement.x * roomScale,
    placement.y * roomScale + roomLift,
    placement.z * roomScale,
  );
  point.project(camera);
  return {
    x: ((point.x + 1) / 2) * viewport.width,
    y: ((1 - point.y) / 2) * viewport.height,
  };
}
