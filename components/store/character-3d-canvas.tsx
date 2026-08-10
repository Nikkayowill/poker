"use client";

import { Canvas } from "@react-three/fiber";
import type { Character3D } from "@/lib/game3d/characters";
import { GlbAvatar } from "@/components/game3d/avatars/glb-avatar";

export function Character3DCanvas({ character }: { character: Character3D }) {
  return (
    <Canvas
      camera={{ position: [0, 1.05, 3.1], fov: 28 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={1.35} color="#d8d1e8" />
      <directionalLight position={[1.5, 2.5, 2]} intensity={2.2} color="#ffe8c4" />
      <group rotation={[0, Math.PI, 0]}>
        <GlbAvatar slot={0} character={character} />
      </group>
    </Canvas>
  );
}
