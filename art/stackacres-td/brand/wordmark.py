import numpy as np, math
from PIL import Image, ImageDraw, ImageFont
from px import *
import os
# Baloo 2 ExtraBold as a static TTF (Google Fonts). The app vendors it as woff2 only.
FONT=os.environ.get('BALOO_TTF','Baloo_2_wght_800.ttf')
def build(size=36, arch=4, gap=-1, depth=4, tones=None):
    parts=[('Stack',('white','trim','trim2'),'goldhi'),('Acres',('goldhi','gold','gold2'),'white')]
    f=ImageFont.truetype(FONT,size)
    text='StackAcres'
    # positions via cumulative getlength with kerning
    xs=[f.getlength(text[:i]) for i in range(len(text))]
    total=f.getlength(text)
    W=int(total)+size+20; H=size*2+arch+depth+10
    L=np.zeros((H,W),bool); F=np.zeros((H,W),np.int8)-1  # tone index map
    colors=[]
    for i,ch in enumerate(text):
        im=Image.new('L',(size*2,size*2),0); d=ImageDraw.Draw(im); d.text((size//2,0),ch,font=f,fill=255)
        m=np.array(im)>110
        cx=xs[i]+f.getlength(ch)/2
        dy=-round(arch*math.sin(math.pi*cx/total))
        ox=int(round(xs[i]))+4-size//2+ (1 if i>=5 else 0)
        oy=dy+arch+4 - size//4
        ys,xs_=np.nonzero(m)
        for y,x in zip(ys,xs_):
            yy=y+oy; xx=x+ox+size//2
            if 0<=yy<H and 0<=xx<W:
                L[yy,xx]=True; F[yy,xx]=0 if i<5 else 1
    # crop
    rows=np.any(L,1); cols=np.any(L,0)
    y0,y1=np.nonzero(rows)[0][[0,-1]]; x0,x1=np.nonzero(cols)[0][[0,-1]]
    pad=depth+4
    L=L[y0:y1+1,x0:x1+1]; F=F[y0:y1+1,x0:x1+1]
    h,w=L.shape
    c=Canvas(w+2*pad,h+2*pad)
    M=np.zeros(c.mask.shape,bool); M[pad:pad+h,pad:pad+w]=L
    FF=np.full(M.shape,-1,np.int8); FF[pad:pad+h,pad:pad+w]=F
    # extrusion down
    E=np.zeros_like(M)
    for t in range(1,depth+1):
        sh=np.zeros_like(M); sh[t:]=M[:-t]; E|=sh
    E&=~M
    c.put(E,'red')
    # darker lower extrusion
    E2=np.zeros_like(M)
    for t in range(max(1,depth-1),depth+1):
        sh=np.zeros_like(M); sh[t:]=M[:-t]; E2|=sh
    c.put(E2&~M,'red2')
    c.put(edges_left(E|M)&E,'redhi')
    from scipy import ndimage as nd
    holes=nd.binary_fill_holes(M)&~M
    c.put(holes&E,'red3')
    below=np.zeros_like(M)
    for t in range(1,depth+2):
        sh=np.zeros_like(M); sh[:-t]=M[t:]; below|=sh
    c.put(E&below,'red3')
    # face tones by vertical position within the word's cap band, per letter column
    yy=np.mgrid[0:M.shape[0],0:M.shape[1]][0]
    # per-pixel: relative position from the glyph's own top in its column
    top=np.full(M.shape[1],10**6)
    for x in range(M.shape[1]):
        col=np.nonzero(M[:,x])[0]
        if len(col): top[x]=col[0]
    for which,(hi,mid,lo) in enumerate([('white','trim','trim2'),('goldhi','gold','gold2')]):
        sel=M&(FF==which)
        c.put(sel,mid)
        # lower band: bottom 35% of the letter height (letter height ~ from local top to baseline)
        base=np.zeros(M.shape[1],int)
        for x in range(M.shape[1]):
            col=np.nonzero(M[:,x])[0]
            base[x]=col[-1] if len(col) else 0
        rel=np.zeros(M.shape)
        for x in range(M.shape[1]):
            if base[x]>top[x]: rel[:,x]=(yy[:,x]-top[x])/max(1,base[x]-top[x])
        c.put(sel&(yy>=0)&(rel>0.72),lo)
        c.put(edges_top(M)&sel,hi)
        c.put(edges_left(M)&sel&(rel<0.62),hi)
    c.outline('ink',1,diag=False)
    c.outline('ink',1,diag=True)
    return c
