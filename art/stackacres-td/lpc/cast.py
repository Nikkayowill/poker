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


# The grocery (lib/stackacres-td/store-cast.ts). Staff wear the store's forest green, so they read as
# staff from across the shop: an apron over a white shirt at the tills and on the produce counter (with a
# straw cap out on the market floor), green overalls and a cap for the stocker who hauls the crates. Each is
# their own person under it: build, face, hair. Shoppers wear their own clothes, never the green.
APRON = ("torso_aprons_apron_full", "forest")
# LPC draws the full apron on the female body only; on the male body it's the bib apron, in the same green.
APRON_M = ("torso_aprons_apron", "forest")
CAST.update({
    "june": dict(items=[BODY, ("heads_human_female", None), ("hair_bob", None), ("torso_clothes_shortsleeve_polo", "white"),
                        APRON, ("legs_pants2", "navy"), ("feet_boots_revised", "brown")],
                 body="female", palette={"body": "bronze", "hair": "chestnut", "eye": "brown"}),
    "omar": dict(items=[BODY, ("heads_human_male", None), ("hair_buzzcut", None), ("beards_trimmed", None),
                        ("torso_clothes_shortsleeve_polo", "white"), APRON_M, ("legs_pants2", "charcoal"),
                        ("feet_boots_revised", "black")],
                 palette={"body": "brown", "hair": "black", "eye": "brown"}),
    "rosa": dict(items=[BODY, ("heads_human_female", None), ("hair_ponytail2", None), ("torso_clothes_longsleeve", "white"),
                        APRON, ("legs_pants2", "brown"), ("feet_boots_revised", "walnut"), ("hat_cap_bonnie", "tan")],
                 body="female", palette={"body": "olive", "hair": "dark_brown", "eye": "green"}),
    "dale": dict(items=[BODY, ("heads_human_male", None), ("hair_messy", None), ("torso_clothes_longsleeve", "white"),
                        ("torso_aprons_overalls", "forest"), ("legs_pants2", "forest"), ("feet_boots_revised", "walnut"),
                        ("hat_cap_bonnie", "forest")],
                 palette={"body": "light", "hair": "ginger", "eye": "blue"}),
    "mabel": dict(items=[BODY, ("heads_human_female_elderly", None), ("hair_bangs_bun", None), ("facial_glasses", None),
                         ("torso_clothes_blouse_longsleeve", "lavender"), ("legs_skirts_plain", "navy"),
                         ("feet_boots_revised", "brown")],
                  body="female", palette={"body": "light", "hair": "white", "eye": "blue"}),
    "priya": dict(items=[BODY, ("heads_human_female", None), ("hair_long_straight", None), ("torso_clothes_tshirt_vneck", "maroon"),
                         ("legs_pants", "navy"), ("feet_boots_revised", "black")],
                  body="female", palette={"body": "amber", "hair": "black", "eye": "brown"}),
    "gus": dict(items=[BODY, ("heads_human_male_elderly", None), ("hair_balding", None), ("beards_walrus", None),
                       ("torso_clothes_longsleeve2_buttoned", "tan"), ("legs_pants", "brown"), ("feet_boots_revised", "walnut")],
                palette={"body": "light", "hair": "gray", "eye": "gray"}),
    "hank": dict(items=[BODY, ("heads_human_male", None), ("hair_curly_short", None), ("torso_clothes_tshirt", "blue"),
                        ("legs_pants2", "slate"), ("feet_boots_revised", "charcoal")],
                 palette={"body": "taupe", "hair": "dark_brown", "eye": "brown"}),
    "lena": dict(items=[BODY, ("heads_human_female", None), ("hair_high_ponytail", None),
                        ("torso_clothes_longsleeve2_cardigan", "sky"), ("legs_leggings", "charcoal"), ("feet_boots_revised", "gray")],
                 body="female", palette={"body": "light", "hair": "blonde", "eye": "blue"}),
    "tomas": dict(items=[BODY, ("heads_human_male", None), ("hair_curtains", None), ("torso_clothes_tshirt", "orange"),
                         ("legs_shorts", "tan"), ("feet_boots_revised", "navy")],
                  body="teen", palette={"body": "bronze", "hair": "sandy", "eye": "brown"}),
})
# The rest of the crew a rush needs: two more cashiers, two more produce clerks, a second stocker.
CAST.update({
    "nell": dict(items=[BODY, ("heads_human_female", None), ("hair_swoop_side", None), ("torso_clothes_shortsleeve_polo", "white"),
                        APRON, ("legs_pants2", "navy"), ("feet_boots_revised", "black")],
                 body="female", palette={"body": "light", "hair": "redhead", "eye": "green"}),
    "theo": dict(items=[BODY, ("heads_human_male", None), ("hair_parted3", None), ("facial_glasses", None),
                        ("torso_clothes_shortsleeve_polo", "white"), APRON_M, ("legs_pants2", "charcoal"), ("feet_boots_revised", "brown")],
                 palette={"body": "taupe", "hair": "chestnut", "eye": "brown"}),
    "ines": dict(items=[BODY, ("heads_human_female", None), ("hair_bob_side_part", None), ("torso_clothes_longsleeve", "white"),
                        APRON, ("legs_pants2", "brown"), ("feet_boots_revised", "walnut"), ("hat_cap_bonnie", "tan")],
                 body="female", palette={"body": "amber", "hair": "black", "eye": "brown"}),
    "kofi": dict(items=[BODY, ("heads_human_male", None), ("hair_flat_top_fade", None), ("torso_clothes_longsleeve", "white"),
                        APRON_M, ("legs_pants2", "charcoal"), ("feet_boots_revised", "black"), ("hat_cap_bonnie", "tan")],
                 palette={"body": "black", "hair": "black", "eye": "brown"}),
    "cole": dict(items=[BODY, ("heads_human_male", None), ("hair_spiked", None), ("beards_trimmed", None),
                        ("torso_clothes_longsleeve", "white"), ("torso_aprons_overalls", "forest"), ("legs_pants2", "forest"),
                        ("feet_boots_revised", "walnut"), ("hat_cap_bonnie", "forest")],
                 palette={"body": "olive", "hair": "dark_brown", "eye": "brown"}),
})
# Townsfolk looking for work at the grocery, on its Help Wanted board (lib/stackacres/grocery-crew.ts), already in
# the uniform of the job they're after, so a hire walks straight onto the floor dressed for it.
CAST.update({
    "ravi": dict(items=[BODY, ("heads_human_male", None), ("hair_parted_side_bangs", None),
                        ("torso_clothes_shortsleeve_polo", "white"), APRON_M, ("legs_pants2", "charcoal"),
                        ("feet_boots_revised", "black")],
                 palette={"body": "bronze", "hair": "black", "eye": "brown"}),
    "noor": dict(items=[BODY, ("heads_human_female", None), ("hair_long_straight", None), ("torso_clothes_shortsleeve_polo", "white"),
                        APRON, ("legs_pants2", "navy"), ("feet_boots_revised", "brown")],
                 body="female", palette={"body": "amber", "hair": "raven", "eye": "brown"}),
    "lucia": dict(items=[BODY, ("heads_human_female", None), ("hair_high_ponytail", None), ("torso_clothes_shortsleeve_polo", "white"),
                         APRON, ("legs_pants2", "navy"), ("feet_boots_revised", "black")],
                  body="female", palette={"body": "light", "hair": "chestnut", "eye": "green"}),
    "sade": dict(items=[BODY, ("heads_human_female", None), ("hair_curly_long", None), ("torso_clothes_longsleeve", "white"),
                        APRON, ("legs_pants2", "brown"), ("feet_boots_revised", "walnut"), ("hat_cap_bonnie", "tan")],
                 body="female", palette={"body": "black", "hair": "dark_brown", "eye": "brown"}),
    "otto": dict(items=[BODY, ("heads_human_male_elderly", None), ("hair_plain", None), ("beards_trimmed", None),
                        ("torso_clothes_longsleeve", "white"), APRON_M, ("legs_pants2", "charcoal"),
                        ("feet_boots_revised", "brown"), ("hat_cap_bonnie", "tan")],
                 palette={"body": "light", "hair": "white", "eye": "blue"}),
    "wren": dict(items=[BODY, ("heads_human_female", None), ("hair_topknot_short", None), ("torso_clothes_longsleeve", "white"),
                        ("torso_aprons_overalls", "forest"), ("legs_pants2", "forest"), ("feet_boots_revised", "walnut"),
                        ("hat_cap_bonnie", "forest")],
                 body="female", palette={"body": "light", "hair": "strawberry", "eye": "blue"}),
    "zeke": dict(items=[BODY, ("heads_human_male", None), ("hair_halfmessy", None), ("torso_clothes_longsleeve", "white"),
                        ("torso_aprons_overalls", "forest"), ("legs_pants2", "forest"), ("feet_boots_revised", "walnut"),
                        ("hat_cap_bonnie", "forest")],
                 body="teen", palette={"body": "taupe", "hair": "dark_brown", "eye": "brown"}),
})
# The townsfolk, in their own clothes and never the store's green: every age, build and skin.
CAST.update({
    "ada": dict(items=[BODY, ("heads_human_female", None), ("hair_curly_long", None), ("torso_clothes_blouse", "rose"),
                       ("legs_skirts_plain", "charcoal"), ("feet_boots_revised", "black")],
                body="female", palette={"body": "black", "hair": "dark_brown", "eye": "brown"}),
    "bruno": dict(items=[BODY, ("heads_human_male", None), ("hair_buzzcut", None), ("beards_medium", None),
                         ("torso_clothes_longsleeve2_buttoned", "red"), ("legs_pants2", "navy"), ("feet_boots_revised", "walnut")],
                  palette={"body": "light", "hair": "black", "eye": "blue"}),
    "cora": dict(items=[BODY, ("heads_human_female_elderly", None), ("hair_page", None), ("facial_glasses_halfmoon", None),
                        ("torso_clothes_longsleeve2_cardigan", "teal"), ("legs_skirts_plain", "brown"), ("feet_boots_revised", "brown")],
                 body="female", palette={"body": "bronze", "hair": "gray", "eye": "brown"}),
    "dev": dict(items=[BODY, ("heads_human_male", None), ("hair_curly_short2", None), ("torso_clothes_tshirt", "yellow"),
                       ("legs_pants", "bluegray"), ("feet_boots_revised", "gray")],
                body="teen", palette={"body": "amber", "hair": "black", "eye": "brown"}),
    "elsie": dict(items=[BODY, ("heads_human_female", None), ("hair_shoulderl", None), ("torso_clothes_tshirt_scoop", "pink"),
                         ("legs_skirts_plain", "navy"), ("feet_boots_revised", "white")],
                  body="female", palette={"body": "light", "hair": "blonde", "eye": "blue"}),
    "felix": dict(items=[BODY, ("heads_human_male", None), ("hair_parted_side_bangs", None), ("torso_clothes_longsleeve2_vneck", "sky"),
                         ("legs_pants", "tan"), ("feet_boots_revised", "brown")],
                  palette={"body": "light", "hair": "ginger", "eye": "green"}),
    "gemma": dict(items=[BODY, ("heads_human_female", None), ("hair_long_messy", None), ("torso_clothes_sleeveless2_scoop", "purple"),
                         ("legs_leggings", "black"), ("feet_boots_revised", "black")],
                  body="female", palette={"body": "olive", "hair": "chestnut", "eye": "brown"}),
    "hugo": dict(items=[BODY, ("heads_human_male_elderly", None), ("hair_parted3", None), ("beards_handlebar", None),
                        ("torso_clothes_longsleeve", "white"), ("torso_jacket_frock_lapel", "brown"), ("legs_pants2", "charcoal"),
                        ("feet_boots_revised", "black")],
                 palette={"body": "taupe", "hair": "white", "eye": "gray"}),
    "iris": dict(items=[BODY, ("heads_human_female", None), ("hair_afro", None), ("torso_clothes_longsleeve_scoop", "yellow"),
                        ("legs_pants", "navy"), ("feet_boots_revised", "brown")],
                 body="female", palette={"body": "brown", "hair": "black", "eye": "brown"}),
    "jonah": dict(items=[BODY, ("heads_human_male", None), ("hair_curtains_long", None), ("torso_clothes_shortsleeve", "bluegray"),
                         ("legs_shorts", "tan"), ("feet_boots_revised", "gray")],
                  body="teen", palette={"body": "light", "hair": "sandy", "eye": "blue"}),
    "kiko": dict(items=[BODY, ("heads_human_female", None), ("hair_lob", None), ("torso_clothes_longsleeve2_cardigan", "rose"),
                        ("legs_skirts_plain", "navy"), ("feet_boots_revised", "black")],
                 body="female", palette={"body": "light", "hair": "raven", "eye": "brown"}),
    "luis": dict(items=[BODY, ("heads_human_male", None), ("hair_halfmessy", None), ("beards_chevron", None),
                        ("torso_clothes_tshirt_vneck", "teal"), ("legs_pants2", "charcoal"), ("feet_boots_revised", "black")],
                 palette={"body": "bronze", "hair": "black", "eye": "brown"}),
    "maya": dict(items=[BODY, ("heads_human_female", None), ("hair_braid", None), ("torso_clothes_blouse_longsleeve", "orange"),
                        ("legs_pants", "tan"), ("feet_boots_revised", "walnut")],
                 body="female", palette={"body": "brown", "hair": "raven", "eye": "brown"}),
    "ned": dict(items=[BODY, ("heads_human_male_elderly", None), ("hair_plain", None), ("beards_horseshoe", None),
                       ("facial_glasses", None), ("torso_clothes_longsleeve2_polo", "navy"), ("legs_pants", "walnut"),
                       ("feet_boots_revised", "brown")],
                palette={"body": "light", "hair": "gray", "eye": "blue"}),
    "olive": dict(items=[BODY, ("heads_human_female_elderly", None), ("hair_wavy", None), ("torso_clothes_longsleeves_cuffed", "lavender"),
                         ("legs_skirt_straight", "purple"), ("feet_boots_revised", "brown")],
                  body="female", palette={"body": "brown", "hair": "platinum", "eye": "brown"}),
    "pablo": dict(items=[BODY, ("heads_human_male", None), ("hair_curly_short", None), ("beards_medium", None),
                         ("torso_clothes_longsleeve", "maroon"), ("legs_pants", "navy"), ("feet_boots_revised", "walnut")],
                  palette={"body": "olive", "hair": "dark_brown", "eye": "brown"}),
    "quinn": dict(items=[BODY, ("heads_human_male", None), ("hair_cowlick", None), ("torso_clothes_tshirt", "purple"),
                         ("legs_shorts", "charcoal"), ("feet_boots_revised", "white")],
                  body="teen", palette={"body": "light", "hair": "carrot", "eye": "green"}),
    "rhea": dict(items=[BODY, ("heads_human_female", None), ("hair_long_center_part", None), ("torso_clothes_tunic", "teal"),
                        ("legs_leggings", "charcoal"), ("feet_boots_revised", "brown")],
                 body="female", palette={"body": "light", "hair": "red", "eye": "green"}),
    "sam": dict(items=[BODY, ("heads_human_male", None), ("hair_twists_fade", None), ("torso_clothes_tshirt", "white"),
                       ("torso_jacket_pockets", "tan"), ("legs_pants2", "bluegray"), ("feet_boots_revised", "brown")],
                palette={"body": "black", "hair": "black", "eye": "brown"}),
    "tilly": dict(items=[BODY, ("heads_human_female", None), ("hair_topknot_short", None), ("torso_clothes_tshirt", "yellow"),
                         ("legs_skirts_plain", "red"), ("feet_boots_revised", "white")],
                  body="female", palette={"body": "amber", "hair": "strawberry", "eye": "brown"}),
    "uma": dict(items=[BODY, ("heads_human_female", None), ("hair_dreadlocks_long", None), ("torso_clothes_longsleeve2_scoop", "red"),
                       ("legs_pants", "charcoal"), ("feet_boots_revised", "black")],
                body="female", palette={"body": "black", "hair": "black", "eye": "brown"}),
    "vince": dict(items=[BODY, ("heads_human_male", None), ("hair_relm_short", None), ("torso_clothes_longsleeve2_buttoned", "white"),
                         ("torso_jacket_frock_collar", "navy"), ("legs_formal", "navy"), ("feet_boots_revised", "black")],
                  palette={"body": "light", "hair": "light_brown", "eye": "gray"}),
    "winnie": dict(items=[BODY, ("heads_human_female_elderly", None), ("hair_curls_large", None), ("facial_glasses", None),
                          ("torso_clothes_blouse", "sky"), ("legs_skirts_plain", "bluegray"), ("feet_boots_revised", "brown")],
                   body="female", palette={"body": "amber", "hair": "white", "eye": "brown"}),
    "yusuf": dict(items=[BODY, ("heads_human_male", None), ("hair_cornrows", None), ("beards_lampshade", None),
                         ("torso_clothes_longsleeve2_buttoned", "tan"), ("legs_pants2", "brown"), ("feet_boots_revised", "walnut")],
                  palette={"body": "brown", "hair": "black", "eye": "brown"}),
})
# What each carries in their arms at work, and who takes the apron off to sit on a break.
STORE_STAFF = {"june": None, "omar": None, "nell": None, "theo": None, "rosa": "produce", "ines": "produce", "kofi": "produce",
               "dale": "crate", "cole": "crate",
               "ravi": None, "noor": None, "lucia": None, "sade": "produce", "otto": "produce", "wren": "crate", "zeke": "crate"}
STORE_SHOPPERS = ("mabel", "priya", "gus", "hank", "lena", "tomas", "ada", "bruno", "cora", "dev", "elsie", "felix", "gemma",
                  "hugo", "iris", "jonah", "kiko", "luis", "maya", "ned", "olive", "pablo", "quinn", "rhea", "sam", "tilly",
                  "uma", "vince", "winnie", "yusuf")


def build(name):
    spec = CAST[name]
    return lpc.Character(spec["items"], body=spec.get("body", "male"), palette=spec.get("palette"))
