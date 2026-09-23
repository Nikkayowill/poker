import numpy as np
from px import *
def chip_stack(W=48,H=50, chips=4, rx=17, ry=6.0, thick=4, top_y=21, offsets=(0,2,-1,1), sprout=True):
    c=Canvas(W,H)
    cx=W/2
    # draw bottom-up; chip k top surface center y
    order=list(range(chips))  # 0=top
    ys=[top_y+k*thick for k in range(chips)]
    for k in reversed(range(chips)):
        ox=cx+offsets[k%len(offsets)]
        y0=ys[k]
        top=ellipse(W,H,ox,y0,rx,ry)
        bot=ellipse(W,H,ox,y0+thick,rx,ry)
        yy,xx=np.mgrid[0:H,0:W]
        band=np.zeros((H,W),bool)
        for t in range(thick+1):
            band|=ellipse(W,H,ox,y0+t,rx,ry)
        side=band&~top
        c.put(side,'red')
        # shade: right third darker, left edge highlight
        rel=(xx+0.5-ox)/rx
        c.put(side&(rel>0.45),'red2')
        c.put(side&(rel<-0.7),'redhi')
        # bottom rim line of the side (just above next chip)
        c.put(edges_bottom(band)&side,'#4a1812')
        # chip edge spots: trim-white blocks at angles
        for ang in [(-0.62,-0.05,0.55),(-0.35,0.25,0.8),(-0.85,-0.25,0.35),(-0.5,0.1,0.7)][k%4]:
            sx=ox+ang*rx
            w=max(1,round(3*np.sqrt(max(0.05,1-ang*ang))))
            spot=side&(np.abs(xx+0.5-sx)<=w/2+0.01)&~edges_bottom(band)
            c.put(spot,'trim')
            c.put(spot&(rel>0.45),'trim2')
        # top face (only visible fully for top chip; lower chips get covered)
        if k==0:
            c.put(top,'green')
            # furrows: 3 soil rows across the ellipse, perspective spacing
            for fy,col in ((y0-3,'dirt'),(y0,'dirt'),(y0+3,'dirt')):
                row=top&(yy==fy)
                # shorten furrows so grass rims them
                inner=ellipse(W,H,ox,y0,rx-3,ry-1)
                c.put(row&inner,'dirt')
                below=np.zeros_like(row); below[1:]=(row&inner)[:-1]
                c.put(below&top,'green2')
            c.put(edges_top(top),'greenhi')
            # rim of field (front lip)
            c.put(edges_bottom(top)&top,'green3')
        else:
            c.put(top,'red3')  # hidden seam/top of lower chip (mostly covered)
        # separation seam between chips
    # re-draw sides in correct painter order: done above bottom-up; top chip last
    if sprout:
        spr=[
        "..kkk.........kkk..",
        ".kggGk.......kgggk.",
        "kgggGGk.....kggggGk",
        "kgggGGGk...kgggGGGk",
        ".kggGGGGk.kggGGGGk.",
        "..kgGGGGGkgGGGGGk..",
        "...kkGGGGGGGGGkk...",
        ".....kkkkGkkkk.....",
        "........kGk........",
        "........kGk........",
        "........kGk........",
        ]
        pal={'k':'ink','g':'greenhi','G':'green'}
        h=len(spr); w=len(spr[0])
        ox=int(round(cx+offsets[0])); by=ys[0]-1
        for y,r in enumerate(spr):
            for x,ch in enumerate(r):
                if ch!='.': c.px(ox-w//2+x, by-h+1+y, pal[ch])
    c.outline('ink',1,diag=False)
    c.outline('ink',1,diag=True)
    return c
