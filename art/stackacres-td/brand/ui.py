import numpy as np
from PIL import Image
from px import *
def box(w,h,r,fill,hi=None,lip=None,lipn=0,outline='ink',inner_hi=None):
    c=Canvas(w,h)
    m=rrect(w,h,1,1,w-2,h-2-lipn,r)          # face
    full=rrect(w,h,1,1,w-2,h-2,r)             # face + lip
    if lip and lipn: c.put(full,lip)
    c.put(m,fill)
    if hi: c.put(edges_top(m)&m,hi)
    if inner_hi: c.put(edges_left(m)&m&~edges_top(m),inner_hi)
    c.put(np.zeros_like(m),'ink')
    c.outline(outline,1,diag=False)
    return c
def panel(S=32):
    c=Canvas(S,S)
    outer=rrect(S,S,1,1,S-2,S-2,4)
    c.put(outer,'red')
    c.put(outer&~rrect(S,S,1,1,S-2,S-4,4),'red2')
    c.put(edges_bottom(outer)&outer,'red3')
    c.put(edges_top(outer)&outer,'redhi')
    c.put(edges_left(outer)&outer&~edges_top(outer),'redhi')
    trimm=rrect(S,S,5,5,S-6,S-8,2)
    c.put(trimm,'trim'); c.put(edges_top(trimm)&trimm,'white'); c.put(edges_left(trimm)&trimm,'white')
    c.put(edges_bottom(trimm)&trimm,'trim2'); c.put(edges_right(trimm)&trimm&~edges_top(trimm),'trim2')
    c.put(rrect(S,S,7,7,S-8,S-10,1),'ink')
    c.put(rrect(S,S,8,8,S-9,S-11,0),'wash')
    for x,y in ((2,2),(S-4,2),(2,S-6),(S-4,S-6)):
        c.px(x,y,'steel'); c.px(x+1,y,'steel2'); c.px(x,y+1,'steel2'); c.px(x+1,y+1,'steel3')
    c.outline('ink',1,diag=False)
    return c
def joy_base(S=48):
    c=Canvas(S,S); yy,xx=np.mgrid[0:S,0:S]; r=np.hypot(xx+.5-S/2,yy+.5-S/2)
    ring=(r<=S/2-1.5)&(r>=S/2-5.5); c.put(ring,'wash'); c.put(ring&(yy<S/2-6)&(r>S/2-3),'white'); c.put(ring&(yy>S/2+6)&(r<S/2-3.5),'trim2')
    c.a[(r<S/2-5.5)]=(58,21,17,70)
    for dx,dy in ((0,-1),(0,1),(-1,0),(1,0)):
        cx=S/2+dx*(S/2-12); cy=S/2+dy*(S/2-12)
        c.put((np.abs(xx+.5-cx)<1.2)&(np.abs(yy+.5-cy)<1.2),'#ffffff')
    c.outline('ink',1,diag=False)
    inner=(r<S/2-5.5)&(r>=S/2-6.5); c.put(inner,'ink')
    return c
def joy_nub(S=22):
    c=Canvas(S,S); yy,xx=np.mgrid[0:S,0:S]; r=np.hypot(xx+.5-S/2,yy+.5-S/2)
    face=r<=S/2-1.5; c.put(face,'red'); c.put(face&(r>S/2-4)&(yy>S/2),'red2')
    ang=np.arctan2(yy+.5-S/2,xx+.5-S/2)
    for k in range(6):
        a0=k*np.pi/3
        d=np.abs(np.angle(np.exp(1j*(ang-a0))))
        c.put(face&(r>S/2-4.5)&(d<0.22),'trim')
    c.put(face&(r<=S/2-5.5),'red'); c.put((r<=S/2-5.5)&(r>S/2-6.5),'red2'); c.put(face&(r<S/2-7)&(yy<S/2-1)&(xx<S/2-1),'redhi')
    c.outline('ink',1,diag=False); return c
def plaque(w=24,h=14):
    c=box(w,h,2,'wash','white','trim2',2)
    for x in (2,w-4):
        y=2
        c.px(x,y,'steel'); c.px(x+1,y,'steel2'); c.px(x,y+1,'steel2'); c.px(x+1,y+1,'steel3')
    return c
def meter(w=16,h=8):
    c=Canvas(w,h); m=rrect(w,h,1,1,w-2,h-2,1); c.put(m,'#5a241c'); c.put(edges_top(m)&m,'red3'); c.outline('ink',1,diag=False); return c
PARTS={
 'panel':(panel(),10),
 'chip':(box(12,13,2,'wash','white','trim2',2),5),
 'chip-down':(box(12,13,2,'trim','trim','trim2',1),5),
 'btn-green':(box(14,16,2,'green','greenhi','green3',3,inner_hi='greenhi'),6),
 'btn-green-down':(box(14,16,2,'green','greenhi','green3',1,inner_hi='greenhi'),6),
 'btn-wash':(box(14,16,2,'wash','white','trim2',3),6),
 'btn-wash-down':(box(14,16,2,'wash','white','trim2',1),6),
 'btn-red':(box(14,16,2,'red','redhi','red3',3,inner_hi='redhi'),6),
 'btn-red-down':(box(14,16,2,'red','redhi','red3',1,inner_hi='redhi'),6),
 'btn-gold':(box(14,16,2,'gold','goldhi','gold2',3,inner_hi='goldhi'),6),
 'slot':(box(14,14,2,'trim','trim2','white',1),6),
 'slot-on':(box(14,16,2,'gold','goldhi','gold2',3,inner_hi='goldhi'),6),
 'card':(box(12,13,2,'white','white','trim',2,outline='trim2'),5),
 'card-sel':(box(12,13,2,'#fff6d8','white','gold',2),5),
 'plaque':(plaque(),6),
 'joy':(joy_base(50),0),
 'nub':(joy_nub(22),0),
 'meter':(meter(),3),
 'tab':(box(12,13,2,'trim','white','trim2',2),5),
 'tab-on':(box(12,13,2,'red','redhi','red3',2),5),
}
