"use client";

/**
 * <SpriteAvatar> — a seat's player, drawn from the six-angle turnaround.
 *
 * THE ARTWORK CARRIES THE ANGLE. `spriteForSeatAngle` picks the render that
 * already depicts how this chair is turned, so nothing here rotates
 * anything to fake orientation. That is the whole difference from the old
 * standee, which owned one frontal image per character and had to yaw the
 * quad partway toward the seat's facing and clamp it.
 *
 * THE QUAD IS SCREEN-ALIGNED, and that is a fix rather than a shortcut. A
 * world-vertical billboard does not project to screen-vertical under a
 * camera that is pitched down: it keystones, measured here at ±25.8° at
 * the near-side seats on a desktop and ±47.8° on an upright phone, which
 * reads exactly as the two nearest players lounging backwards in their
 * chairs. The same pitch was also squashing every figure vertically by
 * ~31%. Holding the quad parallel to the image plane makes it render
 * precisely as authored — upright, and in the artwork's true proportions —
 * at every seat and every viewport.
 *
 * THE PIVOT IS THE QUAD'S FOOT, not its centre. Tipping a screen-aligned
 * quad about its middle swings its bottom edge toward the camera, which
 * walks the figure forward out of its chair and can push it in front of
 * the rail. Pivoting at the base leaves the player planted and moves only
 * the top of the plane.
 *
 * MOTION is the room's standing contract: breathing, a slow sway, a lean
 * while acting, a fold that dims and settles back. Because the pivot is
 * camera-aligned, `rotateZ` is a true screen-space roll and `rotateX` a
 * camera-relative pitch, so both read the same at every seat.
 *
 * MeshBasicMaterial on purpose — the renders are lit artwork already, and
 * running them through the studio lights would grade them twice; scene fog
 * still applies, so a folded figure recedes into the room's depth.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  ACT_LEAN,
  BREATH_AMPLITUDE,
  BREATH_HZ,
  POSE_DAMP,
  HEAD_RISE,
  SPRITE_BASE_Y,
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  SWAY_AMPLITUDE,
  SWAY_HZ,
  TINT_ACTING,
  TINT_FOLDED,
  TINT_IDLE,
  WIN_PULSE,
  WIN_PULSE_HZ,
  FAR_SEAT_WARM_RIM,
  railFadeAlpha,
  seatGetsWarmRim,
  seatNeedsRailFade,
  spriteForSeatAngle,
  spriteSeatOffsetZ,
  spriteSrc,
} from "@/lib/game3d/avatar-sprites";

/*
 * One decode per URL into an external store, shared by every seat showing
 * the same render. No canvas post-processing here: the bottom falloff that
 * blends each figure into its chair is BAKED into the asset by
 * scripts/build-avatar-sprites.sh, because it is per-region (torso first,
 * sleeves last) rather than a plain vertical ramp a loader could apply.
 */
const artCache = new Map<string, THREE.Texture>();
const artWaiters = new Map<string, Set<() => void>>();

function loadSprite(url: string): void {
  if (artCache.has(url) || artWaiters.has(url)) return;
  artWaiters.set(url, new Set());
  const image = new Image();
  image.onload = () => {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    artCache.set(url, texture);
    for (const notify of artWaiters.get(url) ?? []) notify();
    artWaiters.delete(url);
  };
  image.src = url;
}

function subscribeSprite(url: string, onKnown: () => void): () => void {
  if (!artCache.has(url)) {
    loadSprite(url);
    artWaiters.get(url)?.add(onKnown);
  }
  return () => {
    artWaiters.get(url)?.delete(onKnown);
  };
}

function useSprite(url: string): THREE.Texture | null {
  return useSyncExternalStore(
    (onStoreChange) => subscribeSprite(url, onStoreChange),
    () => artCache.get(url) ?? null,
    () => null
  );
}

/*
 * The near seats' rail fade, as an alphaMap (three multiplies its green
 * channel into the map's own alpha). Painted once from the pure
 * railFadeAlpha in lib — deterministic, so it needs no seed and every
 * mount draws the identical texture. One canvas, shared by both seats.
 */
let railFadeTexture: THREE.CanvasTexture | null = null;

function getRailFadeTexture(): THREE.CanvasTexture {
  if (railFadeTexture) return railFadeTexture;
  const W = 256;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(W, H);
  for (let y = 0; y < H; y += 1) {
    // Canvas rows run top-down; the quad's UV v runs bottom-up.
    const vFromBottom = 1 - y / (H - 1);
    for (let x = 0; x < W; x += 1) {
      const alpha = railFadeAlpha(x / (W - 1), vFromBottom);
      const i = (y * W + x) * 4;
      const value = Math.round(alpha * 255);
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  railFadeTexture = new THREE.CanvasTexture(canvas);
  railFadeTexture.colorSpace = THREE.NoColorSpace;
  return railFadeTexture;
}

export interface SpriteAvatarProps {
  slot: number;
  /** Ring angle of this seat, which is what the picker keys off. */
  seatAngle: number;
  acting: boolean;
  folded: boolean;
  betting: boolean;
  winner: boolean;
}

const parentQuat = new THREE.Quaternion();

export function SpriteAvatar({
  slot,
  seatAngle,
  acting,
  folded,
  betting,
  winner,
}: SpriteAvatarProps) {
  const url = useMemo(() => spriteSrc(spriteForSeatAngle(seatAngle)), [seatAngle]);
  const texture = useSprite(url);

  const material = useMemo(
    () =>
      texture
        ? new THREE.MeshBasicMaterial({
            map: texture,
            // The two foreground seats tip their lower halves out over the
            // padded rail (head pivot), so they carry an extra UV-space
            // falloff that dissolves whatever would cross the rim — see
            // railFadeAlpha in lib/game3d/avatar-sprites.ts.
            alphaMap: seatNeedsRailFade(slot) ? getRailFadeTexture() : null,
            transparent: true,
            // Blended, not alpha-tested: the baked bottom falloff is a soft
            // gradient, and a cutoff would turn it back into a hard edge.
            depthWrite: false,
            toneMapped: false,
            color: new THREE.Color(TINT_IDLE),
            side: THREE.DoubleSide,
          })
        : null,
    [texture, slot]
  );
  useEffect(() => () => material?.dispose(), [material]);

  const tintTarget = useMemo(() => {
    const tint = new THREE.Color(
      folded ? TINT_FOLDED : acting ? TINT_ACTING : TINT_IDLE
    );
    // The far seats sit deepest in the shadow the grounding direction
    // asks for; a warm grade lifts their faces without touching the
    // lights (or the near seats' shadow pools). A folded far seat stays
    // folded-dim — the rim lifts presence, not state.
    if (!folded && seatGetsWarmRim(slot)) {
      tint.r *= FAR_SEAT_WARM_RIM.r;
      tint.g *= FAR_SEAT_WARM_RIM.g;
      tint.b *= FAR_SEAT_WARM_RIM.b;
    }
    return tint;
  }, [folded, acting, slot]);

  const rootRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Group>(null);
  const leanRef = useRef(0);

  useFrame((state, delta) => {
    const root = rootRef.current;
    const pivot = pivotRef.current;
    if (!root || !pivot || !material) return;
    const t = state.clock.elapsedTime + slot * 2.13;

    // Square the quad to the camera's image plane. The seat group is yawed
    // to face the table, so cancel whatever the parents did and adopt the
    // camera's world orientation outright.
    if (pivot.parent) {
      pivot.parent.getWorldQuaternion(parentQuat);
      parentQuat.invert();
      pivot.quaternion.copy(parentQuat).multiply(state.camera.quaternion);
    }

    // Now that local axes are camera axes, these are a screen-space roll
    // and a camera-relative pitch — identical in feel at every seat.
    pivot.rotateZ(Math.sin(t * SWAY_HZ * Math.PI * 2) * SWAY_AMPLITUDE);
    const leanTarget = acting && !folded ? ACT_LEAN : 0;
    leanRef.current = THREE.MathUtils.damp(leanRef.current, leanTarget, POSE_DAMP, delta);
    pivot.rotateX(leanRef.current);

    // Breathing and the winner's pulse scale about the foot, so the figure
    // grows out of the chair rather than sinking into it.
    const breath = 1 + Math.sin(t * BREATH_HZ * Math.PI * 2) * BREATH_AMPLITUDE;
    const pulse = winner
      ? 1 + Math.abs(Math.sin(t * WIN_PULSE_HZ * Math.PI)) * WIN_PULSE
      : 1;
    pivot.scale.set(pulse, breath * pulse, pulse);

    // A fold settles back off the rail; a live bet leans in. Seat-local Z,
    // and spriteSeatOffsetZ keeps every pose clear of the chair back.
    root.position.z = THREE.MathUtils.damp(
      root.position.z,
      spriteSeatOffsetZ(slot, folded, betting),
      POSE_DAMP,
      delta
    );

    material.color.lerp(tintTarget, Math.min(1, delta * POSE_DAMP));
  });

  if (!texture || !material) return null;
  return (
    <group ref={rootRef}>
      {/* Pivot at the HEAD's world height, not the foot — see HEAD_RISE.
          The mesh hangs below it by exactly that much, so the quad still
          spans base..top; it is only the point that stays put when the
          plane tips to face the camera that changes. */}
      <group ref={pivotRef} position={[0, SPRITE_BASE_Y + HEAD_RISE, 0]}>
        <mesh material={material} position={[0, SPRITE_HEIGHT / 2 - HEAD_RISE, 0]}>
          <planeGeometry args={[SPRITE_WIDTH, SPRITE_HEIGHT]} />
        </mesh>
      </group>
    </group>
  );
}
