"use client";

/**
 * The 3D room's root: Canvas setup, the light rig, and the assembly of
 * table, seats, cards and chips from one SceneModel.
 *
 * Performance posture: DPI capped at 2, one shadow-casting light with a
 * 1024 map, shared geometries/materials throughout, low segment counts.
 * The scene is only ever mounted through game3d-canvas.tsx's dynamic
 * `ssr: false` import — three.js must never enter a server bundle.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import type { SceneModel, SeatModel } from "@/lib/game3d/scene-model";
import {
  FELT_TOP_Y,
  betSpotPosition,
  faceCentreRotationY,
  seatPosition,
} from "@/lib/game3d/seat-layout";
import type { Vec3 } from "@/lib/game3d/seat-layout";
import {
  AVATAR_HEAD_Y,
  PlayerAvatar3d,
  type TossClock,
} from "../avatars/player-avatar-3d";
import { ChipField } from "../chips/chip-field";
import { CommunityCards, HoleCards } from "./cards-3d";
import { Table3D } from "./table-3d";

function CameraRig() {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.position.set(0, 4.15, 5.45);
    camera.lookAt(0, 0.55, -0.2);
  }, [camera]);
  return null;
}

function Lights() {
  const spotRef = useRef<THREE.SpotLight>(null);
  useLayoutEffect(() => {
    const spot = spotRef.current;
    if (!spot) return;
    spot.target.position.set(0, FELT_TOP_Y, 0);
    spot.target.updateMatrixWorld();
  }, []);
  return (
    <>
      {/* Low ambient room fill so shadows stay readable, not black. */}
      <hemisphereLight args={["#8f8aa6", "#191219", 0.7]} />
      {/* The one shadow-caster: a hard overhead cone on the centre felt. */}
      <spotLight
        ref={spotRef}
        position={[0, 6.4, 0.7]}
        angle={0.72}
        penumbra={0.4}
        intensity={160}
        decay={1.7}
        color="#fff2dd"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0003}
      />
      {/* Faint warm kick from the camera side so near faces aren't silhouettes. */}
      <directionalLight position={[0, 3.2, 6]} intensity={0.5} color="#e8d9c4" />
    </>
  );
}

function SeatUnit({
  seat,
  lookTarget,
  tossClock,
  glbUrl,
}: {
  seat: SeatModel;
  lookTarget: Vec3 | null;
  tossClock: TossClock;
  glbUrl?: string | null;
}) {
  const position = seatPosition(seat.slot);
  const rotationY = faceCentreRotationY(position);
  const folded = seat.status === "folded" || seat.status === "out";
  return (
    <group
      position={[position.x, position.y, position.z]}
      rotation={[0, rotationY, 0]}
    >
      <PlayerAvatar3d
        slot={seat.slot}
        mood={seat.mood}
        accent={folded ? "#4a4550" : seat.accent}
        lookTarget={lookTarget}
        tossClock={tossClock}
        glbUrl={glbUrl}
        folded={folded}
      />
    </group>
  );
}

function DealerButton({ slot }: { slot: number }) {
  const spot = betSpotPosition(slot);
  const angle = Math.atan2(spot.x, spot.z);
  return (
    <mesh
      position={[
        spot.x + Math.sin(angle) * 0.28,
        FELT_TOP_Y + 0.012,
        spot.z + Math.cos(angle) * 0.28,
      ]}
      castShadow
    >
      <cylinderGeometry args={[0.07, 0.07, 0.024, 20]} />
      <meshStandardMaterial color="#f2ede1" roughness={0.35} />
    </mesh>
  );
}

export interface PokerSceneProps {
  model: SceneModel;
  /** Optional per-slot .glb avatar URLs (e.g. Ready Player Me). */
  avatarUrls?: Record<number, string>;
}

function SceneContents({ model, avatarUrls }: PokerSceneProps) {
  // Slot -> timestamp of that seat's latest chip launch. A mutable shared
  // clock rather than state: avatars sample it per-frame, and a toss must
  // not re-render the tree.
  const tossClock = useRef<Map<number, number>>(new Map());
  const clockHandle: TossClock = tossClock;

  const lookTarget: Vec3 | null = useMemo(() => {
    if (model.activeSlot === null) return null;
    const seat = seatPosition(model.activeSlot);
    return { x: seat.x, y: AVATAR_HEAD_Y, z: seat.z };
  }, [model.activeSlot]);

  const dealerSlot =
    model.seats.find((seat) => seat.isDealer)?.slot ?? null;

  return (
    <>
      <CameraRig />
      <Lights />
      <Table3D />
      {model.seats.map((seat) => (
        <SeatUnit
          key={seat.id}
          seat={seat}
          // The acting player looks at the board, not at themselves.
          lookTarget={seat.slot === model.activeSlot ? null : lookTarget}
          tossClock={clockHandle}
          glbUrl={avatarUrls?.[seat.slot] ?? null}
        />
      ))}
      {model.seats.map((seat) => (
        <HoleCards key={seat.id} seat={seat} />
      ))}
      <CommunityCards cards={model.community} />
      {dealerSlot !== null ? <DealerButton slot={dealerSlot} /> : null}
      <ChipField
        model={model}
        onSeatToss={(slot) => tossClock.current.set(slot, performance.now())}
      />
    </>
  );
}

export function PokerScene(props: PokerSceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 42, near: 0.1, far: 40 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={["#0a0a0b"]} />
      <SceneContents {...props} />
    </Canvas>
  );
}
