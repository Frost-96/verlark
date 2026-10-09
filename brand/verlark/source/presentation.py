"""Create a standalone vector brand board using the delivered geometry."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import re
import json

ROOT = Path(__file__).resolve().parents[1]
font_path = ROOT / 'fonts/Manrope-Variable.ttf'
fonts = {w: instantiateVariableFont(TTFont(font_path), {'wght':w}, inplace=False) for w in (450,650)}
def body(name):
    src=(ROOT / name).read_text()
    return re.sub(r'<title>.*?</title>','',re.sub(r'<svg[^>]*>|</svg>','',src))
def group(b,x,y,s=1): return f'<g transform="translate({x} {y}) scale({s})">{b}</g>'
def rect(x,y,w,h,c,r=0): return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{c}"/>'
def txt(value,x,y,size=18,color='#242925',weight=450):
    font=fonts[weight]; glyphs=font.getGlyphSet(); cmap=font.getBestCmap(); scale=size/font['head'].unitsPerEm
    parts=[]
    for char in value:
        name=cmap[ord(char)];pen=SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen,(scale,0,0,-scale,x,y)))
        parts.append(f'<path d="{pen.getCommands()}"/>');x+=glyphs[name].width*scale
    return '<g fill="'+color+'">'+''.join(parts)+'</g>'
def save(name,w,h,parts):
    (ROOT/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><title>Verlark brand preview</title>'+''.join(parts)+'</svg>\n')

ink='#242925';paper='#F7F4ED';ember='#CF432D';apricot='#F1CEAE'
logo=body('exports/logo-primary.svg');white=body('exports/logo-white.svg');mark=body('exports/mark-primary.svg');mw=body('exports/mark-white.svg');icon=body('exports/app-icon.svg')

p=[rect(0,0,1440,1120,paper),txt('VERLARK / BRAND IDENTITY',64,56,14,ink,650),txt('ENGLISH, IN YOUR OWN WORDS.',1082,56,12,ink,650),rect(64,79,1312,1,'#D8D8CF')]
p += [group(logo,70,151,1.65),txt('Find your words.',84,456,56,ink,650),txt('Make them yours.',84,526,56,ink,650),txt('A place to practise, find clarity, and try again.',87,582,20,'#62665E')]
p += [rect(1060,154,316,430,ember,28),group(mw,1078,185,1.06),txt('VER-lark',1094,531,24,paper,650),txt('Your next expression.',1094,560,16,paper)]
p += [rect(64,652,794,388,'#FFFFFF',20),rect(886,652,490,216,ink,20),group(white,935,702,.74)]
# Representative web navigation, not an application redesign or implemented UI.
p += [group(logo,91,683,.43),txt('Practice',529,717,13,ink,650),txt('Progress',611,717,13,ink),txt('Your space',699,717,13,ink),rect(90,745,741,1,'#EAEAE3'),txt('A LITTLE PRACTICE. MORE POSSIBILITIES.',97,787,11,'#74786E',650),txt('What will you try today?',97,829,29,ink,650)]
for i,(label,desc) in enumerate([('Writing','Give your ideas shape.'),('Speaking','Let the words come.')]):
    x=96+i*370
    p += [rect(x,853,347,153,paper,12),group(mark,x+18,870,.19),txt(label,x+21,947,23,ink,650),txt(desc,x+21,980,14,'#62665E')]
p += [txt('PALETTE',896,904,11,ink,650)]
for i,(color,label) in enumerate([(ember,'EMBER'),(ink,'INK'),(paper,'PAPER'),(apricot,'APRICOT')]):
    x=894+i*125;p+=[rect(x,923,108,69,color,8),txt(label,x,1017,10,ink,650),txt(color,x,1037,11,'#62665E')]
p += [txt('Writing + speaking + constructive feedback',64,1090,13,'#62665E'),txt('Name and logo proposal / 2026',1125,1090,12,'#62665E')]
save('previews/brand-board.svg',1440,1120,p)

# Actual pixel samples, large inspection and nearest-neighbour diagnostics.
p=[rect(0,0,1280,890,paper),txt('VERLARK / REDUCTION AND BACKGROUNDS',36,46,17,ink,650)]
for i,size in enumerate([256,64,32,16]):
    x=[36,365,515,660][i]
    p += [group(mark,x,90,size/256),txt(f'{size} px canvas',x,372,12,ink),group(icon,x,400,size/256),txt(f'{size} px canvas',x,684,12,ink)]
p += [rect(836,85,400,300,ink,14),group(mw,911,91,.97),txt('Reversed / white on ink',856,366,13,paper),rect(836,412,400,270,'#FFFFFF',14),group(logo,867,462,.65),txt('Primary / on white',856,660,13,ink)]
p += [txt('Navigation: 176 x 46 px',36,744,14,ink,650),group(logo,36,772,176/527.632),txt('Wordmark only: 120 px wide',350,744,14,ink,650),group(body('exports/wordmark-primary.svg'),350,776,120/339.85),txt('Icon background is intentionally opaque.',836,747,14,ink),txt('Logo PNG backgrounds are transparent.',836,779,14,ink)]
save('previews/size-tests.svg',1280,890,p)
print('Built presentation and size-test SVGs from exact export geometry.')
