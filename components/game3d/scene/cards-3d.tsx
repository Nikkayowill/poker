"use client";

/**
 * Card plates lying on the felt: the community board and each live seat's
 * hole cards. A null card renders the shared back; the redaction already
 * happened server-side, so "null means face down" is the entire rule.
 */

import { useMemo } from "react";
import type { Card } from "@/lib/game/types";
import type { SeatModel } from "@/lib/game3d/scene-model";
import {
  BOARD_POSITION,
  faceCentreRotationY,
  holeCardPosition,
} from "@/lib/game3d/seat-layout";
import { CARD, CARD_GAP } from "@/lib/game3d/dimensions";
import { cardBackTexture, cardFaceTexture } from "./card-textures";

/**
 * A poker-size card at the scale the felt sets — see
 * lib/game3d/dimensions.ts. These were 0.34 x 0.47, picked by hand, which
 * is two and a half times life size: five across the board covered most of
 * the cloth, and a pair of hole cards was wider than the player holding
 * them.
 */
const CARD_W = CARD.width;
const CARD_H = CARD.height;
/** Lifted by its own thickness, so a card lies on the cloth, not in it. */
const CARD_LIFT = CARD.thickness;

/**
 * The board is the one oversized card set — deliberate product direction:
 * flop, turn and river are what the whole table reads, so they get to
 * break the life-size rule the other props obey.
 *
 * Raised from 1.6, which was too small to play off: at 1440x900 a board
 * card measured ~40px across and its rank sat in the corner of that, so
 * the five cards every decision depends on were the least legible thing on
 * screen. Legibility beats the ruler here — the chips and the hole cards
 * still carry the room's real proportions, so the felt keeps its sense of
 * scale while the cards you must read are readable.
 */
const BOARD_CARD_SCALE = 2.4;
const BOARD_SPACING = CARD.width * BOARD_CARD_SCALE + CARD_GAP;

/**
 * The board leans up toward the camera, standing on its lower edge like
 * the local player's pair (CardPlate lifts a propped card by
 * sin(tilt)·h/2, so the felt is never clipped). At the 52° landscape
 * elevation a flat card is read at 38° off face-on; this recovers most of
 * that without the cards reading as standing upright — the same
 * "lift the corner to look" gesture, applied by the dealer.
 *
 * Deliberately the CARDS and not the felt: the chips, bet spots, pot and
 * hole cards all live on that surface, and pitching the table mesh under
 * a fixed rail would shear the whole room to buy what five cards needed.
 */
const BOARD_CARD_TILT = 0.42;

/**
 * The local player's own pair, likewise enlarged — for the same reason and
 * no further. Everyone else's stay life size: theirs are face down, and
 * inflating six pairs of card backs would clutter the cloth to say nothing.
 */
const NEAR_HOLE_CARD_SCALE = 1.8;

/** Half a card and a sliver: a fanned pair overlaps, as a held pair does. */
const HOLE_CARD_FAN = CARD.width * 0.52;

/**
 * How far the local player's own pair leans up off the cloth, in radians.
 *
 * A card lying flat two metres away shows the camera its face at a glancing
 * angle, and that is the one pair whose rank has to be readable at all
 * times. Propping it toward the viewer is what a player physically does —
 * you lift the corner and look — so this buys legibility without inflating
 * the card past life size, which is the other way to solve it and the wrong
 * one.
 */
const NEAR_CARD_TILT = 0.62;

function CardPlate({
  card,
  position,
  rotationY,
  lift = 0,
  tilt = 0,
  scale = 1,
}: {
  card: Card | null;
  position: [number, number, number];
  rotationY: number;
  lift?: number;
  /** Lean toward the camera, for the local player's own cards. */
  tilt?: number;
  /** Display scale — 1 is life size; only the board is allowed above it. */
  scale?: number;
}) {
  const texture = useMemo(
    () => (card ? cardFaceTexture(card) : cardBackTexture()),
    [card]
  );
  return (
    <mesh
      position={[
        position[0],
        // A propped card stands on its lower edge, so its centre rises by
        // half its height times the sine of the lean.
        position[1] + CARD_LIFT + lift + Math.sin(tilt) * ((CARD_H * scale) / 2),
        position[2],
      ]}
      rotation={[-Math.PI / 2 + tilt, 0, rotationY]}
      castShadow
    >
      <planeGeometry args={[CARD_W * scale, CARD_H * scale]} />
      {/* alphaTest, not transparency: the texture paints a rounded rect on a
          clear canvas, and without this the four corners render as opaque
          black squares — the rounding is in the art, so the cut has to be
          too. A test rather than blending keeps the card writing depth, so
          two fanned cards still sort correctly against each other. */}
      {/* Rough on purpose. A standard material's specular reflection does
          not depend on albedo, so at a lower roughness the spotlight lays
          the same sheen over black ink as over white paper and the suits
          come back warm grey instead of black. Spreading the highlight is
          what lets the blacks read black. */}
      <meshStandardMaterial map={texture} roughness={0.88} alphaTest={0.5} />
    </mesh>
  );
}

export function CommunityCards({ cards }: { cards: Card[] }) {
  const startX = -((cards.length - 1) * BOARD_SPACING) / 2;
  return (
    <group>
      {cards.map((communityCard, i) => (
        <CardPlate
          key={`${communityCard.rank}-${communityCard.suit}`}
          card={communityCard}
          position={[
            BOARD_POSITION.x + startX + i * BOARD_SPACING,
            BOARD_POSITION.y,
            BOARD_POSITION.z,
          ]}
          /*
           * No in-plane spin. A card lying FLAT needed a half turn to read
           * from this chair (the -90° X rotation maps the texture's top
           * edge away from the camera), and that is exactly why a PROPPED
           * card must not have one: the tilt pitches the face up toward
           * the viewer, which restores the texture's own orientation — the
           * local player's propped pair has always rendered at an
           * effective spin of zero. Adding the tilt while keeping the old
           * half turn showed five upside-down cards, caught on a render.
           */
          rotationY={0}
          scale={BOARD_CARD_SCALE}
          tilt={BOARD_CARD_TILT}
        />
      ))}
    </group>
  );
}

export function HoleCards({ seat }: { seat: SeatModel }) {
  if (!seat.inHand || seat.holeCards.length === 0) return null;
  const spot = holeCardPosition(seat.slot);
  const facing = faceCentreRotationY(spot);
  const scale = seat.isMine ? NEAR_HOLE_CARD_SCALE : 1;
  // Fan the two cards along the local tangent, angled slightly apart. The
  // fan widens with the card, or an enlarged pair overlaps into one shape.
  const tangentX = Math.cos(-facing);
  const tangentZ = Math.sin(-facing);
  return (
    <group>
      {seat.holeCards.map((holeCard, i) => {
        const side = i === 0 ? -1 : 1;
        return (
          <CardPlate
            key={i}
            card={holeCard}
            position={[
              spot.x + tangentX * side * HOLE_CARD_FAN * scale,
              spot.y,
              spot.z + tangentZ * side * HOLE_CARD_FAN * scale,
            ]}
            rotationY={facing + Math.PI + side * 0.12}
            lift={i * CARD.thickness}
            // Only your own pair leans up: everyone else's are face down,
            // and propping those would show the table six card backs
            // standing on edge for no reason.
            tilt={seat.isMine ? NEAR_CARD_TILT : 0}
            scale={scale}
          />
        );
      })}
    </group>
  );
}
