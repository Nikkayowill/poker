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

import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useAnimations, useGLTF } from "@react-three/drei";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CHARACTERS_3D, type Character3D } from "@/lib/game3d/characters";
import { clipForState } from "@/lib/game3d/avatar-state";
import { HUMAN_STANDING_UNITS } from "@/lib/game3d/dimensions";
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
}

function GlbAvatarModel({ character }: GlbAvatarProps) {
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
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard?.isMaterial) continue;
        if (typeof standard.roughness === "number") {
          standard.roughness = Math.max(standard.roughness, CLOTH_ROUGHNESS_FLOOR);
        }
        if (typeof standard.metalness === "number") {
          standard.metalness = Math.min(standard.metalness, CLOTH_METALNESS_CEILING);
        }
      }
    });
    return cloned;
  }, [scene]);

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

  useEffect(() => {
    const clipName = clipForState(names, "idle");
    if (!clipName) return;
    const action = actions[clipName]?.reset().fadeIn(0.3).play();
    return () => {
      action?.fadeOut(0.2);
    };
  }, [actions, names]);

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

// Warm the cache for the whole roster up front. A six-max table seats six
// players and the roster is exactly six models, so every one of these is
// wanted on any table that fills — there is nothing to defer. Loading them
// together is what stops late arrivals popping in a beat behind the rest.
//
// This was the wrong call while the roster weighed 48 MB, and the fix was
// the assets rather than the strategy: compressed, all six come to ~3.5 MB.
// If the roster ever grows past the seat count, this should become per-seat.
if (typeof window !== "undefined") {
  // The preload path builds its own loader, so the decoder flags must match
  // the hook above exactly — (useDraco, useMeshopt) = (false, true). Leaving
  // them at drei's defaults pulls in Draco from a CDN the CSP does not name,
  // at module-evaluation time, before any component can render.
  for (const c of CHARACTERS_3D) useGLTF.preload(c.url, false, true);
}
