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
import json
import math
import os

import mathutils
from bpy_extras.object_utils import world_to_camera_view

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Source dir/atlas are env-overridable since the extracted pack lives outside
# this repo (see module docstring) at whatever path it was unzipped to.
SOURCE_DIR = os.environ.get("STACKACRES_SOURCE_DIR", os.path.join(SCRIPT_DIR, "fbx"))
# Overridable so a preview run can write somewhere other than the real
# output_sprites dir without touching it.
OUTPUT_DIR = os.environ.get("STACKACRES_OUTPUT_DIR", os.path.join(SCRIPT_DIR, "output_sprites"))
TEXTURE_PATH = os.environ.get(
    "STACKACRES_TEXTURE_PATH", os.path.join(SCRIPT_DIR, "texture", "texture.png")
)

# Skip the actual renders and only write anchors.json (see `ground_anchor`).
# Seconds instead of minutes, for when the sprites are already right and only
# the anchor table needs rebuilding.
ANCHORS_ONLY = os.environ.get("STACKACRES_ANCHORS_ONLY") == "1"

# Restrict a run to specific crop names (comma-separated), for a fast preview
# instead of rendering all 22. Unset renders everything, as before.
_only = os.environ.get("STACKACRES_ONLY_CROPS")
ONLY_CROPS = {c.strip() for c in _only.split(",")} if _only else None

# The onion's bulb UVs land on the atlas's own blank stripe -- rows 57-63 of
# texture.png are plain white, never painted -- so the bulb renders as flat
# pale grey while the other crops come out colorful. That is missing paint in
# the free pack, not a bug in this pipeline.
#
# The fix is a private copy of the atlas with ONLY that white band recolored
# (see `farm_atlas` below); overriding the whole material's Base Color would
# also wreck the correctly-mapped green leaves, since the onion is a single
# mesh/material covering both.
#
# Only the onion gets this. The potato also UVs into the white band, but its
# white part is the flower petals, which are meant to be white -- recoloring
# them turned the blossoms muddy brown.
ATLAS_PATCH_COLOR = {
    "onion": (214, 168, 88),   # golden-tan bulb skin
}

# THE PACK'S PALETTE, REMAPPED ONTO THE FARM'S OWN (art-palette.ts's RAMPS).
#
# The pack paints in muted sage and primary poster colours; StackAcres is a
# warm, saturated flat-vector world, and a crop rendered in the pack's own
# palette reads as a foreign object standing in it however well it is lit.
# Every band of the 64x64 atlas is a flat stripe, so the whole restyle is one
# colour-for-colour swap done to the texture before it is ever bound.
#
# Left column is the pack's stripe, right is the farm tone it becomes. Where
# a band has an obvious ramp on the TypeScript side the value is that ramp's
# (RAMPS.leaf.top, RAMPS.carrot.top and so on) so the crops and the world are
# literally the same paint; the grape violet and the beet magenta have no
# ramp of their own yet and are picked to sit with the rest.
PALETTE_REMAP = {
    (108, 171, 109): (107, 208, 65),   # leaf, lit        -> RAMPS.leaf.top
    (99, 133, 105): (66, 147, 34),     # leaf, shadowed   -> RAMPS.leaf.side
    (106, 158, 115): (87, 182, 47),    # leaf, mid        -> between the two
    (255, 146, 44): (255, 154, 60),    # roots            -> RAMPS.carrot.top
    (237, 20, 0): (240, 92, 66),       # tomato/pepper    -> RAMPS.roof.top
    (255, 212, 0): (255, 210, 77),     # corn/sunflower   -> RAMPS.corn.top
    (99, 89, 167): (150, 110, 215),    # grapes, aubergine
    (155, 0, 67): (201, 49, 109),      # beet
    (94, 49, 0): (122, 86, 52),        # stems, vine poles-> RAMPS.hide.side
    (0, 0, 0): (42, 28, 16),           # seed heads: brown, never pure black
    (255, 255, 255): (234, 230, 220),  # garlic, blossom  -> RAMPS.chalk.side
}

# TWO TONES PER SURFACE, and that is the whole shading model.
#
# Every painter in the farm is drawn as a lit plane and a turned plane with a
# hard boundary between them (art-palette.ts's own header on `Ramp`), so a
# crop shaded with a smooth falloff across its facets belongs to a different
# game. `toon_shade` below drives the render's own lighting through a
# constant-interpolation ramp: at or above BREAK the surface is its flat
# colour, below it the same colour multiplied by SHADE.
TOON_BREAK = 0.42
TOON_SHADE = 0.68

# The outline every mesh gets (see `setup_line_art`). Dark warm brown, NOT
# black: "a shape's outline is its own rim, never black and never a shared
# neutral" is the load-bearing rule of the farm's palette, and a black
# outline is the single clearest tell of clip-art.
LINE_ART_COLOR = (42, 28, 16)
ATLAS_WHITE_BAND = (57, 64)  # pixel rows in the 64x64 atlas (top-down)

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

def srgb_to_linear(channel):
    """Blender takes plain colours (a Grease Pencil stroke, a light) in linear
    scene space, and the palette above is written in sRGB like every other
    colour in this repo."""
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def farm_atlas(crop_name):
    """The atlas this crop is rendered with: the pack's own, repainted in the
    farm's palette (PALETTE_REMAP) and, for the onion, with the unpainted
    white band filled in (ATLAS_PATCH_COLOR).

    Written as a private copy next to the source rather than in place, so the
    pack stays as it was unzipped and a re-run is idempotent. Pure Blender
    image API, no PIL: Blender's bundled interpreter may not have it.
    """
    patch = ATLAS_PATCH_COLOR.get(crop_name)
    suffix = crop_name if patch else "farm"
    out_path = os.path.join(os.path.dirname(TEXTURE_PATH), f"texture_{suffix}.png")

    image = bpy.data.images.load(TEXTURE_PATH, check_existing=False)
    w, h = image.size
    px = list(image.pixels)  # flat RGBA floats, row 0 = image BOTTOM
    lo, hi = ATLAS_WHITE_BAND
    for row in range(h):
        # image.pixels is bottom-up; the atlas's bands are quoted top-down.
        top_down = h - 1 - row
        base = row * w * 4
        for x in range(w):
            i = base + x * 4
            if patch and lo <= top_down < hi:
                r, g, b = patch
            else:
                key = tuple(round(px[i + c] * 255) for c in range(3))
                swap = PALETTE_REMAP.get(key)
                if swap is None:
                    continue
                r, g, b = swap
            px[i], px[i + 1], px[i + 2] = r / 255.0, g / 255.0, b / 255.0
    image.pixels[:] = px
    image.filepath_raw = out_path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    return out_path


def toon_shade(mat, image, uv_name):
    """Rebuilds one material as flat two-tone cel shading.

    The pack's own Principled BSDF is thrown away rather than tuned: it lights
    a low-poly mesh with a smooth falloff across every facet, and no amount of
    roughness makes that read as the flat-vector world it is standing in.
    Instead the lighting is measured with a plain diffuse shader, run through
    `ShaderToRGB` (EEVEE only -- Cycles has no such node, see the caller) and
    a CONSTANT colour ramp, which turns it into exactly two values: 1 above
    TOON_BREAK, TOON_SHADE below. That multiplies the atlas colour, so a
    surface is its own flat paint or its own flat paint darkened, and nothing
    in between. Emission, not diffuse, carries the result out: the shading has
    already happened by then and a second pass over it would soften the very
    boundary this exists to keep hard.
    """
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    # Cleared and rebuilt from empty rather than kept-and-rewired: removing a
    # node invalidates every other Python reference into this collection, so
    # holding onto the old output node across the clear and then reading its
    # sockets raises a stale-key error on Blender 5.
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")

    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Closest"
    tex.location = (out.location.x - 900, out.location.y)
    if uv_name:
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = uv_name
        uv.location = (tex.location.x - 250, tex.location.y)
        links.new(uv.outputs["UV"], tex.inputs["Vector"])

    diffuse = nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.location = (out.location.x - 900, out.location.y - 320)
    to_rgb = nodes.new("ShaderNodeShaderToRGB")
    to_rgb.location = (out.location.x - 700, out.location.y - 320)
    links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (out.location.x - 500, out.location.y - 320)
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (TOON_SHADE, TOON_SHADE, TOON_SHADE, 1.0)
    ramp.color_ramp.elements[1].position = TOON_BREAK
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])

    # VectorMath rather than a Mix node: the mix node's own sockets were
    # renamed across Blender versions and this one has not.
    mul = nodes.new("ShaderNodeVectorMath")
    mul.operation = "MULTIPLY"
    mul.location = (out.location.x - 300, out.location.y)
    links.new(tex.outputs["Color"], mul.inputs[0])
    links.new(ramp.outputs["Color"], mul.inputs[1])

    emit = nodes.new("ShaderNodeEmission")
    emit.location = (out.location.x - 150, out.location.y)
    links.new(mul.outputs["Vector"], emit.inputs["Color"])
    links.new(emit.outputs["Emission"], out.inputs["Surface"])


def bind_texture_atlas(objects, texture_path):
    """The FBX materials already carry correct UVs into the pack's shared color
    atlas (texture/texture.png) — a flat-striped palette each mesh part is UV'd
    into — but Blender's FBX importer never resolves the embedded relative
    image path, so everything renders flat grey. Wire the atlas in directly:
    an Image Texture node (nearest-neighbor, so stripe edges stay crisp) fed by
    the mesh's own UV map, and shade it in two flat tones (`toon_shade`).

    Cycles has no `ShaderToRGB`, so on that engine the atlas goes straight
    into the Principled BSDF as before and the crop renders smoothly shaded
    -- correct, just not the house style. Every engine this script actually
    picks is EEVEE."""
    if not os.path.exists(texture_path):
        print(f"[render_isometric_factory] WARNING: atlas not found at {texture_path}, "
              f"rendering flat grey.")
        return

    image = bpy.data.images.load(texture_path, check_existing=True)
    cel = bpy.context.scene.render.engine.startswith("BLENDER_EEVEE")

    bound_materials = set()
    for obj in mesh_objects(objects):
        uv_layer = obj.data.uv_layers.active
        uv_name = uv_layer.name if uv_layer else None

        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or mat.name in bound_materials or not mat.use_nodes:
                continue
            bound_materials.add(mat.name)

            if cel:
                toon_shade(mat, image, uv_name)
                continue

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
    mat.grease_pencil.color = tuple(srgb_to_linear(c) for c in LINE_ART_COLOR) + (1.0,)
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
    # Crease lines trace every facet join on a low-poly mesh, not just real
    # silhouette/shape edges -- on a rounded model like the cabbage that is
    # dense enough to read as a wireframe overlay instead of a solid head.
    # Off, so only the outer contour draws; the facets still separate from
    # each other by shading, not by ink.
    if hasattr(line_art, "use_crease"):
        line_art.use_crease = False

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

def ground_anchor(cam_obj, ground_z):
    """Where the plant's own root point lands in the rendered frame, in pixels.

    THE ONE THING A TRIMMED SPRITE CANNOT RECOVER. Every frame is trimmed to
    its ink and pasted flush to its canvas's bottom edge, so the scene anchors
    a crop by the bottom-centre of that canvas -- which is the lowest pixel
    anywhere in the frame, not the point the plant grows out of. On anything
    that sprawls (a cabbage's outer leaves, a pumpkin's vine) the lowest pixel
    is at the FRONT of the model and the anchor pushes the whole plant up and
    back off its bed.

    `center_objects_at_origin` has already put the model's own bbox centre on
    the world origin, so (0, 0, ground_z) IS the centre of its footprint at
    ground level. Projected through the same camera the frame is rendered
    with, that is the pixel the bed's centre should sit under.
    """
    scene = bpy.context.scene
    ndc = world_to_camera_view(scene, cam_obj, mathutils.Vector((0.0, 0.0, ground_z)))
    return [ndc.x * RESOLUTION, (1.0 - ndc.y) * RESOLUTION]


def process_model(filepath, output_dir, anchors):
    name = os.path.splitext(os.path.basename(filepath))[0]
    print(f"[render_isometric_factory] Processing {name} ...")

    clear_scene()
    configure_render_settings()

    imported = import_fbx(filepath)
    meshes = mesh_objects(imported)
    if not meshes:
        print(f"[render_isometric_factory] WARNING: no mesh data found in {filepath}, skipping.")
        return False

    bind_texture_atlas(imported, farm_atlas(name))

    bmin, bmax = center_objects_at_origin(imported)
    radius = bbox_radius(bmin, bmax)

    # Camera framing is locked to the MATURE (full) silhouette and reused for
    # every stage, so a seedling renders visibly smaller within the same
    # canvas instead of independently re-filling the frame stage to stage.
    cam_obj = setup_camera(radius)
    fit_camera_to_bounds(cam_obj, imported)
    setup_lighting()
    setup_line_art()

    # One anchor per crop, not per stage: all three stages share this camera
    # and this model, so they share the root point too.
    anchors[name] = ground_anchor(cam_obj, bmin.z)
    if ANCHORS_ONLY:
        return True

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
    if ONLY_CROPS is not None:
        fbx_files = [
            f for f in fbx_files
            if os.path.splitext(os.path.basename(f))[0] in ONLY_CROPS
        ]
    if not fbx_files:
        print(f"[render_isometric_factory] No .fbx files found under {SOURCE_DIR}")
        return

    print(f"[render_isometric_factory] Found {len(fbx_files)} model(s) in {SOURCE_DIR}")

    anchors = {}
    ok, failed = 0, []
    for filepath in fbx_files:
        try:
            if process_model(filepath, OUTPUT_DIR, anchors):
                ok += 1
            else:
                failed.append(os.path.basename(filepath))
        except Exception as exc:  # keep the factory going even if one model breaks
            print(f"[render_isometric_factory] ERROR on {filepath}: {exc}")
            failed.append(os.path.basename(filepath))

    # Merged into whatever is already there, so an ONLY_CROPS run refreshes
    # its own crops without dropping the rest of the table.
    anchor_path = os.path.join(OUTPUT_DIR, "anchors.json")
    existing = {}
    if os.path.exists(anchor_path):
        with open(anchor_path) as handle:
            existing = json.load(handle)
    existing.update(anchors)
    with open(anchor_path, "w") as handle:
        json.dump(existing, handle, indent=2, sort_keys=True)
    print(f"[render_isometric_factory] Wrote {anchor_path} ({len(existing)} crops)")

    print(f"[render_isometric_factory] Done. {ok}/{len(fbx_files)} rendered to {OUTPUT_DIR}")
    if failed:
        print(f"[render_isometric_factory] Failed/skipped: {failed}")


if __name__ == "__main__":
    main()
