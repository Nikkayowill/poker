#!/usr/bin/env python3
"""
One-off prep for StackAcres' magenta-backdrop plate pairs -- every generated
building/character that ships as an idle frame plus a "something happened"
second frame, same canvas, meant to sit under one PainterName pair so the
scene can swap textures between them (barn/barnOpen, rayHouse/rayHouseOpen,
greenhouse/greenhouseOpen, travelerRay/travelerRayActive, factory/
factoryOpen).

    scripts/prepare-stackacres-magenta-plates.py

KEYING is a colour-distance test off each plate's OWN border-median colour
(not a fixed magenta, since the exact shade drifts pair to pair), the reason
laid out in scripts/prepare-dealer.py's own header for why its dark/light
plates key on connectivity rather than a flat colour list: any key wide
enough to catch every JPEG-noise shade of the backdrop risks also catching a
real subject colour that happens to sit close to it. Measured against every
plate prepped here, that never actually happens -- the nearest real subject
colour (Ray's reddish plaid shirt) sits past 90 on this same distance metric,
comfortably clear of FEATHER_HIGH -- so a plain global threshold is used
instead of a border flood. That choice is not just simpler: it is also what
correctly keys the Greenhouse's own genuinely-see-through glass (drawn at
close to the backdrop's own colour wherever nothing blocks the view) and the
enclosed pocket of backdrop colour between Ray's arm and torso, neither of
which touches the plate's own border for a flood to reach them from.

Each pair is cropped to the UNION of both frames' own alpha bounds, not each
frame's own -- the second frame's smoke/motion adds pixels outside the first
frame's silhouette (steam over the greenhouse's roof vents, a raised waving
arm), and if each plate kept its own tight crop the two textures would not
line up when the scene swaps one for the other in place.

OUTPUT: public/stackacres/sprites/<name>.png, one per frame. Then run
`pnpm assets:webp` -- this script writes PNG, the encoder converts to what
stackacres-sprites.ts actually asks for and deletes the PNG behind it.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
DST = REPO / "public" / "stackacres" / "sprites"

# Distance (Euclidean, 0..441) from the plate's own border-median colour.
# A histogram of every plate here (background flush against the border mean,
# JPEG ringing tailing off, then a clean gap before real subject colour picks
# up) puts that gap consistently between the low-30s and mid-50s -- Ray's own
# reddish plaid shirt, the closest real subject colour on either plate, does
# not start until past 90. FEATHER_LOW/HIGH ramp the alpha linearly across
# that gap instead of a hard cut, so an anti-aliased edge pixel gets a
# matching fraction of alpha rather than snapping fully in or out.
#
# A GLOBAL threshold, not a border flood: the greenhouse's own glass is drawn
# genuinely see-through -- rendered at close to the backdrop's own colour
# wherever nothing behind it blocks the view, foliage and frames opaque where
# they do -- and a pocket of that same background colour sits enclosed
# between Ray's arm and torso on both his plates, never touching the border a
# flood would have to reach it from. Keying by colour alone, everywhere in
# the frame, catches both; nothing on either plate's own histogram gives a
# real subject pixel a reason to fall inside the gap.
FEATHER_LOW = 32.0
FEATHER_HIGH = 56.0

PAIRS: list[tuple[str, str, str]] = [
    # (idle source, second-frame source, output basename)
    ("greenhouse", "phase2_Greenhouse", "greenhouse"),
    ("Ray_Sprite", "Ray_waving_sprite", "traveler-ray"),
    ("Gemini_Generated_Image_ulgt0hulgt0hulgt", "Gemini_Generated_Image_uqmk8huqmk8huqmk", "factory"),
]

PICTURES_DIR = Path.home() / "Pictures"


def key_to_alpha(path: Path) -> Image.Image:
    """Key the backdrop to transparent by colour distance; return RGBA.

    DECONTAMINATED, not just keyed: a partial-alpha edge pixel (the anti-
    aliased rim around every dark outline in this art) is itself a blend of
    the real ink and the magenta behind it, so its own RGB still carries a
    magenta tint even once alpha correctly marks it as mostly-background.
    Left alone, that tint reads as a thin pink fringe once the plate sits on
    anything other than magenta -- a real farm's green grass included.
    Unmixing it (the standard alpha-decontamination step: subtract the
    background's own share of each partial pixel, then rescale by what's
    left) recovers the ink's true colour instead.
    """
    im = Image.open(path).convert("RGB")
    arr = np.asarray(im).astype(np.float64)
    border = np.concatenate([arr[0, :, :], arr[-1, :, :], arr[:, 0, :], arr[:, -1, :]])
    bg_colour = border.mean(axis=0)

    d = np.sqrt(((arr - bg_colour) ** 2).sum(axis=2))
    alpha = np.clip((d - FEATHER_LOW) / (FEATHER_HIGH - FEATHER_LOW), 0.0, 1.0)
    dropped = int((alpha == 0).sum())
    print(f"    {path.name}: backdrop {bg_colour[0]:.0f},{bg_colour[1]:.0f},{bg_colour[2]:.0f}"
          f" -> fully keyed {dropped}/{arr.shape[0] * arr.shape[1]}px")

    alpha_safe = np.clip(alpha, 0.12, 1.0)[:, :, None]
    decontaminated = np.clip((arr - (1 - alpha_safe) * bg_colour) / alpha_safe, 0, 255)

    rgba = Image.fromarray(decontaminated.astype(np.uint8), mode="RGB").convert("RGBA")
    rgba.putalpha(Image.fromarray((alpha * 255).astype(np.uint8), mode="L"))
    return rgba


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for idle_name, second_name, out_base in PAIRS:
        idle_src = PICTURES_DIR / f"{idle_name}.jpg"
        second_src = PICTURES_DIR / f"{second_name}.jpg"
        if not idle_src.is_file() or not second_src.is_file():
            raise SystemExit(f"missing source(s): {idle_src} / {second_src}")

        print(f"  {out_base}:")
        idle = key_to_alpha(idle_src)
        second = key_to_alpha(second_src)

        # Union bbox -- see the module note on why neither frame's own bbox
        # is used alone.
        b1 = idle.getbbox()
        b2 = second.getbbox()
        if b1 is None or b2 is None:
            raise SystemExit(f"{out_base}: nothing left after the key -- is the plate solid?")
        box = (min(b1[0], b2[0]), min(b1[1], b2[1]), max(b1[2], b2[2]), max(b1[3], b2[3]))

        idle_out = idle.crop(box)
        second_out = second.crop(box)
        idle_out.save(DST / f"{out_base}.png")
        second_out.save(DST / f"{out_base}-open.png")
        print(f"    -> {out_base}.png / {out_base}-open.png, {idle_out.size[0]}x{idle_out.size[1]}px")


if __name__ == "__main__":
    main()
