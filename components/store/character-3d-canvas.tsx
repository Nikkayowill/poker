"use client";

import { useLayoutEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import type { Character3D } from "@/lib/game3d/characters";
import { GlbAvatar } from "@/components/game3d/avatars/glb-avatar";

function PreviewCamera() {
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.position.set(0, 1.15, 3.4);
    camera.lookAt(0, 1.05, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

export function Character3DCanvas({ character }: { character: Character3D }) {
  return (
    <Canvas
      camera={{ position: [0, 1.15, 3.4], fov: 28 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
    >
      <PerspectiveCamera makeDefault position={[0, 1.15, 3.4]} fov={28} />
      <PreviewCamera />
      <ambientLight intensity={1.35} color="#d8d1e8" />
      <directionalLight position={[1.5, 2.5, 2]} intensity={2.2} color="#ffe8c4" />
      <GlbAvatar slot={0} character={character} />
    </Canvas>
  );
}
