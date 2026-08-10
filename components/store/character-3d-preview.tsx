"use client";

import dynamic from "next/dynamic";
import type { Character3D } from "@/lib/game3d/characters";

const CharacterCanvas = dynamic(
  () => import("./character-3d-canvas").then((module) => module.Character3DCanvas),
  { ssr: false, loading: () => <div className="cosmetic-3d-loading">Loading rig…</div> },
);

export function Character3DPreview({ character }: { character: Character3D }) {
  return <CharacterCanvas character={character} />;
}
