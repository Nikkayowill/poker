/**
 * 6-max spatial layout for the 3D room.
 *
 * Pure math with no three.js import, so `npm test` reaches it. All
 * coordinates are world units: the floor is y = 0, +Y is up, and the local
 * player's seat (slot 0) sits on the +Z side, nearest the camera. Slots
 * proceed counter-clockwise seen from above, which reads left-to-right from
 * the camera the same way `orderedSeats` reads in the DOM table.
 *
 * This module is the one layout authority for the 3D layer — the seat ring,
 * bet spots, pot and board positions all come from here, so a table resize
 * is one edit, not five.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const SEAT_COUNT_3D = 6;

export const FLOOR_Y = 0;

/**
 * Real height of a poker table's playing surface off the floor, in metres.
 *
 * Lives here rather than in dimensions.ts — its more natural home — for the
 * same cycle-avoidance reason TABLE_LENGTH_M/TABLE_WIDTH_M do just below:
 * FELT_TOP_Y needs it to build the room's one ruler, and dimensions.ts needs
 * FELT_RADIUS_X from this file, so the dependency can only run one way.
 * Re-exported from dimensions.ts so there is still exactly one 0.75.
 */
export const TABLE_HEIGHT_M = 0.75;

/**
 * The playing surface of a six-max oval, both axes, in metres.
 *
 * These live here rather than in dimensions.ts — which is the room's metre
 * ruler and is the more natural home — only because dimensions.ts imports
 * FELT_RADIUS_X from this file to BUILD that ruler, so stating them there
 * would be a cycle. It re-exports `TABLE_LENGTH_M` from here so there is
 * still exactly one 2.13 in the codebase, and dimensions.test.ts pins that
 * the felt's rendered width really is TABLE_WIDTH_M under that ruler.
 */
export const TABLE_LENGTH_M = 2.13;
export const TABLE_WIDTH_M = 1.07;

/**
 * The felt's half-length, in world units — the ruler `dimensions.ts`'s
 * `UNITS_PER_METRE` is built from (`= 2 * FELT_RADIUS_X / TABLE_LENGTH_M`).
 * Avatar height is built off this SAME ruler too (`FELT_TOP_Y` below,
 * `HUMAN_STANDING_UNITS` in dimensions.ts) — the two used to disagree; see
 * `FELT_TOP_Y`'s own comment for why that was a real, recurring bug rather
 * than a cosmetic inconsistency.
 *
 * Was 2.15, then 1.8, then 1.45. At 2.15 the table read oversized next to
 * the people sitting at it — real casino tables put six players
 * elbow-to-elbow, not spread around a wide oval with daylight between every
 * chair. Since avatars, chips and cards on the felt all scale with THIS
 * number (chips and cards through `UNITS_PER_METRE`, so shrinking it here
 * does not throw off the "chip is 1/50th of the table" proportion
 * dimensions.ts anchors), pulling it in is a global "the table was drawn to
 * too generous a ruler" correction, not a change to the real 2.13 m table
 * it represents.
 *
 * The fourth pull-in, to 1.2, is what a freed bottom edge is FOR. Avatar
 * height does not ride this ruler (see the comment above), so shrinking the
 * felt/ring pulls the camera closer without shrinking the fixed-height
 * people already in frame — and until this round the near seat had nowhere
 * to go: the desktop console sat in-flow below .table-area, so "closer"
 * stopped at the top of a reserved strip well short of the true viewport
 * edge. 06-table.css now floats the desktop 3D console into the bottom-right
 * corner instead, out of the flex column, which is what makes a fourth
 * pull-in worth doing at all — .table-area now runs to the room's real
 * bottom edge, and the corner placement means the near seat's own back can
 * approach it without ever sharing a footprint with the controls.
 *
 * Fifth move, back out to 1.32: the same mechanism as the fourth pull-in,
 * run in reverse on purpose. Avatar height still doesn't ride this ruler, so
 * growing the felt/ring pushes `frameCamera`'s own numeric search back out
 * to keep everyone in frame — without growing the fixed-height people
 * already there. The felt (and everything scaled through `UNITS_PER_METRE`
 * with it — chips, cards, the pot/board) gets relatively MORE of the frame
 * and the seated players relatively less, which is the fix for "the
 * community cards, bets and pot are hard to read": the fourth pull-in traded
 * exactly that legibility for elbow-room, and this gives some of it back.
 * Not a full reversion to 1.45 — a measured step, judged on a render.
 */
export const FELT_RADIUS_X = 1.32;

/**
 * Depth is DERIVED from the table's real plan proportions, not typed.
 *
 * It was 1.32, which against a 2.15 half-length is a 1.63:1 oval. A real
 * six-max table is 2.13 m x 1.07 m — very close to 2:1 — so the felt was
 * markedly rounder than the object it claims to be, and dimensions.ts was
 * anchoring the entire room's metre ruler to the one axis that happened to
 * be right.
 *
 * Fixing it is not only an accuracy point, and that is worth spelling out.
 * The camera fit is bound by DEPTH at every landscape aspect — the felt's
 * far edge plus the far player's headroom is what sets the distance, and
 * width has slack to spare on anything wider than about 16:9. A rounder
 * table is therefore a table that pushes its own camera back and then
 * cannot use the width it freed. Measured, giving the table its true shape
 * moves the felt from 46% to 53% of an ultrawide frame and from 50% to 57%
 * on a landscape phone, purely by letting the camera come in.
 */
export const FELT_RADIUS_Z = FELT_RADIUS_X * (TABLE_WIDTH_M / TABLE_LENGTH_M);

/**
 * Top surface of the felt; chips and cards rest here.
 *
 * ONE RULER, NOT TWO — this used to be an independent literal (0.86) with no
 * relationship to FELT_RADIUS_X's own ruler. dimensions.ts's UNITS_PER_METRE
 * is "how many world units a real metre is," built from the felt's LENGTH;
 * this constant used to be a second, disagreeing answer to the same
 * question, built from nothing, and every seated avatar was imported at a
 * height converted through a THIRD constant (dimensions.ts's old
 * UNITS_PER_METRE_Y) keyed off this literal instead of off FELT_RADIUS_X.
 * The gap between the two rulers reached 1.76x at one point and was still
 * ~1.08x here — never zero, because nothing tied them together.
 *
 * That gap was not cosmetic; it is why "resize the table" and "the arms
 * don't reach the cards" kept being the same bug wearing different
 * clothes. FELT_RADIUS_X moved five times chasing camera framing, and each
 * time it did, the table's ruler moved while the people sitting at it
 * (scaled off this constant, which didn't) silently didn't — so
 * SEAT_SETBACK, hand-anchors.ts's reach math and the chair (chair.tsx) all
 * had to be re-measured against a fresh render after every single one,
 * chasing a target that had just moved again for an unrelated reason. A
 * table resize and an avatar/arm-length change are the same edit now, so
 * they can no longer drift apart in between.
 *
 * Restated on the SAME ratio FELT_RADIUS_X derives — `(2 * FELT_RADIUS_X) /
 * TABLE_LENGTH_M` — rather than importing UNITS_PER_METRE from dimensions.ts,
 * which would cycle straight back through this file's own FELT_RADIUS_X (the
 * same reason TABLE_LENGTH_M is re-exported there rather than imported here).
 * dimensions.test.ts pins the two computations equal, so this cannot quietly
 * drift from dimensions.ts's own copy the way the old literal drifted from
 * everything else.
 */
export const FELT_TOP_Y = TABLE_HEIGHT_M * ((2 * FELT_RADIUS_X) / TABLE_LENGTH_M);

/**
 * How far above FELT_TOP_Y the padded rail's own cushion peaks. Table3D's
 * rail geometry (components/game3d/scene/table-3d.tsx) aligns its top to
 * exactly this offset — stated here, not there, so the felt-clamp IK
 * (glb-avatar.tsx, via tableSurfaceY below) can use the same number. A
 * forearm reaching in from a seat crosses the RAIL before it crosses the
 * felt; clamping every wrist target to the felt's own, lower surface left
 * it clipping through the rail's raised cushion on the way there, on every
 * side seat. One number, both consumers, so a further rail retune can't
 * silently reopen that gap.
 */
export const RAIL_LIP_HEIGHT = 0.016;

/**
 * How far the padded rail's cushion extends outward past the felt's own
 * edge — the same "one number, both consumers" reasoning as
 * `RAIL_LIP_HEIGHT` just above. Table3D's rail mesh
 * (components/game3d/scene/table-3d.tsx) is offset outward from the felt by
 * exactly this width; `hand-anchors.ts` uses it to rest an idle hand ON the
 * cushion a real player's forearm would use, not short of it on the felt
 * itself — see that file's own header for why "closest point ON THE FELT"
 * still measured as a near-full-arm reach even after this module's
 * SEAT_SETBACK. Stated here so a future rail retune can't silently drift
 * the two apart the way a second local literal would.
 */
export const RAIL_WIDTH = 0.0869;

/**
 * The height a wrist has to clear at plan position (x, z): the felt's own
 * top surface over the cloth itself, the rail's slightly higher one just
 * outside it. An ellipse test against the felt's own radii, not the
 * table's exact stadium outline — cheap, pure, and conservative in the
 * corner where the two shapes disagree (it starts guarding the rail
 * fractionally early rather than fractionally late). Reports the rail
 * height for anything past the felt's edge, open floor included: no
 * seat/chair collision is modelled, and a seated reach animation's wrist
 * target never actually lands out there, so a third "open air" region
 * would guard against a case that doesn't occur.
 */
export function tableSurfaceY(point: { x: number; z: number }): number {
  const onFelt = (point.x / FELT_RADIUS_X) ** 2 + (point.z / FELT_RADIUS_Z) ** 2 <= 1;
  return onFelt ? FELT_TOP_Y : FELT_TOP_Y + RAIL_LIP_HEIGHT;
}

/**
 * How far behind the rail a player sits — one number, applied to both axes.
 *
 * The seat ring used to be two independent radii (2.62 and 1.78) whose
 * margins over the felt were 0.47 and 0.46: equal by coincidence rather
 * than by construction, and silently un-linked from the felt they are
 * supposed to sit outside of. Stated once, a player is the same distance
 * back from the cloth wherever they are sitting, and a change to the
 * table's shape moves the chairs with it.
 *
 * Was 0.47, then 0.36, then 0.29, then 0.24 — each pull-in kept the same
 * ratio to FELT_RADIUS_X's own move, on the theory that this is purely "how
 * close a real player sits." That theory was wrong at 0.24: rendered on the
 * real GPU, every seat's reach-for-a-card hand pose was landing BELOW the
 * felt plane, arm and fingers visibly cutting through the cloth rather than
 * resting on it (worst at the side seats, e.g. Priya's cigar hand). The
 * cause is the asymmetry this file documents everywhere else — the .glb
 * avatars are baked animation clips at a FIXED real-world reach, scaled by
 * UNITS_PER_METRE_Y, which never moved. SEAT_SETBACK had been shrinking the
 * one distance a fixed-size body actually needs to clear the rail by, while
 * the ratio-preservation logic treated it as if it scaled with the felt like
 * a chip or a card does. Reset to 0.34 — between the round-3 and round-2
 * values — restores that clearance without giving back all of round 3's
 * pull-in. If FELT_RADIUS_X moves again, do NOT scale this by the same
 * ratio; re-render and re-measure against the avatars' actual reach instead.
 */
export const SEAT_SETBACK = 0.34;

/** Avatars stand on this larger ellipse, just outside the rail. This is the
 * FAR seat's own radius — see FAR_SEAT_SLOT below for why it, alone, is not
 * pushed out any further. */
export const SEAT_RING_RADIUS_X = FELT_RADIUS_X + SEAT_SETBACK;
export const SEAT_RING_RADIUS_Z = FELT_RADIUS_Z + SEAT_SETBACK;

/**
 * The seat directly across the felt from the camera (θ=180°, -Z — see
 * seatAngle/seatPosition below and avatar-sprites.ts's own note that "slot 3
 * at -Z" is the far seat everyone else's turnaround faces).
 *
 * It is the one seat this pass does NOT pull back further, on purpose:
 * camera-framing.ts's FAR_CROWN is built from this exact seat's radius, and
 * studio-environment.ts's DEALER_STAND_MARGIN comment already records that
 * framing has no slack left around it — 0.617 units of measured clearance
 * against a 0.6 floor at 844x390. Moving it back risks pushing its own head
 * off screen for a table that has room everywhere else. See
 * NEAR_SEAT_EXTRA_SETBACK just below for the seats that do move.
 */
export const FAR_SEAT_SLOT = 3;

/**
 * Extra room every seat OTHER than the far one gets, on top of
 * SEAT_SETBACK — rendered and judged, not derived. Five of six seats read
 * as sitting right on top of the rail once SEAT_SETBACK stopped scaling
 * with the felt (see that constant's own history above): it now only
 * states the clearance a fixed-size .glb body needs against the felt
 * plane, not "how far back a person actually sits," so every seat the
 * framing has room for gets a bit more air than that bare minimum.
 *
 * Was 0.08. User feedback on that render: still too tight, wanted the
 * seats pulled back further. Doubled to 0.16 and re-rendered rather than
 * nudged, since the first pass was already a guess and a second small
 * nudge risked reading as "still not enough" again.
 */
export const NEAR_SEAT_EXTRA_SETBACK = 0.16;

function seatSetback(slot: number): number {
  return slot === FAR_SEAT_SLOT ? SEAT_SETBACK : SEAT_SETBACK + NEAR_SEAT_EXTRA_SETBACK;
}

/**
 * How far a seat's bet spot sits from centre, as a fraction of the felt
 * radii. Far enough out to read as "in front of the bettor", far enough in
 * to be unambiguously on the cloth.
 *
 * Was 0.58, which put every seat's chips well inside the painted betting
 * line (table-3d.tsx's BETTING_LINE_INSET, 0.72 of this same felt) — on a
 * real table the line is what a bet crosses on its way to the pot, not
 * where it starts, so chips sitting entirely short of it read as never
 * having left the player's own side. 0.74 clears the line with a hair of
 * cloth to spare and stays under HOLE_CARD_INSET (0.78), which the "gives
 * the near seat its own corridor" test in seat-layout.test.ts still checks
 * — a bet spot outside its own seat's cards would sit behind them from the
 * camera's own angle.
 */
export const BET_SPOT_INSET = 0.74;

/**
 * The pot rests behind the community cards (negative Z is away from the
 * camera), never in front of them — the near half of the felt belongs to the
 * local player's cards. Same invariant the 2D room documents on
 * POT_DEPTH_FRACTION.
 */
export const POT_DEPTH_FRACTION = 0.39;
export const POT_POSITION: Vec3 = {
  x: 0,
  y: FELT_TOP_Y,
  z: -POT_DEPTH_FRACTION * FELT_RADIUS_Z,
};

/**
 * Centre of the community-card row — just past the middle, toward the far
 * side, so the near half of the cloth stays the local player's.
 *
 * Both of these are fractions of the felt's depth now rather than the
 * literals -0.52 and 0.08. Those were measured against a 1.32 plate, so a
 * change to the table's shape used to leave the pot and the board sitting
 * at absolute distances that meant something different — the pot drifting
 * proportionally further back on a shallower felt, which is exactly where
 * it stops being on the cloth at all. The fractions reproduce the tuned
 * positions on the old plate to within a millimetre.
 */
export const BOARD_DEPTH_FRACTION = 0.06;
export const BOARD_POSITION: Vec3 = {
  x: 0,
  y: FELT_TOP_Y,
  z: BOARD_DEPTH_FRACTION * FELT_RADIUS_Z,
};

/** Angle for a seat slot; slot 0 is at +Z (nearest the camera). */
export function seatAngle(slot: number): number {
  return (slot / SEAT_COUNT_3D) * Math.PI * 2;
}

/**
 * Where the avatar for a slot stands (on the floor, outside the rail).
 *
 * Not one shared ellipse: every seat but the far one (FAR_SEAT_SLOT) sits
 * NEAR_SEAT_EXTRA_SETBACK further out than SEAT_RING_RADIUS_X/Z alone would
 * put it. Both radii still scale together per slot, so each seat still
 * stands on a true ellipse — just a slightly larger one than its neighbour
 * across the table.
 */
export function seatPosition(slot: number): Vec3 {
  const angle = seatAngle(slot);
  const setback = seatSetback(slot);
  return {
    x: Math.sin(angle) * (FELT_RADIUS_X + setback),
    y: FLOOR_Y,
    z: Math.cos(angle) * (FELT_RADIUS_Z + setback),
  };
}

/**
 * Slot 0's bet spot sits deeper toward the board than everyone else's: its
 * hole cards take the near corridor (see holeCardPosition), and chips on
 * the ordinary inset would land on top of them.
 *
 * Raised from 0.4 alongside the ordinary BET_SPOT_INSET, for the same
 * betting-line reason — but it can't clear the line by quite as much as the
 * other five seats' spots do: NEAR_SEAT_BANKROLL_INSET (0.74) is this seat's
 * own hard ceiling — see that constant's comment for why it stays pulled in
 * — which leaves only 0.02 of felt between this and the line versus the
 * ordinary seats' 0.06. NEAR_SEAT_HOLE_CARD_INSET (which the "corridor" test
 * still requires this stay under) moved to 0.72 alongside it — its own
 * ceiling is no longer a rendered card's occlusion (the local player's own
 * pair is DOM — hud/own-hole-cards.tsx — so this seat's felt position is a
 * shadow/fold-flight anchor only; see that constant's own comment) but the
 * ordering test itself.
 */
export const NEAR_SEAT_BET_INSET = 0.7;

/** Where a slot's committed street bet rests, on the felt. */
export function betSpotPosition(slot: number): Vec3 {
  const inset = slot === 0 ? NEAR_SEAT_BET_INSET : BET_SPOT_INSET;
  const angle = seatAngle(slot);
  return {
    x: Math.sin(angle) * FELT_RADIUS_X * inset,
    y: FELT_TOP_Y,
    z: Math.cos(angle) * FELT_RADIUS_Z * inset,
  };
}

/**
 * Chips leave a bettor's hands, not their chair: just inside their place at
 * the rail, at hand height above the floor.
 *
 * Stated here rather than in whichever component happens to launch a push,
 * because two of them do — the ordinary bet diff and the mid-flight
 * handoff a renderer switch rebuilds — and a launch point that differs
 * between them makes the same bet leave from two places depending on
 * whether the player changed renderer while it was in the air.
 */
export const HAND_HEIGHT_Y = 1.05;
const HAND_INSET = 0.82;

export function handLaunchPosition(slot: number): Vec3 {
  const seat = seatPosition(slot);
  return { x: seat.x * HAND_INSET, y: HAND_HEIGHT_Y, z: seat.z * HAND_INSET };
}

/**
 * Where a slot's hole cards lie, on the felt just inside the rail.
 *
 * Slot 0 gets its own inset, kept separate from the ordinary five seats'
 * even now that nothing draws a card there (see NEAR_SEAT_HOLE_CARD_INSET's
 * own comment) — it is still the near seat's own corridor floor, and a
 * shared constant would tie this seat's fold-flight anchor to a number
 * tuned for a card that isn't this seat's.
 */
/*
 * Pulled in from 0.82 when the felt took its true 2.13 x 1.07 proportions,
 * and the reason is an ordering rule rather than a look: from the rail
 * inward a real table reads bankroll, cards, bet, board, and the bankroll
 * props are physical objects at a fixed real size. On the narrower plate the
 * outermost inset at which the deepest pile keeps every corner on the cloth
 * is 0.82 — the value the cards already occupied — so the two could not
 * both stay there and still be in that order. The cards are the ones with
 * room to give: they were small, and 0.78 kept them well outside the bet
 * spot, back when that spot sat at 0.58.
 *
 * Nudged again to 0.78 alongside BET_SPOT_INSET's own move to 0.74 (see that
 * constant's comment on the painted betting line) — cards need to clear the
 * bet spot in front of them, not the line itself, so this followed rather
 * than led.
 *
 * The near seat's value is no longer "untouched". It WAS measured on a
 * render against the local player's own figure occluding their cards, which
 * mattered when a 3D pair actually rendered there — but their own cards are
 * DOM now (hud/own-hole-cards.tsx; see poker-scene.tsx's own comment on
 * seatHasFeltCards), so this seat's felt position has no card to occlude
 * any more. It still exists as the near seat's fold-flight start point and
 * the ordering floor NEAR_SEAT_BET_INSET's comment describes, which is why
 * it moved to 0.72 (the betting line itself) rather than staying put.
 */
const HOLE_CARD_INSET = 0.78;
const NEAR_SEAT_HOLE_CARD_INSET = 0.72;

export function holeCardPosition(slot: number): Vec3 {
  const inset = slot === 0 ? NEAR_SEAT_HOLE_CARD_INSET : HOLE_CARD_INSET;
  const angle = seatAngle(slot);
  return {
    x: Math.sin(angle) * FELT_RADIUS_X * inset,
    y: FELT_TOP_Y,
    z: Math.cos(angle) * FELT_RADIUS_Z * inset,
  };
}

/**
 * Y rotation that turns a model whose forward axis is +Z to face the table
 * centre from `position`.
 */
export function faceCentreRotationY(position: Vec3): number {
  return Math.atan2(-position.x, -position.z);
}
