#!/usr/bin/env python3
"""What the farmer can wear at the mirror: the wardrobe catalogue as data.

Every item here passed the audit the cast needs: drawn for walk, idle, thrust, slash, shoot and hurt
on both bodies (so nothing blinks off mid-swing), and licensed CC0, OGA-BY or CC-BY (or offered
under one of those next to a share-alike option). `wardrobe.py` checks both again on every run.

A colour id names its palette, e.g. "cloth:forest" or "hair:light_brown", because the same word
means a different ramp in each ("brown" skin is not "brown" cloth).

This file is data only, so `build.py` can read it for the credits without pulling in the baker.
"""

# The two bodies. "male" is the farmer as he ships, teen build and all (Kayo's call), so the default
# look bakes to exactly today's sheet. Each body brings its own head and the rosy cheeks.
BODIES = {
    "male": dict(body="teen", head="heads_human_male", label="Male"),
    "female": dict(body="female", head="heads_human_female", label="Female"),
}
BOTH = ("male", "female")

# Palette material, the ramps offered in it and the label each is shown with, in editor order.
SKIN = [("light", "Light"), ("amber", "Amber"), ("olive", "Olive"), ("taupe", "Taupe"),
        ("bronze", "Bronze"), ("brown", "Brown"), ("black", "Deep brown")]
EYES = [("blue", "Blue"), ("brown", "Brown"), ("green", "Green"), ("gray", "Grey"), ("purple", "Purple")]
HAIR = [("light_brown", "Light brown"), ("dark_brown", "Dark brown"), ("chestnut", "Chestnut"),
        ("black", "Black"), ("blonde", "Blonde"), ("sandy", "Sandy"), ("ginger", "Ginger"),
        ("carrot", "Carrot"), ("gray", "Grey"), ("white", "White"), ("pink", "Pink"), ("blue", "Blue")]
CLOTH = [("red", "Red"), ("maroon", "Maroon"), ("orange", "Orange"), ("yellow", "Yellow"),
         ("tan", "Tan"), ("brown", "Brown"), ("walnut", "Walnut"), ("forest", "Forest green"),
         ("green", "Green"), ("teal", "Teal"), ("sky", "Sky blue"), ("blue", "Blue"),
         ("navy", "Navy"), ("purple", "Purple"), ("pink", "Pink"), ("white", "White"),
         ("gray", "Grey"), ("black", "Black")]

# The colour prefix each palette material is given in catalogue ids.
PREFIX = {"body": "skin", "eye": "eye", "hair": "hair", "cloth": "cloth"}

# slot, LPC item (or a made-up id for skin and eyes), label, how it takes colour, price.
#   "skin" / "eyes": the pick's colour is the look's skin or eye colour
#   "hair": the pick's colour is the look's hair colour (beards follow it, with no colour of their own)
#   "cloth": recoloured from LPC's cloth palette; items LPC ships as colour files are rebuilt from
#            one of them, which wardrobe.py proves is pixel-identical to LPC's own file
#   "follow-hair": no colour of its own
# The first colour listed is the default; `first` moves one to the front.
ITEMS = [
    ("skin", "skin", "Skin", "skin", None),
    ("eyes", "eyes", "Eyes", "eyes", None),
    ("hair", "hair_plain", "Short", "hair", None),
    ("hair", "hair_cowlick", "Cowlick", "hair", None),
    ("hair", "hair_parted_side_bangs", "Side part", "hair", None),
    ("hair", "hair_bob", "Bob", "hair", None),
    ("hair", "hair_curly_short", "Curly", "hair", None),
    ("hair", "hair_afro", "Afro", "hair", None),
    ("hair", "hair_cornrows", "Cornrows", "hair", None),
    ("hair", "hair_buzzcut", "Buzz cut", "hair", None),
    ("hair", "hair_spiked", "Spiky", "hair", None),
    ("hair", "hair_long_straight", "Long", "hair", None),
    ("hair", "hair_high_ponytail", "Ponytail", "hair", None),
    ("hair", "hair_braid", "Braid", "hair", None),
    ("hat", "hat_cap_bonnie", "Straw hat", "cloth", None),
    ("hat", "hat_bandana", "Bandana", "cloth", None),
    ("hat", "hat_headband_kerchief", "Kerchief", "cloth", None),
    ("hat", "hat_hood_cloth", "Hood", "cloth", None),
    ("hat", "hat_cap_leather", "Leather cap", "cloth", 800),
    ("hat", "hat_cap_cavalier", "Cavalier hat", "cloth", 1500),
    ("hat", "hat_holiday_christmas", "Holiday hat", "cloth", 500),
    ("top", "torso_clothes_longsleeve", "Long sleeves", "cloth", None),
    ("top", "torso_clothes_longsleeve2_buttoned", "Button-up", "cloth", None),
    ("top", "torso_clothes_longsleeve2_polo", "Polo", "cloth", None),
    ("top", "torso_clothes_longsleeve2_cardigan", "Cardigan", "cloth", None),
    ("top", "torso_clothes_tshirt", "T-shirt", "cloth", None),
    ("top", "torso_clothes_sleeveless2", "Tank top", "cloth", None),
    ("over", "torso_aprons_overalls", "Overalls", "cloth", None),
    ("over", "torso_aprons_suspenders", "Suspenders", "cloth", None),
    ("bottom", "legs_pants2", "Trousers", "cloth", None),
    ("bottom", "legs_cuffed", "Cuffed trousers", "cloth", None),
    ("bottom", "legs_shorts", "Shorts", "cloth", None),
    ("bottom", "legs_skirts_plain", "Skirt", "cloth", None),
    ("shoes", "feet_boots_revised", "Boots", "cloth", None),
    ("shoes", "feet_shoes_basic", "Shoes", "cloth", None),
    ("shoes", "feet_sandals", "Sandals", "cloth", None),
    ("face", "facial_glasses", "Glasses", "cloth", None),
    ("face", "facial_glasses_halfmoon", "Reading glasses", "cloth", None),
    ("face", "beards_trimmed", "Short beard", "follow-hair", None),
    ("face", "beards_medium", "Beard", "follow-hair", None),
]
# Bodies an item is offered on, when not both.
ONLY_ON = {"beards_trimmed": ("male",), "beards_medium": ("male",)}
# Default colour per item where the palette's first would not do.
FIRST = {"hat_cap_bonnie": "tan", "torso_clothes_longsleeve": "forest", "torso_aprons_overalls": "blue",
         "legs_pants2": "navy", "feet_boots_revised": "brown", "hat_cap_leather": "brown",
         "hat_holiday_christmas": "red", "facial_glasses": "black", "facial_glasses_halfmoon": "black"}

# Today's farmer (cast.py), as picks.
DEFAULT_LOOK = {
    "body": "male",
    "picks": {
        "skin": ("skin", "skin:light"), "eyes": ("eyes", "eye:blue"),
        "hair": ("hair_plain", "hair:light_brown"), "hat": ("hat_cap_bonnie", "cloth:tan"),
        "top": ("torso_clothes_longsleeve", "cloth:forest"), "over": ("torso_aprons_overalls", "cloth:blue"),
        "bottom": ("legs_pants2", "cloth:navy"), "shoes": ("feet_boots_revised", "cloth:brown"),
        "face": (None, None),
    },
}

# The order a look's items are stacked in before zPos sorts them. Ties in zPos (the bandana and the
# hair are both 120) go to the earlier one, as they do in lpc.Character. The farmer's own cast.py
# order: body, head, cheeks, hair, shirt, overalls, trousers, boots, hat.
STACK = ["hair", "top", "over", "bottom", "shoes", "hat", "face"]

# The tools, which only exist for the action that uses them (build.ACTIONS and build.SWINGS).
TOOLS = ["tool_watering_can", "tool_hoe", "tool_rod", "weapon_ranged_bow_normal", "tool_axe", "tool_pickaxe"]


def all_lpc_items():
    """Every LPC item a look can put on the farmer, tools included, for the credits."""
    out = ["body/body", "face_blush"] + [b["head"] for b in BODIES.values()]
    out += [lpc_id for _slot, lpc_id, _l, how, _p in ITEMS if how not in ("skin", "eyes")]
    return out + TOOLS


def body_types():
    return [b["body"] for b in BODIES.values()]


def head_for(body_type):
    for b in BODIES.values():
        if b["body"] == body_type:
            return b["head"]
    return None
