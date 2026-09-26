import numpy as np
from PIL import Image, ImageDraw
from px import *
K={'k':'ink','w':'white','t':'trim','T':'trim2','r':'red','R':'red2','y':'gold','Y':'gold2','h':'goldhi',
   'g':'green','G':'green2','d':'green3','l':'greenhi','b':'blue','B':'blue2','c':'bluehi','s':'steel','S':'steel2','z':'steel3',
   'o':'dirt','O':'dirt2','n':'dirt3','e':'orange','E':'orange2'}
def g(rows): return grid(rows,K)
ICONS={}
ICONS['coin']=g([
"...kkkkkk...",
"..khhhhyyk..",
".khhyyyyyYk.",
"khhyYYYYyyYk",
"khyYyyyyhyYk",
"khyYyyyyhyYk",
"kyyYyyyyhyYk",
"kyyYyyyyhyYk",
"kyyyhhhhyYYk",
".kyyyyyyYYk.",
"..kYYYYYYk..",
"...kkkkkk...",
])
ICONS['energy']=g([
"......kkkkk.",
".....keeeEk.",
"....keeeEk..",
"...keeeEk...",
"..keeeekkkk.",
".keeeeeeeEk.",
".kkkkkeeeEk.",
"....keeeEk..",
"...keeEk....",
"...keEk.....",
"..keEk......",
"..kkk.......",
])
ICONS['water']=g([
".....kk.....",
"....kcbk....",
"....kcbk....",
"...kcbbBk...",
"...kcbbBk...",
"..kcbbbbBk..",
"..kcbbbbBk..",
".kcbbbbbbBk.",
".kcwbbbbbBk.",
".kcwbbbbBBk.",
"..kcbbbBBk..",
"...kkkkkk...",
])
ICONS['map']=g([
"............",
"kkkk.....kkk",
"kwwkkkkkkktk",
"kwwkttttktTk",
"kwrkttttktTk",
"kwwrtttrrtTk",
"kwwkrrrtktrk",
"kwwkttttkrkr",
"kwwkttttktrk",
"kkkkttttkkkk",
"...kkkkkk...",
"............",
])
ICONS['journal']=g([
".kkkkkkkkk..",
"krrrrrrrrRk.",
"krkkkkkkkRwk",
"krkhhhhhkRwk",
"krkkkkkkkRwk",
"krrrrrrrrRwk",
"krrrrrrrrRwk",
"krrrrrrrrRwk",
"krrrrrrrrRwk",
"kRRRRRRRRRwk",
".kwwwwwwwwTk",
"..kkkkkkkkkk",
])
ICONS['back']=g([
"............",
".....kk.....",
"....kkk.....",
"...kkkkkkkk.",
"..kkkkkkkkk.",
".kkkkkkkkkk.",
".kkkkkkkkkk.",
"..kkkkkkkkk.",
"...kkkkkkkk.",
"....kkk.....",
".....kk.....",
"............",
])
ICONS['more']=g(["............","............","............","............",
".kk..kk..kk.","kkkk.kk.kkkk"[:0]+".kk..kk..kk.","............","............","............","............","............","............"])
ICONS['close']=g([
"............",
".kk......kk.",
".kkk....kkk.",
"..kkk..kkk..",
"...kkkkkk...",
"....kkkk....",
"....kkkk....",
"...kkkkkk...",
"..kkk..kkk..",
".kkk....kkk.",
".kk......kk.",
"............",
])
ICONS['sound']=g([
"............",".....kk.....","....kwk...k.","kkkkwwk.k..k","kwwwwwk..k.k","kwwwwwk..k.k",
"kwwwwwk..k.k","kwwwwwk..k.k","kkkkwwk.k..k","....kwk...k.",".....kk.....","............"])
ICONS['mute']=g([
"............",".....kk.....","....kwk.....","kkkkwwk.....","kwwwwwkrr.rr","kwwwwwk.rrr.",
"kwwwwwk.rrr.","kwwwwwkrr.rr","kkkkwwk.....","....kwk.....",".....kk.....","............"])
ICONS['plus']=g([
"............","....kkkk....","....kkkk....","....kkkk....",".kkkkkkkkkk.",".kkkkkkkkkk.",
".kkkkkkkkkk.",".kkkkkkkkkk.","....kkkk....","....kkkk....","....kkkk....","............"])
ICONS['minus']=g([
"............","............","............","............",".kkkkkkkkkk.",".kkkkkkkkkk.",
".kkkkkkkkkk.",".kkkkkkkkkk.","............","............","............","............"])

# A smelted metal bar (the Far Field's buildings cost it), side on: lit top face, steel front.
ICONS['metal']=g([
"............",
"............",
"...kkkkkkk..",
"..kwwwwwwsk.",
".kwsssssssk.",
".kkkkkkkkkSk",
".ksssssssSSk",
".ksssssssSzk",
".kSSSSSSSzk.",
".kkkkkkkkk..",
"............",
"............",
])
# ---- 16px tools, drawn as shapes then outlined
def shaped(fn, size=16):
    im=Image.new('RGBA',(size,size)); d=ImageDraw.Draw(im); fn(d)
    c=Canvas(size,size); c.a=np.array(im); c.outline('ink',1,diag=False); return c
def C(n): return rgba(P[n])
def hoe(d):
    for i in range(10):
        x=2+i; y=13-i
        d.point((x,y),C('dirt')); d.point((x+1,y),C('dirt2')); d.point((x,y-1),C('goldhi') if i%3==0 else C('dirt'))
    d.rectangle([12,2,14,3],fill=C('steel'))
    d.rectangle([13,4,14,9],fill=C('steel'))
    d.line([(14,3),(14,9)],fill=C('steel2')); d.line([(13,9),(14,9)],fill=C('steel3'))
    d.line([(12,2),(13,2)],fill=C('white')); d.line([(13,4),(13,7)],fill=C('white'))
def can(d):
    d.rectangle([2,6,10,13],fill=C('green'))
    d.line([(2,6),(9,6)],fill=C('greenhi')); d.line([(3,7),(3,12)],fill=C('greenhi'))
    d.line([(10,7),(10,13)],fill=C('green2')); d.line([(3,13),(10,13)],fill=C('green3'))
    d.rectangle([2,9,10,9],fill=C('green2'))
    d.line([(11,10),(13,7)],fill=C('green')); d.line([(11,11),(13,8)],fill=C('green2'))
    d.rectangle([13,5,14,7],fill=C('steel')); d.point((14,5),C('white'))
    d.arc([3,1,9,9],180,360,fill=C('green2'))
    d.point((12,3),C('bluehi')); d.point((15,3),C('bluehi'))
def pouch(d):
    d.polygon([(4,6),(11,6),(13,10),(13,13),(12,14),(3,14),(2,13),(2,10)],fill=C('dirt'))
    d.line([(3,13),(12,13)],fill=C('dirt2')); d.line([(12,10),(12,13)],fill=C('dirt2'))
    d.line([(3,10),(3,12)],fill=C('goldhi'))
    d.polygon([(5,3),(10,3),(11,6),(4,6)],fill=C('dirt'))
    d.line([(5,5),(10,5)],fill=C('red')); d.line([(4,6),(11,6)],fill=C('red2'))
    d.point((7,9),C('green')); d.point((8,9),C('green')); d.point((6,10),C('greenhi')); d.point((7,10),C('green'));d.point((9,10),C('green2')); d.point((7,11),C('green3')); d.point((8,11),C('green3'))
def fence(d):
    for x in (3,10):
        d.rectangle([x,4,x+2,14],fill=C('dirt')); d.line([(x,4),(x,14)],fill=C('goldhi')); d.line([(x+2,4),(x+2,14)],fill=C('dirt2'))
        d.point((x+1,3),C('dirt'))
    for y in (6,10):
        d.rectangle([1,y,14,y+1],fill=C('dirt')); d.line([(1,y+1),(14,y+1)],fill=C('dirt2'))
def glove(d):
    d.rectangle([4,11,11,14],fill=C('red')); d.line([(4,14),(11,14)],fill=C('red2')); d.line([(4,11),(11,11)],fill=C('redhi'))
    d.polygon([(4,10),(4,6),(5,5),(6,6),(6,3),(7,2),(8,3),(8,2),(9,1),(10,2),(10,3),(11,3),(12,4),(12,7),(13,5),(14,6),(13,9),(11,10)],fill=C('dirt'))
    for x in (7,9): d.line([(x,3),(x,7)],fill=C('dirt2'))
    d.line([(11,4),(11,7)],fill=C('dirt2')); d.line([(5,6),(5,9)],fill=C('goldhi'))
def egg(d):
    d.ellipse([4,2,11,14],fill=C('trim')); d.ellipse([5,3,9,9],fill=C('white')); d.line([(10,8),(10,12)],fill=C('trim2')); d.line([(6,13),(9,13)],fill=C('trim2'))
def sack(d):
    d.polygon([(3,5),(12,5),(14,9),(14,14),(1,14),(1,9)],fill=C('trim'))
    d.polygon([(4,2),(11,2),(12,5),(3,5)],fill=C('trim')); d.line([(3,5),(12,5)],fill=C('dirt2'))
    d.line([(13,9),(13,13)],fill=C('trim2')); d.line([(2,13),(13,13)],fill=C('trim2'))
    d.rectangle([5,8,10,11],fill=C('red')); d.point((7,9),C('white')); d.point((8,10),C('white'))
    d.point((6,1),C('gold')); d.point((8,0),C('gold')); d.point((9,1),C('gold2'))
def build(d):
    # a little red-roofed barn front: the Build button
    d.polygon([(1,8),(8,1),(15,8)],fill=C('red'))
    d.line([(2,8),(8,2)],fill=C('redhi')); d.line([(9,2),(14,7)],fill=C('red2'))
    d.rectangle([3,8,13,14],fill=C('trim'))
    d.line([(3,8),(3,14)],fill=C('white')); d.line([(13,8),(13,14)],fill=C('trim2')); d.line([(3,14),(13,14)],fill=C('trim2'))
    d.rectangle([6,10,10,14],fill=C('red'))
    d.line([(6,10),(10,14)],fill=C('trim')); d.line([(10,10),(6,14)],fill=C('trim'))
    d.rectangle([7,5,9,6],fill=C('gold'))
TOOLS={'hand':glove,'hoe':hoe,'can':can,'pouch':pouch,'fence':fence,'egg':egg,'sack':sack,'build':build}
def coin():
    c=Canvas(12,12); yy,xx=np.mgrid[0:12,0:12]; r=np.hypot(xx+0.5-6,yy+0.5-6)
    face=r<=5.6; c.put(face,'gold')
    ring=(r>=3.0)&(r<=3.9); c.put(ring&((xx+yy)<11),'gold2'); c.put(ring&((xx+yy)>=11),'goldhi')
    c.put(face&(r>4.6)&((xx+yy)<9),'goldhi'); c.put(face&(r>4.6)&((xx+yy)>13),'gold2')
    c.px(5,5,'goldhi'); c.px(6,6,'gold2')
    c.outline('ink',1,diag=False); return c
def all_icons():
    out={k:v for k,v in ICONS.items()}
    for k,fn in TOOLS.items(): out[k]=shaped(fn)
    out['coin']=coin()
    return out
