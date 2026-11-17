import {
  OPENING_BUS_MS,
  OPENING_DOOR_CLOSE_AFTER_MS,
  OPENING_DOOR_OPEN_MS,
  OPENING_DOOR_PAUSE_MS,
  OPENING_FOLLOW_LAG_MS,
  OPENING_LINES,
  OPENING_MEET_FARMER,
  OPENING_PORCH_FARMER,
  OPENING_PORCH_RAY,
  OPENING_WALK_SPEED,
  facingToward,
  openingLineMs,
  type OpeningFacing,
} from "@/lib/stackacres/opening";
import type { Point } from "@/lib/stackacres-td/movement";

export type OpeningActor = "farmer" | "ray";

/**
 * What the scene gives the director to work with. Every method that takes time returns a promise that
 * settles when it is done and rejects with `OpeningSkipped` if the player skipped meanwhile, so the
 * script below reads top to bottom without checking a flag after each step.
 */
export interface OpeningStage {
  /** The bus, off the left edge of the map. */
  placeBus(): void;
  /** Drives it in to its stop, with the engine heard. */
  driveBus(ms: number): Promise<void>;
  /** Swings the bus door open, and shuts it again after `closeAfterMs`. */
  openDoor(closeAfterMs: number): void;
  /** The farmer comes out of the bus door, hidden until now. Settles once he is fully in sight; he is free to walk meanwhile. */
  stepOffBus(): Promise<void>;
  /** Walks `who` to a point by the way a tap would, at `speed` map units a second. */
  walk(who: OpeningActor, to: Point, speed: number): Promise<void>;
  face(who: OpeningActor, facing: OpeningFacing): void;
  position(who: OpeningActor): Point;
  /** What the shell shows under the picture, or nothing. */
  line(text: string | null): void;
  /** Holds the camera where it is, then lets it ride between the two of them once they are walking. */
  cameraRidesBoth(): void;
  wait(ms: number): Promise<void>;
}

/** Thrown into a pending stage call when the player skips. */
export class OpeningSkipped extends Error {
  constructor() {
    super("opening skipped");
  }
}

/**
 * The scene, top to bottom: the bus pulls in, he steps off, Ray meets him and talks, they walk up to
 * the house, and Ray tells him he is free. Resolves when the last line is done; the scene hands him back.
 */
export async function directOpening(stage: OpeningStage): Promise<void> {
  const say = async (text: string) => {
    stage.line(text);
    await stage.wait(openingLineMs(text));
    stage.line(null);
    await stage.wait(250);
  };
  const lines = (at: "stop" | "porch") => OPENING_LINES.filter((beat) => beat.at === at);
  const [hello, packing, comeOn] = lines("stop");

  stage.placeBus();
  await stage.wait(700);
  await stage.driveBus(OPENING_BUS_MS);
  await stage.wait(OPENING_DOOR_PAUSE_MS);
  stage.openDoor(OPENING_DOOR_CLOSE_AFTER_MS);
  // Ray looks round at the door as it opens, and the farmer steps out and on toward him in one movement.
  stage.face("ray", facingToward(stage.position("ray"), stage.position("farmer")));
  await stage.wait(OPENING_DOOR_OPEN_MS);
  await Promise.all([stage.stepOffBus(), stage.walk("farmer", OPENING_MEET_FARMER, OPENING_WALK_SPEED)]);
  stage.face("farmer", facingToward(stage.position("farmer"), stage.position("ray")));
  stage.face("ray", facingToward(stage.position("ray"), stage.position("farmer")));
  await stage.wait(500);
  await say(hello.text);
  await say(packing.text);
  await say(comeOn.text);

  // Ray leads and he follows a few steps behind.
  stage.cameraRidesBoth();
  const ray = stage.walk("ray", OPENING_PORCH_RAY, OPENING_WALK_SPEED);
  const farmer = stage.wait(OPENING_FOLLOW_LAG_MS).then(() => stage.walk("farmer", OPENING_PORCH_FARMER, OPENING_WALK_SPEED));
  await Promise.all([ray, farmer]);
  stage.face("ray", facingToward(stage.position("ray"), stage.position("farmer")));
  stage.face("farmer", facingToward(stage.position("farmer"), stage.position("ray")));
  await stage.wait(400);
  for (const beat of lines("porch")) await say(beat.text);
}
