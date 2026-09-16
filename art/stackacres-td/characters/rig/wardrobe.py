"""Heads and outfits for everyone who is not Ray or the farmer.

Same rig, same body, same poses: a character here is a head style, an outfit (torso
grid) and a palette of colour roles, exactly like rig.py's CHARACTERS. Head grids are
14 wide; a `rise` lifts a tall hat above head_top. Faces keep the eyes on row 6 and
the chin on rows 9-10 so every head sits on the torso the same way.

Roles: S s h skin, H j hair, C c k hat, A a a second garment or hat accent, E eyes,
R r shirt, L l Y trousers/overalls and buckle, u cuffs, D b d boots.
"""

# ---------------------------------------------------------------- faces (rows 5-10)

FACE = {
    "front": ["..HssssssssH..", "..hSESSSSESs..", "..hSSSSsSSSs..", "...SSSssSSs...", "....SSSSSs....", ".....SSSs....."],
    "back": ["..HHHHHHHHHH..", "..HHHHHHHHHj..", "..SHHHHHHHHs..", "...HHHHHHHj...", "....SSSSSs....", ".....SSSs....."],
    "side": ["...HHHssssS...", "...HHSSSSES...", "...HSSSSSSSS..", "....SSSSSsS...", ".....SSSS.....", "......SSs....."],
}
VEIL = {  # Bea's face behind netting
    "front": [".AAssssssssAA.", ".AhSESSSSESsA.", ".AhSSSSsSSSsA.", ".AaSSSssSSsaA.", ".AaaSSSSSsaaA.", "..AaaaaaaaaA.."],
    "back": [".AAAAAAAAAAAA.", ".AAAAAAAAAAAA.", ".AAAAAAAAAAAA.", ".AaAAAAAAAAaA.", "..AaaaaaaaaA..", "...aaaaaaaa..."],
    "side": ["..AAHssssSAA..", "..AHSSSSESAA..", "..AHSSSSSSSA..", "..AaSSSSsSAA..", "..AaaSSSSaA...", "...Aaaaaaaa..."],
}

# ---------------------------------------------------------------- hats (rows 0-4, plus `rise` rows above)

HATS = {
    "toque": {"rise": 3, "front": [
        "...kkkkkkkk...", "..kCCCCCCCCc..", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..cCCCCCCCCc..",
        "...CCCCCCCc...", "...CCCCCCCc...", "...cccccccc..."],
        "back": [
        "...CCCCCCCC...", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..cCCCCCCCCc..",
        "...CCCCCCCc...", "...CCCCCCCc...", "...cccccccc..."],
        "side": [
        "....kkkkkkkk..", "...kCCCCCCCCc.", "...CCCCCCCCCc.", "...CCCCCCCCCc.", "...cCCCCCCCCc.",
        "....CCCCCCCc..", "....CCCCCCCc..", "....cccccccc.."]},
    "fedora": {"rise": 0, "front": [
        "....CCCCCC....", "...CkkCCCCc...", "...aaaaaaaa...", "CCCCCCCCCCCCCC", ".cccccccccccc."],
        "back": ["....CCCCCC....", "...CCCCCCCc...", "...aaaaaaaa...", "CCCCCCCCCCCCCC", ".cccccccccccc."],
        "side": [".....CCCCC....", "....CkkCCCc...", "....aaaaaaa...", ".CCCCCCCCCCCCC", "..cccccccccccc"]},
    "cap_back": {"rise": 0, "front": [
        "...CCCCCCCC...", "..CkkCCCCCCc..", ".CCCCCCCCCCCc.", ".cccccccccccc.", "..jHHHHHHHHj.."],
        "back": ["...CCCCCCCC...", "..CCCCCCCCCc..", ".CCCCCCCCCCCc.", ".cccccccccccc.", "cccccccccccccc"],
        "side": [".....CCCCCC...", "....CkkCCCCc..", "...CCCCCCCCCc.", "...cccccccccc.", "ccccjHHHHHHj.."]},
    "hard_hat": {"rise": 0, "front": [
        "....CCCCCC....", "..CCkkCCCCCc..", ".CCCaAAaCCCCc.", ".CCCCCCCCCCCc.", "cccccccccccccc"],
        "back": ["....CCCCCC....", "..CCCCCCCCCc..", ".CCCCCCCCCCCc.", ".CCCCCCCCCCCc.", "cccccccccccccc"],
        "side": [".....CCCCCC...", "...CCCkkCCCCc.", "..CCCCCCCCaAa.", "..CCCCCCCCCCc.", ".ccccccccccccc"]},
    "toadstool": {"rise": 1, "front": [
        ".....CCCC.....", "...CCkkCCCCC..", ".CCkCCCCCkCCc.", "CCCCCCkCCCCCCc", "CccccccccccccC", ".cccccccccccc."],
        "back": [".....CCCC.....", "...CCCCCCCCC..", ".CCCCkCCCCCCc.", "CCCkCCCCCkCCCc", "CccccccccccccC", ".cccccccccccc."],
        "side": [".....CCCC.....", "...CCCkkCCCC..", ".CCCCCCCkCCCc.", "CCkCCCCCCCCCCc", "CccccccccccccC", ".cccccccccccc."]},
    "stetson": {"rise": 1, "front": [
        "....CCkCCC....", "...CCCkCCCC...", "...CCCCCCCCc..", "...aaaaaaaac..", "CCCCCCCCCCCCCC", "kcccccccccccck"],
        "back": ["....CCCCCC....", "...CCCCCCCC...", "...CCCCCCCCc..", "...aaaaaaaac..", "CCCCCCCCCCCCCC", "kcccccccccccck"],
        "side": [".....CCkCCC...", "....CCCkCCCC..", "....CCCCCCCCc.", "....aaaaaaaac.", ".CCCCCCCCCCCCC", ".kccccccccccck"]},
    "sunhat": {"rise": 0, "front": [
        "....CCCCCC....", "...CkkCCCCc...", "...cccccccc...", "CCCCCCCCCCCCCC", ".cccccccccccc."],
        "back": ["....CCCCCC....", "...CCCCCCCc...", "...cccccccc...", "CCCCCCCCCCCCCC", ".cccccccccccc."],
        "side": [".....CCCCC....", "....CkkCCCc...", "....ccccccc...", ".CCCCCCCCCCCCC", "..cccccccccccc"]},
}

# ---------------------------------------------------------------- whole heads (11 rows, no separate face)

WHOLE = {
    "dive_helmet": {"rise": 0, "front": [
        "....CCCCCC....", "..CCkkCCCCCc..", ".CCCCCCCCCCCc.", ".CCCAAAAAACcc.", ".CCAAEAAEAACc.", ".CCAaAAAAaACc.",
        ".CCCAAAAAACcc.", "..CCCCCCCCCc..", "..cccccccccc..", "...kCCCCCCc...", "....cccccc...."],
        "back": [
        "....CCCCCC....", "..CCCCCCCCCc..", ".CCCCCCCCCCCc.", ".CCkCCCCCCkCc.", ".CCCCCCCCCCCc.", ".CCCCCCCCCCCc.",
        ".CCkCCCCCCkCc.", "..CCCCCCCCCc..", "..cccccccccc..", "...CCCCCCCc...", "....cccccc...."],
        "side": [
        ".....CCCCCC...", "...CCkkCCCCCc.", "..CCCCCCCCCCc.", "..CCCCCAAAAcc.", "..CCkCCAEAAAc.", "..CCCCCAaAAAc.",
        "..CCCCCAAAAcc.", "...CCCCCCCCc..", "...ccccccccc..", "....kCCCCCc...", ".....cccccc..."]},
    "great_helm": {"rise": 2, "front": [
        "......AA......", ".....AaAA.....", "....CCCCCC....", "..CCkkCCCCCc..", ".CCCCCCCCCCCc.", ".CCCCCCCCCCCc.",
        ".CCEEEEEEEEcc.", ".CCCCCCCCCCcc.", ".CCCcCCCCcCcc.", "..CCCCCCCCCc..", "..cccccccccc..", "...CCCCCCCc...", "....cccccc...."],
        "back": [
        "......AA......", ".....AAaA.....", "....CCCCCC....", "..CCCCCCCCCc..", ".CCCCCCCCCCCc.", ".CCCCCCCCCCCc.",
        ".CCCCCCCCCCcc.", ".CCCCCCCCCCcc.", ".CCCCCCCCCCcc.", "..CCCCCCCCCc..", "..cccccccccc..", "...CCCCCCCc...", "....cccccc...."],
        "side": [
        "....AAA.......", "...AAaAA......", ".....CCCCCC...", "...CCkkCCCCCc.", "..CCCCCCCCCCc.", "..CCCCCCCCCCc.",
        "..CCCCCEEEEEc.", "..CCCCCCCCCcc.", "..CCCCCCCcCcc.", "...CCCCCCCCc..", "...ccccccccc..", "....CCCCCCc...", ".....cccccc..."]},
    "space_helmet": {"rise": 0, "front": [
        "....CCCCCC....", "..CCkkCCCCCc..", ".CCCCCCCCCCCc.", ".CCAAAAAAAACc.", ".CAaSssssSaAc.", ".CAhSESSSESAc.",
        ".CAhSSSsSSSAc.", ".CAAaSSSSaAAc.", ".CCAAAAAAAACc.", "..CCCCCCCCCc..", "..cccccccccc.."],
        "back": [
        "....CCCCCC....", "..CCCCCCCCCc..", ".CCCCCCCCCCCc.", ".CCCCCCCCCCCc.", ".CCkCCCCCCCCc.", ".CCCCCCCCCCCc.",
        ".CCCCCCCCCCCc.", ".CCCCCCCCCCCc.", ".CCCCCCCCCCCc.", "..CCCCCCCCCc..", "..cccccccccc.."],
        "side": [
        ".....CCCCCC...", "...CCkkCCCCCc.", "..CCCCCCCCCCc.", "..CCCCCAAAAAc.", "..CCCCAaSssAc.", "..CCkCAhSESAc.",
        "..CCCCAhSSSAc.", "..CCCCAAaSAAc.", "..CCCCCAAAAcc.", "...CCCCCCCCc..", "...ccccccccc.."]},
    "shaved": {"rise": 0, "front": [
        "..............", "..............", "....hhSSSS....", "..hhSSSSSSSs..", "..hSSSSSSSSs..", "..hSSSSSSSSs..",
        "..hSESSSSESs..", "..hSSSSsSSSs..", "...SSSssSSs...", "....SSSSSs....", ".....SSSs....."],
        "back": [
        "..............", "..............", "....hhSSSS....", "..hhSSSSSSSs..", "..hSSSSSSSSs..", "..hSSSSSSSSs..",
        "..SSSSSSSSSs..", "..SSSSSSSSSs..", "...SSSSSSSs...", "....SSSSSs....", ".....SSSs....."],
        "side": [
        "..............", "..............", ".....hhSSSS...", "...hhSSSSSSSs.", "...hSSSSSSSSs.", "...hSSSSSSSSs.",
        "...hSSSSSSES..", "...hSSSSSSSSs.", "....SSSSSsS...", ".....SSSS.....", "......SSs....."]},
    "hood": {"rise": 0, "front": [
        "....CCCCCC....", "...CCkCCCCc...", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..CCccccccCc..", "..CcccccccCc..",
        "..CcEccccEcc..", "..CcccccccCc..", "..CCccccccCc..", "..CCCCCCCCCc..", "..CCCCCCCCCc.."],
        "back": [
        "....CCCCCC....", "...CCCCCCCc...", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..CCkCCCCCCc..",
        "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..CCCCCCCCCc..", "..CCCCCCCCCc.."],
        "side": [
        ".....CCCCCC...", "....CCkCCCCc..", "...CCCCCCCCCc.", "...CCCCCCCCCc.", "...CCCCCccccc.", "...CCCCcccccc.",
        "...CCCCcccEcc.", "...CCCCcccccc.", "...CCCCCccccc.", "...CCCCCCCCCc.", "...CCCCCCCCCc."]},
}


def _head(hat, face=FACE):
    spec = HATS[hat]
    return {"rise": spec["rise"], **{view: spec[view] + face[view] for view in ("front", "back", "side")}}


HEADS = {name: _head(name) for name in HATS}
HEADS["sunhat_veil"] = _head("sunhat", VEIL)
HEADS.update(WHOLE)

# ---------------------------------------------------------------- outfits (torso grids, 14 wide, stamped at head_top + 11)

TORSOS = {
    "shirt": {  # a plain shirt tucked into trousers, with a belt
        "front": ["RRRRRSSSSRRRRR", "RrRRRRSSRRRRrR", "rrrrRRRRRRrrrr", "RrRRRRRRRRRRrR", "RrRRRRRRRRRRrR",
                  "RrRRrRRRRrRRrR", "..RRRRRRRRRR..", "..llllYYllll..", "..LLLLLLLLLL.."],
        "back": ["RRRRRRRRRRRRRR", "RrRRRRRRRRRRrR", "rrrrrrRRrrrrrr", "RrRRRRRRRRRRrR", "RrRRRRRRRRRRrR",
                 "RrRRrRRRRrRRrR", "..RRRRRRRRRR..", "..llllllllll..", "..LLLLLLLLLL.."],
        "side": ["...RRRSSRRR...", "..RRrRRRRRR...", "..rrrrrRRRRR..", "..RrRRRRRRRR..", "..RrRRRRRRRr..",
                 "..RrRRRRRRRr..", "...RRRRRRRRr..", "...lllllYlll..", "...LLLLLLLLl.."],
    },
    "apron": {  # shirt with a bib apron over it (A)
        "front": ["RRRRRSSSSRRRRR", "RrRRRASSARRRrR", "rrrrRAAAARrrrr", "RrRRAAAAAARRrR", "RrRRAAAAAARRrR",
                  "RrRRAaAAAARRrR", "..RAAAAAAAAR..", "..AAAAAAAAAA..", "..aaaaaaaaaa.."],
        "back": ["RRRRRRRRRRRRRR", "RrRRRARRARRRrR", "rrrrrrAArrrrrr", "RrRRRRAARRRRrR", "RrRRRRRRRRRRrR",
                 "RrRRrRRRRrRRrR", "..RRRRRRRRRR..", "..llllllllll..", "..LLLLLLLLLL.."],
        "side": ["...RRRSSRRR...", "..RRrRRAAAR...", "..rrrrrAAAAA..", "..RrRRAAAAAA..", "..RrRRAAAAAa..",
                 "..RrRRAaAAAa..", "...RRAAAAAAa..", "...lAAAAAAAa..", "...LLaaaaaal.."],
    },
    "coat": {  # a long coat, belted, skirt over the trousers
        "front": ["RRRRRSSSSRRRRR", "RrRRRrSSrRRRrR", "rrrrRRrRrRrrrr", "RrRRRRrRrRRRrR", "RrRRRRrRrRRRrR",
                  "RrRRrrrYrrRRrR", "..RRRRrRrRRR..", "..RRRRrRrRRR..", "..rrrrrrrrrr.."],
        "back": ["RRRRRRRRRRRRRR", "RrRRRRRRRRRRrR", "rrrrrrRRrrrrrr", "RrRRRRRRRRRRrR", "RrRRRRRRRRRRrR",
                 "RrRRrrrrrrRRrR", "..RRRRRRRRRR..", "..RRRRRrRRRR..", "..rrrrrrrrrr.."],
        "side": ["...RRRSSRRR...", "..RRrRRRRRR...", "..rrrrrRRRRr..", "..RrRRRRRRRr..", "..RrRRRRRRRr..",
                 "..RrRrrrrrrr..", "...RRRRRRRRr..", "...RRRRRRRRr..", "...rrrrrrrrr.."],
    },
    "vest": {  # shirt with a vest (A) open down the front
        "front": ["AAARRSSSSRRAAA", "AaARRRSSRRRAaA", "aaARRRRRRRRAaa", "AaARRRRRRRRAaA", "AaARRRRRRRRAaA",
                  "AaARRrRRrRRAaA", "..AARRRRRRAA..", "..llllYYllll..", "..LLLLLLLLLL.."],
        "back": ["AAAAAAAAAAAAAA", "AaAAAAAAAAAAaA", "aaaaaaAAaaaaaa", "AaAAAAAAAAAAaA", "AaAAAAAAAAAAaA",
                 "AaAAaAAAAaAAaA", "..AAAAAAAAAA..", "..llllllllll..", "..LLLLLLLLLL.."],
        "side": ["...RRRSSRRR...", "..AArRRRRRR...", "..aaaaaRRRRR..", "..AaAARRRRRR..", "..AaAARRRRRr..",
                 "..AaAARRRRRr..", "...AAAARRRRr..", "...lllllYlll..", "...LLLLLLLLl.."],
    },
    "robe": {  # a long robe to the ankles: legs hidden, feet showing
        "front": ["RRRRRSSSSRRRRR", "RrRRRRSSRRRRrR", "rrrrRRRRRRrrrr", "RrRRRRRRRRRRrR", "RrRRrRRRRrRRrR",
                  "RrRRrRRRRrRRrR", "..RRrRRRRrRR..", "..RRrRRRRrRR..", "..RRrRRRRrRR..", "..RRrRRRRrRR..",
                  "..RRRRRRRRRR..", "..RRRRRRRRRR..", "..rrrrrrrrrr.."],
        "back": ["RRRRRRRRRRRRRR", "RrRRRRRRRRRRrR", "rrrrrrRRrrrrrr", "RrRRRRRRRRRRrR", "RrRRRRRRRRRRrR",
                 "RrRRrRRRRrRRrR", "..RRrRRRRrRR..", "..RRrRRRRrRR..", "..RRrRRRRrRR..", "..RRrRRRRrRR..",
                 "..RRRRRRRRRR..", "..RRRRRRRRRR..", "..rrrrrrrrrr.."],
        "side": ["...RRRSSRRR...", "..RRrRRRRRR...", "..rrrrrRRRRR..", "..RrRRRRRRRR..", "..RrRRRRRRRr..",
                 "..RrRRRRRRRr..", "...RRrRRRRRr..", "...RRrRRRRRr..", "...RRrRRRRRr..", "...RRrRRRRRr..",
                 "...RRRRRRRRr..", "...RRRRRRRRr..", "...rrrrrrrrr.."],
    },
}

# ---------------------------------------------------------------- the cast

T_SKIN = {"S": "T", "s": "o", "h": "W"}
N_SKIN = {"S": "N", "s": "P", "h": "o"}
BOOTS = {"D": "N", "b": "o", "d": "P"}
DARK_BOOTS = {"D": "P", "b": "N", "d": "K"}
STEEL_BOOTS = {"D": "g", "b": "s", "d": "K"}

CHARACTERS = {
    "pierre": {"head": "toque", "torso": "apron", "roles": {
        **T_SKIN, "H": "N", "j": "P", "C": "W", "c": "s", "k": "W", "A": "R", "a": "P", "E": "K",
        "R": "W", "r": "s", "L": "g", "l": "K", "Y": "Y", "u": "s", **DARK_BOOTS}},
    "miles": {"head": "fedora", "torso": "coat", "roles": {
        **T_SKIN, "H": "N", "j": "P", "C": "N", "c": "P", "k": "o", "A": "P", "a": "K", "E": "K",
        "R": "o", "r": "N", "L": "N", "l": "P", "Y": "Y", "u": "o", **DARK_BOOTS}},
    "skye": {"head": "cap_back", "torso": "shirt", "roles": {
        **T_SKIN, "H": "P", "j": "K", "C": "R", "c": "P", "k": "o", "A": "R", "a": "P", "E": "K",
        "R": "Y", "r": "o", "L": "B", "l": "K", "Y": "Y", "u": "o", "D": "R", "b": "o", "d": "P"}},
    "barnaby": {"head": "dive_helmet", "torso": "shirt", "roles": {
        "S": "g", "s": "K", "h": "s", "H": "g", "j": "K", "C": "s", "c": "g", "k": "W", "A": "C", "a": "L", "E": "K",
        "R": "v", "r": "G", "L": "v", "l": "G", "Y": "o", "u": "o", **STEEL_BOOTS}},
    "arthur": {"head": "great_helm", "torso": "vest", "roles": {
        "S": "g", "s": "K", "h": "s", "H": "g", "j": "K", "C": "s", "c": "g", "k": "W", "A": "L", "a": "B", "E": "K",
        "R": "s", "r": "g", "L": "g", "l": "K", "Y": "W", "u": "g", **STEEL_BOOTS}},
    "brayden": {"head": "hard_hat", "torso": "shirt", "roles": {
        **N_SKIN, "H": "N", "j": "P", "C": "Y", "c": "o", "k": "W", "A": "W", "a": "s", "E": "K",
        "R": "o", "r": "N", "L": "N", "l": "P", "Y": "Y", "u": "o", **DARK_BOOTS}},
    "ivy": {"head": "toadstool", "torso": "vest", "roles": {
        **T_SKIN, "H": "N", "j": "P", "C": "R", "c": "P", "k": "W", "A": "v", "a": "G", "E": "K",
        "R": "N", "r": "P", "L": "P", "l": "K", "Y": "Y", "u": "N", **BOOTS}},
    "wes": {"head": "stetson", "torso": "vest", "roles": {
        **T_SKIN, "H": "N", "j": "P", "C": "N", "c": "P", "k": "o", "A": "P", "a": "K", "E": "K",
        "R": "W", "r": "s", "L": "N", "l": "P", "Y": "Y", "u": "W", **BOOTS}},
    "bea": {"head": "sunhat_veil", "torso": "apron", "roles": {
        **N_SKIN, "H": "P", "j": "K", "C": "Y", "c": "o", "k": "W", "A": "W", "a": "s", "E": "K",
        "R": "W", "r": "s", "L": "W", "l": "s", "Y": "Y", "u": "s", **BOOTS}},
    "leo": {"head": "space_helmet", "torso": "shirt", "roles": {
        "S": "W", "s": "s", "h": "W", "H": "W", "j": "s", "C": "W", "c": "s", "k": "W", "A": "C", "a": "L", "E": "K",
        "R": "W", "r": "s", "L": "W", "l": "s", "Y": "L", "u": "L", **STEEL_BOOTS}},
    "pilgrim": {"head": "shaved", "torso": "robe", "roles": {
        **N_SKIN, "H": "N", "j": "P", "C": "o", "c": "N", "k": "o", "A": "o", "a": "N", "E": "K",
        "R": "o", "r": "N", "L": "o", "l": "N", "Y": "o", "u": "o", **BOOTS}},
    "merchant": {"head": "hood", "torso": "robe", "roles": {
        "S": "P", "s": "K", "h": "B", "H": "P", "j": "K", "C": "P", "c": "K", "k": "B", "A": "P", "a": "K", "E": "Y",
        "R": "P", "r": "B", "L": "P", "l": "K", "Y": "Y", "u": "B", **STEEL_BOOTS}},
}

# Leo's face inside the visor and Bea's behind the veil use the skin roles; the
# helmeted and hooded ones show gloves for hands, which is what S/s/h become there.
for name, ch in CHARACTERS.items():
    for view, grid in ((v, g) for v, g in HEADS[ch["head"]].items() if v != "rise"):
        assert {len(r) for r in grid} == {14}, (name, view)
    for view, grid in TORSOS[ch["torso"]].items():
        assert {len(r) for r in grid} == {14}, (name, view)
