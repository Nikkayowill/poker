"""
render-stackacres-craftpix-crops.py

Source of the 22 StackAcres crop sprites: headless Blender automation that
turns CraftPix's "Free Farming Crops 3D Low Poly Models" pack (one static
.fbx per crop, source zip not in this repo) into 3-stage isometric PNGs.

Colors THE PACK'S OWN texture atlas in (texture/texture.png) -- Blender's FBX
importer never resolves the embedded relative image path, so every material
renders flat grey until an Image Texture node is wired to the mesh's existing
UVs by hand; see bind_texture_atlas().

Growth stages are synthesized, not sourced -- the pack ships one (mature)
model per crop, no seedling/sprout variants. Each mesh's own faces are
re-sorted bottom-to-top by world Z, then a Build modifier reveals a fraction
of them per stage (see GROWTH_STAGES): a partial reveal is always whole
original faces, so it needs no plane-cut/capping geometry and stays correct
on the pack's thin, non-manifold "card" leaves. All 3 stages of one crop
share ONE camera framing, locked to the MATURE silhouette, so a seedling
reads as visibly smaller within the same canvas rather than independently
re-filling the frame -- see trim-stackacres-craftpix-crops.py, the next
step, for how that shared canvas becomes the game's actual sprite files.

Usage:
    blender -b -P render-stackacres-craftpix-crops.py

Run from inside the extracted pack's own folder (SOURCE_DIR/OUTPUT_DIR/
TEXTURE_PATH below are relative to this script's own location, i.e. the
extracted zip root with fbx/ and texture/ subfolders) or edit those
constants to absolute paths.
"""

import bpy
import glob
import math
import os

import mathutils

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.join(SCRIPT_DIR, "fbx")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output_sprites")
TEXTURE_PATH = os.path.join(SCRIPT_DIR, "texture", "texture.png")

RESOLUTION = 512
ISO_ROTATION_DEG = (54.736, 0.0, 45.0)  # true 2:1 isometric
CAMERA_DISTANCE_FACTOR = 6.0            # how far back the camera sits, relative to bbox radius
FRAME_PADDING = 1.12                    # headroom so the model doesn't touch the edge
LINE_ART_THICKNESS = 2.4

# Three growth stages per crop, named to match lib/stackacres/crop-visuals.ts's
# CropStage (0 seedling, 1 sprout, 2 mature). Each is a *fraction of the plant's
# own faces*, revealed lowest-to-highest so early stages read as "just come up
# out of the soil" rather than a uniformly shrunk copy of the full plant.
GROWTH_STAGES = (
    (0, 0.30),  # seedling
    (1, 0.62),  # sprout
    (2, 1.00),  # mature
)

RENDER_ENGINE_CANDIDATES = ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"]


# ---------------------------------------------------------------------------
# Scene setup helpers
# ---------------------------------------------------------------------------

def clear_scene():
    """Wipe the default cube/camera/light and every stale datablock."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    for collection in (
        bpy.data.meshes,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.armatures,
        bpy.data.actions,
        getattr(bpy.data, "grease_pencils", []),
        getattr(bpy.data, "grease_pencils_v3", []),
    ):
        for block in list(collection):
            try:
                collection.remove(block)
            except (RuntimeError, ReferenceError):
                pass


def pick_render_engine():
    available = set()
    try:
        # Any prop enum lookup works for checking engine availability.
        available = {
            item.identifier
            for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
        }
    except Exception:
        pass
    for candidate in RENDER_ENGINE_CANDIDATES:
        if not available or candidate in available:
            return candidate
    return "BLENDER_EEVEE_NEXT"


def configure_render_settings():
    scene = bpy.context.scene
    scene.render.engine = pick_render_engine()
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    # Keep EEVEE's soft shadows/AO subtle but on, for a bit of cartoon depth
    # without breaking a flat, print-clean silhouette. Guard every attribute:
    # EEVEE Next renamed/removed several of these vs. legacy EEVEE.
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for attr, value in (
            ("use_taa_reprojection", True),
            ("taa_render_samples", 64),
            ("use_gtao", True),
            ("use_soft_shadows", True),
        ):
            if hasattr(eevee, attr):
                setattr(eevee, attr, value)


def import_fbx(filepath):
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.fbx(filepath=filepath)
    after = set(bpy.data.objects.keys())
    imported_names = after - before
    return [bpy.data.objects[name] for name in imported_names]


def mesh_objects(objects):
    return [obj for obj in objects if obj.type == "MESH"]


# ---------------------------------------------------------------------------
# Color: bind the pack's own UV-mapped atlas
# ---------------------------------------------------------------------------

def bind_texture_atlas(objects):
    """The FBX materials already carry correct UVs into the pack's shared color
    atlas (texture/texture.png) — a flat-striped palette each mesh part is UV'd
    into — but Blender's FBX importer never resolves the embedded relative
    image path, so everything renders flat grey. Wire the atlas in directly:
    an Image Texture node (nearest-neighbor, so stripe edges stay crisp) fed by
    the mesh's own UV map, straight into the Principled BSDF's Base Color."""
    if not os.path.exists(TEXTURE_PATH):
        print(f"[render_isometric_factory] WARNING: atlas not found at {TEXTURE_PATH}, "
              f"rendering flat grey.")
        return

    image = bpy.data.images.load(TEXTURE_PATH, check_existing=True)

    bound_materials = set()
    for obj in mesh_objects(objects):
        uv_layer = obj.data.uv_layers.active
        uv_name = uv_layer.name if uv_layer else None

        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or mat.name in bound_materials or not mat.use_nodes:
                continue
            bound_materials.add(mat.name)

            nodes = mat.node_tree.nodes
            links = mat.node_tree.links
            bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue

            tex_node = nodes.new("ShaderNodeTexImage")
            tex_node.image = image
            tex_node.interpolation = "Closest"
            tex_node.location = (bsdf.location.x - 500, bsdf.location.y)

            if uv_name:
                uv_node = nodes.new("ShaderNodeUVMap")
                uv_node.uv_map = uv_name
                uv_node.location = (tex_node.location.x - 250, tex_node.location.y)
                links.new(uv_node.outputs["UV"], tex_node.inputs["Vector"])

            links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])


def world_bounding_box(objects):
    """World-space min/max corners across every mesh object's 8 bbox corners."""
    corners = []
    for obj in mesh_objects(objects):
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ mathutils.Vector(corner))
    if not corners:
        return mathutils.Vector((-1, -1, -1)), mathutils.Vector((1, 1, 1))
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return (
        mathutils.Vector((min(xs), min(ys), min(zs))),
        mathutils.Vector((max(xs), max(ys), max(zs))),
    )


def center_objects_at_origin(objects):
    """Recenter the whole imported hierarchy so its bbox center sits at (0,0,0)."""
    bmin, bmax = world_bounding_box(objects)
    center = (bmin + bmax) / 2.0

    # Only shift top-level (parentless) objects among the imported set, so
    # children move with their parent instead of double-shifting.
    top_level = [obj for obj in objects if obj.parent is None or obj.parent not in objects]
    for obj in top_level:
        obj.location = obj.location - center

    bpy.context.view_layer.update()
    return world_bounding_box(objects)


def bbox_radius(bmin, bmax):
    center = (bmin + bmax) / 2.0
    return max((bmax - center).length, 1e-4)


def setup_camera(radius):
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = "ORTHO"
    cam_obj = bpy.data.objects.new("IsoCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)

    cam_obj.rotation_euler = (
        math.radians(ISO_ROTATION_DEG[0]),
        math.radians(ISO_ROTATION_DEG[1]),
        math.radians(ISO_ROTATION_DEG[2]),
    )

    # Camera looks down its local -Z; back it off along local +Z from origin.
    local_back = mathutils.Vector((0.0, 0.0, 1.0))
    local_back.rotate(cam_obj.rotation_euler)
    cam_obj.location = local_back * (radius * CAMERA_DISTANCE_FACTOR)

    bpy.context.scene.camera = cam_obj
    return cam_obj


def fit_camera_to_bounds(cam_obj, objects):
    """Auto-scale ortho_scale (and re-center in-frame) so the model fills the canvas."""
    scene = bpy.context.scene
    bpy.context.view_layer.update()

    cam_matrix_inv = cam_obj.matrix_world.inverted()
    corners = []
    for obj in mesh_objects(objects):
        for corner in obj.bound_box:
            world_pt = obj.matrix_world @ mathutils.Vector(corner)
            corners.append(cam_matrix_inv @ world_pt)

    if not corners:
        cam_obj.data.ortho_scale = 2.0
        return

    xs = [c.x for c in corners]
    ys = [c.y for c in corners]

    width = max(xs) - min(xs)
    height = max(ys) - min(ys)
    span = max(width, height, 1e-4) * FRAME_PADDING

    cam_obj.data.ortho_scale = span

    # Re-center the footprint in frame: shift the camera along its own local
    # right/up axes by the offset between the footprint center and (0,0).
    x_center = (max(xs) + min(xs)) / 2.0
    y_center = (max(ys) + min(ys)) / 2.0

    right = mathutils.Vector((1.0, 0.0, 0.0))
    up = mathutils.Vector((0.0, 1.0, 0.0))
    right.rotate(cam_obj.rotation_euler)
    up.rotate(cam_obj.rotation_euler)

    cam_obj.location += right * x_center + up * y_center


def setup_lighting():
    key_data = bpy.data.lights.new("KeySun", type="SUN")
    key_data.energy = 3.2
    key_data.angle = math.radians(4)
    key_obj = bpy.data.objects.new("KeySun", key_data)
    bpy.context.collection.objects.link(key_obj)
    key_obj.rotation_euler = (
        math.radians(ISO_ROTATION_DEG[0] - 15),
        0.0,
        math.radians(ISO_ROTATION_DEG[2] + 25),
    )

    fill_data = bpy.data.lights.new("FillSun", type="SUN")
    fill_data.energy = 1.1
    fill_obj = bpy.data.objects.new("FillSun", fill_data)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (
        math.radians(70),
        0.0,
        math.radians(ISO_ROTATION_DEG[2] - 150),
    )

    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs[1].default_value = 0.35  # soft ambient fill


def _new_line_art_material():
    mat = bpy.data.materials.new("SpriteLineArt")
    bpy.data.materials.create_gpencil_data(mat)
    mat.grease_pencil.color = (0.0, 0.0, 0.0, 1.0)
    mat.grease_pencil.show_stroke = True
    mat.grease_pencil.show_fill = False
    return mat


def setup_line_art():
    """Add a Grease Pencil object with a Scene-source Line Art modifier so every
    mesh in the scene gets a crisp, smooth outline — the hand-drawn cartoon look."""
    gp_data = bpy.data.grease_pencils.new("SpriteLineArt")
    gp_obj = bpy.data.objects.new("SpriteLineArt", gp_data)
    bpy.context.collection.objects.link(gp_obj)

    layer = gp_data.layers.new("Lines", set_active=True)
    if hasattr(layer, "frames"):
        layer.frames.new(0)

    mat = _new_line_art_material()
    gp_data.materials.append(mat)

    modifiers = getattr(gp_obj, "grease_pencil_modifiers", None)
    if modifiers is None:
        modifiers = gp_obj.modifiers  # new (GPv3) grease pencil objects share bpy.types.Object.modifiers

    mod_type = None
    for candidate in ("GREASE_PENCIL_LINEART", "LINEART"):
        if candidate in bpy.types.GpencilModifier.bl_rna.properties["type"].enum_items.keys() if hasattr(bpy.types, "GpencilModifier") else []:
            mod_type = candidate
            break
    if mod_type is None:
        mod_type = "GREASE_PENCIL_LINEART"

    line_art = None
    for attempt in (mod_type, "GREASE_PENCIL_LINEART", "LINEART"):
        try:
            line_art = modifiers.new(name="SceneLineArt", type=attempt)
            break
        except (TypeError, RuntimeError):
            continue

    if line_art is None:
        print("[render_isometric_factory] WARNING: could not create a Line Art modifier "
              "on this Blender build; rendering without an outline pass.")
        return gp_obj

    if hasattr(line_art, "source_type"):
        line_art.source_type = "SCENE"
    if hasattr(line_art, "thickness"):
        line_art.thickness = LINE_ART_THICKNESS
    if hasattr(line_art, "target_layer"):
        line_art.target_layer = layer.info if hasattr(layer, "info") else "Lines"
    if hasattr(line_art, "target_material"):
        line_art.target_material = mat
    if hasattr(line_art, "use_crease"):
        line_art.use_crease = True
    if hasattr(line_art, "crease_threshold"):
        line_art.crease_threshold = math.radians(140)

    return gp_obj


# ---------------------------------------------------------------------------
# Growth stages: reveal the mesh bottom-to-top with a Build modifier
# ---------------------------------------------------------------------------
#
# The pack only ships one (mature) model per crop -- there is no seedling or
# sprout mesh to render. Rather than just scaling a copy of the full plant
# down (which reads as "the same plant, shrunk", not "a younger plant"), each
# mesh's own faces are re-sorted bottom-to-top by world-space height, then a
# Build modifier reveals a fraction of them in that order. A partial reveal
# is always made of whole original faces, so it never needs cutting/capping
# geometry the way slicing the mesh with a plane would -- it stays correct on
# any topology, including the thin, non-manifold "card" leaves several of
# these low-poly models use.

def sort_faces_bottom_up(obj):
    """Reorder a mesh's faces by ascending world-space Z, in place."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    mat = obj.matrix_world
    def face_world_z(face):
        return (mat @ face.calc_center_median()).z

    bm.faces.sort(key=face_world_z)
    bm.faces.index_update()
    bm.to_mesh(obj.data)
    bm.free()


def add_growth_modifier(obj):
    mod = obj.modifiers.new(name="GrowthReveal", type="BUILD")
    mod.frame_start = 0
    mod.frame_duration = 100
    mod.use_random_order = False
    mod.use_reverse = False
    return mod


def set_growth_fraction(build_modifiers, fraction):
    frame = max(0, min(100, round(fraction * 100)))
    bpy.context.scene.frame_set(frame)


# ---------------------------------------------------------------------------
# Per-model pipeline
# ---------------------------------------------------------------------------

def process_model(filepath, output_dir):
    name = os.path.splitext(os.path.basename(filepath))[0]
    print(f"[render_isometric_factory] Processing {name} ...")

    clear_scene()
    configure_render_settings()

    imported = import_fbx(filepath)
    meshes = mesh_objects(imported)
    if not meshes:
        print(f"[render_isometric_factory] WARNING: no mesh data found in {filepath}, skipping.")
        return False

    bind_texture_atlas(imported)

    bmin, bmax = center_objects_at_origin(imported)
    radius = bbox_radius(bmin, bmax)

    # Camera framing is locked to the MATURE (full) silhouette and reused for
    # every stage, so a seedling renders visibly smaller within the same
    # canvas instead of independently re-filling the frame stage to stage.
    cam_obj = setup_camera(radius)
    fit_camera_to_bounds(cam_obj, imported)
    setup_lighting()
    setup_line_art()

    for mesh_obj in meshes:
        sort_faces_bottom_up(mesh_obj)
    build_mods = [add_growth_modifier(mesh_obj) for mesh_obj in meshes]

    for stage, fraction in GROWTH_STAGES:
        set_growth_fraction(build_mods, fraction)
        out_path = os.path.join(output_dir, f"{name}{stage}.png")
        bpy.context.scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        print(f"[render_isometric_factory] Wrote {out_path}")

    return True


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    fbx_files = sorted(glob.glob(os.path.join(SOURCE_DIR, "*.fbx")))
    if not fbx_files:
        print(f"[render_isometric_factory] No .fbx files found under {SOURCE_DIR}")
        return

    print(f"[render_isometric_factory] Found {len(fbx_files)} model(s) in {SOURCE_DIR}")

    ok, failed = 0, []
    for filepath in fbx_files:
        try:
            if process_model(filepath, OUTPUT_DIR):
                ok += 1
            else:
                failed.append(os.path.basename(filepath))
        except Exception as exc:  # keep the factory going even if one model breaks
            print(f"[render_isometric_factory] ERROR on {filepath}: {exc}")
            failed.append(os.path.basename(filepath))

    print(f"[render_isometric_factory] Done. {ok}/{len(fbx_files)} rendered to {OUTPUT_DIR}")
    if failed:
        print(f"[render_isometric_factory] Failed/skipped: {failed}")


if __name__ == "__main__":
    main()
