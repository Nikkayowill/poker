"use client";

/**
 * <GlbAvatar> — a seat's player, rendered from a real rigged .glb rather
 * than the six-angle sprite turnaround it sits alongside. First pass for
 * evaluating the new character roster (lib/game3d/characters.ts) before any
 * decision to make this the seats' primary renderer.
 *
 * SCALE IS MEASURED, NOT ASSUMED — and WHAT is measured is the whole point.
 *
 * Measuring per model is right: the roster does not agree with itself.
 * Michael is authored at almost exactly twice the other five (bind-pose
 * skeleton 3.72 units tall against their ~1.77), so one unit-convention
 * constant would have to be wrong for somebody. But five of the six ARE in
 * metres, which is what dimensions.ts always said they would be; the
 * earlier note here — that the first render proved otherwise, a
 * centimetre export ~100x too large — described a *symptom* of the bug
 * below, not a unit convention. Nothing in this roster is in centimetres.
 *
 * THE BUG THAT COST THE FIRST PASS: the skeleton was measured at BIND
 * pose, but every one of these rigs renders its baked clip, and that clip
 * is SEATED. So the numbers being read were a standing person's (head top
 * 1.77, hip 0.97) while the thing on screen was a sitting one (head 1.12,
 * hip 0.57). Two errors fell out of that one mistake, which is why the
 * result read as "too large" and "too small" at the same time depending on
 * which seat you looked at. The height normalized was a standing height
 * held to a target meant for a seated figure, and the hip the group was
 * positioned by was the STANDING hip — 0.4 units above where the seated
 * hip actually is — so every character was posted that far into the floor,
 * which is what read as figures reclining through their own chairs. The
 * clip is sampled at t=0 here now, before anything is measured.
 *
 * The target is derived, not tuned: HUMAN_STANDING_UNITS in dimensions.ts,
 * a real 1.75 m adult under the vertical ruler the TABLE actually has.
 * Read that constant's comment before changing anything here — the room is
 * not isotropic, and this file is downstream of that fact, not the cause
 * of it.
 *
 * OCCLUSION is real now, not baked: a standing figure at seatPosition (floor
 * level, just outside the rail) lets Table3D's own geometry hide whatever it
 * hides, seat by seat, instead of the sprite's painted rail-fade alpha mask.
 * Judge the crop on a render — it will not match every seat evenly the way
 * the mask did.
 *
 * LIGHTING: unlike the sprites (MeshBasicMaterial, pre-lit artwork), a glTF
 * import keeps its own PBR materials and takes the scene's studio lights
 * directly — this is the thing sprites structurally could not do.
 *
 * Folded/acting/winner tinting is deliberately not wired yet — first the
 * base look, at the right scale, under the studio lights, needs to be
 * judged on a render before any state-dressing goes on top of it.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { STARTER_CHARACTERS_3D, type Character3D } from "@/lib/game3d/characters";
import {
  CLIP_FADE_S,
  baseAnimationState,
  clipForState,
  transientAnimationState,
  type AvatarAnimationState,
} from "@/lib/game3d/avatar-state";
import type { AvatarMood, SeatModel } from "@/lib/game3d/scene-model";
import { HUMAN_STANDING_UNITS } from "@/lib/game3d/dimensions";
import { handPoseWeight } from "@/lib/game3d/hand-anchors";
import { buildArmRig, createPoseScratch, poseAvatar, poseFingersOnly } from "./arm-rig";
import { CHAIR_SEAT_Y } from "../scene/chair";

/**
 * Standing height, in world units, every model is normalized to — derived
 * from a stated adult height and the room's vertical ruler rather than
 * picked. Kept as a named re-export so the seated-pose maths below reads
 * against one name.
 */
export const TARGET_HEIGHT = HUMAN_STANDING_UNITS;

/**
 * How far the hip bone sits above the chair's own seat-pan top — a real
 * cushion compresses a little under a sitting person, so a hair of positive
 * clearance (rather than 0) reads as sitting IN the chair instead of
 * levitating a whole cushion-thickness above it.
 */
const HIP_SIT_RISE = 0.03;

/** See the clamp in the clone below for why these exist and why they clamp. */
const CLOTH_ROUGHNESS_FLOOR = 0.55;
const CLOTH_METALNESS_CEILING = 0.15;

export interface GlbAvatarProps {
  slot: number;
  character: Character3D;
  mood: AvatarMood;
  status: SeatModel["status"];
  isCurrent: boolean;
  /**
   * Does this seat still hold live cards? Drives which of the player's two
   * hands covers the card spot and which rests at the table edge — a seat
   * with nothing in front of it must not be cradling it.
   */
  inHand: boolean;
  /**
   * False for a character rendered on its own, with no room around it — the
   * store's preview canvas. Every anchor the seated rest pose reaches for is
   * a world-space point on the table, so a figure rendered without one must
   * not reach; it still gets the finger shaping, which needs no furniture.
   */
  atTable?: boolean;
  lastAction: string | null;
  /** Changes once per server-authored seat action, even when its label repeats. */
  actionKey: string;
}

function GlbAvatarModel({
  slot,
  character,
  mood,
  status,
  isCurrent,
  inHand,
  atTable = true,
  lastAction,
  actionKey,
}: GlbAvatarProps) {
  const groupRef = useRef<THREE.Group>(null);
  // (url, useDraco, useMeshopt). Meshopt is ON and Draco stays OFF, and the
  // asymmetry is the point. scripts/compress-3d-assets.sh now meshopt-encodes
  // every roster model, so the decoder is required rather than pure cost —
  // and it instantiates a WebAssembly module, which `script-src` blocks
  // without 'wasm-unsafe-eval'. That entry went into next.config.ts in the
  // same change, exactly as this comment used to ask.
  //
  // Draco is still off, and not for want of compression: drei fetches its
  // decoder from a gstatic CDN, which would make a third-party origin a hard
  // dependency of the table rendering at all. Meshopt's decoder ships inside
  // the bundle. If a future asset needs Draco, self-host the decoder rather
  // than widening script-src to a CDN.
  const { scene, animations } = useGLTF(character.url, false, true);

  // Clone with skeleton so the same URL can seat more than one slot without
  // the mixer of one seat re-posing every other seat's shared scene graph.
  const model = useMemo(() => {
    const cloned = cloneSkeleton(scene) as THREE.Object3D;
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // A ROUGHNESS FLOOR, and it is about this room rather than about the
      // models. These exports carry KHR_materials_specular and were authored
      // for a soft, many-light preview; under one hard spotlight and a warm
      // key they returned broad mirror highlights, and a cotton hoodie, denim
      // shorts and a wool top all read as wet latex. Clamping rather than
      // assigning keeps a genuinely glossy surface (hair, a leather jacket)
      // ahead of a matte one — the relative ordering the artist authored
      // survives, only the top of the range is pulled back.
      // Materials have to be per-seat too: folded/current dressing below is
      // stateful and two players may use the same character URL.
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materials = sourceMaterials.map((material) => material.clone());
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard?.isMaterial) continue;
        if (typeof standard.roughness === "number") {
          standard.roughness = Math.max(standard.roughness, CLOTH_ROUGHNESS_FLOOR);
        }
        if (typeof standard.metalness === "number") {
          standard.metalness = Math.min(standard.metalness, CLOTH_METALNESS_CEILING);
        }
        if ("color" in standard && standard.color) {
          standard.userData.stackchipsBaseColor = standard.color.clone();
        }
      }
    });
    return cloned;
  }, [scene]);

  // Bones, bind-pose measurements and every joint's own flexion axis, found
  // once per model rather than per frame. MUST be built before the hip
  // sampling below: that runs a throwaway mixer and leaves the model posed
  // at the seated clip's first frame, while every number the rig captures —
  // bone lengths, the palm plane, each finger's rest rotation — is a
  // property of the BIND skeleton. `useMemo` order is what guarantees it,
  // so these two blocks cannot be reordered.
  //
  // Mixamo's per-download name prefix ("mixamorig:", "mixamorig8",
  // "mixamorig9Hips" with and without the colon) is handled by suffix
  // matching, the same way the hip lookup below handles it.
  const rig = useMemo(() => buildArmRig(model), [model]);
  // Scratch objects, not per-model state — a plain useMemo(() => ..., [])
  // rather than a ref, since this only ever needs to be built once per
  // mount and a ref read during render is exactly what react-hooks/refs
  // flags.
  const poseScratch = useMemo(() => createPoseScratch(), []);

  // Measured off the SKELETON's world positions, not Box3.setFromObject:
  // for a SkinnedMesh, three's default bounds come from the raw (unskinned)
  // geometry attribute, not the bone-deformed shape, and on these rigs that
  // returned a near-degenerate box a few millimetres tall — collapsed toward
  // wherever the mesh's local vertex space happens to sit before skinning,
  // nothing to do with the actual character size. Bone world positions
  // reflect the real skeleton regardless of that quirk.
  //
  // TWO POSES ARE MEASURED, AND THEY ARE DIFFERENT POSES ON PURPOSE:
  //   * the STANDING bind pose gives the height — "how tall is this person"
  //     is a property of the person, and it is the only span that compares
  //     across a roster whose baked clips do not all sit the same way;
  //   * the SEATED clip at t=0 gives the hip, because the hip is what has
  //     to land on a chair, and it is ~0.4 model-units below the standing
  //     one. Reading it off the bind pose is the bug in this file's header.
  const { scale, hipOffset } = useMemo(() => {
    const boneSpanY = () => {
      model.updateMatrixWorld(true);
      let min = Infinity;
      let max = -Infinity;
      // Mixamo prefixes this per-download ("mixamorig:Hips", "mixamorig8:Hips",
      // "mixamorig9Hips" — with and without the colon) — match the suffix.
      let hip: number | null = null;
      const pos = new THREE.Vector3();
      model.traverse((obj) => {
        if (!(obj as THREE.Bone).isBone) return;
        obj.getWorldPosition(pos);
        min = Math.min(min, pos.y);
        max = Math.max(max, pos.y);
        if (hip === null && /hips$/i.test(obj.name)) hip = pos.y;
      });
      return { min, max, hip };
    };

    const bind = boneSpanY();
    let minY = bind.min;
    let maxY = bind.max;
    if (!Number.isFinite(minY) || maxY - minY < 1e-6) {
      const box = new THREE.Box3().setFromObject(model);
      minY = box.min.y;
      maxY = box.max.y;
    }
    // No fudge factor. The topmost bone on a Mixamo rig is HeadTop_End, which
    // is the crown — the old 1.08 pad was compensating for the pose error,
    // not for any real gap between the skeleton and the silhouette.
    const s = TARGET_HEIGHT / Math.max(maxY - minY, 0.0001);

    // Pose the clone at the clip's first frame on a throwaway mixer. The
    // mixer useAnimations owns is created later and re-poses this every
    // frame regardless, so sampling here cannot fight it; doing it in render
    // (rather than an effect that then sets state) keeps the figure from
    // ever being committed at the wrong height for a frame.
    const clipName = clipForState(animations.map((clip) => clip.name), "idle");
    const clip = animations.find((c) => c.name === clipName) ?? animations[0];
    let posedHip: number | null = null;
    if (clip) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(clip).play();
      mixer.update(0);
      posedHip = boneSpanY().hip;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    }
    // Fall back to the bind hip, then to the vertical midpoint — a rig with
    // no clip is simply standing, and its bind hip is then the right anchor.
    const hipLocal = posedHip ?? bind.hip ?? minY + (maxY - minY) * 0.5;
    return { scale: s, hipOffset: hipLocal * s };
  }, [model, animations]);

  const { actions, names } = useAnimations(animations, groupRef);
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const firstActionKeyRef = useRef(actionKey);
  /** Wall-clock deadline for the running one-shot gesture; see the frame
   * callback above for why the rest pose stands down while one plays. */
  const gestureUntilRef = useRef(0);
  const baseState = baseAnimationState(mood, status);
  const transientState = transientAnimationState(lastAction);

  // Seated rest pose. Registered AFTER useAnimations' own useFrame (the
  // mixer update), which is what guarantees it runs later in the same frame
  // — react-three-fiber calls same-priority useFrame subscribers in
  // registration order, so this corrects the pose the clip just set rather
  // than one it is about to overwrite. Deliberately not given an explicit
  // priority: any non-zero priority hands rendering itself to that callback,
  // which this has no business taking over.
  //
  // What it does and why it is not just the old felt clamp: see the headers
  // of lib/game3d/hand-anchors.ts (where the hands should be, and the
  // measured reach deficit that means the clips could never have put them
  // there) and lib/game3d/hand-rig.ts (what shape a hand should be in, and
  // why every character was gripping an invisible flute). The clamp itself
  // survives inside `poseAvatar`, applied to the TARGET rather than to a
  // wrist that has already sunk.
  //
  // `gestureUntilRef` is read here rather than in render on purpose: it is
  // the one piece of state a frame callback needs and a render does not, and
  // reading a ref during render is exactly what react-hooks/refs flags.
  useFrame((state, delta) => {
    if (!rig) return;
    const gesturing = performance.now() < gestureUntilRef.current;
    if (!atTable) {
      poseFingersOnly(rig, poseScratch, gesturing ? 0 : 1);
      return;
    }
    poseAvatar(rig, poseScratch, {
      slot,
      hasCards: inHand,
      weight: handPoseWeight({
        folded: baseState === "fold",
        celebrating: baseState === "celebrate",
        gesturing,
      }),
      // A player about to act settles their hand onto their own cards; the
      // rest of the table's rests just short of them.
      snug: isCurrent ? 1 : 0,
      timeS: state.clock.elapsedTime,
      delta,
      modelScale: scale,
    });
  });

  // State belongs on the actual figure in a 3D room, not only on a detached
  // nameplate. Folded players recede into the light; the actor and winner get
  // a restrained warm lift without recolouring skin or clothing outright.
  useEffect(() => {
    const folded = status === "folded" || status === "out";
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        const base = standard.userData.stackchipsBaseColor as THREE.Color | undefined;
        if (base && standard.color) {
          standard.color.copy(base);
          if (folded) standard.color.multiplyScalar(0.34);
          else if (isCurrent) standard.color.lerp(new THREE.Color("#fff1c7"), 0.08);
        }
        if (standard.emissive) {
          standard.emissive.set(isCurrent && !folded ? "#2b1c06" : "#000000");
          standard.emissiveIntensity = isCurrent && !folded ? 0.32 : 0;
        }
        standard.needsUpdate = true;
      }
    });
  }, [isCurrent, model, status]);

  /* AnimationAction is three.js's imperative playback handle. Mutating its
     enabled/loop/clamp fields is the public API; it is not React-owned data. */
  /* eslint-disable react-hooks/immutability */
  const playState = useCallback((state: AvatarAnimationState, once: boolean) => {
    const clipName = clipForState(names, state);
    if (!clipName) return null;
    const next = actions[clipName];
    if (!next) return null;

    const current = activeActionRef.current;
    if (current && current !== next) current.fadeOut(CLIP_FADE_S);
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(1);
    next.clampWhenFinished = once;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.fadeIn(CLIP_FADE_S).play();
    activeActionRef.current = next;
    return next;
  }, [actions, names]);

  // Idle/thinking loop. Fold and celebration are deliberate one-shots: a
  // winner does not repeat the same gesture like a mechanical toy, and a
  // folded player holds the leaned-back end pose until the next hand.
  useEffect(() => {
    playState(baseState, baseState === "fold" || baseState === "celebrate");
  }, [baseState, playState]);

  // Action labels persist in snapshots, so the full actionKey is the edge.
  // Suppressing the first key prevents a freshly mounted table replaying a
  // stale call/check from before the viewer arrived.
  useEffect(() => {
    if (firstActionKeyRef.current === actionKey) return;
    firstActionKeyRef.current = actionKey;
    if (!transientState || baseState === "fold" || baseState === "celebrate") return;

    const played = playState(transientState, true);
    if (!played) return;
    const delayMs = Math.max(0, (played.getClip().duration - CLIP_FADE_S) * 1000);
    // The rest pose yields for the whole gesture plus its fade back, or the
    // last half of a bet would be dragged toward the card spot mid-throw.
    gestureUntilRef.current = performance.now() + delayMs + CLIP_FADE_S * 1000;
    const timeout = window.setTimeout(() => playState(baseState, false), delayMs);
    return () => window.clearTimeout(timeout);
  }, [actionKey, baseState, playState, transientState]);

  useEffect(() => () => {
    activeActionRef.current?.stop();
    activeActionRef.current = null;
  }, []);
  /* eslint-enable react-hooks/immutability */

  // Position so the (scaled) hip lands exactly HIP_SIT_RISE above the
  // chair's seat pan. hipOffset is already in world-scaled units
  // (hipLocal*s), and a group's own position is parent-space — NOT divided
  // by its own scale again, which an earlier cut here got wrong.
  return (
    <group
      ref={groupRef}
      scale={scale}
      position={[0, CHAIR_SEAT_Y + HIP_SIT_RISE - hipOffset, 0]}
    >
      <primitive object={model} />
    </group>
  );
}

export function GlbAvatar(props: GlbAvatarProps) {
  return (
    <Suspense fallback={null}>
      <GlbAvatarModel {...props} />
    </Suspense>
  );
}

// Warm the cache for the STARTER roster up front, not the whole roster. A
// six-max table seats six players and the starter tier is exactly six
// models, so every one of those is wanted on any table that fills — there
// is nothing to defer. Loading them together is what stops late arrivals
// popping in a beat behind the rest.
//
// This was the wrong call while the roster weighed 48 MB, and the fix was
// the assets rather than the strategy: compressed, six models come to
// ~3.5 MB. The roster DID grow past the seat count — eight premium
// characters landed alongside the original six — and this is that "should
// become per-seat" turn arriving: premium characters have no purchase or
// equip path yet, so nothing today can assign one to a seat, and preloading
// all fourteen would put every visitor through ~17 MB of GLBs to render a
// six-seat table that can only ever show the free six. Preload the tier
// that `characterForSlot` can actually hand out; a future equip flow should
// preload a player's own purchased characters alongside this list, not fold
// them into it.
if (typeof window !== "undefined") {
  // The preload path builds its own loader, so the decoder flags must match
  // the hook above exactly — (useDraco, useMeshopt) = (false, true). Leaving
  // them at drei's defaults pulls in Draco from a CDN the CSP does not name,
  // at module-evaluation time, before any component can render.
  for (const c of STARTER_CHARACTERS_3D) useGLTF.preload(c.url, false, true);
}
