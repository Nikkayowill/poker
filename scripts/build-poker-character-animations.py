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
            rotate_local(rig, suffix, angles)
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
        bpy.data.actions.remove(source)
        apply_canonical_seated_pose(rig)
        base_pose = snapshot_pose(rig)
        source = action(rig, "Poker_Idle", base_pose, [
            (1, {}),
            (36, {"Spine1": (math.radians(1.2), 0, 0), "Spine2": (math.radians(1.5), 0, 0)}),
            (72, {}),
        ])
    else:
        bpy.context.scene.frame_set(SOURCE_FRAME)
        bpy.context.view_layer.update()
        base_pose = snapshot_pose(rig)
        source.name = "Poker_Idle"
        source.use_fake_user = True

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
