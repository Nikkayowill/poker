"""Add reusable seated poker actions to a rigged character GLB.

The input must be an uncompressed GLB that Blender can import. The shipped
StackChips models use EXT_meshopt_compression, so the companion shell pipeline
decodes a temporary copy with gltf-transform before invoking this script.

Usage:
  blender --background --factory-startup \
    --python scripts/build-poker-character-animations.py -- input.glb output.glb
"""

from __future__ import annotations

import math
import os
import sys
from collections.abc import Iterable

import bpy
from mathutils import Quaternion, Vector


FPS = 24
SOURCE_FRAME = 1

# The premium source pack carries a zero-duration T-pose rather than a seated
# clip. These are the local Mixamo pose rotations sampled from Gloria's seated
# source at frame 1. Mixamo prefixes vary, but the core rest axes and suffixes
# are shared across both the 41- and 65-bone roster families.
CANONICAL_SEATED_ROTATIONS = {
    "Hips": (0.98084885, -0.18785447, -0.03834975, -0.03428458),
    "LeftUpLeg": (-0.74548173, -0.65211105, 0.06108822, 0.12359637),
    "LeftLeg": (0.73636770, -0.67037582, -0.02895398, -0.08671997),
    "LeftFoot": (0.96980405, -0.24095382, -0.02953391, -0.02342566),
    "LeftToeBase": (0.99999875, -0.00161319, 0.00020817, 0.00012479),
    "RightUpLeg": (-0.79959112, -0.54785836, 0.08740655, -0.22992386),
    "RightLeg": (0.79155946, -0.60616916, 0.07163822, -0.02933339),
    "RightFoot": (0.97865731, -0.10361553, 0.02229948, -0.17605756),
    "RightToeBase": (0.99997121, -0.00752077, -0.00095841, -0.00016954),
    "Spine": (0.99114770, 0.12603107, 0.01738476, 0.03794784),
    "Spine1": (0.99908853, 0.04185319, -0.00069433, 0.00835168),
    "Spine2": (0.99908614, 0.04189977, -0.00150575, 0.00829997),
    "Neck": (0.99874508, -0.05003421, 0.00164520, 0.00135950),
    "Head": (0.99932671, -0.03662642, 0.00165911, 0.00134291),
    "LeftShoulder": (0.96539867, 0.08616011, 0.07338842, 0.23493718),
    "LeftArm": (0.82096362, 0.55750889, 0.05638357, -0.10964722),
    "LeftForeArm": (0.75632483, 0.06423371, -0.04667213, 0.64935988),
    "LeftHand": (0.77982056, -0.13406786, 0.53787440, 0.29085350),
    "RightShoulder": (0.98796159, 0.03643541, -0.06668445, -0.13475072),
    "RightArm": (0.80361658, 0.31434944, -0.29278845, -0.41189730),
    "RightForeArm": (0.87778771, 0.06955361, 0.03511746, -0.47267091),
    "RightHand": (0.87143266, -0.36806989, -0.30323461, -0.11479405),
}


def arguments() -> tuple[str, str]:
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 2:
        raise SystemExit("expected input.glb and output.glb")
    return os.path.abspath(values[0]), os.path.abspath(values[1])


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def armature() -> bpy.types.Object:
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"expected one armature, found {len(rigs)}")
    return rigs[0]


def bone_by_suffix(rig: bpy.types.Object, suffix: str):
    suffix = suffix.lower()
    return next((bone for bone in rig.pose.bones if bone.name.lower().endswith(suffix)), None)


def snapshot_pose(rig: bpy.types.Object) -> dict[str, tuple[Vector, Quaternion, Vector]]:
    return {
        bone.name: (
            bone.location.copy(),
            bone.rotation_quaternion.copy(),
            bone.scale.copy(),
        )
        for bone in rig.pose.bones
    }


def restore_pose(
    rig: bpy.types.Object,
    pose: dict[str, tuple[Vector, Quaternion, Vector]],
) -> None:
    for bone in rig.pose.bones:
        location, rotation, scale = pose[bone.name]
        bone.rotation_mode = "QUATERNION"
        bone.location = location
        bone.rotation_quaternion = rotation
        bone.scale = scale


def apply_canonical_seated_pose(rig: bpy.types.Object) -> None:
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)
    for suffix, rotation in CANONICAL_SEATED_ROTATIONS.items():
        bone = bone_by_suffix(rig, suffix)
        if bone is not None:
            bone.rotation_quaternion = Quaternion(rotation)
    bpy.context.view_layer.update()


#: TABLE SPACE — the one real-world number the whole "rest pose" is built
#: from, named once rather than buried in an arm-angle literal. A casino
#: table's playing surface sits TABLE_HEIGHT_M off the floor
#: (dimensions.ts's own constant, restated here since this file runs inside
#: Blender with no import path to the TS source of truth) and a seated
#: adult's hip rides ~2.6cm above a 0.45m chair pan under cushion
#: compression (chair.tsx's HIP_SIT_RISE, likewise restated) — so the felt
#: is TABLE_SURFACE_ABOVE_HIP_M above a seated player's OWN hip, regardless
#: of that player's height. TABLE_FORWARD_REACH_M is the horizontal
#: complement: how far in front of the hip a forearm has to travel to rest
#: on that surface, which is not a table dimension but a human-reach one —
#: kept separate rather than reusing the vertical number, because a resting
#: forearm's rise and its reach are not the same distance.
TABLE_HEIGHT_M = 0.75
CHAIR_SEAT_M = 0.45
HIP_SIT_RISE_M = 0.026
TABLE_SURFACE_ABOVE_HIP_M = TABLE_HEIGHT_M - (CHAIR_SEAT_M + HIP_SIT_RISE_M)
#: Raised from 0.16m, which had itself been cut from an original 0.35m to
#: stop the arms reading as "flung out to the side rather than resting on
#: the table". That symptom was the FACING BUG (_facing_sign below), not
#: the reach: forward was hardcoded as +Y on a roster that faces -Y, so
#: this number was the distance the hands were driven BACKWARD past the
#: hips, and shrinking it genuinely did help — by reaching less far the
#: wrong way. With the axis measured, at 0.16 the hands clasp at the chest
#: short of the table edge.
#:
#: 0.22 rather than the literal 0.35 because the two are indistinguishable
#: on a render and very different in the solve: measured across the roster,
#: 0.35 leaves five characters at maximum forward lean STILL unable to
#: reach, with half of all arms missing the target by over 3% of body
#: height (median 5.0%). At 0.22 nothing saturates, the median miss is
#: 0.12%, and the forearms still land out on the cloth. Past the point
#: where arms are already at full stretch, asking for more reach buys no
#: visible extension — it only spends the lean budget and leaves the hands
#: short. Judge any change here on a render WITH a felt proxy at the solved
#: height; without the surface in frame, "resting on the table" and
#: "clasped at the chest" look much the same.
TABLE_FORWARD_REACH_M = 0.22
HUMAN_STANDING_M = 1.75  # dimensions.ts's HUMAN_STANDING_M.

#: The ELBOW's own rest target, which the search scores separately from the
#: hand's. Scoring the hand alone proves only where the fingertips ended
#: up: the same wrist position is reachable with the elbow winged out to
#: the side or tucked under the ribs, and only one of those reads as a
#: player leaning on the table shielding their cards. So the elbow gets
#: real coordinates too — at the same felt height as the wrist, less far
#: forward (a resting forearm declines gently toward the cards rather than
#: lying parallel to the table edge), and slightly OUTSIDE its own
#: shoulder, which is what opens the forearm into a shield rather than
#: pinning it against the torso. The outward direction is taken from the
#: sign of (shoulder.x - hips.x) at solve time, never a hardcoded per-side
#: sign: this roster's Left/Right bones are not mirror images in local
#: space, which is the same reason find_arm_rest searches both Z signs.
ELBOW_FORWARD_REACH_M = 0.11
ELBOW_FLARE_M = 0.045
#: How far the wrist is drawn in from its own shoulder toward the body's
#: centreline: 0 leaves it out under the shoulder, 1 puts it exactly on the
#: centreline. It was effectively 1 — both wrists were given the SAME
#: target point, so the two hands were solved into each other and the pose
#: came out with the forearms crossed and the hands overlapping at the
#: midline. A poker player's hands converge toward their cards; they do not
#: occupy one point. Under 1 also shortens the lateral travel, so it buys a
#: little reach back on exactly the characters that were straining for it.
WRIST_CENTRELINE_PULL = 0.6
#: The minimum distance the wrist must sit FORWARD of its own elbow for a
#: candidate to count as a resting forearm at all — a hard constraint, not
#: a scoring term, because the objective genuinely has two minima and the
#: wrong one is not a near miss. A pose that throws the elbow forward past
#: the wrist and folds the forearm back toward the body scores WELL on
#: wrist position (the hand still lands on the felt) while being an arm
#: bent the wrong way round; on Gloria's left arm that basin beat the
#: correct one at every elbow weight tried, including one heavy enough to
#: start dragging other characters' wrists off the table. Rejecting the
#: whole basin costs nothing, since no character needs it to reach.
FOREARM_MIN_FORWARD_M = 0.04
#: Settled by sweeping it across the roster and measuring, not picked. The
#: wrist is the joint with a real object under it (the cards), so the elbow
#: is deliberately not allowed to outvote it by much: at 2.0 the elbow
#: starts dragging wrists off the felt (James' right went 2mm -> 28mm out).
#: At 0.5 Dora's two elbows settled 45mm apart from each other on the same
#: character. 1.0 is where her two sides land identically and the worst
#: wrist error across the roster is smallest.
ELBOW_WEIGHT = 1.0

#: Forward spine pitch, in degrees, tried in ascending order when a
#: character's arms are too SHORT to reach the felt from their seated pose
#: — the triangle-inequality case: ||wrist - shoulder|| must not exceed
#: upper arm + forearm, or no rotation of either joint can land the hand
#: on the table and the search can only return its least-bad miss. Leaning
#: the torso forward walks the shoulder toward the table until the reach
#: closes, which is also what a real short-armed player does rather than
#: stretching. Split across Spine and Spine1 so the bend reads as a torso
#: rather than a hinge at the waist, and applied to the base pose before
#: EITHER arm solves, so both sides solve against the same torso.
SPINE_LEAN_DEGREES = (6, 12, 18, 24)
#: Scaled by the character's own build at the call site, for the same
#: reason the score filter's slack is: the roster's rigs are authored at
#: wildly different world scales (bind spans measured here run 0.02 to
#: 3.69 units for characters that are all supposed to be adult humans), so
#: an absolute tolerance is simultaneously far too loose at one end of the
#: roster and far too tight at the other. Unscaled, this one silently
#: disabled the lean entirely for the eight customer-pack characters — a
#: deficit of half their body height still read as "within tolerance".
REACH_TOLERANCE_FRACTION = 0.01

#: Search ranges for shoulder ("Arm") and elbow ("ForeArm") flexion, local
#: X/Z in degrees. X reaches the hand forward and up; Z is what keeps it
#: tucked near the body instead of swinging out to the side. Deliberately
#: NOT signed the same for Left/Right going in — find_arm_rest tries both
#: signs on Z and keeps whichever actually lands closer to the centreline,
#: because this roster's Left/Right bones are not mirror images of each
#: other in local space (CANONICAL_SEATED_ROTATIONS above already carries
#: visibly different numbers per side for the same reason).
_SEARCH_ARM_X = (0, 15, 30, 45, 60, 75)
_SEARCH_ARM_Z = (-40, -20, 0, 20, 40)
_SEARCH_FORE_X = (0, 20, 40, 60, 80)
_SEARCH_FORE_Z = (-40, -20, 0, 20, 40)

#: Coordinate-descent step sizes, in degrees, run after the coarse grid.
#: The grid exists to find the right BASIN (it is the part that cannot get
#: trapped by a local minimum); these polish within it.
_REFINE_STEPS = (8.0, 4.0, 2.0, 1.0)

_FINGER_CURL = (math.radians(24), math.radians(18), math.radians(10))


#: Fallback for a rig with no toe bones. Every character on the current
#: roster faces -Y, so this is what the measurement below would have
#: returned anyway; it exists so a future rig missing ToeBase degrades to
#: the house convention rather than silently reaching backward.
FALLBACK_FACING = -1.0


def _facing_sign(rig: bpy.types.Object) -> float:
    """Which way along Y this character faces, measured from its OWN feet.

    Load-bearing, and the single most expensive thing in this file to get
    wrong. Every length below ("forward reach", "elbow forward of hip",
    "hand forward of elbow") is signed along this axis, and the roster
    faces -Y — so a hardcoded +Y, which is what this file used to assume,
    solves the entire arm rest BEHIND the character: hands reaching back
    past the hips, elbows required to be behind the hip to pass the very
    filter whose comment says it exists to keep them in front. Toes are
    the measurement because a foot bone points at its toe by construction
    on every Mixamo rig here, at any scale and in either bone family.
    """
    votes = 0.0
    for side in ("Left", "Right"):
        foot = _bone_world(rig, f"{side}Foot")
        toe = _bone_world(rig, f"{side}ToeBase")
        if foot is not None and toe is not None:
            votes += toe.y - foot.y
    if votes == 0.0:
        return FALLBACK_FACING
    return 1.0 if votes > 0 else -1.0


def _bone_world(rig: bpy.types.Object, suffix: str) -> Vector | None:
    bone = bone_by_suffix(rig, suffix)
    if bone is None:
        return None
    return rig.matrix_world @ bone.matrix.translation


def _measured_bind_span(rig: bpy.types.Object) -> float:
    """The rig's own standing bone span, without disturbing its CURRENT pose.

    Zeroing every bone to measure the rest skeleton would blow away
    whatever legs/spine/head pose the caller already established (canonical
    or that character's own seated mocap), so the current pose is snapshot
    and restored around the measurement.
    """
    saved = snapshot_pose(rig)
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()
    ys = []
    for bone in rig.pose.bones:
        w = rig.matrix_world @ bone.matrix.translation
        ys.append(w.z)
    span = max(ys) - min(ys) if ys else 0.0
    restore_pose(rig, saved)
    bpy.context.view_layer.update()
    return span


def _rest_targets(
    rig: bpy.types.Object,
    side: str,
    hips: Vector,
    ratio: float,
    forward: float,
) -> tuple[Vector, Vector] | None:
    """Absolute wrist and elbow targets for one arm, in world space.

    Both are expressed off the character's OWN hip and scaled by that
    character's own bind span, so a short character and a tall one each get
    a target at their own felt height rather than one borrowed from the
    roster's median build.
    """
    shoulder = _bone_world(rig, f"{side}Arm")
    if shoulder is None:
        return None
    surface_z = hips.z + TABLE_SURFACE_ABOVE_HIP_M * ratio
    wrist = Vector((
        # Drawn in toward the centreline from this shoulder, not placed on
        # it — see WRIST_CENTRELINE_PULL.
        shoulder.x + (hips.x - shoulder.x) * WRIST_CENTRELINE_PULL,
        hips.y + TABLE_FORWARD_REACH_M * ratio * forward,
        surface_z,
    ))
    outward = 1.0 if shoulder.x >= hips.x else -1.0
    elbow = Vector((
        shoulder.x + ELBOW_FLARE_M * ratio * outward,
        hips.y + ELBOW_FORWARD_REACH_M * ratio * forward,
        surface_z,
    ))
    return wrist, elbow


def _reach_deficit(rig: bpy.types.Object, side: str, wrist: Vector) -> float:
    """How far SHORT of `wrist` this arm is, fully extended. <=0 means reachable.

    Bone lengths are measured off the rig's current pose rather than read
    from a table of per-character numbers — rotating a joint never changes
    the distance to its own child, so these are the true limb lengths no
    matter what pose the caller established.
    """
    shoulder = _bone_world(rig, f"{side}Arm")
    elbow = _bone_world(rig, f"{side}ForeArm")
    hand = _bone_world(rig, f"{side}Hand")
    if shoulder is None or elbow is None or hand is None:
        return 0.0
    span = (elbow - shoulder).length + (hand - elbow).length
    return (wrist - shoulder).length - span


def _forward_pitch_sign(rig: bpy.types.Object, forward: float) -> float:
    """Which sign of local X on Spine pitches this rig's chest FORWARD.

    Measured by trying it and watching which way a shoulder actually
    travels, not assumed from the Mixamo convention: getting it backwards
    would lean a character who cannot reach the table further AWAY from it,
    and the failure would look like the reach fix simply not working.
    """
    saved = snapshot_pose(rig)
    before = _bone_world(rig, "RightArm") or _bone_world(rig, "LeftArm")
    if before is None:
        return 1.0
    before_y = before.y
    rotate_local(rig, "Spine", (math.radians(10), 0.0, 0.0))
    bpy.context.view_layer.update()
    after = _bone_world(rig, "RightArm") or _bone_world(rig, "LeftArm")
    moved = ((after.y - before_y) * forward) if after is not None else 0.0
    restore_pose(rig, saved)
    bpy.context.view_layer.update()
    return 1.0 if moved >= 0 else -1.0


def _lean_into_reach(
    rig: bpy.types.Object,
    hips: Vector,
    ratio: float,
    forward: float,
) -> None:
    """Pitch the torso forward until BOTH arms can reach their wrist target.

    Applies the smallest lean that clears both sides; if none of them does
    (a genuinely very short-armed character), the largest is kept, since a
    character straining toward the felt still reads better than one sitting
    bolt upright with its hands in mid-air. Every attempt is applied to the
    same saved pose rather than compounded on the previous one.
    """
    sides = [side for side in ("Right", "Left") if bone_by_suffix(rig, f"{side}Arm") is not None]
    if not sides:
        return

    tolerance = REACH_TOLERANCE_FRACTION * ratio

    def worst_deficit() -> float:
        worst = -math.inf
        for side in sides:
            targets = _rest_targets(rig, side, hips, ratio, forward)
            if targets is None:
                continue
            worst = max(worst, _reach_deficit(rig, side, targets[0]))
        return worst if worst > -math.inf else 0.0

    if worst_deficit() <= tolerance:
        return

    sign = _forward_pitch_sign(rig, forward)
    upright = snapshot_pose(rig)
    for degrees in SPINE_LEAN_DEGREES:
        restore_pose(rig, upright)
        half = math.radians(degrees / 2.0) * sign
        rotate_local(rig, "Spine", (half, 0.0, 0.0))
        rotate_local(rig, "Spine1", (half, 0.0, 0.0))
        bpy.context.view_layer.update()
        if worst_deficit() <= tolerance:
            print(f"INFO leaned torso {degrees} deg forward to bring the felt into reach")
            return
    print(
        f"WARN arms still short of the table at {SPINE_LEAN_DEGREES[-1]} deg of lean; "
        "keeping the deepest lean"
    )


def find_arm_rest(
    rig: bpy.types.Object,
    side: str,
    hips: Vector,
    ratio: float,
    forward: float,
) -> None:
    """Solve, then APPLY, an absolute rest rotation for one arm.

    This is an FK grid search, run fresh per character per side against
    THAT character's own current pose and own proportions — never a fixed
    set of degrees copied from one character onto the rest of the roster.
    That distinction is load-bearing: an earlier version of this function
    baked one character's angles as a constant and re-applied them as a
    *delta* on top of whatever arm rotation every other character's own
    seated source clip already had, which composes into a different
    absolute shoulder orientation per character — on a few of them, one
    that reads as the arm wrenched behind the back. Solving per character
    and assigning the *result* outright removes the composition entirely:
    every character's shoulder lands at a rotation chosen for that
    character, not one borrowed from Gloria's.
    """
    arm = bone_by_suffix(rig, f"{side}Arm")
    fore = bone_by_suffix(rig, f"{side}ForeArm")
    hand = bone_by_suffix(rig, f"{side}Hand")
    if arm is None or fore is None or hand is None:
        return

    base_arm_q = arm.rotation_quaternion.copy()
    base_fore_q = fore.rotation_quaternion.copy()
    targets = _rest_targets(rig, side, hips, ratio, forward)
    if targets is None:
        return
    wrist_target, elbow_target = targets

    d = math.radians

    def set_delta(ax: float, az: float, fx: float, fz: float) -> None:
        arm_delta = Quaternion((1.0, 0.0, 0.0, 0.0))
        for axis, angle in zip(((1, 0, 0), (0, 0, 1)), (d(ax), d(az))):
            arm_delta @= Quaternion(axis, angle)
        arm.rotation_quaternion = base_arm_q @ arm_delta
        fore_delta = Quaternion((1.0, 0.0, 0.0, 0.0))
        for axis, angle in zip(((1, 0, 0), (0, 0, 1)), (d(fx), d(fz))):
            fore_delta @= Quaternion(axis, angle)
        fore.rotation_quaternion = base_fore_q @ fore_delta

    # Matching the hand's final position is not enough to prove the arm got
    # there by reaching forward: the same (y, z) is also reachable by
    # swinging the arm backward and around behind the body, which is
    # exactly what a bare position match let through for a couple of
    # characters — a plausible-looking number that was actually the elbow
    # pointing the wrong way. Reject any candidate whose elbow ends up
    # behind the hip, or whose hand ends up behind its own elbow: neither
    # can be "resting forward on the table" regardless of where the
    # fingertip lands.
    # Scaled by the character's own build, like every other length here.
    # These were absolute metres, which made the whole filter meaningless
    # at both ends of the roster: the customer-pack rigs measure ~0.02
    # world units tall in total, so a 0.02 tolerance admitted literally
    # every candidate including fully backward-reaching ones, while the
    # 3.7-unit rig was held to a tolerance 100x tighter than intended.
    slack = 0.02 * ratio
    min_forearm_reach = FOREARM_MIN_FORWARD_M * ratio

    def score(ax: float, az: float, fx: float, fz: float) -> float:
        set_delta(ax, az, fx, fz)
        bpy.context.view_layer.update()
        ep = _bone_world(rig, f"{side}ForeArm")
        hp = _bone_world(rig, f"{side}Hand")
        # Projected onto the character's own facing, never raw +Y — these
        # two comparisons are the constraints the whole solve rests on, and
        # written against the axis directly they silently mean the exact
        # opposite on a rig that faces the other way.
        elbow_ahead_of_hip = (ep.y - hips.y) * forward
        hand_ahead_of_elbow = (hp.y - ep.y) * forward
        if elbow_ahead_of_hip < -slack or hand_ahead_of_elbow < min_forearm_reach:
            return math.inf
        return (
            abs(hp.y - wrist_target.y)
            + abs(hp.z - wrist_target.z)
            + 1.5 * abs(hp.x - wrist_target.x)
            + ELBOW_WEIGHT
            * (
                abs(ep.y - elbow_target.y)
                + abs(ep.z - elbow_target.z)
                + abs(ep.x - elbow_target.x)
            )
        )

    best_err = math.inf
    best = (0.0, 0.0, 0.0, 0.0)
    for ax in _SEARCH_ARM_X:
        for az in _SEARCH_ARM_Z:
            for fx in _SEARCH_FORE_X:
                for fz in _SEARCH_FORE_Z:
                    err = score(ax, az, fx, fz)
                    if err < best_err:
                        best_err = err
                        best = (float(ax), float(az), float(fx), float(fz))

    # The coarse grid steps 15-20 degrees, which is far wider than the pose
    # difference between "forearm resting along the felt" and "forearm
    # swung out sideways across the rail" — so the grid's own winner was
    # regularly a near-miss that satisfied the wrist and left the elbow
    # 2x its intended flare out from the shoulder, differently on each
    # side of the SAME character. Coordinate descent on shrinking steps
    # settles the same objective properly. It only ever moves to a strictly
    # better score, so it cannot return anything worse than the grid's
    # winner, and it inherits the backward-reach rejection for free by
    # scoring rejected candidates as infinite.
    if best_err < math.inf:
        bounds = (
            (min(_SEARCH_ARM_X) - 15, max(_SEARCH_ARM_X) + 15),
            (min(_SEARCH_ARM_Z) - 15, max(_SEARCH_ARM_Z) + 15),
            (min(_SEARCH_FORE_X) - 15, max(_SEARCH_FORE_X) + 15),
            (min(_SEARCH_FORE_Z) - 15, max(_SEARCH_FORE_Z) + 15),
        )
        for step in _REFINE_STEPS:
            improved = True
            while improved:
                improved = False
                for axis in range(4):
                    for delta in (step, -step):
                        candidate = list(best)
                        low, high = bounds[axis]
                        candidate[axis] = min(high, max(low, candidate[axis] + delta))
                        if candidate[axis] == best[axis]:
                            continue
                        err = score(*candidate)
                        if err < best_err - 1e-9:
                            best_err = err
                            best = tuple(candidate)
                            improved = True

    if math.isinf(best_err):
        # No candidate in the search grid cleared the forward-reach
        # constraint for this character — leave the arm at whatever pose it
        # already had rather than force a rejected (backward-reaching)
        # candidate. Loud on purpose: a silent fallback here would ship a
        # character with lifeless arms and no record of why.
        print(f"WARN no valid arm-rest candidate for {side} arm; leaving pose unchanged")
        return

    # Apply the winner as the FINAL, absolute rotation — no further delta
    # gets composed on top of it by any caller.
    set_delta(*best)
    sign = -1 if side == "Left" else 1
    hand.rotation_quaternion = hand.rotation_quaternion @ (
        Quaternion((1, 0, 0), d(-8)) @ Quaternion((0, 0, 1), d(6 * sign))
    )
    bpy.context.view_layer.update()


def apply_arm_rest(rig: bpy.types.Object) -> None:
    # Measured ONCE here rather than per side: _measured_bind_span zeroes
    # every bone to read the rest skeleton and restores the pose after, so
    # calling it inside each solve did the same expensive round trip twice
    # for one number that cannot differ between a character's two arms.
    bind_span = _measured_bind_span(rig)
    hips = _bone_world(rig, "Hips")
    if hips is None or bind_span <= 0:
        return
    ratio = bind_span / HUMAN_STANDING_M
    forward = _facing_sign(rig)

    # Reach first, arms second. The lean moves both shoulders, so solving an
    # arm before it would solve against a torso that is about to move.
    _lean_into_reach(rig, hips, ratio, forward)
    find_arm_rest(rig, "Right", hips, ratio, forward)
    find_arm_rest(rig, "Left", hips, ratio, forward)
    # Finger curl: a much smaller, non-searched touch so a resting hand
    # reads as relaxed rather than a flat mitt. Bones that don't exist on a
    # given rig (the 41-bone family has no fingers) are a silent no-op via
    # rotate_local's own None guard, so this is safe to apply unconditionally.
    for side in ("Left", "Right"):
        for finger in ("Index", "Middle", "Ring", "Pinky", "Thumb"):
            for segment, curl in zip((1, 2, 3), _FINGER_CURL):
                rotate_local(rig, f"{side}Hand{finger}{segment}", (curl, 0.0, 0.0))
    bpy.context.view_layer.update()


def rotate_local(rig: bpy.types.Object, suffix: str, xyz: tuple[float, float, float]) -> None:
    bone = bone_by_suffix(rig, suffix)
    if bone is None:
        return
    delta = Quaternion((1.0, 0.0, 0.0, 0.0))
    for axis, angle in zip(((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), xyz):
        if angle:
            delta @= Quaternion(axis, angle)
    bone.rotation_quaternion = bone.rotation_quaternion @ delta


def translate_local(rig: bpy.types.Object, suffix: str, xyz: tuple[float, float, float]) -> None:
    bone = bone_by_suffix(rig, suffix)
    if bone is not None:
        bone.location += Vector(xyz)


def key_pose(rig: bpy.types.Object, frame: int) -> None:
    for bone in rig.pose.bones:
        bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)


def action_fcurves(result: bpy.types.Action):
    """Yield curves from legacy Actions and Blender 4.4+'s layered Actions."""
    if hasattr(result, "fcurves"):
        yield from result.fcurves
        return
    for layer in result.layers:
        for strip in layer.strips:
            for channelbag in getattr(strip, "channelbags", []):
                yield from channelbag.fcurves


#: Fold/Check/Bet/Raise/Celebrate's arm deltas below were tuned against the
#: OLD rest pose, where the arm started near the lap — so reaching to the
#: table took a large swing. Now that base_pose already rests the arm ON
#: the table (find_arm_rest), the same swing overshoots: for the couple of
#: characters whose rest pose lands closest to their own reach limit, it
#: was enough to push the gesture's peak frame out past a natural range
#: (an arm visibly flung out to the side, off the table). Rather than
#: retune every keyframe below by hand, every arm/forearm/hand delta these
#: actions request is scaled down here, uniformly, at the one place they
#: all pass through — `action()`. Spine/neck/head deltas (the majority of
#: what most of these gestures actually are) are untouched.
GESTURE_ARM_SCALE = 0.4


def _scaled(suffix: str, angles: tuple[float, float, float]) -> tuple[float, float, float]:
    if "Arm" in suffix or suffix.endswith("Hand"):
        return tuple(a * GESTURE_ARM_SCALE for a in angles)
    return angles


def action(
    rig: bpy.types.Object,
    name: str,
    base_pose: dict[str, tuple[Vector, Quaternion, Vector]],
    keys: Iterable[tuple[int, dict[str, tuple[float, float, float]]]],
) -> bpy.types.Action:
    existing = bpy.data.actions.get(name)
    if existing is not None:
        if rig.animation_data and rig.animation_data.action == existing:
            rig.animation_data.action = None
        bpy.data.actions.remove(existing)

    result = bpy.data.actions.new(name)
    result.use_fake_user = True
    rig.animation_data.action = result
    for frame, rotations in keys:
        restore_pose(rig, base_pose)
        for suffix, angles in rotations.items():
            rotate_local(rig, suffix, _scaled(suffix, angles))
        key_pose(rig, frame)
    # Blender's unconstrained automatic Bezier handles can overshoot a keyed
    # shoulder/forearm rotation between poses, which reads as a wrist snap in
    # a short poker gesture. Auto-clamped keeps the ease without inventing a
    # more extreme pose than either neighbouring key.
    for curve in action_fcurves(result):
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"
    return result


def poker_actions(
    rig: bpy.types.Object,
    base_pose: dict[str, tuple[Vector, Quaternion, Vector]],
) -> list[bpy.types.Action]:
    d = math.radians
    actions = []

    # Slow, readable thought: eyes/head settle toward the felt, then glance.
    actions.append(action(rig, "Poker_Thinking", base_pose, [
        (1, {}),
        (18, {"Spine2": (d(4), 0, 0), "Neck": (d(7), 0, 0), "Head": (d(4), d(-5), 0)}),
        (38, {"Spine2": (d(3), 0, d(-2)), "Neck": (d(5), d(7), 0), "Head": (d(3), d(8), 0)}),
        (58, {"Spine2": (d(4), 0, 0), "Neck": (d(7), 0, 0), "Head": (d(4), d(-4), 0)}),
        (72, {}),
    ]))

    # Right hand slides the cards toward the dealer; torso settles back.
    actions.append(action(rig, "Poker_Fold", base_pose, [
        (1, {}),
        (9, {"Spine": (d(5), 0, 0), "Spine2": (d(7), 0, d(-2))}),
        (20, {"Spine": (d(7), 0, 0), "RightArm": (d(-10), 0, d(10)), "RightForeArm": (d(-10), 0, d(10)), "RightHand": (d(4), 0, d(-12))}),
        (31, {"Spine": (d(4), 0, 0), "RightArm": (d(-6), 0, d(6)), "RightForeArm": (d(-6), 0, d(6))}),
        (44, {"Spine": (d(-3), 0, 0), "Spine2": (d(-4), 0, 0), "Head": (d(-3), d(7), 0)}),
        (56, {"Spine": (d(-4), 0, 0), "Spine2": (d(-5), 0, 0)}),
    ]))

    # Two small table taps. Distinct name allows a future check event to pick it.
    actions.append(action(rig, "Poker_Check", base_pose, [
        (1, {}),
        (8, {"Spine2": (d(3), 0, 0), "RightArm": (d(-6), 0, d(6)), "RightForeArm": (d(-5), 0, d(7))}),
        (13, {"RightArm": (d(-8), 0, d(8)), "RightForeArm": (d(-8), 0, d(9)), "RightHand": (d(7), 0, 0)}),
        (18, {"RightArm": (d(-5), 0, d(6)), "RightForeArm": (d(-4), 0, d(6))}),
        (23, {"RightArm": (d(-8), 0, d(8)), "RightForeArm": (d(-8), 0, d(9)), "RightHand": (d(7), 0, 0)}),
        (34, {}),
    ]))

    # Gather chips near the rail, extend, release, and return.
    actions.append(action(rig, "Poker_Bet", base_pose, [
        (1, {}),
        (8, {"Spine2": (d(3), 0, d(-2)), "RightArm": (d(-4), 0, d(4)), "RightForeArm": (d(-4), 0, d(4)), "RightHand": (d(5), 0, d(-8))}),
        (18, {"Spine": (d(5), 0, 0), "Spine2": (d(7), 0, d(-2)), "RightArm": (d(-8), 0, d(8)), "RightForeArm": (d(-8), 0, d(8)), "RightHand": (d(8), 0, d(-12))}),
        (28, {"Spine": (d(4), 0, 0), "RightArm": (d(-10), 0, d(10)), "RightForeArm": (d(-10), 0, d(10)), "RightHand": (d(-3), 0, d(5))}),
        (42, {"RightArm": (d(-5), 0, d(5)), "RightForeArm": (d(-5), 0, d(5))}),
        (52, {}),
    ]))

    # A clearer, more assertive raise: chips forward and off-hand lifts.
    actions.append(action(rig, "Poker_Raise", base_pose, [
        (1, {}),
        (10, {"Spine2": (d(4), 0, 0), "LeftArm": (d(-8), 0, d(-8)), "LeftForeArm": (d(-22), 0, d(5))}),
        (21, {"Spine": (d(5), 0, 0), "RightArm": (d(-9), 0, d(9)), "RightForeArm": (d(-9), 0, d(9)), "LeftArm": (d(-20), d(-6), d(-18)), "LeftForeArm": (d(-38), 0, d(10))}),
        (34, {"Spine": (d(4), 0, 0), "RightArm": (d(-10), 0, d(10)), "RightForeArm": (d(-10), 0, d(10)), "LeftArm": (d(-12), 0, d(-10)), "LeftForeArm": (d(-24), 0, d(5))}),
        (50, {}),
    ]))

    # Seated victory: a satisfied lean-and-nod with one short table-level hand
    # beat. Mixamo hands in this roster are open in the base pose, so lifting
    # one to chest height reads as "stop", not a fist pump; keeping it near
    # the rail lets posture and timing carry the win instead.
    actions.append(action(rig, "Poker_Celebrate", base_pose, [
        (1, {}),
        (10, {"Spine": (d(-2), 0, 0), "Spine2": (d(-3), 0, d(1)), "Neck": (d(-2), d(-2), 0), "Head": (d(-3), d(-3), 0)}),
        (22, {"Spine": (d(-3), 0, 0), "Spine2": (d(-5), 0, d(2)), "Neck": (d(3), d(-4), 0), "Head": (d(5), d(-5), 0), "RightArm": (d(-5), d(1), d(5)), "RightForeArm": (d(-9), 0, d(-3))}),
        (32, {"Spine": (d(-3), 0, 0), "Spine2": (d(-4), 0, d(-1)), "Neck": (d(-2), d(2), 0), "Head": (d(-3), d(3), 0), "RightArm": (d(-8), d(2), d(8)), "RightForeArm": (d(-15), 0, d(-5)), "RightHand": (d(3), 0, 0)}),
        (42, {"Spine": (d(-2), 0, 0), "Spine2": (d(-3), 0, d(1)), "Neck": (d(2), d(-2), 0), "Head": (d(3), d(-2), 0), "RightArm": (d(-4), d(1), d(4)), "RightForeArm": (d(-8), 0, d(-3))}),
        (56, {"Spine": (d(-2), 0, 0), "Spine2": (d(-3), 0, d(1)), "Head": (d(-2), d(-2), 0)}),
    ]))
    return actions


def main() -> None:
    source_path, output_path = arguments()
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=source_path)
    rig = armature()
    rig.animation_data_create()

    source = rig.animation_data.action
    if source is None:
        source = next(iter(bpy.data.actions), None)
        rig.animation_data.action = source
    if source is None:
        raise RuntimeError("input character has no seated source animation")

    bpy.context.scene.render.fps = FPS
    static_source = source.frame_range[1] - source.frame_range[0] <= 2.0
    if static_source:
        rig.animation_data.action = None
        apply_canonical_seated_pose(rig)
    else:
        bpy.context.scene.frame_set(SOURCE_FRAME)
        bpy.context.view_layer.update()

    # Legs/spine/head come from whatever pose was just established above —
    # the canonical fallback for a static-source rig, or that character's
    # own real seated mocap otherwise, unchanged either way. Arms are always
    # overridden here: a raw Mixamo "seated" clip rests the hands in the lap
    # regardless of source, which is the actual "lifeless" complaint this
    # function exists to fix, so it is not something either branch above can
    # be trusted to have gotten right on its own.
    apply_arm_rest(rig)
    base_pose = snapshot_pose(rig)

    # The original action (real mocap or none) is discarded either way, in
    # favour of one freshly keyed from base_pose — the ONLY way an override
    # applied to the in-memory pose bones above actually survives into the
    # exported clip; mutating pose bones after an action is already assigned
    # changes what you can currently see in this session, not what plays
    # back once Poker_Idle is sampled from its own keyframes.
    rig.animation_data.action = None
    bpy.data.actions.remove(source)
    source = action(rig, "Poker_Idle", base_pose, [
        (1, {}),
        (36, {"Spine1": (math.radians(1.2), 0, 0), "Spine2": (math.radians(1.5), 0, 0)}),
        (72, {}),
    ])

    created = poker_actions(rig, base_pose)
    rig.animation_data.action = source

    # A few source exports carry an unparented two-metre Icosphere helper.
    # It is not weighted character geometry and would engulf the avatar if it
    # survived the re-export.
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.parent is None and obj.name.lower().startswith("icosphere"):
            bpy.data.objects.remove(obj, do_unlink=True)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_apply=False,
    )
    print(
        "OK",
        os.path.basename(output_path),
        "actions:",
        ", ".join([source.name, *(item.name for item in created)]),
    )
    # Some Linux audio backends leave Blender's background process alive after
    # the script returns. Explicitly quitting makes the batch deterministic.
    if bpy.app.background:
        sys.stdout.flush()
        os._exit(0)


if __name__ == "__main__":
    main()
