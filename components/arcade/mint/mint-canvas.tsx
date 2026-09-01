"use client";

import { useEffect, useRef } from "react";
import { MINT_STAGE_H, MINT_STAGE_W } from "./iso";
import type { MintScene, MintSceneTile } from "./mint-scene";

/**
 * The Phaser mount, and the bundle boundary. Both the engine and the scene
 * enter through the dynamic import below, so a player who never opens the
 * Mint never downloads Phaser -- the same isolation poker-app.tsx's
 * `dynamic(..., { ssr: false })` gives the table. The parent additionally
 * loads this whole file through next/dynamic, belt and braces.
 *
 * Rendering is fully driven from props: `tiles` repaints the grid whenever
 * its signature changes, `celebrate` fires the harvest fountain once per
 * nonce. The canvas is decorative to assistive tech (the DOM overlay in
 * mint-treasury.tsx is the real control surface), hence aria-hidden.
 */
export function MintCanvas({
  tiles,
  celebrate,
}: {
  tiles: MintSceneTile[];
  celebrate: { plotIndex: number; nonce: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MintScene | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void } | null>(null);
  const tilesRef = useRef(tiles);
  useEffect(() => {
    tilesRef.current = tiles;
  });

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const [{ default: Phaser }, { MintScene: SceneClass }] = await Promise.all([
        import("phaser"),
        import("./mint-scene"),
      ]);
      if (cancelled) return;

      const scene = new SceneClass();
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        transparent: true,
        width: MINT_STAGE_W,
        height: MINT_STAGE_H,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        // The diorama animates a slow hen at most; half rate is plenty and
        // half the battery. Phaser already pauses fully on tab blur.
        fps: { target: 30 },
        scene,
      });
      sceneRef.current = scene;
      gameRef.current = game;
      scene.setPlots(tilesRef.current);
    })();

    return () => {
      cancelled = true;
      sceneRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  // Repaint only when the visible state of some tile actually changed; the
  // parent recomputes `tiles` every clock tick for its countdown text, and a
  // repaint per second would restart the ripe hen tween each time.
  const signature = tiles
    .map(
      (tile) =>
        `${tile.plotIndex}:${tile.state}:${tile.nodeType ?? ""}:${Math.round((tile.growthPercent ?? 0) * 24)}:${tile.selected ? 1 : 0}`,
    )
    .join("|");
  useEffect(() => {
    sceneRef.current?.setPlots(tilesRef.current);
  }, [signature]);

  useEffect(() => {
    if (celebrate) sceneRef.current?.celebrateHarvest(celebrate.plotIndex);
  }, [celebrate]);

  return <div ref={hostRef} className="mint-canvas" aria-hidden="true" />;
}
