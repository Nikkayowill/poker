/**
 * The three.js half of the seated rest pose: find the bones, measure the
 * bind pose once, and drive arms/wrists/fingers at the targets
 * `lib/game3d/hand-anchors.ts` and `lib/game3d/hand-rig.ts` compute.
 *
 * Split out of glb-avatar.tsx because it is a different KIND of work — that
 * file is about loading, scaling and seating a character, this one is about
 * posing one — and because everything genuinely decidable without three.js
 * has already been pushed into `lib/game3d`, leaving here exactly the part
 * that cannot be: reading bone world matrices, composing quaternions, and
 * knowing the difference between a bone's local frame and its parent's.
 *
 * THREE THINGS ABOUT THIS FILE THAT ARE EASY TO GET WRONG.
 *
 * 1. EVERY MEASUREMENT IS TAKEN AT BIND, BEFORE ANY MIXER RUNS. Bone lengths,
 *    the palm's plane, each joint's flexion axis and every rest rotation are
 *    properties of the skeleton, not of whichever frame of whichever clip is
 *    playing. `buildArmRig` therefore has to be called on a freshly cloned
 *    model — glb-avatar.tsx samples the seated clip at t=0 further down to
 *    find the hip, and that sampling leaves the model posed, so the order of
 *    those two `useMemo`s is load-bearing rather than incidental.
 *
 * 2. FINGER POSES ARE ABSOLUTE, ARM CORRECTIONS ARE RELATIVE. The clips key
 *    all 40 finger bones with the offline bake's uniform curl, so a delta on
 *    top of the clip would leave that curl underneath; fingers are rebuilt
 *    from the captured rest rotation instead. Shoulders and elbows are the
 *    opposite case — the clip's bend plane is worth keeping, and the solve
 *    only wants to change where the chain ends up — so those stay relative.
 *
 * 3. A BONE'S CHILD POSITION IS ALREADY IN THAT BONE'S FRAME. `child.position`
 *    is expressed in the parent's local space, which is exactly the space a
 *    rotation applied to the parent acts in — so the direction a finger
 *    points, in its own bone's frame, is just its child's normalized
 *    position. No inverse world quaternion is needed anywhere below, and
 *    reaching for one is the sign of having confused the two frames.
 */

import * as THREE from "three";
import {
  handAnchor,
  idleDrift,
  reachableTarget,
  seatFrame,
  type HandRole,
} from "@/lib/game3d/hand-anchors";
import {
  FINGER_NAMES,
  blendHandShapes,
  curlAxis,
  curlsTowardPalm,
  palmNormal,
  spreadSign,
  HAND_SHAPES,
  RESTING_HAND_PITCH,
  type FingerName,
  type HandShape,
} from "@/lib/game3d/hand-rig";
import { clampWristToFelt, dampPointToward, IK_DAMPING, solveTwoBoneIk } from "@/lib/game3d/arm-ik";
import { tableSurfaceY } from "@/lib/game3d/seat-layout";

/** Segment count per digit — the three articulated joints, tip bone excluded. */
const FINGER_SEGMENTS = 3;

/**
 * How fast the pose weight itself moves, in effective changes per second.
 * Slower than IK_DAMPING on purpose: a hand arriving at the cards is a
 * movement, but a hand deciding to *stop* holding them (a fold, a
 * celebration taking over) is a change of intent and reads better eased.
 */
const WEIGHT_DAMPING = 4;

interface FingerSegment {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Flexion axis in this bone's own local frame, sign-checked toward the palm. */
  curl: THREE.Vector3;
  /** Splay axis (the palm normal) in this bone's own local frame. */
  spread: THREE.Vector3;
  /** Which way about `spread` moves this digit away from the middle finger. */
  spreadSign: number;
}

interface HandRig {
  wrist: THREE.Bone;
  /** Finger direction and palm normal in the WRIST bone's own local frame. */
  forwardLocal: THREE.Vector3;
  normalLocal: THREE.Vector3;
  fingers: Partial<Record<FingerName, FingerSegment[]>>;
}

export interface ArmRig {
  shoulder: THREE.Bone;
  elbow: THREE.Bone;
  hand: HandRig;
  /**
   * Fully-extended shoulder-to-wrist distance at bind, in the MODEL's own
   * units — not world units. `buildArmRig` runs on a clone that has not been
   * parented into the scaled group yet, and this roster is authored at wildly
   * different scales (bind spans from 0.02 to 3.69 for characters all meant
   * to be adults), so a length read here means nothing until it is multiplied
   * by the seat's own normalizing scale. `poseAvatar` takes that scale as an
   * input and does the conversion; comparing this to a world-space distance
   * directly is the bug it exists to prevent.
   */
  armLength: number;
  /** +1 when this arm is on the character's right as the seat faces the table. */
  lateralSign: number;
  /** Smoothed wrist target; null until the first frame establishes one. */
  smoothed: THREE.Vector3 | null;
  /** Last frame's unreachable overshoot, in world units — drives the lean. */
  deficit: number;
}

export interface AvatarRig {
  arms: ArmRig[];
  /** Damped state, mutated in place by `poseAvatar`. */
  weight: number;
  snug: number;
}

const MIXAMO_SUFFIXES: Record<FingerName, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky",
};

function findBone(model: THREE.Object3D, pattern: RegExp): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  model.traverse((obj) => {
    if (found || !(obj as THREE.Bone).isBone) return;
    if (pattern.test(obj.name)) found = obj as THREE.Bone;
  });
  return found;
}

/** A bone's first child bone, which is what gives it a direction at all. */
function childBone(bone: THREE.Bone): THREE.Bone | null {
  for (const child of bone.children) {
    if ((child as THREE.Bone).isBone) return child as THREE.Bone;
  }
  return null;
}

const toVec3 = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

/**
 * Measure one hand: the palm's plane, then every finger joint's own flexion
 * axis expressed in that joint's frame.
 *
 * The palm normal starts life in the WRIST bone's frame (where the knuckle
 * positions are directly readable as child positions) and is then carried
 * down each finger by the inverse of each intermediate bone's rest rotation
 * — which is what "the same physical direction, expressed one frame further
 * down the chain" means. Doing it any other way requires knowing the
 * exporter's axis convention, which is the assumption this whole file exists
 * to avoid.
 */
function buildHandRig(side: string, model: THREE.Object3D): HandRig | null {
  const wrist = findBone(model, new RegExp(`${side}hand$`, "i"));
  if (!wrist) return null;

  const knuckle = (finger: FingerName): THREE.Bone | null =>
    findBone(model, new RegExp(`${side}hand${MIXAMO_SUFFIXES[finger]}1$`, "i"));

  const index = knuckle("index");
  const pinky = knuckle("pinky");
  const middle = knuckle("middle");
  const thumb = knuckle("thumb");

  // Direction the hand points, in its own frame: toward the middle knuckle
  // when the rig has one, otherwise toward whatever child it does have.
  const forwardSource = middle ?? childBone(wrist);
  const forwardLocal = forwardSource
    ? forwardSource.position.clone().normalize()
    : new THREE.Vector3(0, 1, 0);

  // A rig with no fingers still gets a usable palm plane so the wrist can be
  // oriented; it simply has nothing to curl. The 41-bone roster family is
  // exactly this case, and it must degrade rather than throw.
  let normalLocal = new THREE.Vector3(0, 0, 1);
  if (index && pinky && thumb) {
    const n = palmNormal(
      { x: 0, y: 0, z: 0 },
      toVec3(index.position),
      toVec3(pinky.position),
      toVec3(thumb.position)
    );
    normalLocal.set(n.x, n.y, n.z);
  } else {
    // Any direction off the finger axis is better than a parallel one.
    const fallback = Math.abs(forwardLocal.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    normalLocal = fallback.projectOnPlane(forwardLocal).normalize();
  }
  // Orthonormalize against the finger axis: the knuckle plane and the middle
  // finger are near-perpendicular on a real hand but not exactly, and the
  // wrist orientation below builds a basis from these two.
  normalLocal.projectOnPlane(forwardLocal).normalize();

  const fingers: Partial<Record<FingerName, FingerSegment[]>> = {};
  for (const finger of FINGER_NAMES) {
    const base = knuckle(finger);
    if (!base || !middle) continue;

    const sign = spreadSign(
      toVec3(base.position),
      toVec3(middle.position),
      { x: 0, y: 0, z: 0 },
      toVec3(normalLocal)
    );

    const segments: FingerSegment[] = [];
    // The palm normal, re-expressed one frame further down at each step.
    const carriedNormal = normalLocal.clone();
    let bone: THREE.Bone | null = base;
    for (let i = 0; i < FINGER_SEGMENTS && bone; i += 1) {
      carriedNormal.applyQuaternion(bone.quaternion.clone().invert());
      const next = childBone(bone);
      const forward = next
        ? next.position.clone().normalize()
        : new THREE.Vector3(0, 1, 0);
      const normal = carriedNormal.clone().projectOnPlane(forward).normalize();

      const axisVec = curlAxis(toVec3(forward), toVec3(normal));
      const axis = new THREE.Vector3(axisVec.x, axisVec.y, axisVec.z);
      // The pure module states the ordering that makes a positive angle flex
      // toward the palm; this asserts it on the real numbers rather than
      // trusting it, because a rig with a left-handed bone basis would make
      // every finger bend backwards and nothing else would notice.
      if (!curlsTowardPalm(toVec3(forward), toVec3(normal), axisVec)) axis.negate();

      segments.push({
        bone,
        rest: bone.quaternion.clone(),
        curl: axis,
        spread: normal,
        spreadSign: sign,
      });
      bone = next;
    }
    if (segments.length > 0) fingers[finger] = segments;
  }

  return {
    wrist,
    forwardLocal,
    normalLocal,
    fingers,
  };
}

/**
 * Build the whole rig, or null if this model has no usable arms.
 *
 * MUST be called before anything poses the model — see the header. The
 * `leftarm$` / `leftforearm$` suffix pair is safe as written: the two differ
 * in their last several characters, so no explicit exclusion is needed.
 */
export function buildArmRig(model: THREE.Object3D): AvatarRig | null {
  model.updateMatrixWorld(true);

  const hips = findBone(model, /hips$/i);
  const arms: ArmRig[] = [];
  const hipWorld = new THREE.Vector3();
  if (hips) hips.getWorldPosition(hipWorld);

  for (const side of ["left", "right"] as const) {
    const shoulder = findBone(model, new RegExp(`${side}arm$`, "i"));
    const elbow = findBone(model, new RegExp(`${side}forearm$`, "i"));
    const hand = buildHandRig(side, model);
    if (!shoulder || !elbow || !hand) continue;

    const shoulderWorld = new THREE.Vector3();
    const elbowWorld = new THREE.Vector3();
    const wristWorld = new THREE.Vector3();
    shoulder.getWorldPosition(shoulderWorld);
    elbow.getWorldPosition(elbowWorld);
    hand.wrist.getWorldPosition(wristWorld);

    arms.push({
      shoulder,
      elbow,
      hand,
      armLength: shoulderWorld.distanceTo(elbowWorld) + elbowWorld.distanceTo(wristWorld),
      // Bind pose is a standing T-pose, so the two arms are simply left and
      // right of the hip in the model's own X. Which of those becomes the
      // seat's right once the group is rotated to face the table is fixed by
      // the model's forward axis, and every character here is authored the
      // same way; the sign is confirmed against the rendered seats rather
      // than assumed, and is the one number to re-check if a future roster
      // arrives mirrored.
      lateralSign: shoulderWorld.x >= hipWorld.x ? -1 : 1,
      smoothed: null,
      deficit: 0,
    });
  }

  if (arms.length === 0) return null;

  return { arms, weight: 0, snug: 0 };
}

/** Scratch, allocated once per mounted avatar rather than per frame. */
export interface PoseScratch {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  target: THREE.Vector3;
  aim: THREE.Vector3;
  axis: THREE.Vector3;
  parentQuat: THREE.Quaternion;
  parentInv: THREE.Quaternion;
  delta: THREE.Quaternion;
  desired: THREE.Quaternion;
  scratchQuat: THREE.Quaternion;
  basisLocal: THREE.Matrix4;
  basisWorld: THREE.Matrix4;
  u: THREE.Vector3;
  v: THREE.Vector3;
  w: THREE.Vector3;
  /** Owned by `aimChildAt` alone. Sharing u/v with it aliased the very
   * vector being passed in as the desired position — the function's first
   * line overwrote its own argument, and a skinned mesh fed the resulting
   * garbage rotation stretches to the horizon. Scratch reuse is worth the
   * allocation savings and is worth naming the owner of each slot for. */
  aimFrom: THREE.Vector3;
  aimTo: THREE.Vector3;
  /** Owned by the arm solve in `poseAvatar`. */
  solvedElbow: THREE.Vector3;
  solvedWrist: THREE.Vector3;
}

export function createPoseScratch(): PoseScratch {
  return {
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    c: new THREE.Vector3(),
    target: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    parentQuat: new THREE.Quaternion(),
    parentInv: new THREE.Quaternion(),
    delta: new THREE.Quaternion(),
    desired: new THREE.Quaternion(),
    scratchQuat: new THREE.Quaternion(),
    basisLocal: new THREE.Matrix4(),
    basisWorld: new THREE.Matrix4(),
    u: new THREE.Vector3(),
    v: new THREE.Vector3(),
    w: new THREE.Vector3(),
    aimFrom: new THREE.Vector3(),
    aimTo: new THREE.Vector3(),
    solvedElbow: new THREE.Vector3(),
    solvedWrist: new THREE.Vector3(),
  };
}

/**
 * Compose a world-space rotation onto whatever local rotation the clip just
 * set for `bone`, without needing to know the bone's own axis convention:
 * newLocal = parentInv * deltaWorld * parentWorld * clipLocal.
 */
function applyWorldDelta(
  bone: THREE.Bone,
  deltaWorld: THREE.Quaternion,
  scratch: PoseScratch
): void {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(scratch.parentQuat);
  scratch.parentInv.copy(scratch.parentQuat).invert();
  scratch.desired
    .copy(scratch.parentInv)
    .multiply(deltaWorld)
    .multiply(scratch.parentQuat)
    .multiply(bone.quaternion);
  bone.quaternion.copy(scratch.desired);
}

/** Rotate `bone` so its child swings from where it is to where it should be. */
function aimChildAt(
  bone: THREE.Bone,
  pivot: THREE.Vector3,
  current: THREE.Vector3,
  desired: THREE.Vector3,
  weight: number,
  scratch: PoseScratch
): void {
  if (!bone.parent || weight <= 0) return;
  scratch.aimFrom.copy(current).sub(pivot);
  scratch.aimTo.copy(desired).sub(pivot);
  if (scratch.aimFrom.lengthSq() < 1e-10 || scratch.aimTo.lengthSq() < 1e-10) return;
  scratch.aimFrom.normalize();
  scratch.aimTo.normalize();
  scratch.delta.setFromUnitVectors(scratch.aimFrom, scratch.aimTo);
  if (weight < 1) scratch.delta.slerp(scratch.scratchQuat.identity(), 1 - weight);
  applyWorldDelta(bone, scratch.delta, scratch);
}

export interface PoseInputs {
  slot: number;
  /** Does this seat still hold live cards to be aware of? */
  hasCards: boolean;
  /** 0..1 target strength — see `handPoseWeight`. */
  weight: number;
  /** 0..1, how far the card hand settles onto the cards (their turn). */
  snug: number;
  timeS: number;
  delta: number;
  /** The seat's normalizing scale, converting the rig's model-unit bind
   * measurements into the world units every anchor is stated in. */
  modelScale: number;
}

/**
 * Drive one avatar's arms, wrists and fingers for this frame.
 *
 * Runs AFTER the animation mixer (see the registration order note in
 * glb-avatar.tsx): every bone below has just been rewritten from the clip,
 * and this is the pass that has the last word on the ones it owns.
 */
export function poseAvatar(rig: AvatarRig, scratch: PoseScratch, input: PoseInputs): void {
  const { delta } = input;
  const ease = (rate: number) => 1 - Math.exp(-rate * delta);

  rig.weight += (input.weight - rig.weight) * ease(WEIGHT_DAMPING);
  rig.snug += (input.snug - rig.snug) * ease(WEIGHT_DAMPING);

  // A hand that is not being driven at all is left entirely to the clip —
  // and cheaply, since fold and celebrate are the two poses in the roster
  // with real arm content and no reason to pay for a solve on top.
  if (rig.weight < 0.01) return;

  const frame = seatFrame(input.slot);

  // NO TORSO LEAN, AND THAT IS A MEASURED DECISION RATHER THAN AN OMISSION.
  //
  // A seated player at this table genuinely cannot reach their own cards —
  // that measurement is what `hand-anchors.ts`'s header records — so an
  // earlier cut of this file pitched the spine forward to close the gap, the
  // same way the offline bake does. Two things killed it. Aiming the wrist a
  // palm's length short of the cards (CARD_HAND_SETBACK) had already taken
  // the residual deficit down to 0.000-0.100 world units across the six
  // seats, worst on the near player, who is seen from behind; a lean big
  // enough to matter against numbers that small reads as hunching over the
  // felt, and at the 24-degree cap it put heads through the rail. And the
  // loop was unstable by construction: leaning reduces the deficit that
  // asked for the lean, so it hunts. `reachableTarget` absorbs what is left
  // by stopping the hand short along the same line, which is invisible at
  // this scale and cannot oscillate. Re-adding a lean means re-measuring the
  // deficits first, and driving it from something other than its own effect.

  // --- arms -------------------------------------------------------------
  for (const arm of rig.arms) {
    // The spine just moved; these have to be re-derived, not cached.
    arm.shoulder.updateWorldMatrix(true, false);
    arm.elbow.updateWorldMatrix(true, false);
    arm.hand.wrist.updateWorldMatrix(true, false);
    scratch.a.setFromMatrixPosition(arm.shoulder.matrixWorld);
    scratch.b.setFromMatrixPosition(arm.elbow.matrixWorld);
    scratch.c.setFromMatrixPosition(arm.hand.wrist.matrixWorld);

    const role: HandRole = input.hasCards && arm.lateralSign > 0 ? "cards" : "rail";
    const anchor = handAnchor(input.slot, role, arm.lateralSign, rig.snug);
    const drift = idleDrift(input.slot, arm.lateralSign, input.timeS);
    scratch.target.set(
      anchor.wrist.x + drift.x,
      anchor.wrist.y + drift.y,
      anchor.wrist.z + drift.z
    );

    const reach = reachableTarget(
      { x: scratch.a.x, y: scratch.a.y, z: scratch.a.z },
      arm.armLength * input.modelScale,
      { x: scratch.target.x, y: scratch.target.y, z: scratch.target.z }
    );
    arm.deficit = reach.deficit;
    scratch.target.set(reach.target.x, reach.target.y, reach.target.z);

    // The felt clamp the previous version of this file existed entirely to
    // do, kept: an anchor is above the cloth by construction, but a target
    // pulled back toward an unreachable line, plus drift, is not guaranteed
    // to be — and the rail's own crown is higher than the felt it surrounds.
    const clamped = clampWristToFelt(
      { x: scratch.target.x, y: scratch.target.y, z: scratch.target.z },
      tableSurfaceY(scratch.target)
    );
    if (clamped) scratch.target.set(clamped.x, clamped.y, clamped.z);

    // Smooth the TARGET and apply the solve at full strength — see
    // `dampPointToward` in arm-ik.ts for why the reverse silently
    // under-corrects forever.
    if (!arm.smoothed) {
      arm.smoothed = scratch.target.clone();
    } else {
      const next = dampPointToward(
        { x: arm.smoothed.x, y: arm.smoothed.y, z: arm.smoothed.z },
        { x: scratch.target.x, y: scratch.target.y, z: scratch.target.z },
        IK_DAMPING,
        delta
      );
      arm.smoothed.set(next.x, next.y, next.z);
    }

    const solved = solveTwoBoneIk(
      { x: scratch.a.x, y: scratch.a.y, z: scratch.a.z },
      { x: scratch.b.x, y: scratch.b.y, z: scratch.b.z },
      { x: scratch.c.x, y: scratch.c.y, z: scratch.c.z },
      { x: arm.smoothed.x, y: arm.smoothed.y, z: arm.smoothed.z }
    );

    scratch.solvedElbow.set(solved.elbow.x, solved.elbow.y, solved.elbow.z);
    aimChildAt(arm.shoulder, scratch.a, scratch.b, scratch.solvedElbow, rig.weight, scratch);
    // Both joints solve off the same snapshot rather than re-reading the
    // elbow after the shoulder turned: the error that introduces is
    // second-order in the shoulder's own rotation and is re-measured from
    // scratch next frame.
    scratch.solvedWrist.set(solved.wrist.x, solved.wrist.y, solved.wrist.z);
    aimChildAt(arm.elbow, scratch.b, scratch.c, scratch.solvedWrist, rig.weight, scratch);

    poseHand(arm, anchor.aim, frame, rig.weight, role, rig.snug, scratch);
  }
}

/**
 * Shape the fingers and nothing else.
 *
 * For a character rendered with no table in the scene at all — the store's
 * preview canvas — where every world-space anchor in this file points at
 * furniture that isn't there. The uniform baked curl is still wrong in that
 * canvas, though, and it is the same wrongness, so the half of the fix that
 * needs no table is applied on its own rather than the whole thing being
 * skipped.
 */
export function poseFingersOnly(rig: AvatarRig, scratch: PoseScratch, weight: number): void {
  if (weight <= 0.01) return;
  for (const arm of rig.arms) {
    shapeFingers(arm.hand, HAND_SHAPES.loose, weight, scratch);
  }
}

/**
 * Turn the hand so the palm lies on the table and the fingers point at what
 * the hand is there for, then shape the fingers.
 *
 * This is the half of "aware of where their cards are" that position alone
 * cannot deliver: an arm solved perfectly to a point beside the cards, with
 * the wrist left at whatever roll the clip happened to leave, is a hand in
 * the right place facing nowhere — which is most of what reads as a prop
 * being held rather than a table being touched.
 */
function poseHand(
  arm: ArmRig,
  aim: { x: number; y: number; z: number },
  frame: { forward: { x: number; y: number; z: number } },
  weight: number,
  role: HandRole,
  snug: number,
  scratch: PoseScratch
): void {
  const hand = arm.hand;
  hand.wrist.updateWorldMatrix(true, false);
  scratch.a.setFromMatrixPosition(hand.wrist.matrixWorld);

  // Desired finger direction: from the wrist toward what it is reaching for,
  // flattened onto the table plane. Falls back to the seat's own forward if
  // the wrist has somehow arrived on top of its target.
  scratch.u.set(aim.x - scratch.a.x, 0, aim.z - scratch.a.z);
  if (scratch.u.lengthSq() < 1e-8) scratch.u.set(frame.forward.x, 0, frame.forward.z);
  scratch.u.normalize();
  // Palm down: the normal points out of the BACK of the hand, so it faces up.
  scratch.v.set(0, 1, 0);
  scratch.u.projectOnPlane(scratch.v).normalize();
  scratch.w.copy(scratch.u).cross(scratch.v).normalize();
  // Then tip the whole hand nose-down about its own across-the-knuckles
  // axis, so the fingers run DOWN to the cloth from a wrist that is
  // necessarily above it — see RESTING_HAND_PITCH. Rotating the basis rather
  // than the aim point keeps the palm normal square to the fingers.
  scratch.u.applyAxisAngle(scratch.w, -RESTING_HAND_PITCH);
  scratch.v.applyAxisAngle(scratch.w, -RESTING_HAND_PITCH);

  scratch.basisWorld.makeBasis(scratch.u, scratch.v, scratch.w);
  scratch.basisLocal.makeBasis(
    scratch.axis.copy(hand.forwardLocal),
    scratch.target.copy(hand.normalLocal),
    scratch.aim.copy(hand.forwardLocal).cross(hand.normalLocal).normalize()
  );
  // q = worldBasis * localBasis^-1 — the rotation carrying the hand's own
  // finger/palm axes onto the ones the table wants.
  scratch.desired.setFromRotationMatrix(scratch.basisWorld);
  scratch.scratchQuat.setFromRotationMatrix(scratch.basisLocal).invert();
  scratch.desired.multiply(scratch.scratchQuat);

  if (hand.wrist.parent) {
    hand.wrist.parent.getWorldQuaternion(scratch.parentQuat);
    scratch.parentInv.copy(scratch.parentQuat).invert();
    scratch.desired.premultiply(scratch.parentInv);
    hand.wrist.quaternion.slerp(scratch.desired, weight);
  }

  // Fingers, absolute from the captured rest pose. `overCards` only when the
  // hand actually has cards under it — an off hand at the table edge that
  // arched onto nothing would read as holding an invisible card, which is
  // the same failure in a different place.
  const shape: HandShape =
    role === "cards"
      ? blendHandShapes(HAND_SHAPES.restFlat, HAND_SHAPES.overCards, 0.55 + 0.45 * snug)
      : HAND_SHAPES.restFlat;

  shapeFingers(hand, shape, weight, scratch);
}

/**
 * Write one hand's finger rotations, absolutely, from the captured bind
 * rotations. Absolute and not additive because the clips key all 40 finger
 * bones with the bake's uniform curl — see this file's header.
 */
function shapeFingers(
  hand: HandRig,
  shape: HandShape,
  weight: number,
  scratch: PoseScratch
): void {
  for (const finger of FINGER_NAMES) {
    const segments = hand.fingers[finger];
    if (!segments) continue;
    const pose = shape[finger];
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      scratch.desired.copy(segment.rest);
      scratch.scratchQuat.setFromAxisAngle(segment.curl, pose.curl[i]);
      scratch.desired.multiply(scratch.scratchQuat);
      // Splay happens at the knuckle only; the joints past it have no
      // sideways freedom on a real hand and giving them some reads as a
      // broken finger rather than a relaxed one.
      if (i === 0 && segment.spreadSign !== 0 && pose.spread !== 0) {
        scratch.scratchQuat.setFromAxisAngle(
          segment.spread,
          pose.spread * segment.spreadSign
        );
        scratch.desired.multiply(scratch.scratchQuat);
      }
      segment.bone.quaternion.slerp(scratch.desired, weight);
    }
  }
}
