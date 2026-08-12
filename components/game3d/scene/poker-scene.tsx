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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
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
import { RIM_RIG } from "@/lib/game3d/floor-environment";
import { STUDIO_SPOT, studioFog } from "@/lib/game3d/studio-environment";
import {
  DEFAULT_ROOM_THEME_ID,
  roomThemeById,
  type RoomTheme,
  type RoomThemeId,
} from "@/lib/game3d/room-theme";
import {
  FELT_TOP_Y,
  betSpotPosition,
  faceCentreRotationY,
  seatPosition,
} from "@/lib/game3d/seat-layout";
import { GlbAvatar } from "../avatars/glb-avatar";
import { characterById, characterForSlot } from "@/lib/game3d/characters";
import { ChipField } from "../chips/chip-field";
import { SeatBankrolls } from "../props/seat-bankrolls";
import { HoleCardProp } from "../props/hole-card-prop";
import { HoleCardsInstanced } from "./cards-instanced";
import { Table3D } from "./table-3d";
import { Chair } from "./chair";
import { SceneSeam } from "./scene-seam";
import { FoldCardFlights } from "./fold-card-flights";
import { RoomSurround } from "./room-surround";
import { allSeatsLoaded } from "@/lib/game3d/avatar-load-gate";

/**
 * How long the room waits for every seated character's .glb before giving up
 * and presenting itself anyway. Without this, one stuck or slow fetch would
 * hold the *entire* room hidden behind the loading splash forever, which is
 * strictly worse than the old behaviour of an individual seat popping in
 * late. Ten seconds is generous for a ~3.5MB starter roster on an ordinary
 * connection and short enough that a genuinely stuck load doesn't strand a
 * player.
 */
const AVATAR_LOAD_TIMEOUT_MS = 10_000;


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
function CameraRig({ theme }: { theme: RoomTheme }) {
  const size = useThree((state) => state.size);
  const framing = useMemo(
    () => frameCamera(size.height > 0 ? size.width / size.height : 1),
    [size.width, size.height],
  );
  // The studio fog is a function of where the camera stands, which changes
  // with the viewport — so it lives with the framing, not in the light rig.
  // Its colour is the active theme's, and must match the canvas background
  // (see the <color> in PokerScene below) or the fade draws a horizon line.
  const fog = useMemo(() => studioFog(framing, theme), [framing, theme]);
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

function Lights({ theme }: { theme: RoomTheme }) {
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
          abyss outright — the falloff/fog contrast is the point. Colour and
          intensity are `theme.hemisphere` now (room-theme.ts); every other
          light in this rig follows the same split. */}
      <hemisphereLight
        args={[theme.hemisphere.sky, theme.hemisphere.ground, theme.hemisphere.intensity]}
      />
      {/* The televised table light: one soft-edged overhead pool, solved in
          lib/game3d/studio-environment.ts so who sits inside it (everyone
          seated) and who falls out of it (a folded figure slid back) is
          unit-tested arithmetic rather than eyeballed. Position/angle/
          penumbra are the shared rig (STUDIO_SPOT); colour/intensity/decay
          are the active theme's mood. */}
      <spotLight
        ref={spotRef}
        position={[STUDIO_SPOT.position.x, STUDIO_SPOT.position.y, STUDIO_SPOT.position.z]}
        angle={STUDIO_SPOT.angle}
        penumbra={STUDIO_SPOT.penumbra}
        intensity={theme.spot.intensity}
        decay={theme.spot.decay}
        color={theme.spot.color}
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
      <directionalLight position={[0, 4.6, 5.2]} intensity={theme.kick.intensity} color={theme.kick.color} />
      {/* Cool rim from behind and to the side, so the rail and the seated
          shoulders have an edge. The spot is directly overhead and the kick
          above is head-on, and a silhouette lit from both of those is
          flattest exactly where its outline is — which is why the table read
          as a shape cut out of the dark rather than an object standing in
          it. Deliberately the only light in the rig that comes from -Z.
          Position and castShadow are the fixed rig (RIM_RIG); colour/
          intensity are the theme's.

          castShadow is spread from the constant rather than defaulted: it is
          the difference between one shadow pass per frame and two over every
          character, chair and chip, and a second map at this intensity would
          cost that and show nothing. See lib/game3d/floor-environment.ts. */}
      <directionalLight
        position={[RIM_RIG.position.x, RIM_RIG.position.y, RIM_RIG.position.z]}
        intensity={theme.rim.intensity}
        color={theme.rim.color}
        castShadow={RIM_RIG.castShadow}
      />
    </>
  );
}

function SeatUnit({
  seat,
  actionKey,
  onAvatarLoaded,
}: {
  seat: SeatModel;
  actionKey: string;
  onAvatarLoaded?: (slot: number) => void;
}) {
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
      {/* The seated .glb roster and its embedded Blender action clips. */}
      <GlbAvatar
        slot={seat.slot}
        character={characterById(seat.avatar3dCosmetic ?? "") ?? characterForSlot(seat.slot)}
        mood={seat.mood}
        status={seat.status}
        isCurrent={seat.isCurrent}
        inHand={seat.inHand}
        lastAction={seat.lastAction}
        actionKey={actionKey}
        onLoaded={onAvatarLoaded}
      />
      {seat.isCurrent || seat.isWinner ? (
        <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.48, 0.72, 48]} />
          <meshBasicMaterial
            color={seat.isWinner ? "#d8a92f" : "#f0c75e"}
            transparent
            opacity={seat.isWinner ? 0.34 : 0.24}
            depthWrite={false}
          />
        </mesh>
      ) : null}
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
  /** Bet events still airborne when this scene is mounted after a renderer switch. */
  resumeBetFlights?: Array<{ id: string; slot: number; amount: number }>;
  /** Which void/carpet/light palette to render — see lib/game3d/room-theme.ts.
   * Optional and defaults to the standing "after dark" look, so a caller that
   * doesn't yet care about the preference (a test, a future embed) still gets
   * a real theme rather than an undefined one threaded into three.js props. */
  roomThemeId?: RoomThemeId;
  /**
   * Fires true once the GL context exists, and false if it is ever lost.
   *
   * This is the same one-signal handshake the Canvas-2D room reports through,
   * and it is what `.scene-lit` keys off: until it goes true the DOM felt and
   * rail keep painting, so a room that never arrives degrades to the table
   * that was already there rather than to a hole. A lost context — the common
   * low-end-mobile failure — reports false and hands the felt straight back.
   */
  onReady?: (ready: boolean) => void;
}

function SceneContents({
  model,
  resumeBetFlights = [],
  theme,
  onAvatarLoaded,
}: {
  model: SceneModel;
  resumeBetFlights?: Array<{ id: string; slot: number; amount: number }>;
  theme: RoomTheme;
  onAvatarLoaded?: (slot: number) => void;
}) {
  const dealerSlot =
    model.seats.find((seat) => seat.isDealer)?.slot ?? null;

  return (
    <>
      <CameraRig theme={theme} />
      {/* Publishes window.__stackchipsScene. Inside the Canvas because that
          is the only place the live camera is reachable, and mounted first
          so a spec polling for the seam is not racing the room's assets. */}
      <SceneSeam />
      <Lights theme={theme} />
      <Table3D theme={theme} />
      {/* A real modelled brass railing around the play area — see
          room-surround.tsx's own header for why only a piece of this asset
          (the balustrade, not the taller walls) is ever actually on screen. */}
      <RoomSurround />
      {/* No house dealer figure: the seats are photographic renders now, and
          nothing in that style exists for the house yet. */}
      {model.seats.map((seat) => (
        <SeatUnit
          key={seat.id}
          seat={seat}
          actionKey={`${model.handNumber}:${model.street}:${seat.status}:${seat.streetBet}:${seat.lastAction ?? ""}`}
          onAvatarLoaded={onAvatarLoaded}
        />
      ))}
      {/* One InstancedMesh for every live hole card (cards-instanced.tsx),
          not one mesh pair per seat — see that file's header for how a
          single atlas material shows N different card faces in one draw
          call. */}
      <HoleCardsInstanced seats={model.seats} />
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
      <FoldCardFlights model={model} />
      {/* The board itself is no longer painted here — see
          hud/board-cards.tsx. A texture lying flat on the felt two metres
          from camera cannot be made to read at a lazy glance on a phone;
          DOM cards floating at the same anchor can. Hole cards stay
          in-scene: they are propped up toward the viewer for exactly this
          legibility reason and are already life-size-plus for a single
          local player, not five cards shared across every viewport. */}
      {dealerSlot !== null ? <DealerButton slot={dealerSlot} /> : null}
      <ChipField model={model} resumeBetFlights={resumeBetFlights} />
      {/* Each player's own chips at the rail — the modelled props, sized by
          each seat's live stack. Deliberately mounted alongside ChipField
          rather than inside it: bets and the pot are engine quantities that
          have to fly, bankrolls are scenery that never moves. See
          props/seat-bankrolls.tsx. */}
      <SeatBankrolls model={model} />
    </>
  );
}

export function PokerScene({
  model,
  resumeBetFlights = [],
  roomThemeId = DEFAULT_ROOM_THEME_ID,
  onReady,
}: PokerSceneProps) {
  const theme = useMemo(() => roomThemeById(roomThemeId), [roomThemeId]);
  // Held in a ref so the Canvas's own props never change identity because a
  // parent re-rendered with a fresh callback -- remounting a Canvas rebuilds
  // the GL context, which is the one thing this component must not do
  // casually (see CLAUDE.md on forceContextLoss).
  const onReadyRef = useRef(onReady);
  // Kept fresh in an effect, not assigned during render. useRef's initial
  // value already holds the first callback, so `onCreated` firing before this
  // effect runs still reports to the right place.
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // `sceneReady` used to mean "the GL context exists," which is essentially
  // immediate and says nothing about whether anyone is actually seated yet.
  // It now means "the context exists AND every currently-modelled seat's
  // .glb has mounted" -- see lib/game3d/avatar-load-gate.ts for the pure
  // predicate. `readyLatchedRef` makes this a one-shot gate for the initial
  // load: once true, a later seat/avatar swap (a reseat, a bot rotating in)
  // never revokes it, so only the first entry into the room pays for the
  // full wait.
  const glCreatedRef = useRef(false);
  const loadedSlotsRef = useRef<Set<number>>(new Set());
  const readyLatchedRef = useRef(false);
  const expectedSlotsRef = useRef<number[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current === null) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const maybeReportReady = useCallback(() => {
    if (readyLatchedRef.current || !glCreatedRef.current) return;
    if (!allSeatsLoaded(expectedSlotsRef.current, loadedSlotsRef.current)) return;
    readyLatchedRef.current = true;
    clearLoadTimeout();
    onReadyRef.current?.(true);
  }, [clearLoadTimeout]);

  // Keeps the expected-seat set current as the game snapshot changes, and
  // re-checks the gate every time -- harmless once latched, since
  // maybeReportReady no-ops immediately in that case.
  useEffect(() => {
    expectedSlotsRef.current = model.seats.map((seat) => seat.slot);
    maybeReportReady();
  }, [model.seats, maybeReportReady]);

  const handleAvatarLoaded = useCallback((slot: number) => {
    loadedSlotsRef.current.add(slot);
    maybeReportReady();
  }, [maybeReportReady]);

  const handleCreated = useCallback((state: { gl: THREE.WebGLRenderer }) => {
    const canvas = state.gl.domElement;
    // Report false BEFORE the browser would otherwise leave a frozen image on
    // screen. preventDefault is what allows a restore to be attempted at all;
    // without it the context is gone for good.
    const lost = (event: Event) => {
      event.preventDefault();
      glCreatedRef.current = false;
      readyLatchedRef.current = false;
      onReadyRef.current?.(false);
    };
    const restored = () => {
      // A restored context re-runs the same gate a first mount does -- the
      // avatars' three.js objects survive a context loss, but their GPU
      // resources do not, so treating this as anything less than a fresh
      // "not ready" would risk showing a room whose textures never re-upload.
      glCreatedRef.current = true;
      maybeReportReady();
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    glCreatedRef.current = true;
    maybeReportReady();
  }, [maybeReportReady]);

  // The timeout safety net: mount-scoped, independent of the gate above, so
  // a single stuck fetch cannot hold the room hidden indefinitely.
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      readyLatchedRef.current = true;
      onReadyRef.current?.(true);
    }, AVATAR_LOAD_TIMEOUT_MS);
    return clearLoadTimeout;
  }, [clearLoadTimeout]);

  useEffect(() => {
    // Unmounting un-lights the felt, so a route change or a StrictMode
    // double-mount hands the DOM table back rather than leaving it hidden
    // behind a canvas that no longer exists.
    return () => onReadyRef.current?.(false);
  }, []);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      onCreated={handleCreated}
      // Rigged characters breathe, think and complete one-shot gestures even
      // while no chips are moving. Demand mode rendered only the first frame
      // of those mixers and left avatars visibly frozen until another scene
      // mutation happened, so the character room owns a continuous loop.
      frameloop="always"
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 42, near: 0.1, far: 40 }}
      style={{ position: "absolute", inset: 0 }}
    >
      {/* Must match the fog colour, or the fade draws a horizon line — both
          read the active theme's `backdrop`. */}
      <color attach="background" args={[theme.backdrop]} />
      <SceneContents
        model={model}
        resumeBetFlights={resumeBetFlights}
        theme={theme}
        onAvatarLoaded={handleAvatarLoaded}
      />
    </Canvas>
  );
}
