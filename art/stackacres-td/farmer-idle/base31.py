"""Reduce the dev render to the cast's real size: 31px of body, feet on y=45.

31 is not a guess. Stardew draws a 16x32 character on a 16x16 tile, so a body
is ~1.9 tiles; our tiles are 16, so 31px. Every shipped character in
public/stackacres-td/characters/ measures exactly 31 (y=14..45), 14-16 wide.
The earlier 41px sprites in this folder were 30% too tall and would have
towered over the cast.
"""
import sys
from PIL import Image
from post_farmer import key_plate, strip_pad, place, SIZE

BODY_H, FEET_Y = 31, 45

def premul(im):
    p = im.copy(); px = p.load()
    for y in range(p.height):
        for x in range(p.width):
            r,g,b,a = px[x,y]; f = a/255
            px[x,y] = (round(r*f), round(g*f), round(b*f), a)
    return p

def unpremul(p, thresh=110):
    px = p.load()
    for y in range(p.height):
        for x in range(p.width):
            r,g,b,a = px[x,y]
            if a < thresh: px[x,y] = (0,0,0,0)
            else:
                f = 255/a
                px[x,y] = (min(255,round(r*f)), min(255,round(g*f)), min(255,round(b*f)), 255)
    return p

if __name__ == "__main__":
    src = sys.argv[1]
    out = sys.argv[2]
    im = Image.open(src)
    keyed, npad = strip_pad(key_plate(im))
    keyed = keyed.crop(keyed.getbbox())
    tw = max(1, round(keyed.width * BODY_H / keyed.height))
    p = premul(keyed).resize((tw*2, BODY_H*2), Image.BOX).resize((tw, BODY_H), Image.LANCZOS)
    sprite = unpremul(p)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0,0,0,0))
    canvas.paste(sprite, (round((SIZE-sprite.width)/2), FEET_Y-BODY_H), sprite)
    canvas.save(out)
    canvas.resize((SIZE*16, SIZE*16), Image.NEAREST).save(out.replace(".png","-16x.png"))
    print(f"{out}: {sprite.width}x{BODY_H}, pad {npad}")
