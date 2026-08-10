"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CARD } from "@/lib/game3d/dimensions";
import { foldFlightPose } from "@/lib/game3d/fold-flight";
import type { SceneModel } from "@/lib/game3d/scene-model";

interface Flight {
  id: string;
  slot: number;
}

function FoldCardFlight({ flight, onDone }: { flight: Flight; onDone: (id: string) => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const startedAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    if (startedAtRef.current === null) startedAtRef.current = clock.elapsedTime;
    const pose = foldFlightPose(flight.slot, clock.elapsedTime - startedAtRef.current);
    group.position.set(pose.position.x, pose.position.y, pose.position.z);
    group.rotation.set(0, pose.rotationY, pose.rotationZ);
    group.scale.setScalar(pose.scale);
    if (pose.done && !finishedRef.current) {
      finishedRef.current = true;
      onDone(flight.id);
    }
  });

  return (
    <group ref={groupRef}>
      {[-1, 1].map((side, index) => (
        <mesh
          key={side}
          position={[side * CARD.width * 0.28, CARD.thickness * (index + 0.5), 0]}
          rotation={[0, side * 0.07, side * 0.08]}
          castShadow
        >
          <boxGeometry args={[CARD.width, CARD.thickness, CARD.height]} />
          <meshStandardMaterial
            color="#861b2b"
            roughness={0.72}
            metalness={0.02}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Detects active-to-folded edges and keeps a physical pair alive through its muck flight. */
export function FoldCardFlights({ model }: { model: SceneModel }) {
  const previousRef = useRef<{ handNumber: number; folded: Record<string, boolean> } | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    const previous = previousRef.current;
    if (previous && previous.handNumber === model.handNumber) {
      const newlyFolded = model.seats.filter(
        (seat) => seat.status === "folded" && !previous.folded[seat.id],
      );
      if (newlyFolded.length) {
        setFlights((current) => [
          ...current,
          ...newlyFolded.map((seat) => ({
            id: `${model.handNumber}:${seat.id}`,
            slot: seat.slot,
          })),
        ]);
      }
    } else if (previous?.handNumber !== model.handNumber) {
      setFlights([]);
    }
    previousRef.current = {
      handNumber: model.handNumber,
      folded: Object.fromEntries(model.seats.map((seat) => [seat.id, seat.status === "folded"])),
    };
  }, [model.handNumber, model.seats]);

  const remove = useCallback((id: string) => {
    setFlights((current) => current.filter((flight) => flight.id !== id));
  }, []);

  return flights.map((flight) => (
    <FoldCardFlight key={flight.id} flight={flight} onDone={remove} />
  ));
}
