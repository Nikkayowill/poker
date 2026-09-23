import numpy as np
from PIL import Image
from scipy import ndimage as nd
P = dict(
 ink='#3a1511', white='#ffffff', trim='#eeebe4', trim2='#d9d3c7', wash='#f7f4ee',
 red='#ab372b', red2='#8a2822', red3='#621c19', redhi='#c9503c',
 gold='#f4c542', gold2='#dd9a26', goldhi='#fff0a8',
 green='#84bf44', green2='#66942a', green3='#386a30', greenhi='#b4e06a',
 dirt='#c39753', dirt2='#996b4a', dirt3='#71452b',
 blue='#07acc6', blue2='#156c99', bluehi='#7fe0ee',
 steel='#c7ccd4', steel2='#8a93a3', steel3='#5b6273',
 orange='#eb8a55', orange2='#d4623a', wood='#b88751', wood2='#8a5a33',
 plum='#3a1511',
)
def rgba(h, a=255):
    h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
class Canvas:
    def __init__(s,w,h): s.a=np.zeros((h,w,4),np.uint8)
    @property
    def mask(s): return s.a[...,3]>0
    def put(s,m,c):
        s.a[m]=rgba(P.get(c,c))
    def px(s,x,y,c):
        if 0<=y<s.a.shape[0] and 0<=x<s.a.shape[1]: s.a[y,x]=rgba(P.get(c,c))
    def outline(s,c='ink',n=1,diag=True):
        st=np.ones((3,3),bool) if diag else nd.generate_binary_structure(2,1)
        m=s.mask
        for _ in range(n):
            d=nd.binary_dilation(m,st)&~m; s.put(d,c); m=m|d
    def img(s): return Image.fromarray(s.a,'RGBA')
    def save(s,p,scale=1):
        im=s.img()
        if scale!=1: im=im.resize((im.width*scale,im.height*scale),Image.NEAREST)
        im.save(p); return im
def ellipse(w,h,cx,cy,rx,ry):
    y,x=np.mgrid[0:h,0:w]
    return ((x+0.5-cx)/rx)**2+((y+0.5-cy)/ry)**2<=1.0
def grid(rows, pal):
    h=len(rows); w=len(rows[0]); c=Canvas(w,h)
    for y,r in enumerate(rows):
        for x,ch in enumerate(r):
            if ch!='.': c.px(x,y,pal[ch])
    return c
def edges_top(m):  # pixels in m whose pixel above is outside m
    up=np.zeros_like(m); up[1:]=m[:-1]; return m&~up
def edges_bottom(m):
    dn=np.zeros_like(m); dn[:-1]=m[1:]; return m&~dn
def edges_left(m):
    l=np.zeros_like(m); l[:,1:]=m[:,:-1]; return m&~l
def edges_right(m):
    r=np.zeros_like(m); r[:,:-1]=m[:,1:]; return m&~r

def rrect(w,h,x0,y0,x1,y1,r):
    yy,xx=np.mgrid[0:h,0:w]
    m=(xx>=x0)&(xx<=x1)&(yy>=y0)&(yy<=y1)
    if r<=0: return m
    for cx,cy,qx,qy in ((x0+r,y0+r,xx<x0+r,yy<y0+r),(x1-r,y0+r,xx>x1-r,yy<y0+r),(x0+r,y1-r,xx<x0+r,yy>y1-r),(x1-r,y1-r,xx>x1-r,yy>y1-r)):
        m&=~(qx&qy&(((xx-cx)**2+(yy-cy)**2)>r*r+0.5*r))
    return m
