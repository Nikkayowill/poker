import type * as Phaser from "phaser";
import {
  OPENING_BUS_FROM,
  OPENING_BUS_STOP,
  OPENING_DOOR,
  OPENING_SIGN,
  facingToward,
  type OpeningFacing,
} from "@/lib/stackacres/opening";
import { advance, findPath, type Grid, type Point } from "./movement";
import { OpeningSkipped, type OpeningActor, type OpeningStage } from "./opening-director";

/** Where the bus's wheels meet the ground inside its 96x64 picture. */
const BUS_ORIGIN_Y = 52 / 64;
const BUS_DEPTH_LIFT = 0.5;
/** The bus rocks a pixel while it moves, the way everything on a bumpy lane does. */
const BUS_BOUNCE_MS = 140;
/** The drawn dust is three cells of one sheet, small to large (public/stackacres-td/common/bus-dust.png). */
const DUST_TEXTURE = "bus-dust";
const DUST_FRAMES = 3;
/** Dust kicked up off the wheels once the bus is slowing, one puff this often, and a bigger burst as it stops. */
const DUST_FROM = 0.55;
const DUST_EVERY_MS = 120;
const DUST_LIFE_MS = 700;
/** Where the back wheel sits in the bus's picture, from its centre and from the ground line. */
const BUS_REAR_WHEEL = { x: -30, y: -2 };
const BUS_TEXTURE = "bus";
const BUS_TEXTURE_OPEN = "bus-open";
const SIGN_TEXTURE = "bus-stop-sign";

export type OpeningSound = "bus-pull-in" | "bus-door";

interface Body {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
}

/** What the stage borrows from the scene: the two people, the ground and the camera. */
export interface OpeningWorld {
  scene: Phaser.Scene;
  grid: () => Grid;
  body: (who: OpeningActor) => Body;
  /** Puts someone down at a point, shadow and draw order with them. */
  place: (who: OpeningActor, at: Point) => void;
  at: (who: OpeningActor) => Point;
  standingFrame: (facing: OpeningFacing) => string;
  /** Has them breathing where they stand, facing a way, instead of frozen on one frame. */
  idle: (who: OpeningActor, facing: OpeningFacing) => void;
  sound: (cue: OpeningSound) => void;
  /** Frames of walking the two rigs were drawn to a second at the pace they were timed for. */
  timedFor: (who: OpeningActor) => number;
  /** Keeps the camera on a point, off the farmer. */
  lookAt: (point: Point) => void;
  /** The player asked for less motion: the bus does not rock. */
  reducedMotion: () => boolean;
}

interface Walk {
  path: Point[];
  speed: number;
  done: () => void;
}

/**
 * The director's hands (opening-director.ts): puts the bus on the map and moves the bus, the farmer
 * and Ray about it, a frame at a time from the scene's own update.
 */
export class SceneOpeningStage implements OpeningStage {
  private aborted = false;
  private readonly rejects = new Set<(reason: Error) => void>();
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private readonly walks = new Map<OpeningActor, Walk>();
  private readonly facings = new Map<OpeningActor, OpeningFacing>([
    ["farmer", "right"],
    ["ray", "left"],
  ]);
  private bus: { image: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; sign: Phaser.GameObjects.Image } | null = null;
  private drive: { from: number; to: number; ms: number; elapsed: number; done: () => void } | null = null;
  private busClock = 0;
  private dustClock = 0;
  private riding = false;
  private lines: (text: string | null) => void = () => undefined;

  constructor(private readonly world: OpeningWorld) {}

  /** Where the shell hears the words. */
  onLine(handler: (text: string | null) => void): void {
    this.lines = handler;
  }

  // ---------------------------------------------------------------- promises

  /** A step that settles when `start`'s callback runs, or rejects if the opening is skipped first. */
  private pending(start: (done: () => void) => void): Promise<void> {
    if (this.aborted) return Promise.reject(new OpeningSkipped());
    return new Promise<void>((resolve, reject) => {
      const fail = (reason: Error) => reject(reason);
      this.rejects.add(fail);
      try {
        start(() => {
          this.rejects.delete(fail);
          resolve();
        });
      } catch (error) {
        this.rejects.delete(fail);
        reject(error);
      }
    });
  }

  /** Skipped: everything still waiting is told so, and nothing new starts. */
  abort(): void {
    this.aborted = true;
    for (const timer of this.timers) timer.remove(false);
    this.timers.clear();
    this.walks.clear();
    this.drive = null;
    this.world.scene.tweens.killTweensOf([this.world.body("farmer").sprite, this.world.body("farmer").shadow]);
    for (const fail of [...this.rejects]) fail(new OpeningSkipped());
    this.rejects.clear();
  }

  // ---------------------------------------------------------------- OpeningStage

  wait(ms: number): Promise<void> {
    return this.pending((done) => {
      const timer = this.world.scene.time.delayedCall(ms, () => {
        this.timers.delete(timer);
        done();
      });
      this.timers.add(timer);
    });
  }

  placeBus(): void {
    const { scene } = this.world;
    const image = scene.add.image(OPENING_BUS_FROM.x, OPENING_BUS_FROM.y, BUS_TEXTURE).setOrigin(0.5, BUS_ORIGIN_Y).setDepth(OPENING_BUS_FROM.y + BUS_DEPTH_LIFT);
    const shadow = scene.add.ellipse(OPENING_BUS_FROM.x, OPENING_BUS_FROM.y + 2, 86, 9, 0x140c1c, 0.3).setDepth(-1);
    // The stop's post and the case beside it, standing there before the bus comes.
    const sign = scene.add.image(OPENING_SIGN.x, OPENING_SIGN.y, SIGN_TEXTURE).setOrigin(0.5, 1).setDepth(OPENING_SIGN.y);
    this.bus = { image, shadow, sign };
    // The farmer is on the bus until the door opens.
    const farmer = this.world.body("farmer");
    farmer.sprite.setAlpha(0);
    farmer.shadow.setAlpha(0);
    this.world.place("farmer", OPENING_DOOR);
    this.world.lookAt({ x: (OPENING_BUS_STOP.x + this.world.at("ray").x) / 2, y: OPENING_BUS_STOP.y });
  }

  driveBus(ms: number): Promise<void> {
    return this.pending((done) => {
      this.world.sound("bus-pull-in");
      this.drive = { from: OPENING_BUS_FROM.x, to: OPENING_BUS_STOP.x, ms, elapsed: 0, done };
    });
  }

  openDoor(closeAfterMs: number): void {
    if (!this.bus) throw new Error("The bus door was opened before there was a bus.");
    this.bus.image.setTexture(BUS_TEXTURE_OPEN);
    this.world.sound("bus-door");
    const timer = this.world.scene.time.delayedCall(closeAfterMs, () => {
      this.timers.delete(timer);
      this.bus?.image.setTexture(BUS_TEXTURE);
      this.world.sound("bus-door");
    });
    this.timers.add(timer);
  }

  stepOffBus(): Promise<void> {
    const farmer = this.world.body("farmer");
    this.face("farmer", "right");
    return this.pending((done) => {
      this.world.scene.tweens.add({ targets: [farmer.sprite, farmer.shadow], alpha: 1, duration: 220, ease: "Sine.easeOut", onComplete: done });
    });
  }

  walk(who: OpeningActor, to: Point, speed: number): Promise<void> {
    return this.pending((done) => {
      const from = this.world.at(who);
      const path = findPath(this.world.grid(), from, to);
      const end = path[path.length - 1];
      // Every point is checked against the map (lib/stackacres/opening.test.ts), so this is something
      // built there since: a fence or a bed across the way. Walking to the nearest open spot instead
      // would hide that.
      if (!end || Math.hypot(end.x - to.x, end.y - to.y) > 1) {
        throw new Error(`The opening has no way for ${who} from ${from.x},${from.y} to ${to.x},${to.y}.`);
      }
      this.walks.set(who, { path, speed, done });
    });
  }

  face(who: OpeningActor, facing: OpeningFacing): void {
    this.facings.set(who, facing);
    this.stand(who);
  }

  position(who: OpeningActor): Point {
    return this.world.at(who);
  }

  place(who: OpeningActor, at: Point): void {
    this.world.place(who, at);
  }

  line(text: string | null): void {
    this.lines(text);
  }

  cameraRidesBoth(): void {
    this.riding = true;
  }

  // ---------------------------------------------------------------- frames

  /** One frame: the bus, then whoever is walking, then the camera. */
  tick(delta: number): void {
    if (this.aborted) return;
    this.tickBus(delta);
    for (const who of ["farmer", "ray"] as const) this.tickWalk(who, delta);
    if (this.riding) {
      const a = this.world.at("farmer");
      const b = this.world.at("ray");
      this.world.lookAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }

  private tickBus(delta: number): void {
    const run = this.drive;
    if (!run || !this.bus) return;
    run.elapsed = Math.min(run.ms, run.elapsed + delta);
    const t = run.elapsed / run.ms;
    // Slows into its stop the way a bus does.
    const eased = 1 - (1 - t) ** 3;
    const x = Math.round(run.from + (run.to - run.from) * eased);
    this.busClock += delta;
    const rocking = !this.world.reducedMotion() && t < 1 && Math.floor(this.busClock / BUS_BOUNCE_MS) % 2 === 0 ? 1 : 0;
    this.bus.image.setPosition(x, OPENING_BUS_STOP.y - rocking);
    this.bus.shadow.setPosition(x, OPENING_BUS_STOP.y + 2);
    if (!this.world.reducedMotion() && t >= DUST_FROM) {
      this.dustClock += delta;
      if (this.dustClock >= DUST_EVERY_MS || t >= 1) {
        this.dustClock = 0;
        this.puff(x, t >= 1 ? 3 : 1);
      }
    }
    if (t >= 1) {
      this.drive = null;
      run.done();
    }
  }

  /** Dust off the back wheel, drifting back and up as it thins. `count` puffs at once, for the stop. */
  private puff(busX: number, count: number): void {
    const { scene } = this.world;
    for (let i = 0; i < count; i++) {
      const x = busX + BUS_REAR_WHEEL.x + (i - (count - 1) / 2) * 5;
      const y = OPENING_BUS_STOP.y + BUS_REAR_WHEEL.y;
      const dust = scene.add.image(x, y, DUST_TEXTURE, 0).setOrigin(0.5, 1).setDepth(y + 1).setAlpha(0.9);
      scene.tweens.add({
        targets: dust,
        x: x - 10 - i * 3,
        y: y - 4 - i * 2,
        alpha: 0,
        duration: DUST_LIFE_MS,
        ease: "Sine.easeOut",
        // The puff swells through its three drawings as it thins.
        onUpdate: (tween: Phaser.Tweens.Tween) => dust.setFrame(Math.min(DUST_FRAMES - 1, Math.floor(tween.progress * DUST_FRAMES))),
        onComplete: () => dust.destroy(),
      });
    }
  }

  private tickWalk(who: OpeningActor, delta: number): void {
    const walk = this.walks.get(who);
    if (!walk) return;
    const from = this.world.at(who);
    const next = walk.path[0];
    if (Math.hypot(next.x - from.x, next.y - from.y) > 0.01) this.facings.set(who, facingToward(from, next));
    const facing = this.facings.get(who) ?? "down";
    const { sprite } = this.world.body(who);
    const key = `walk_${facing}`;
    const timeScale = walk.speed / this.world.timedFor(who);
    if (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) sprite.play({ key, repeat: -1, timeScale });
    else sprite.anims.timeScale = timeScale;
    const stepped = advance(from, walk.path, (walk.speed * Math.min(delta, 100)) / 1000);
    walk.path = stepped.path;
    this.world.place(who, stepped.at);
    if (walk.path.length === 0) {
      this.walks.delete(who);
      this.stand(who);
      walk.done();
    }
  }

  /** Stood where they are, breathing, facing the way last set. */
  private stand(who: OpeningActor): void {
    this.world.idle(who, this.facings.get(who) ?? "down");
  }

  /** Stood still on one frame, for handing them back: the scene's own idling takes over from here. */
  private freeze(who: OpeningActor): void {
    const { sprite } = this.world.body(who);
    sprite.anims.stop();
    sprite.setFrame(this.world.standingFrame(this.facings.get(who) ?? "down"));
  }

  /** Takes the bus away and puts the farmer's picture back as it was. */
  tidy(): void {
    this.bus?.image.destroy();
    this.bus?.shadow.destroy();
    this.bus?.sign.destroy();
    this.bus = null;
    const farmer = this.world.body("farmer");
    farmer.sprite.setAlpha(1);
    farmer.shadow.setAlpha(1);
    this.freeze("farmer");
    this.freeze("ray");
  }
}
