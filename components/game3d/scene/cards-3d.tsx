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
import { cardBackTexture, cardFaceTexture } from "./card-textures";

const CARD_W = 0.34;
const CARD_H = 0.47;
const CARD_LIFT = 0.004;
const BOARD_SPACING = 0.38;

function CardPlate({
  card,
  position,
  rotationY,
  lift = 0,
}: {
  card: Card | null;
  position: [number, number, number];
  rotationY: number;
  lift?: number;
}) {
  const texture = useMemo(
    () => (card ? cardFaceTexture(card) : cardBackTexture()),
    [card]
  );
  return (
    <mesh
      position={[position[0], position[1] + CARD_LIFT + lift, position[2]]}
      rotation={[-Math.PI / 2, 0, rotationY]}
      castShadow
    >
      <planeGeometry args={[CARD_W, CARD_H]} />
      <meshStandardMaterial map={texture} roughness={0.6} />
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
          rotationY={0}
        />
      ))}
    </group>
  );
}

export function HoleCards({ seat }: { seat: SeatModel }) {
  if (!seat.inHand || seat.holeCards.length === 0) return null;
  const spot = holeCardPosition(seat.slot);
  const facing = faceCentreRotationY(spot);
  // Fan the two cards along the local tangent, angled slightly apart.
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
              spot.x + tangentX * side * 0.17,
              spot.y,
              spot.z + tangentZ * side * 0.17,
            ]}
            rotationY={facing + Math.PI + side * 0.12}
            lift={i * 0.002}
          />
        );
      })}
    </group>
  );
}
