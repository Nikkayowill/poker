"use client";

/**
 * <SeatBankrolls> — every player's own chips, parked at the rail in front of
 * them.
 *
 * This is the prop the room was missing. chips/chip-field.tsx already draws
 * everything the ENGINE knows about — standing street bets and the centre pot
 * — but those exist only while a hand is being contested, so between hands
 * the felt emptied completely and even mid-hand the four seats who had not
 * bet yet sat behind bare cloth. A card room is mostly chips that are nobody's
 * bet, and that is what this adds.
 *
 * WHY THESE ARE MODELLED AND THE BETS STAY PROCEDURAL. A bet is a live,
 * per-denomination quantity the engine owns and has to be able to fly from a
 * rail to a spot and sweep into a pot; it stays the shared cylinder in
 * chip-stack.tsx, which is built for exactly that. A bankroll never moves and
 * never has to be counted — its whole job is to read as a heap of real clay
 * from two metres — so it is the one place a modelled asset strictly wins.
 * The two sit side by side at the same scale, which is only true because both
 * are built on dimensions.ts's ruler.
 *
 * WHERE THEY GO and WHICH PILE each seat gets is lib/game3d/chip-props.ts —
 * pure, and unit-tested against the felt ellipse, the hole cards and the bet
 * spots, because vitest.config.ts collects only lib/ and app/ and placement
 * arithmetic is exactly the kind of thing that looks right in a file and is
 * wrong on a render.
 *
 * THE PILE TRACKS THE STACK, which is most of the liveliness: `seat.stack` is
 * live, so a player who wins a big pot visibly grows a taller heap and one who
 * is grinding down shrinks to the short stack. The tier bands are wide
 * (chip-props.ts documents why) so this does not flicker mid-hand.
 *
 * THE BASELINE TRACKS THE TABLE, not just the seat. `tierForSeat` reads a
 * seat's own stack as a ratio to THIS TABLE's fixed buy-in
 * (`TIER_CONFIG[model.tier].minBuyIn`) — every seat at one table buys in for
 * the same amount, so that ratio is what actually varies per seat — nudged
 * off a baseline set by the table's own stakes rung. A 1k table reads small
 * overall, a 500k table reads big overall, and either way a seat that's
 * doubled up or busted down still visibly moves. See chip-props.ts's own
 * header for why neither factor alone is enough.
 */

import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import {
  CHIP_PROPS,
  bankrollPosition,
  bankrollRotationY,
  nearSeatTier,
  tierForSeat,
  type ChipPropTier,
} from "@/lib/game3d/chip-props";
import { UNITS_PER_METRE, mm } from "@/lib/game3d/dimensions";
import { TIER_CONFIG } from "@/lib/game/tiers";
import type { SceneModel } from "@/lib/game3d/scene-model";
import {
  buildInstancedProp,
  disposeInstancedProp,
  PROP_DETAIL,
  type PropDetail,
} from "./instanced-prop";

/**
 * The props are authored in metres — measured, not assumed; see
 * MODELLED_CHIP_DIAMETER_M — so they mount on the ruler the felt sets, with
 * no per-asset fudge factor.
 *
 * Note this is the HORIZONTAL ruler deliberately. The room is not isotropic
 * (dimensions.ts's UNITS_PER_METRE_Y explains why), but these props lie ON
 * the cloth, and everything lying on the cloth is judged against the cloth.
 */
const PROP_SCALE = UNITS_PER_METRE;

/**
 * Lifts the pile's base a hair off FELT_TOP_Y — the same reason CARD_LIFT
 * exists in scene/cards-3d.tsx ("a card lies on the cloth, not in it"),
 * applied to a prop that was missing it. Without this the base of the
 * modelled stack sits exactly coplanar with the felt's own top face —
 * invisible on a real GPU, where two coincident surfaces resolve to
 * whichever one the depth buffer's floating-point rounding happens to
 * favour, rather than on SwiftShader's software rasterizer, which had been
 * quietly resolving the tie in the prop's favour and hiding the bug from
 * every headless check run against it. 2mm is generous next to a pile
 * that's centimetres tall — imperceptible, but well clear of any driver's
 * depth precision at this distance from camera.
 */
const PROP_LIFT = mm(2);

/**
 * Per-seat prop cost, published on the window for the same reason the 2D room
 * publishes `__stackchipsScene`: a headless check can then assert the real
 * numbers — where each pile landed, and how many draw calls it became — and a
 * performance pass can read the effect of a detail change without adding
 * instrumentation first.
 */
export interface BankrollStatsEntry {
  tier: ChipPropTier;
  sourceNodes: number;
  drawnNodes: number;
  batches: number;
  triangles: number;
}

declare global {
  interface Window {
    __stackchipsProps?: {
      bankrolls: Record<number, BankrollStatsEntry>;
      position: (slot: number, tier: ChipPropTier) => { x: number; y: number; z: number };
    };
  }
}

function reportBankrollStats(slot: number, stats: BankrollStatsEntry | null): void {
  if (typeof window === "undefined") return;
  const seam = (window.__stackchipsProps ??= {
    bankrolls: {},
    position: bankrollPosition,
  });
  if (stats) seam.bankrolls[slot] = stats;
  else delete seam.bankrolls[slot];
}

function Bankroll({
  slot,
  tier,
  detail,
}: {
  slot: number;
  tier: ChipPropTier;
  detail: PropDetail;
}) {
  // (url, useDraco, useMeshopt) — Meshopt on, Draco off, matching every other
  // .glb in this tree; glb-avatar.tsx carries the full reasoning for why the
  // two decoders are not treated alike. 'wasm-unsafe-eval' is in script-src
  // for the Meshopt decoder, which every compressed prop now needs.
  const { scene } = useGLTF(CHIP_PROPS[tier].url, false, true);

  /*
   * A STABLE, EMPTY CONTAINER is what <primitive> mounts — the built pile is
   * added to it by the effect below, never handed to <primitive> directly.
   *
   * THIS IS NOT A STYLE CHOICE, IT IS THE FIX FOR A BUG THAT ATE THE PROPS.
   * The pile used to be built in a `useMemo` and destroyed in an effect
   * cleanup. React does not pair those two: it may run an effect's cleanup
   * and then mount it again with the SAME memoized value (StrictMode's
   * double-mount in dev, and a Suspense boundary hiding and re-revealing
   * content — which this component always sits inside, because useGLTF
   * suspends). `disposeInstancedProp` ends in `group.clear()`, so that
   * sequence emptied the very group `<primitive>` was still pointing at, and
   * nothing rebuilt it: every chip pile and every face-down pair vanished
   * while the seat, its stats and its shadow decal all stayed correct.
   *
   * It presented as a GPU bug and is not one. Whether the emptied group was
   * the one React kept depended on how the suspend/re-render interleaved,
   * which shifts with load timing — so a headless SwiftShader run drew the
   * props and a real GPU did not, from identical code.
   *
   * Owning the build INSIDE the effect makes the two inseparable: whatever a
   * cleanup tears down, the next mount builds again.
   *
   * The container itself is safe in a `useMemo` precisely because it is the
   * inverse of what broke: it owns no GPU resources and nothing ever disposes
   * it, so React discarding and rebuilding it costs an empty Group. It is in
   * this effect's deps, so a rebuilt container simply gets the pile re-added.
   */
  const container = useMemo(() => new THREE.Group(), []);

  // Built per mounted seat rather than shared: an Object3D has exactly one
  // parent, so one built group cannot hang off six seats at once. The cost of
  // that is only the InstancedMesh wrappers — geometries and materials are
  // still shared with the cached gltf and with the other seats.
  //
  // Reporting what this seat costs rides along here on the same window seam
  // the 2D room established for its e2e checks: it is what makes "instancing
  // collapsed 468 draw calls into 12" an assertion rather than a claim in a
  // comment. It belongs in this effect and not its own, because the stats
  // describe the very object this effect owns the lifetime of.
  useEffect(() => {
    const built = buildInstancedProp(scene, { detail });
    container.add(built.group);
    reportBankrollStats(slot, { tier, ...built.stats });
    return () => {
      reportBankrollStats(slot, null);
      container.remove(built.group);
      disposeInstancedProp(built);
    };
  }, [scene, detail, container, slot, tier]);

  const position = bankrollPosition(slot, tier);
  return (
    <group
      position={[position.x, position.y + PROP_LIFT, position.z]}
      rotation={[0, bankrollRotationY(slot, tier), 0]}
      scale={PROP_SCALE}
    >
      <primitive object={container} />
    </group>
  );
}

export function SeatBankrolls({
  model,
  detail = PROP_DETAIL,
}: {
  model: SceneModel;
  /** Escape hatch for judging the art as exported — see instanced-prop.ts. */
  detail?: PropDetail;
}) {
  const buyIn = TIER_CONFIG[model.tier].minBuyIn;

  return (
    <group>
      {model.seats.map((seat) => {
        const rawTier = tierForSeat(seat.stack, buyIn, model.tier);
        // Slot 0's own pile gets a visibility floor — see chip-props.ts's
        // own header on nearSeatTier for why only the local seat needs it.
        const tier = seat.slot === 0 ? nearSeatTier(rawTier) : rawTier;
        // A busted or empty seat draws nothing. A heap in front of a chair
        // the HUD says holds zero is a lie the player can see.
        if (!tier) return null;
        return (
          <Suspense key={seat.id} fallback={null}>
            <Bankroll slot={seat.slot} tier={tier} detail={detail} />
          </Suspense>
        );
      })}
    </group>
  );
}

// Warm all four piles up front. Six seats draw from four files and a seat can
// change tier mid-session, so without this a player who wins a pot would see
// their stack vanish for a beat while the next .glb arrives.
if (typeof window !== "undefined") {
  // Flags must match the hook's exactly — the preload path builds its own
  // loader. See glb-avatar.tsx.
  for (const spec of Object.values(CHIP_PROPS)) {
    useGLTF.preload(spec.url, false, true);
  }
}
