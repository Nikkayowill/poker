"use client";

/**
 * <PlayerAvatar3d> — one seated player.
 *
 * Two render paths behind one contract:
 *
 * - `glbUrl` set: the model is loaded with drei's useGLTF (Ready Player Me
 *   URLs and similar rigged .glb files), its clips are matched by intent via
 *   `clipForState`, and state changes cross-fade through the mixer rather
 *   than snapping. Head tracking finds a bone named like "head" and turns it
 *   toward the acting seat, clamped so the head never owls past its body.
 *   NOTE: loading a remote .glb also requires the host in next.config.ts's
 *   CSP `connect-src`; that config is deliberately untouched on this branch,
 *   so remote avatars are opt-in.
 *
 * - no `glbUrl` (and the Suspense fallback while one loads): a low-poly
 *   procedural figure animated entirely in useFrame — breathing, a thinking
 *   sway, a toss lunge, a celebration hop — so the room is fully alive with
 *   zero downloaded assets.
 *
 * All motion is a pure function of clock time and the shared toss clock; no
 * per-frame state feeds back into itself, so a dropped frame can never
 * accumulate drift.
 */

import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AvatarMood } from "@/lib/game3d/scene-model";
import {
  CLIP_FADE_S,
  TOSS_HOLD_MS,
  clampHeadPitch,
  clampHeadYaw,
  clipForState,
  resolveAnimationState,
  type AvatarAnimationState,
} from "@/lib/game3d/avatar-state";
import type { Vec3 } from "@/lib/game3d/seat-layout";

/** Shared, mutable toss clock: slot → ms timestamp of the last chip launch. */
export type TossClock = { current: Map<number, number> };

export interface PlayerAvatarProps {
  slot: number;
  mood: AvatarMood;
  accent: string;
  /** World position of the head to look at, or null to face the table. */
  lookTarget: Vec3 | null;
  tossClock: TossClock;
  glbUrl?: string | null;
  folded: boolean;
}

/** Head height used both for gaze targets and the fallback figure. */
export const AVATAR_HEAD_Y = 1.5;

function animationState(
  mood: AvatarMood,
  slot: number,
  tossClock: TossClock
): AvatarAnimationState {
  return resolveAnimationState(
    mood,
    tossClock.current.get(slot) ?? null,
    performance.now()
  );
}

/* ------------------------------------------------------------------ */
/* Procedural fallback figure                                          */
/* ------------------------------------------------------------------ */

function ProceduralAvatar({
  slot,
  mood,
  accent,
  lookTarget,
  tossClock,
  folded,
}: PlayerAvatarProps) {
  const rootRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);

  const bodyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(accent),
        roughness: 0.65,
      }),
    [accent]
  );
  useEffect(() => () => bodyMaterial.dispose(), [bodyMaterial]);

  useFrame((state, delta) => {
    const root = rootRef.current;
    const torso = torsoRef.current;
    const head = headRef.current;
    if (!root || !torso || !head) return;

    // Per-seat phase offset so six figures never breathe in unison.
    const t = state.clock.elapsedTime + slot * 1.73;
    const current = animationState(mood, slot, tossClock);

    // Baseline breathing, always on.
    torso.scale.y = 1 + Math.sin(t * 1.7) * 0.018;
    torso.position.y = Math.sin(t * 1.7) * 0.008;

    // Sustained pose targets, reached by damping — never snapped.
    let leanTarget = 0;
    let hop = 0;
    let headSway = 0;

    if (current === "thinking") {
      leanTarget = 0.09;
      headSway = Math.sin(t * 2.6) * 0.07;
    } else if (current === "celebrate") {
      hop = Math.abs(Math.sin(t * 5.2)) * 0.11;
      headSway = Math.sin(t * 5.2) * 0.1;
    } else if (current === "toss") {
      // One forward lunge over the toss window, synced to the chip launch.
      const startedAt = tossClock.current.get(slot) ?? 0;
      const p = Math.min(1, (performance.now() - startedAt) / TOSS_HOLD_MS);
      leanTarget = Math.sin(p * Math.PI) * 0.32;
    }

    root.rotation.x = THREE.MathUtils.damp(root.rotation.x, leanTarget, 8, delta);
    root.position.y = THREE.MathUtils.damp(root.position.y, hop, 12, delta);

    // Head tracking: gaze target into local space, clamp, damp.
    let yawTarget = 0;
    let pitchTarget = 0;
    if (lookTarget) {
      const local = head.parent!.worldToLocal(
        new THREE.Vector3(lookTarget.x, lookTarget.y, lookTarget.z)
      );
      local.sub(head.position);
      yawTarget = clampHeadYaw(Math.atan2(local.x, local.z));
      pitchTarget = clampHeadPitch(-Math.atan2(local.y, Math.hypot(local.x, local.z)));
    }
    yawRef.current = THREE.MathUtils.damp(yawRef.current, yawTarget, 5, delta);
    pitchRef.current = THREE.MathUtils.damp(pitchRef.current, pitchTarget, 5, delta);
    head.rotation.set(pitchRef.current, yawRef.current, headSway);
  });

  return (
    <group ref={rootRef}>
      <group ref={torsoRef} scale={folded ? [1, 0.96, 1] : [1, 1, 1]}>
        {/* Torso */}
        <mesh position={[0, 0.98, 0]} castShadow>
          <capsuleGeometry args={[0.24, 0.55, 6, 14]} />
          <primitive object={bodyMaterial} attach="material" />
        </mesh>
        {/* Arms resting toward the rail */}
        <mesh position={[-0.31, 0.98, 0.06]} rotation={[0.5, 0, 0.5]} castShadow>
          <capsuleGeometry args={[0.075, 0.42, 4, 10]} />
          <primitive object={bodyMaterial} attach="material" />
        </mesh>
        <mesh position={[0.31, 0.98, 0.06]} rotation={[0.5, 0, -0.5]} castShadow>
          <capsuleGeometry args={[0.075, 0.42, 4, 10]} />
          <primitive object={bodyMaterial} attach="material" />
        </mesh>
      </group>
      <group ref={headRef} position={[0, AVATAR_HEAD_Y, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.17, 20, 16]} />
          <meshStandardMaterial color="#d9b48f" roughness={0.7} />
        </mesh>
        {/* Visor band — reads as a face direction at distance. */}
        <mesh position={[0, 0.03, 0.13]}>
          <boxGeometry args={[0.2, 0.05, 0.08]} />
          <meshStandardMaterial color="#1c2026" roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* GLB path                                                            */
/* ------------------------------------------------------------------ */

function GlbAvatar(props: PlayerAvatarProps & { glbUrl: string }) {
  const { glbUrl, slot, mood, lookTarget, tossClock } = props;
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(glbUrl);

  // Clone with skeleton so six seats can share one cached asset.
  const model = useMemo(() => {
    const cloned = cloneSkeleton(scene);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = false;
      }
    });
    return cloned;
  }, [scene]);

  const headBone = useMemo<THREE.Object3D | null>(() => {
    let bone: THREE.Object3D | null = null;
    model.traverse((obj) => {
      if (bone === null && /head/i.test(obj.name)) bone = obj;
    });
    return bone;
  }, [model]);
  // Rest pose, restored each frame when no clip is re-posing the skeleton —
  // otherwise the per-frame rotateY below would accumulate and spin the head.
  const headRestQuat = useMemo(() => headBone?.quaternion.clone() ?? null, [headBone]);

  // useAnimations registers its mixer-update useFrame here — before our own
  // useFrame below — so within the same priority our head-tracking runs
  // after the mixer has posed the skeleton each frame.
  const { actions, names } = useAnimations(animations, groupRef);
  const playingRef = useRef<string | null>(null);
  const stateRef = useRef<AvatarAnimationState>("idle");
  const yawRef = useRef(0);
  const pitchRef = useRef(0);

  // Cross-fade whenever the resolved state changes. The resolution itself is
  // sampled per-frame (toss is a transient on a shared clock, not a prop),
  // so the fade is driven from useFrame rather than an effect.
  useFrame((_, delta) => {
    const nextState = animationState(mood, slot, tossClock);
    if (nextState !== stateRef.current || playingRef.current === null) {
      stateRef.current = nextState;
      const clipName = clipForState(names, nextState);
      if (clipName && clipName !== playingRef.current) {
        const prev = playingRef.current ? actions[playingRef.current] : null;
        const next = actions[clipName];
        if (next) {
          prev?.fadeOut(CLIP_FADE_S);
          next.reset().fadeIn(CLIP_FADE_S).play();
          playingRef.current = clipName;
        }
      }
    }

    // Head tracking over the animated pose: convert the gaze target into the
    // bone's parent space and post-rotate the bone by damped, clamped angles.
    if (!headBone) return;
    if (playingRef.current === null && headRestQuat) {
      headBone.quaternion.copy(headRestQuat);
    }
    let yawTarget = 0;
    let pitchTarget = 0;
    if (lookTarget && headBone.parent) {
      const local = headBone.parent.worldToLocal(
        new THREE.Vector3(lookTarget.x, lookTarget.y, lookTarget.z)
      );
      local.sub(headBone.position);
      yawTarget = clampHeadYaw(Math.atan2(local.x, local.z));
      pitchTarget = clampHeadPitch(
        -Math.atan2(local.y, Math.hypot(local.x, local.z))
      );
    }
    yawRef.current = THREE.MathUtils.damp(yawRef.current, yawTarget, 5, delta);
    pitchRef.current = THREE.MathUtils.damp(pitchRef.current, pitchTarget, 5, delta);
    headBone.rotateY(yawRef.current);
    headBone.rotateX(pitchRef.current);
  });

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  );
}

/* ------------------------------------------------------------------ */

export function PlayerAvatar3d(props: PlayerAvatarProps) {
  if (!props.glbUrl) {
    return <ProceduralAvatar {...props} />;
  }
  return (
    <Suspense fallback={<ProceduralAvatar {...props} />}>
      <GlbAvatar {...props} glbUrl={props.glbUrl} />
    </Suspense>
  );
}
