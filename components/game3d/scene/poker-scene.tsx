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
import { PerspectiveCamera } from "@react-three/drei";
import {
  seatHasFeltCards,
  seatHoleCardsHidden,
  type SceneModel,
  type SeatModel,
} from "@/lib/game3d/scene-model";
import { frameCamera } from "@/lib/game3d/camera-framing";
import { DEALER_BUTTON } from "@/lib/game3d/dimensions";
import {
  STUDIO_BACKDROP,
  STUDIO_SPOT,
  studioFog,
} from "@/lib/game3d/studio-environment";
import {
  FELT_TOP_Y,
  betSpotPosition,
  faceCentreRotationY,
  seatAngle,
  seatPosition,
} from "@/lib/game3d/seat-layout";
import { SpriteAvatar } from "../avatars/sprite-avatar";
import { GlbAvatar } from "../avatars/glb-avatar";
import { characterForSlot } from "@/lib/game3d/characters";
import { ChipField } from "../chips/chip-field";
import { SeatBankrolls } from "../props/seat-bankrolls";
import { HoleCardProp } from "../props/hole-card-prop";
import { HoleCards } from "./cards-3d";
import { HoleCardsInstanced } from "./cards-instanced";
import { Table3D } from "./table-3d";
import { Chair } from "./chair";


/**
 * The camera, solved for the shape of the viewport rather than fixed.
 *
 * Re-runs on every resize — which is what makes the room work in both
 * orientations of a phone, and the reason it is `size` this depends on and
 * not the mount. The maths is pure and unit-tested in
 * lib/game3d/camera-framing.ts; all this does is push the answer onto the
 * camera and update the projection matrix, which three does not do for a
 * changed `fov` on its own.
 */
function CameraRig() {
  const size = useThree((state) => state.size);
  const framing = useMemo(
    () => frameCamera(size.height > 0 ? size.width / size.height : 1),
    [size.width, size.height],
  );
  // The studio fog is a function of where the camera stands, which changes
  // with the viewport — so it lives with the framing, not in the light rig.
  const fog = useMemo(() => studioFog(framing), [framing]);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  useLayoutEffect(() => {
    cameraRef.current?.lookAt(framing.target.x, framing.target.y, framing.target.z);
  }, [framing]);
  /*
   * drei's camera rather than mutating the one `useThree` hands back. The
   * fov changes with orientation, and assigning it on a hook's return value
   * both trips react-hooks/immutability and leaves the projection matrix
   * stale until something else happens to rebuild it. Declared as a prop,
   * drei owns the update.
   */
  return (
    <>
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        fov={framing.fovY}
        near={0.1}
        far={40}
        position={[framing.position.x, framing.position.y, framing.position.z]}
      />
      <fog attach="fog" args={[fog.color, fog.near, fog.far]} />
    </>
  );
}

function Lights() {
  const spotRef = useRef<THREE.SpotLight>(null);
  useLayoutEffect(() => {
    const spot = spotRef.current;
    if (!spot) return;
    const { target } = STUDIO_SPOT;
    spot.target.position.set(target.x, target.y, target.z);
    spot.target.updateMatrixWorld();
  }, []);
  return (
    <>
      {/* Fill so the dark side of a figure is shape, not hole. Raised from
          the sprite era's 0.24: those were unlit MeshBasicMaterial quads
          that needed only enough ambient to keep the void readable, but a
          real .glb's PBR materials go genuinely black without scene light
          reaching them, which is what made every seated face read as a
          silhouette before this. Still short of relighting the studio
          abyss outright — the falloff/fog contrast is the point. */}
      <hemisphereLight args={["#8f8aa6", "#191219", 0.55]} />
      {/* The televised table light: one soft-edged overhead pool, solved in
          lib/game3d/studio-environment.ts so who sits inside it (everyone
          seated) and who falls out of it (a folded figure slid back) is
          unit-tested arithmetic rather than eyeballed. */}
      <spotLight
        ref={spotRef}
        position={[STUDIO_SPOT.position.x, STUDIO_SPOT.position.y, STUDIO_SPOT.position.z]}
        angle={STUDIO_SPOT.angle}
        penumbra={STUDIO_SPOT.penumbra}
        intensity={STUDIO_SPOT.intensity}
        decay={STUDIO_SPOT.decay}
        color={STUDIO_SPOT.color}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0003}
      />
      {/* Warm kick from the camera side. This light's original job — "so
          near faces aren't silhouettes" — is back: the sprite era's
          reasoning for dimming it to 0.1 (MeshBasic quads take no scene
          light, so this only ever lit the floor) no longer holds now that
          the seats are real .glb meshes with PBR materials, which the
          faceless-looking far seat in a render made obvious. Direction is
          (position → origin), so this travels toward −Z — which is toward
          the far seat's own front, not just the near seats'. */}
      <directionalLight position={[0, 4.6, 5.2]} intensity={0.85} color="#e8d9c4" />
    </>
  );
}

function SeatUnit({ seat }: { seat: SeatModel }) {
  const position = seatPosition(seat.slot);
  const rotationY = faceCentreRotationY(position);
  return (
    <group
      position={[position.x, position.y, position.z]}
      rotation={[0, rotationY, 0]}
    >
      {/* Chairs are back (product direction reversed for the .glb pass —
          see chair.tsx's header for why the old "hard cutout through the
          rail" failure mode doesn't apply to real, depth-tested geometry
          the way it did to the sprite era's flat quads). */}
      <Chair />
      {/* First-pass evaluation of the real .glb roster (see
          components/game3d/avatars/glb-avatar.tsx) in place of the sprite
          turnaround, while this stays judged before any production wiring.
          SpriteAvatar is left mounted commented-out below for a quick
          A/B by uncommenting rather than reconstructing the call. */}
      <GlbAvatar slot={seat.slot} character={characterForSlot(seat.slot)} />
      {/* <SpriteAvatar
        slot={seat.slot}
        seatAngle={seatAngle(seat.slot)}
        acting={seat.isCurrent}
        folded={folded}
        betting={seat.streetBet > 0}
        winner={seat.isWinner}
      /> */}
    </group>
  );
}

/** A real button is 76mm — nearly twice a chip, which is how it is spotted. */
function DealerButton({ slot }: { slot: number }) {
  const spot = betSpotPosition(slot);
  const angle = Math.atan2(spot.x, spot.z);
  const offset = DEALER_BUTTON.radius * 3;
  return (
    <mesh
      position={[
        spot.x + Math.sin(angle) * offset,
        FELT_TOP_Y + DEALER_BUTTON.thickness / 2,
        spot.z + Math.cos(angle) * offset,
      ]}
      castShadow
    >
      <cylinderGeometry
        args={[DEALER_BUTTON.radius, DEALER_BUTTON.radius, DEALER_BUTTON.thickness, 28]}
      />
      <meshStandardMaterial color="#f2ede1" roughness={0.35} />
    </mesh>
  );
}

export interface PokerSceneProps {
  model: SceneModel;
}

function SceneContents({ model }: PokerSceneProps) {
  // Slot -> timestamp of that seat's latest chip launch. A mutable shared
  // clock rather than state: the chip layer samples it per-frame, and a
  // toss must not re-render the tree.
  const tossClock = useRef<Map<number, number>>(new Map());

  const dealerSlot =
    model.seats.find((seat) => seat.isDealer)?.slot ?? null;

  return (
    <>
      <CameraRig />
      <Lights />
      <Table3D />
      {/* No house dealer figure: the seats are photographic renders now, and
          nothing in that style exists for the house yet. */}
      {model.seats.map((seat) => (
        <SeatUnit key={seat.id} seat={seat} />
      ))}
      {/* One InstancedMesh for every live hole card (cards-instanced.tsx),
          not one <HoleCards> per seat — see that file's header for how a
          single atlas material shows N different card faces in one draw
          call. HoleCards/CardPlate (cards-3d.tsx) are left imported and
          commented rather than deleted, matching this file's own
          SpriteAvatar precedent above: an easy A/B if the atlas UV/mipmap
          bleed math (documented as unverified on a real GPU in
          card-atlas-texture.ts's header) doesn't hold up on a render. */}
      <HoleCardsInstanced seats={model.seats} />
      {/* {model.seats.map((seat) => (
        <HoleCards key={seat.id} seat={seat} />
      ))} */}
      {/* An opponent's still-unrevealed pair is the modelled face-down
          prop, not the atlas texture above — see cards-instanced.tsx's own
          header for the split and lib/game3d/scene-model.ts's
          seatHoleCardsHidden for the one predicate both key off. Never the
          local player's own pair: that one is DOM (hud/own-hole-cards.tsx). */}
      {model.seats.map((seat) =>
        seatHasFeltCards(seat) && seatHoleCardsHidden(seat) ? (
          <HoleCardProp key={`hole-card-prop-${seat.id}`} seat={seat} />
        ) : null
      )}
      {/* The board itself is no longer painted here — see
          hud/board-cards.tsx. A texture lying flat on the felt two metres
          from camera cannot be made to read at a lazy glance on a phone;
          DOM cards floating at the same anchor can. Hole cards stay
          in-scene: they are propped up toward the viewer for exactly this
          legibility reason and are already life-size-plus for a single
          local player, not five cards shared across every viewport. */}
      {dealerSlot !== null ? <DealerButton slot={dealerSlot} /> : null}
      <ChipField
        model={model}
        onSeatToss={(slot) => tossClock.current.set(slot, performance.now())}
      />
      {/* Each player's own chips at the rail — the modelled props, sized by
          each seat's live stack. Deliberately mounted alongside ChipField
          rather than inside it: bets and the pot are engine quantities that
          have to fly, bankrolls are scenery that never moves. See
          props/seat-bankrolls.tsx. */}
      <SeatBankrolls model={model} />
    </>
  );
}

export function PokerScene(props: PokerSceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      // On-demand rendering: this room only actually changes when a chip
      // is in flight, a card just dealt, or the camera framing recomputes
      // on resize — not every 16ms. See scene/demand-loop.ts's header for
      // exactly what does and doesn't wake a "demand" loop back up; the
      // chip and card layers are the two pieces of this scene built to
      // that contract (chip-instanced-layer.tsx self-sustains invalidate()
      // only while a flight is airborne).
      frameloop="demand"
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 42, near: 0.1, far: 40 }}
      style={{ position: "absolute", inset: 0 }}
    >
      {/* Must match the fog colour, or the fade draws a horizon line. */}
      <color attach="background" args={[STUDIO_BACKDROP]} />
      <SceneContents {...props} />
    </Canvas>
  );
}
