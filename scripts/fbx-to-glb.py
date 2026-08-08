"""
Headless FBX -> GLB conversion, matching the pipeline that produced the
original four character models (their glTF "generator" field reads
"Khronos glTF Blender I/O v5.2.39" -- this is that same exporter, run
without the GUI).

Downscales every texture to MAX_DIM before export. The source art arrived
at 4096x4096 (a couple at 2048) per material slot -- for a character that
renders at a few hundred pixels on screen, that's 15-25MB per texture of
real GPU/VRAM cost every frame, not just a download-size number, and with
six characters on screen at once it was the actual cause of a laptop's fans
spinning up. Geometry is left alone: a Decimate pass on a skinned mesh risks
distorting the skin binding, and the texture weight so dominates the file
size (a few MB of geometry against 50-100MB of textures per character) that
it wasn't worth that risk for this pass.

Usage: blender --background --factory-startup --python fbx-to-glb.py -- <in.fbx> <out.glb> [max_dim]
"""

import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
fbx_path, glb_path = argv[0], argv[1]
max_dim = int(argv[2]) if len(argv) > 2 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx_path)

resized = 0
for img in bpy.data.images:
    w, h = img.size
    if w <= max_dim and h <= max_dim:
        continue
    scale = max_dim / max(w, h)
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    img.scale(new_w, new_h)
    resized += 1
    print(f"  resized {img.name}: {w}x{h} -> {new_w}x{new_h}")

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format="GLB",
    export_animations=True,
    export_skins=True,
    export_apply=False,
    # AUTO lets the exporter pick JPEG for opaque colour maps and keep PNG
    # only where alpha is actually used -- a further real cut on top of the
    # resize, at no quality cost for opaque base-colour/roughness/normal maps.
    export_image_format="AUTO",
)

print(f"OK ({resized} textures resized) {fbx_path} -> {glb_path}")
