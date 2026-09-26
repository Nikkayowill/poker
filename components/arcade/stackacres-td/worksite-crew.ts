import Phaser from "phaser";
import type { Dir } from "@/lib/stackacres-td/npc-routine";
import type { Tile, WalkerView } from "@/lib/stackacres-td/work-board";
import type { Mood } from "@/lib/stackacres-td/work-store";
import type { Worksite } from "@/lib/stackacres-td/worksite";

/** The pace each walk was timed for, px a second: the NPC sheets' four-frame walk (npc-walkers.ts), and the
 *  eight-frame stride the grocery's people have (art/stackacres-td/lpc/build.py STRIDE_MS, the farmer's pace).
 *  Played at the walker's own speed over this, the feet keep up with the ground instead of sliding over it. */
const WALK_TIMED_FOR = 40;
const STRIDE_TIMED_FOR = 72;
/** Moving tags: their speed follows the walker's. */
const MOVING = new Set(["walk", "carry", "basket"]);
/** Longest frame the site is stepped by, so a tab coming back from the background doesn't fast-forward it. */
/** The sim moves in fixed steps, so a day plays out the same at any frame rate; a slow frame catches up at most this far. */
const SIM_STEP_MS = 50;
const MAX_CATCH_UP_MS = 250;

interface CrewNode {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  tween: Phaser.Tweens.Tween | null;
  /** The grid square the sprite was last sent to. */
  at: Tile;
  anim: string;
}

/**
 * Draws a worksite (lib/stackacres-td/worksite.ts): its hired hands and customers on their character
 * sheets. The site decides everything. Each time someone sets off for a new grid square the sprite is
 * tweened across to it over the time the step takes, so the picture never runs ahead of or lags behind
 * the square the site has them on. With reduced motion they are placed on their square and stand still.
 *
 * How a customer feels shows in how they stand, never in a bubble over them: someone getting impatient
 * in a queue glances about, back over their shoulder and to the side, and more often the crosser they get.
 */

/** How often a waiting customer glances about, by mood, in ms; calm customers don't. */
const GLANCE_EVERY: Partial<Record<Mood, number>> = { impatient: 2600, cross: 1200 };
const GLANCE_FOR_MS = 500;
const GLANCES: readonly Dir[] = ["down", "left", "right"];
export class WorksiteCrew {
  private readonly nodes = new Map<string, CrewNode>();
  private clock = 0;
  private owed = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly site: Worksite,
    private readonly tile: number,
    private readonly standing: Record<Dir, string>,
  ) {}

  update(delta: number, reducedMotion: boolean): void {
    this.clock += delta;
    this.owed = Math.min(this.owed + delta, MAX_CATCH_UP_MS);
    for (; this.owed >= SIM_STEP_MS; this.owed -= SIM_STEP_MS) this.site.step(SIM_STEP_MS);
    const view = this.site.view();
    const seen = new Set<string>();
    for (const walker of [...view.workers, ...view.customers]) {
      seen.add(walker.id);
      this.draw(walker, reducedMotion);
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      this.remove(node);
      this.nodes.delete(id);
    }
  }

  destroy(): void {
    for (const node of this.nodes.values()) this.remove(node);
    this.nodes.clear();
  }

  private centre(tile: Tile): { x: number; y: number } {
    return { x: tile.tx * this.tile + this.tile / 2, y: tile.ty * this.tile + this.tile / 2 };
  }

  private node(walker: WalkerView): CrewNode {
    let node = this.nodes.get(walker.id);
    if (node) return node;
    const { x, y } = this.centre(walker.from);
    const sprite = this.scene.add.sprite(x, y, walker.sprite, this.standing[walker.facing]).setOrigin(0.5, 44 / 48).setDepth(y);
    this.scene.anims.createFromAseprite(walker.sprite, undefined, sprite);
    const shadow = this.scene.add.ellipse(x + 1, y + 1, 13, 4, 0x140c1c, 0.28).setDepth(-1);
    node = { sprite, shadow, tween: null, at: walker.from, anim: "" };
    this.nodes.set(walker.id, node);
    return node;
  }

  private draw(walker: WalkerView, reducedMotion: boolean): void {
    const node = this.node(walker);

    if (walker.tile.tx !== node.at.tx || walker.tile.ty !== node.at.ty) {
      node.at = walker.tile;
      node.tween?.stop();
      node.tween = null;
      const to = this.centre(walker.tile);
      if (reducedMotion || walker.stepLeft <= 0) {
        this.place(node, to.x, to.y);
      } else {
        node.tween = this.scene.tweens.add({
          targets: node.sprite,
          x: to.x,
          y: to.y,
          duration: walker.stepLeft,
          ease: "Linear",
          onUpdate: () => this.place(node, node.sprite.x, node.sprite.y),
          onComplete: () => {
            node.tween = null;
          },
        });
      }
    }

    if (reducedMotion) {
      if (node.sprite.anims.isPlaying) node.sprite.anims.stop();
      if (node.sprite.frame.name !== this.standing[walker.facing]) node.sprite.setFrame(this.standing[walker.facing]);
      node.anim = "";
      return;
    }
    const key = this.animKey(node.sprite, walker);
    const tag = key.slice(0, key.lastIndexOf("_"));
    const stride = (node.sprite.anims.animationManager.get(key) ?? node.sprite.anims.get(key))?.frames.length === 8;
    const timeScale =
      MOVING.has(tag) && walker.stepMs > 0 ? (this.tile * 1000) / walker.stepMs / (stride ? STRIDE_TIMED_FOR : WALK_TIMED_FOR) : 1;
    if (key !== node.anim || !node.sprite.anims.isPlaying) {
      node.sprite.play({ key, repeat: -1, timeScale });
      node.anim = key;
    } else {
      node.sprite.anims.timeScale = timeScale;
    }
  }

  /**
   * The animation for what they're doing, facing the way they face: a customer with something in their
   * basket walks with it; a sheet without the action's tag (an older character) falls back to walking or
   * standing, so nothing is ever left without a pose.
   */
  private animKey(sprite: Phaser.GameObjects.Sprite, walker: WalkerView & { mood?: Mood }): string {
    const facing = this.facingNow(walker);
    const shopping = walker.mood !== undefined;
    const doing = walker.doing === "walk" && shopping && walker.carrying > 0 ? "basket" : walker.doing;
    const has = (tag: string) => sprite.anims.get(`${tag}_${facing}`) !== undefined || this.scene.anims.exists(`${tag}_${facing}`);
    if (has(doing)) return `${doing}_${facing}`;
    return `${MOVING.has(doing) ? "walk" : "idle"}_${facing}`;
  }

  /** Which way they face this frame: their own, or a glance about while they wait out of patience. */
  private facingNow(walker: WalkerView & { mood?: Mood }): Dir {
    const every = walker.mood ? GLANCE_EVERY[walker.mood] : undefined;
    if (!every || walker.doing !== "idle") return walker.facing;
    // Each person on their own beat, so a queue doesn't turn as one.
    let seed = 0;
    for (const c of walker.id) seed = (seed * 31 + c.charCodeAt(0)) % 997;
    const t = (this.clock + seed * 7) % every;
    if (t >= GLANCE_FOR_MS) return walker.facing;
    return GLANCES[Math.floor((this.clock + seed) / every) % GLANCES.length];
  }

  private place(node: CrewNode, x: number, y: number): void {
    node.sprite.setPosition(x, y).setDepth(Math.round(y));
    node.shadow.setPosition(Math.round(x) + 1, Math.round(y) + 1);
  }

  private remove(node: CrewNode): void {
    node.tween?.stop();
    node.sprite.destroy();
    node.shadow.destroy();
  }
}
