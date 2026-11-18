import { describe, expect, it } from "vitest";
import { OPENING_DOOR } from "@/lib/stackacres/opening";
import { tileKey, type Grid, type Point } from "./movement";
import { OpeningSkipped } from "./opening-director";
import { SceneOpeningStage, type OpeningWorld } from "./opening-stage";

/** Just enough of Phaser for the stage: a clock it can be told to run, tweens that finish when told, and sprites that remember what they were told. */
function fakeWorld(options: { walls?: [number, number][] } = {}) {
  const timers: { at: number; run: () => void; removed: boolean }[] = [];
  let now = 0;
  const tweenDone: (() => void)[] = [];
  const sprite = () => {
    const state = { alpha: 1, visible: true, frame: "", texture: "", played: [] as string[], destroyed: false, x: 0, y: 0, depth: 0 };
    const self = {
      state,
      anims: { isPlaying: false, currentAnim: null as { key: string } | null, timeScale: 1, stop: () => { self.anims.isPlaying = false; } },
      play: (config: { key: string }) => {
        state.played.push(config.key);
        self.anims.currentAnim = { key: config.key };
        self.anims.isPlaying = true;
      },
      setFrame: (frame: string) => { state.frame = frame; return self; },
      setTexture: (texture: string) => { state.texture = texture; return self; },
      setAlpha: (alpha: number) => { state.alpha = alpha; return self; },
      setOrigin: () => self,
      setDepth: (depth: number) => { state.depth = depth; return self; },
      setPosition: (x: number, y: number) => { state.x = x; state.y = y; return self; },
      destroy: () => { state.destroyed = true; },
    };
    return self;
  };
  const made: ReturnType<typeof sprite>[] = [];
  const scene = {
    time: {
      delayedCall: (ms: number, run: () => void) => {
        const timer = { at: now + ms, run, removed: false };
        timers.push(timer);
        return { remove: () => { timer.removed = true; } };
      },
    },
    tweens: {
      add: (config: { onComplete: () => void }) => { tweenDone.push(config.onComplete); },
      killTweensOf: () => { tweenDone.length = 0; },
    },
    add: { image: () => { const made1 = sprite(); made.push(made1); return made1; }, ellipse: () => { const made1 = sprite(); made.push(made1); return made1; } },
  };
  const grid: Grid = { width: 64, height: 52, tile: 16, blocked: new Set((options.walls ?? []).map(([tx, ty]) => tileKey(tx, ty))) };
  const bodies = { farmer: { sprite: sprite(), shadow: sprite() }, ray: { sprite: sprite(), shadow: sprite() } };
  const positions: Record<"farmer" | "ray", Point> = { farmer: { ...OPENING_DOOR }, ray: { x: 330, y: 486 } };
  const looks: Point[] = [];
  const sounds: string[] = [];
  const idles: string[] = [];
  const world = {
    scene,
    grid: () => grid,
    body: (who: "farmer" | "ray") => bodies[who],
    place: (who: "farmer" | "ray", at: Point) => { positions[who] = at; },
    at: (who: "farmer" | "ray") => positions[who],
    standingFrame: (facing: string) => `stand-${facing}`,
    idle: (who: string, facing: string) => { idles.push(`${who}:${facing}`); },
    sound: (cue: string) => { sounds.push(cue); },
    timedFor: () => 40,
    lookAt: (point: Point) => { looks.push(point); },
    reducedMotion: () => false,
  } as unknown as OpeningWorld;
  return {
    world,
    bodies,
    positions,
    looks,
    sounds,
    idles,
    made,
    advanceClock(ms: number) {
      now += ms;
      for (const timer of timers) if (!timer.removed && timer.at <= now) { timer.removed = true; timer.run(); }
    },
    finishTweens() { for (const done of tweenDone.splice(0)) done(); },
    pendingTimers: () => timers.filter((timer) => !timer.removed).length,
  };
}

/** Runs the stage's own frames: `ms` of them, 16ms at a time. */
function run(stage: SceneOpeningStage, ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) stage.tick(16);
}

describe("the opening stage", () => {
  it("waits on the scene's clock", async () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    let done = false;
    void stage.wait(500).then(() => (done = true));
    fake.advanceClock(499);
    await Promise.resolve();
    expect(done).toBe(false);
    fake.advanceClock(1);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("drives the bus in to its stop and says so", async () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    stage.placeBus();
    let arrived = false;
    void stage.driveBus(1000).then(() => (arrived = true));
    run(stage, 500);
    await Promise.resolve();
    expect(arrived).toBe(false);
    run(stage, 600);
    await Promise.resolve();
    expect(arrived).toBe(true);
  });

  it("keeps the farmer out of sight until the bus door opens", () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    stage.placeBus();
    expect(fake.bodies.farmer.sprite.state.alpha).toBe(0);
    expect(fake.positions.farmer).toEqual(OPENING_DOOR);
    expect(fake.looks.length).toBeGreaterThan(0);
    void stage.stepOffBus();
    fake.finishTweens();
  });

  it("walks someone to the exact spot, facing the way they go, and leaves them idling there", async () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    const target = { x: 296, y: 486 };
    let arrived = false;
    void stage.walk("farmer", target, 44).then(() => (arrived = true));
    run(stage, 500);
    expect(fake.bodies.farmer.sprite.state.played).toContain("walk_right");
    run(stage, 4000);
    await Promise.resolve();
    expect(arrived).toBe(true);
    expect(fake.positions.farmer).toEqual(target);
    expect(fake.idles[fake.idles.length - 1]).toBe("farmer:right");
  });

  it("refuses a walk to somewhere it cannot reach, rather than going to the nearest spot", async () => {
    // A wall of blocked tiles the whole way down column 20 cuts the corridor in two.
    const wall: [number, number][] = Array.from({ length: 52 }, (_, ty) => [20, ty]);
    const fake = fakeWorld({ walls: wall });
    const stage = new SceneOpeningStage(fake.world);
    await expect(stage.walk("farmer", { x: 400, y: 486 }, 44)).rejects.toThrow(/no way for farmer/);
    await expect(stage.walk("farmer", { x: 400, y: 486 }, 44)).rejects.not.toBeInstanceOf(OpeningSkipped);
  });

  it("makes everything still waiting say it was skipped, and starts nothing new", async () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    const waiting = stage.wait(5000);
    const walking = stage.walk("ray", { x: 300, y: 486 }, 44);
    const outcomes = Promise.allSettled([waiting, walking]);
    stage.abort();
    const settled = await outcomes;
    for (const outcome of settled) {
      expect(outcome.status).toBe("rejected");
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(OpeningSkipped);
    }
    expect(fake.pendingTimers()).toBe(0);
    await expect(stage.wait(10)).rejects.toBeInstanceOf(OpeningSkipped);
  });

  it("takes the bus away and gives the farmer his picture back, standing still for the scene to take over", () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    stage.placeBus();
    stage.tidy();
    // The bus, its shadow and the stop's sign all go.
    expect(fake.made.slice(0, 3).every((made) => made.state.destroyed)).toBe(true);
    expect(fake.bodies.farmer.sprite.state.alpha).toBe(1);
    expect(fake.bodies.farmer.shadow.state.alpha).toBe(1);
    expect(fake.bodies.farmer.sprite.state.frame).toBe("stand-right");
  });

  it("rides the camera between the two of them once told to", () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    fake.positions.farmer = { x: 100, y: 400 };
    fake.positions.ray = { x: 200, y: 500 };
    const before = fake.looks.length;
    stage.tick(16);
    expect(fake.looks.length).toBe(before);
    stage.cameraRidesBoth();
    stage.tick(16);
    expect(fake.looks[fake.looks.length - 1]).toEqual({ x: 150, y: 450 });
  });

  it("swings the bus door open with its sound and shuts it again later", () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    stage.placeBus();
    const bus = fake.made[0];
    stage.openDoor(1500);
    expect(bus.state.texture).toBe("bus-open");
    expect(fake.sounds).toEqual(["bus-door"]);
    fake.advanceClock(1499);
    expect(bus.state.texture).toBe("bus-open");
    fake.advanceClock(1);
    expect(bus.state.texture).toBe("bus");
    expect(fake.sounds).toEqual(["bus-door", "bus-door"]);
  });

  it("will not open a door that is not there", () => {
    const stage = new SceneOpeningStage(fakeWorld().world);
    expect(() => stage.openDoor(1000)).toThrow(/before there was a bus/);
  });

  it("lets the engine be heard as the bus starts in, and kicks dust up as it slows", () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    stage.placeBus();
    void stage.driveBus(1000);
    expect(fake.sounds).toEqual(["bus-pull-in"]);
    const before = fake.made.length;
    run(stage, 400);
    expect(fake.made.length).toBe(before);
    run(stage, 700);
    expect(fake.made.length).toBeGreaterThan(before + 3);
  });

  it("has people breathing where they stand rather than frozen", async () => {
    const fake = fakeWorld();
    const stage = new SceneOpeningStage(fake.world);
    stage.face("ray", "left");
    expect(fake.idles).toEqual(["ray:left"]);
    void stage.walk("farmer", { x: 296, y: 486 }, 44);
    run(stage, 4000);
    await Promise.resolve();
    expect(fake.idles[fake.idles.length - 1]).toBe("farmer:right");
  });
});
