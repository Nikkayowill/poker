import type Phaser from "phaser";
import type { EmoteKind, EmoteTarget } from "../stackacres/world-contract";

export type Dir = "down" | "up" | "left" | "right";

/** How close the farmer comes before someone turns to face him and greets him, in map px. */
const GREET_REACH = 40;
const GREET_COOLDOWN_MS = 90_000;
/** How long the farmer stands still before he starts breathing and blinking. */
const FARMER_IDLE_AFTER_MS = 1600;
/** Emotes are UI: above the daylight tint and cue bubbles. */
const EMOTE_DEPTH = 10_001;
const EMOTE_HOLD_MS = 1500;
const EMOTE_FADE = [0.66, 0.33];
const EMOTE_FADE_STEP_MS = 90;

type Keep = <T extends Phaser.GameObjects.GameObject>(object: T) => T;

interface Npc {
  sprite: Phaser.GameObjects.Sprite;
  facing: Dir;
  near: boolean;
  greetedAt: number;
  timeScale: number;
}

/** What each person says with a bubble when the farmer walks up. At night everyone is sleepy. */
function greeting(name: string, hour: number): EmoteKind {
  if (hour >= 22 || hour < 5) return "sleep";
  if (name === "ray") return "heart";
  if (name === "pilgrim") return "sparkle";
  if (name === "merchant") return "question";
  return "note";
}

/**
 * The people and hens on the map, alive while nobody is tapping them:
 * - everyone breathes and blinks on their own rhythm (the rig's `idle` tag), turns to face the farmer when he
 *   comes close and greets him with an emote bubble (not more than once a minute and a half per person);
 * - the farmer idles too once he has stood still a moment;
 * - hens peck and turn in place, and sheep and cattle turn now and then, never leaving their spot (they are tap targets);
 * - emote bubbles pop up over a head, hold, and fade in steps.
 * Under prefers-reduced-motion people stand still and hens don't peck; emotes still show (they say something).
 */
export class PeopleLife {
  private npcs = new Map<string, Npc>();
  private hens = new Map<string, { sprite: Phaser.GameObjects.Image; base: string; next: number; until: number }>();
  private emotes = new Map<EmoteTarget, { image: Phaser.GameObjects.Image; sprite: Phaser.GameObjects.Sprite; born: number; raised: boolean }>();
  private stoodAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: Keep,
    private readonly standing: Record<Dir, string>,
  ) {}

  /** Called on entering an area, after the area's objects were cleared. */
  clear(): void {
    this.npcs.clear();
    this.hens.clear();
    this.emotes.clear();
  }

  addNpc(name: string, sprite: Phaser.GameObjects.Sprite): void {
    this.npcs.set(name, { sprite, facing: "down", near: false, greetedAt: Number.NEGATIVE_INFINITY, timeScale: 0.85 + Math.random() * 0.3 });
  }

  /** The farmer has just come to a stop (arrived, or finished acting something out). */
  stood(time: number): void {
    this.stoodAt = time;
  }

  /** Called after the scene redraws the player's units: picks up new hens, forgets gone ones. */
  syncHens(nodes: Iterable<[string, Phaser.GameObjects.Image]>, time: number): void {
    const seen = new Set<string>();
    for (const [id, sprite] of nodes) {
      if (!/^(hen|sheep|cattle)_/.test(sprite.frame.name)) continue;
      seen.add(id);
      const known = this.hens.get(id);
      if (!known || known.sprite !== sprite) {
        this.hens.set(id, { sprite, base: sprite.frame.name, next: time + 800 + Math.random() * 3000, until: 0 });
      }
    }
    for (const id of this.hens.keys()) if (!seen.has(id)) this.hens.delete(id);
  }

  emote(who: EmoteTarget, kind: EmoteKind, time: number, farmer: Phaser.GameObjects.Sprite, raised: (name: string) => boolean): void {
    const sprite = who === "farmer" ? farmer : this.npcs.get(who)?.sprite;
    if (!sprite?.visible) return;
    this.emotes.get(who)?.image.destroy();
    const image = this.keep(this.scene.add.image(0, 0, "common", `emote_${kind}`).setOrigin(0, 0).setDepth(EMOTE_DEPTH));
    this.emotes.set(who, { image, sprite, born: time, raised: who !== "farmer" && raised(who) });
    this.placeEmote(this.emotes.get(who)!, time, false);
  }

  update(
    time: number,
    farmer: { sprite: Phaser.GameObjects.Sprite; x: number; y: number; facing: Dir; walking: boolean },
    hour: number,
    reducedMotion: boolean,
    raised: (name: string) => boolean,
  ): void {
    for (const [name, npc] of this.npcs) {
      if (!npc.sprite.visible) continue;
      const dx = farmer.x - npc.sprite.x;
      const dy = farmer.y - npc.sprite.y;
      const near = Math.hypot(dx, dy) < GREET_REACH;
      const facing: Dir = near ? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up") : "down";
      if (reducedMotion) {
        if (npc.sprite.anims.isPlaying) npc.sprite.anims.stop();
        if (npc.sprite.frame.name !== this.standing[facing]) npc.sprite.setFrame(this.standing[facing]);
      } else if (facing !== npc.facing || !npc.sprite.anims.isPlaying) {
        npc.sprite.play({ key: `idle_${facing}`, repeat: -1, timeScale: npc.timeScale, startFrame: Math.floor(Math.random() * 3) });
      }
      npc.facing = facing;
      if (near && !npc.near && time - npc.greetedAt > GREET_COOLDOWN_MS) {
        npc.greetedAt = time;
        this.emote(name as EmoteTarget, greeting(name, hour), time, farmer.sprite, raised);
      }
      npc.near = near;
    }

    const player = farmer.sprite;
    if (!reducedMotion && !farmer.walking && !player.anims.isPlaying && time - this.stoodAt > FARMER_IDLE_AFTER_MS) {
      player.play({ key: `idle_${farmer.facing}`, repeat: -1 });
    } else if (reducedMotion && player.anims.currentAnim?.key.startsWith("idle_")) {
      player.anims.stop();
      player.setFrame(this.standing[farmer.facing]);
    }

    for (const [id, hen] of this.hens) {
      if (!hen.sprite.active) {
        this.hens.delete(id);
        continue;
      }
      if (reducedMotion) {
        if (hen.sprite.frame.name !== hen.base) hen.sprite.setFrame(hen.base);
        continue;
      }
      if (hen.until && time >= hen.until) {
        hen.sprite.setFrame(hen.base);
        hen.until = 0;
      }
      if (time < hen.next) continue;
      const pecks = hen.base.startsWith("hen_");
      if (pecks && Math.random() < 0.65) {
        hen.sprite.setFrame(`${hen.base}_peck`);
        hen.until = time + 170;
      } else {
        hen.base = hen.base.includes("_left") ? hen.base.replace("_left", "_right") : hen.base.replace("_right", "_left");
        hen.sprite.setFrame(hen.base);
      }
      // Sheep and cattle only turn now and then; hens are busier.
      hen.next = time + (pecks ? (Math.random() < 0.3 ? 300 : 1400 + Math.random() * 3600) : 4000 + Math.random() * 7000);
    }

    for (const [who, emote] of this.emotes) {
      const age = time - emote.born;
      if (age >= EMOTE_HOLD_MS + EMOTE_FADE.length * EMOTE_FADE_STEP_MS || !emote.sprite.active) {
        emote.image.destroy();
        this.emotes.delete(who);
        continue;
      }
      this.placeEmote(emote, time, reducedMotion);
    }
  }

  /** Over the head (higher when a cue bubble is already there), popping up 2px on arrival, fading in steps. */
  private placeEmote(
    emote: { image: Phaser.GameObjects.Image; sprite: Phaser.GameObjects.Sprite; born: number; raised: boolean },
    time: number,
    reducedMotion: boolean,
  ): void {
    const age = time - emote.born;
    const rise = reducedMotion ? 0 : age < 60 ? 2 : age < 120 ? 1 : 0;
    const bottom = Math.round(emote.sprite.y) - (emote.raised ? 42 : 32);
    emote.image.setPosition(Math.round(emote.sprite.x) - Math.floor(emote.image.width / 2), bottom - emote.image.height + rise);
    const fading = age - EMOTE_HOLD_MS;
    emote.image.setAlpha(fading < 0 ? 1 : EMOTE_FADE[Math.min(EMOTE_FADE.length - 1, Math.floor(fading / EMOTE_FADE_STEP_MS))]);
  }
}
