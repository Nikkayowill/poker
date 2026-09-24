"""Inside the player's house, the barn and the workshop, walked into through their doors on the Homestead.

The rooms are drawn in lpc_rooms.py from the LPC Revised interior art at the pack's 32px per tile. This module
hands each one to the rig as an Area: the room picture as one ground-level item, each piece of furniture as a
standing item, both as half-size stand-ins carrying their full-detail pictures (`img.info["hires"]`, the same
arrangement lpc_trees.py uses outside), plus the walls, the door and where a player walking in arrives.

What tapping does is on the furniture, by tag: the kitchen counter, the stove and the larder chest open the house
panel (`farmhouse`), the bed is slept in (`bed`), Ray's counter opens the store (`barn`) and the carpenter's bench
opens the Workshop (`workshop`)."""
from PIL import Image

import lpc_rooms as L
from area import Area
from pal import Canvas

T = 16


def doormat(w):
    """The straw mat laid outside a door (export_rich.DOORMATS, empty since the buildings got porches)."""
    c = Canvas(w, 10)
    for y in range(10):
        for x in range(w):
            weave = (x + y) % 3
            rim = y in (0, 9) or x in (0, w - 1)
            c.put(x, y, "straw", (2.4 if rim else 3.8) + (0.7 if weave == 0 else -0.5 if weave == 2 else 0))
    return c.image()


def _half(n):
    return int(round(n * L.SCALE))


def _stand_in(img, **info):
    """A pack picture as the rig's half-size stand-in, the full-detail picture riding along."""
    proxy = img.resize((max(1, _half(img.width)), max(1, _half(img.height))), Image.LANCZOS)
    proxy.info["hires"] = {"img": img, "scale": L.SCALE}
    proxy.info.update(info)
    return proxy


def _area(name, room, back):
    """The rig's Area for a finished lpc_rooms.Room. `back` is where a player leaving lands on the Homestead."""
    plan = room.plan
    a = Area(name, plan.w, plan.h)
    a.indoor = True
    a.rect("cobble", 0, 0, plan.w, plan.h)                       # under the room picture: not grass, so nothing grows
    lights = [(_half(x), _half(y), kind) for x, y, kind in plan.lights]
    a.add((_stand_in(plan.picture(), lights=lights), (0, 0)), 0, 0, ground=True)
    for p in room.props:
        info = {"lights": [(_half(x), _half(y), kind) for x, y, kind in p.lights]}
        if p.solid:
            info["solid_h"] = _half(p.solid)
        if p.passable:
            info["passable"] = True
        a.add((_stand_in(p.img, **info), (_half(p.base[0]), _half(p.base[1]))), _half(p.x), _half(p.y), p.shadow,
              tag=p.tag)
    # the back wall's three rows, both sides, and the front wall either side of the doorway
    d0, d1 = plan.door
    a.wall(0, 0, plan.w - 1, 2)
    a.wall(0, 0, 0, plan.h - 1)
    a.wall(plan.w - 1, 0, plan.w - 1, plan.h - 1)
    a.wall(0, plan.h - 1, d0 - 1, plan.h - 1)
    a.wall(d1 + 1, plan.h - 1, plan.w - 1, plan.h - 1)
    a.door("homestead", d0 * T, plan.h * T - 8, (d1 - d0 + 1) * T, 8, back)
    # Just inside the door, where a player walking in lands: the Homestead's doors send them here.
    a.spawn = ((d0 + d1 + 1) * T // 2, plan.h * T - 26)
    a.sunbeams = [(img, _half(x), _half(y)) for img, x, y in plan.beams]
    return a


# Where each door lets out on the Homestead: just below its door on the map (homestead.py's `a.door` calls).
def barn(for_game=False):
    return _area("barn", L.barn(), (640, 290))


def workshop(for_game=False):
    return _area("workshop", L.workshop(), (351, 290))


def house(for_game=False):
    return _area("farmhouse", L.house(), (481, 300))
