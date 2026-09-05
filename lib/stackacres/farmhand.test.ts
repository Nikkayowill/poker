import { describe, expect, it } from "vitest";

import {
  FARMHAND_BASE,
  FARMHAND_QUEUE_MAX,
  FARMHAND_SPEED,
  FARMHAND_WORK_MS,
  enqueueFarmhandTask,
  farmhandStandoff,
  farmhandWalking,
  pruneFarmhandTasks,
  spawnFarmhand,
  stepFarmhand,
  type Farmhand,
  type FarmhandTask,
} from "./farmhand";
import { isoProject } from "./iso";
import { nearPath } from "./paths";
import { inPondZone } from "./water";
import { BARN_FOOTPRINT, FARM_ZONE, barnHitAt, growAreaAt, inFarmZone } from "./world";

const FRAME = 16;

function task(unitId: string, x: number, y: number): FarmhandTask {
  return { unitId, x, y };
}

/** Run the FSM until `done` says stop, so a test can say "walk him there"
 *  without spelling out how many frames that takes. */
function run(
  hand: Farmhand,
  next: (hand: Farmhand) => FarmhandTask | null,
  done: (hand: Farmhand) => boolean,
  limit = 4000,
): { hand: Farmhand; frames: number; claims: number; finishes: number } {
  let current = hand;
  let claims = 0;
  let finishes = 0;
  for (let frames = 1; frames <= limit; frames += 1) {
    const step = stepFarmhand(current, next(current), FRAME);
    current = step.hand;
    if (step.claimed) claims += 1;
    if (step.finished) finishes += 1;
    if (done(current)) return { hand: current, frames, claims, finishes };
  }
  throw new Error(`farmhand never satisfied the condition in ${limit} frames`);
}

describe("FARMHAND_BASE", () => {
  // Six constraints, all of them things a future reposition has to keep. They
  // are asserted rather than commented because every one of them is a real
  // artefact somebody would only notice in a screenshot.
  it("stands on the farm, clear of everything already there", () => {
    const { x, y } = FARMHAND_BASE;
    expect(inFarmZone(x, y)).toBe(true);
    expect(barnHitAt(x, y)).toBe(false);
    expect(nearPath(x, y)).toBe(false);
    expect(inPondZone(x, y)).toBe(false);
    // Outside the fence: standing inside the hen ground would make him a tap
    // target competing with the units he is there to serve.
    expect(growAreaAt(x, y)).toBeNull();
  });

  it("is inside the camera's own world bounds", () => {
    expect(FARMHAND_BASE.x).toBeGreaterThan(FARM_ZONE.x);
    expect(FARMHAND_BASE.x).toBeLessThan(FARM_ZONE.x + FARM_ZONE.width);
    expect(FARMHAND_BASE.y).toBeGreaterThan(FARM_ZONE.y);
    expect(FARMHAND_BASE.y).toBeLessThan(FARM_ZONE.y + FARM_ZONE.height);
  });

  it("does not stand on top of Grandfather Ray's own post", () => {
    // Ray is a static prop at (175, 20) and is 20 units wide. Two people
    // sharing a spot read as one person with a drawing error.
    expect(Math.hypot(FARMHAND_BASE.x - 175, FARMHAND_BASE.y - 20)).toBeGreaterThan(20);
    expect(FARMHAND_BASE.y).toBeGreaterThan(BARN_FOOTPRINT.y + BARN_FOOTPRINT.height);
  });
});

describe("farmhandStandoff", () => {
  it("puts him BESIDE the thing on screen, not in front of it", () => {
    // The regression this exists for: standing in front of a hen hides it
    // behind a man four times its height, so the animation plays over bare
    // straw. Measured in screen space, because "beside" is a screen word.
    const at = { x: 200, y: 260 };
    const spot = farmhandStandoff(at);
    const unit = isoProject(at.x, at.y);
    const hand = isoProject(spot.x, spot.y);
    // Clear of a hen's own picture sideways...
    expect(hand.x - unit.x).toBeGreaterThanOrEqual(12);
    // ...and still in front of it, so he sorts over the fence he leans on.
    expect(hand.y).toBeGreaterThan(unit.y);
  });
});

describe("spawnFarmhand", () => {
  it("starts idle at base, facing the camera", () => {
    const hand = spawnFarmhand();
    expect(hand.phase).toBe("idle");
    expect(hand.x).toBe(FARMHAND_BASE.x);
    expect(hand.y).toBe(FARMHAND_BASE.y);
    expect(hand.unitId).toBeNull();
    expect(farmhandWalking(hand)).toBe(false);
  });

  it("stays exactly put while there is nothing to do", () => {
    let hand = spawnFarmhand();
    for (let i = 0; i < 200; i += 1) hand = stepFarmhand(hand, null, FRAME).hand;
    expect(hand).toEqual(spawnFarmhand());
  });
});

describe("stepFarmhand", () => {
  it("walks the whole loop: idle, travelling, working, returning, idle", () => {
    const job = task("u1", 240, 300);
    const seen: string[] = [];
    let hand = spawnFarmhand();
    let claimed = false;

    for (let i = 0; i < 4000 && !(claimed && hand.phase === "idle"); i += 1) {
      const step = stepFarmhand(hand, hand.unitId || !claimed ? job : null, FRAME);
      if (step.claimed) claimed = true;
      hand = step.hand;
      if (seen[seen.length - 1] !== hand.phase) seen.push(hand.phase);
    }

    expect(seen).toEqual(["travelling", "working", "returning", "idle"]);
    expect(hand.x).toBe(FARMHAND_BASE.x);
    expect(hand.y).toBe(FARMHAND_BASE.y);
    expect(hand.unitId).toBeNull();
  });

  it("claims a job on the frame it is offered, and reports it exactly once", () => {
    const job = task("u1", 240, 300);
    const first = stepFarmhand(spawnFarmhand(), job, FRAME);
    expect(first.claimed).toBe(true);
    expect(first.hand.phase).toBe("travelling");
    expect(first.hand.unitId).toBe("u1");
    // It moved on the claiming frame too: a claim landing on a long frame
    // must not throw that frame's travel away.
    expect(first.hand.travelled).toBeGreaterThan(0);

    const second = stepFarmhand(first.hand, job, FRAME);
    expect(second.claimed).toBe(false);
  });

  it("arrives exactly on the target rather than easing at it forever", () => {
    const job = task("u1", 200, 200);
    const arrived = run(
      spawnFarmhand(),
      () => job,
      (hand) => hand.phase === "working",
    ).hand;
    expect(arrived.x).toBe(job.x);
    expect(arrived.y).toBe(job.y);
    expect(arrived.workMs).toBe(FARMHAND_WORK_MS);
  });

  it("does not jitter once it is standing on the target", () => {
    const job = task("u1", 200, 200);
    // A target he is already on. Every frame must leave him on it, and must
    // not tick `travelled` -- the hop cycle would crawl on forever otherwise.
    const standing: Farmhand = {
      ...spawnFarmhand(),
      x: job.x,
      y: job.y,
      phase: "travelling",
      unitId: "u1",
      targetX: job.x,
      targetY: job.y,
    };
    const after = stepFarmhand(standing, job, FRAME).hand;
    expect(after.x).toBe(job.x);
    expect(after.y).toBe(job.y);
    expect(after.travelled).toBe(0);
  });

  it("re-aims at a unit that wanders while he crosses the yard", () => {
    // The hen keeps moving. He must chase the live spot, not the one the tap
    // was made against.
    let hand = stepFarmhand(spawnFarmhand(), task("u1", 200, 200), FRAME).hand;
    hand = stepFarmhand(hand, task("u1", 300, 340), FRAME).hand;
    expect(hand.targetX).toBe(300);
    expect(hand.targetY).toBe(340);
  });

  it("gives up and heads home when the unit he was walking to is gone", () => {
    const walking = stepFarmhand(spawnFarmhand(), task("u1", 320, 340), FRAME).hand;
    const abandoned = stepFarmhand(walking, null, FRAME);
    expect(abandoned.hand.phase).toBe("returning");
    expect(abandoned.hand.unitId).toBeNull();
    // Not a finish: he never did the job, so nothing should celebrate it.
    expect(abandoned.finished).toBe(false);
  });

  it("does not abandon a job it has already reached", () => {
    // The server answered and the row vanished while he was bent over it.
    // Cutting the animation here would mean the work is only ever SEEN on a
    // slow connection.
    const working = run(
      spawnFarmhand(),
      () => task("u1", 220, 260),
      (hand) => hand.phase === "working",
    ).hand;
    const after = stepFarmhand(working, null, FRAME);
    expect(after.hand.phase).toBe("working");
  });

  it("reports finishing exactly once, on the frame the work timer runs out", () => {
    const job = task("u1", 220, 260);
    const { finishes, hand } = run(
      spawnFarmhand(),
      (current) => (current.phase === "returning" ? null : job),
      (current) => current.phase === "returning",
    );
    expect(finishes).toBe(1);
    expect(hand.targetX).toBe(FARMHAND_BASE.x);
    expect(hand.targetY).toBe(FARMHAND_BASE.y);
  });

  it("turns around mid-walk-home for a new job", () => {
    const going = run(
      spawnFarmhand(),
      (current) => (current.phase === "returning" ? null : task("u1", 300, 320)),
      (current) => current.phase === "returning",
    ).hand;
    // A few steps homeward first, so he is genuinely between the two.
    let homeward = going;
    for (let i = 0; i < 10; i += 1) homeward = stepFarmhand(homeward, null, FRAME).hand;
    expect(homeward.phase).toBe("returning");

    const turned = stepFarmhand(homeward, task("u2", 260, 300), FRAME);
    expect(turned.claimed).toBe(true);
    expect(turned.hand.phase).toBe("travelling");
    expect(turned.hand.unitId).toBe("u2");
  });

  it("clamps one enormous frame to a single stride", () => {
    // A phone coming back from a background tab hands the scene a delta of
    // minutes. He did not walk across the county in that time.
    const job = task("u1", 100_000, 100_000);
    const jumped = stepFarmhand(spawnFarmhand(), job, 600_000).hand;
    expect(jumped.travelled).toBeCloseTo(FARMHAND_SPEED * 0.25, 6);
  });

  it("ignores a negative or zero frame rather than walking backwards", () => {
    const job = task("u1", 300, 300);
    const hand = stepFarmhand(spawnFarmhand(), job, -50).hand;
    expect(hand.travelled).toBe(0);
    expect(hand.x).toBe(FARMHAND_BASE.x);
  });
});

describe("facing", () => {
  // The four isometric diagonals, as the two signs that express them. Screen
  // x is (world x - world y) and screen depth is (world x + world y), so each
  // world-space quadrant lands on its own pair.
  const cases: { name: string; dx: number; dy: number; facing: 1 | -1; towards: 1 | -1 }[] = [
    { name: "SE", dx: 1, dy: 0, facing: 1, towards: 1 },
    { name: "SW", dx: 0, dy: 1, facing: -1, towards: 1 },
    { name: "NE", dx: 0, dy: -1, facing: 1, towards: -1 },
    { name: "NW", dx: -1, dy: 0, facing: -1, towards: -1 },
  ];

  for (const { name, dx, dy, facing, towards } of cases) {
    it(`heads ${name} with the right mirror and the right art`, () => {
      const from = spawnFarmhand();
      const job = task("u1", from.x + dx * 120, from.y + dy * 120);
      const hand = stepFarmhand(from, job, FRAME).hand;
      expect(hand.facing).toBe(facing);
      expect(hand.towards).toBe(towards);
    });
  }

  it("keeps the facing it had when a step is straight up or down the picture", () => {
    // Equal parts +x and +y is no turn either way. Flipping to a default here
    // would snap him round every time a target happened to land on the
    // diagonal.
    const from: Farmhand = { ...spawnFarmhand(), facing: -1 };
    const hand = stepFarmhand(from, task("u1", from.x + 90, from.y + 90), FRAME).hand;
    expect(hand.facing).toBe(-1);
    expect(hand.towards).toBe(1);
  });
});

describe("the queue", () => {
  const a = task("u1", 10, 10);
  const b = task("u2", 20, 20);

  it("takes a job", () => {
    expect(enqueueFarmhandTask([], a)).toEqual([a]);
  });

  it("refuses a unit it is already holding, and says so by identity", () => {
    // A mashed ready hen is the common case. Returning the same array is what
    // lets the caller skip its own work on it.
    const queue = enqueueFarmhandTask([], a);
    expect(enqueueFarmhandTask(queue, task("u1", 99, 99))).toBe(queue);
  });

  it("refuses rather than evicting when full", () => {
    let queue: readonly FarmhandTask[] = [];
    for (let i = 0; i < FARMHAND_QUEUE_MAX; i += 1) {
      queue = enqueueFarmhandTask(queue, task(`u${i}`, i, i));
    }
    // Evicting the oldest could forget the job he is walking to right now.
    expect(enqueueFarmhandTask(queue, b)).toBe(queue);
    expect(queue).toHaveLength(FARMHAND_QUEUE_MAX);
  });

  it("drops jobs whose unit has gone", () => {
    const queue = enqueueFarmhandTask(enqueueFarmhandTask([], a), b);
    expect(pruneFarmhandTasks(queue, (id) => id === "u2")).toEqual([b]);
  });

  it("returns the same array when nothing was dropped", () => {
    const queue = enqueueFarmhandTask([], a);
    expect(pruneFarmhandTasks(queue, () => true)).toBe(queue);
  });
});
