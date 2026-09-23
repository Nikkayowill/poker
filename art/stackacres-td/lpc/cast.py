#!/usr/bin/env python3
"""The StackAcres people as LPC wardrobes.

A character here is a list of LPC items plus a palette, which is all it takes: one shared rig draws
every animation, so adding a person is picking clothes, not drawing frames. Skin, hair and eye
colour are palette swaps over the same art. The designs come from the sprites already in the game
(`public/stackacres-td/characters/`), which is what everyone is matched against.

Two of the travelers are from worlds LPC never drew. Leo's space suit and Barnaby's diving rig have
no counterpart in a medieval fantasy wardrobe, so what is here is the closest LPC gets; both are
flagged in ODD_ONES for Kayo to keep or throw out.
"""
import lpc

# LPC draws people 50px tall. The game's frame is 48px with the feet on row 44, and the cast it
# already has is 31px (Stardew draws a 16x32 body on a 16px tile, so ~1.9 tiles), so 31 is the
# default and 44 is the tallest that still fits the frame.
TARGET_HEIGHT = 31

BODY = ("body/body", None)
BOOTS = ("feet_boots_revised", "brown")

# Leo and Barnaby: LPC has no space suit and no diving bell, so these are approximations.
ODD_ONES = ("leo", "barnaby")

CAST = {
    # The player. Straw hat, green shirt, denim overalls. The teen build and rosy cheeks are Kayo's
    # call: on the grown man's body he looked too macho for a cheerful farm game.
    "farmer": dict(items=[BODY, ("heads_human_male", None), ("face_blush", "cheeks"), ("hair_plain", None),
                          ("torso_clothes_longsleeve", "forest"), ("torso_aprons_overalls", "blue"),
                          ("legs_pants2", "navy"), BOOTS, ("hat_cap_bonnie", "tan")],
                   body="teen", palette={"hair": "light_brown", "eye": "blue"}),
    # Ray, Kayo's great-grandfather: white beard, flat cap, red plaid, brown skin.
    "ray": dict(items=[BODY, ("heads_human_male_elderly", None), ("hair_plain", None),
                       ("beards_winter", None), ("torso_clothes_longsleeve", "maroon"),
                       ("torso_aprons_overalls", "navy"), ("legs_pants2", "navy"),
                       ("feet_boots_revised", "walnut"), ("hat_cap_bonnie", "brown")],
              palette={"body": "bronze", "hair": "white", "eye": "brown"}),
    # Arthur, the knight: plate, a blue tabard and a closed helm.
    "arthur": dict(items=[BODY, ("heads_human_male", None), ("torso_clothes_longsleeve", "slate"),
                          ("torso_armour_plate", None), ("legs_armour", None),
                          ("torso_jacket_tabard", "blue"), ("feet_boots_revised", "gray"),
                          ("hat_helmet_close", None)],
                  palette={"body": "light", "eye": "blue"}),
    # Barnaby the diver. Nearest LPC: a rounded helm and a heavy coat, in his green and brass.
    "barnaby": dict(items=[BODY, ("heads_human_male", None), ("torso_clothes_longsleeve", "forest"),
                           ("torso_armour_plate", None), ("legs_pants2", "forest"),
                           ("feet_boots_revised", "walnut"), ("hat_helmet_sugarloaf_simple", None)],
                    palette={"body": "light", "eye": "green"}),
    # Bea the beekeeper: wide pale hat, yellow jacket, white trousers.
    "bea": dict(items=[BODY, ("heads_human_female", None), ("hair_plain", None),
                       ("torso_clothes_longsleeve", "yellow"), ("legs_hose", "white"),
                       ("feet_boots_revised", "white"), ("hat_cap_bonnie", "white")],
                body="female", palette={"body": "bronze", "hair": "black", "eye": "brown"}),
    # Brayden the miner: hard hat in orange, brown working coat.
    "brayden": dict(items=[BODY, ("heads_human_male", None), ("hair_plain", None),
                           ("torso_clothes_longsleeve", "brown"),
                           ("torso_aprons_suspenders", "walnut"), ("legs_pants2", "brown"),
                           ("feet_boots_revised", "walnut"), ("hat_cap_bonnie", "orange")],
                    palette={"body": "brown", "hair": "black", "eye": "brown"}),
    # Ivy the forager: red cap, green top, brown trousers.
    "ivy": dict(items=[BODY, ("heads_human_female", None), ("hair_plain", None),
                       ("torso_clothes_sleeveless", "forest"), ("legs_hose", "brown"),
                       BOOTS, ("hat_cap_bonnie", "red")],
                body="female", palette={"body": "light", "hair": "light_brown", "eye": "green"}),
    # Leo the astronaut. Nearest LPC: white plate and a round helm.
    "leo": dict(items=[BODY, ("heads_human_male", None), ("torso_clothes_longsleeve", "white"),
                       ("torso_armour_plate", None), ("legs_pants2", "white"),
                       ("feet_boots_revised", "white"), ("hat_helmet_bascinet_round", None)],
                palette={"body": "light", "eye": "blue"}),
    # Miles the detective: long tan coat and a brown hat.
    "miles": dict(items=[BODY, ("heads_human_male", None), ("hair_plain", None),
                         ("torso_clothes_longsleeve", "white"), ("torso_jacket_santa", "tan"),
                         ("legs_pants2", "brown"), ("feet_boots_revised", "walnut"),
                         ("hat_cap_bonnie", "walnut")],
                  palette={"body": "light", "hair": "ash", "eye": "gray"}),
    # Pierre the cook: white shirt, red apron, a white cap for the toque.
    "pierre": dict(items=[BODY, ("heads_human_male", None), ("hair_plain", None),
                          ("torso_clothes_longsleeve", "white"), ("torso_aprons_apron", "red"),
                          ("legs_pants2", "gray"), ("feet_boots_revised", "charcoal"),
                          ("hat_bandana", "white")],
                   palette={"body": "light", "hair": "white", "eye": "brown"}),
    # The Pixel Pilgrim: brown robe and hood, no face to speak of.
    "pilgrim": dict(items=[BODY, ("heads_human_male", None), ("torso_clothes_longsleeve", "brown"),
                           ("cape_tattered", "brown"), ("legs_pants2", "brown"), ("feet_boots_revised", "walnut"),
                           ("hat_hood_cloth", "brown")],
                    palette={"body": "brown", "eye": "brown"}),
    # Skye: red cap, yellow jacket, jeans.
    "skye": dict(items=[BODY, ("heads_human_female", None), ("hair_plain", None),
                        ("torso_clothes_longsleeve", "white"),
                        ("torso_clothes_longsleeve2_cardigan", "yellow"), ("legs_hose", "navy"),
                        ("feet_boots_revised", "navy"), ("hat_cap_bonnie", "red")],
                 body="female", palette={"body": "light", "hair": "black", "eye": "brown"}),
    # Wes the cowhand: brown hat, white shirt, brown vest.
    "wes": dict(items=[BODY, ("heads_human_male", None), ("hair_plain", None),
                       ("beards_trimmed", None), ("torso_clothes_longsleeve", "white"),
                       ("torso_aprons_suspenders", "brown"), ("legs_pants2", "brown"),
                       ("feet_boots_revised", "walnut"), ("hat_cap_bonnie", "walnut")],
                palette={"body": "light", "hair": "white", "eye": "blue"}),
}


def build(name):
    spec = CAST[name]
    return lpc.Character(spec["items"], body=spec.get("body", "male"), palette=spec.get("palette"))
