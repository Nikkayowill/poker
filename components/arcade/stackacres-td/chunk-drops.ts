import type Phaser from "phaser";
import {
  CHUNK_STAGGER_MS,
  CHUNK_WAIT_MS,
  MAGNET_DELAY_MS,
  chunkAt,
  flyToward,
  inMagnetReach,
  type ChunkKind,
  type Flight,
  type Point,
} from "@/lib/stackacres-td/chunks";
import { CHUNK_ART } from "@/lib/stackacres-td/gather-nodes";

interface Chunk {
  kind: ChunkKind;
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  from: Point;
  rest: Point;
  /** When it pops out. Later chunks of one break pop a beat after the first. */
  popAt: number;
  /** Set once he draws it in. */
  flight: Flight | null;
}

/**
 * The chunks lying on the map (lib/stackacres-td/chunks.ts): they pop out,
 * bounce and settle, and fly into the farmer once he is near. What they are
 * worth was paid when the thing came down, so dropping them all on an area
 * change loses nothing.
 */
export class ChunkDrops {
  private chunks: Chunk[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
    /** His feet (what is near) and his middle (where a chunk flies to), and the depth to draw a flying chunk at. */
    private readonly farmer: () => { feet: Point; middle: Point; depth: number },
    /** One chunk reached him. `last` when it was the last one on the map. */
    private readonly onCollect: (kind: ChunkKind, last: boolean) => void,
  ) {}

  /** Chunks of `kind` break off at `from` and come to rest at each of `rests`. */
  drop(kind: ChunkKind, from: Point, rests: readonly Point[], now: number): void {
    const texture = CHUNK_ART[kind].texture;
    rests.forEach((rest, index) => {
      const shadow = this.keep(this.scene.add.ellipse(from.x, from.y, 7, 2, 0x140c1c, 0.25).setDepth(-1));
      const image = this.keep(this.scene.add.image(from.x, from.y, texture).setOrigin(0.5, 1).setDepth(from.y).setVisible(false));
      // Alternate chunks lie the other way round, so three logs are not one log three times.
      if (index % 2 === 1) image.setFlipX(true);
      shadow.setVisible(false);
      this.chunks.push({ kind, image, shadow, from, rest, popAt: now + index * CHUNK_STAGGER_MS, flight: null });
    });
  }

  update(now: number, delta: number): void {
    if (this.chunks.length === 0) return;
    const { feet, middle, depth } = this.farmer();
    const landed: Chunk[] = [];
    for (const chunk of this.chunks) {
      const age = now - chunk.popAt;
      if (age < 0) continue;
      chunk.image.setVisible(true);
      chunk.shadow.setVisible(chunk.flight === null);
      if (chunk.flight) {
        const next = flyToward(chunk.flight, middle, delta);
        chunk.flight = next;
        chunk.image.setPosition(next.at.x, next.at.y + chunk.image.height / 2).setDepth(depth + 0.5);
        if (next.arrived) landed.push(chunk);
        continue;
      }
      const { ground, lift } = chunkAt(chunk.from, chunk.rest, age);
      chunk.image.setPosition(ground.x, ground.y - lift).setDepth(ground.y);
      chunk.shadow.setPosition(ground.x, ground.y).setScale(1 - Math.min(0.5, lift / 18));
      if (age >= MAGNET_DELAY_MS && (inMagnetReach(ground, feet) || age >= CHUNK_WAIT_MS)) {
        chunk.flight = { at: { x: ground.x, y: ground.y - chunk.image.height / 2 }, speed: 0 };
      }
    }
    for (const chunk of landed) {
      chunk.image.destroy();
      chunk.shadow.destroy();
      this.chunks.splice(this.chunks.indexOf(chunk), 1);
      this.onCollect(chunk.kind, this.chunks.length === 0);
    }
  }

  /** Off the map. Called when he leaves the area; they were his already. */
  clear(): void {
    for (const chunk of this.chunks) {
      chunk.image.destroy();
      chunk.shadow.destroy();
    }
    this.chunks = [];
  }

  /** How many are lying about or in the air, for the e2e hook. */
  count(): number {
    return this.chunks.length;
  }
}
