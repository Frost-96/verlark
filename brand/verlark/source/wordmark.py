"""Outline a manually spaced Manrope wordmark. Requires fontTools.

The font is unmodified. Exported paths retain the same glyphs/positions as
the editable SVG source. All generated assets stay under this brand folder.
"""
import base64
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[1]
font_path = ROOT / "fonts/Manrope-Variable.ttf"
font = instantiateVariableFont(TTFont(font_path), {"wght": 650}, inplace=False)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font["head"].unitsPerEm
size = 100
scale = size / units
baseline = 95
x = 10.0
paths, positions = [], []
# Explicit per-glyph positions support deterministic editable and outline masters.
# Tighten va/e relationships gently, let the two r shoulders breathe.
tracking = [-3.4, -2.2, -1.0, -1.0, -2.2, -1.1, 0]
for char, adjust in zip("verlark", tracking):
    positions.append(round(x, 5))
    name = cmap[ord(char)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
    paths.append(f'<path d="{pen.getCommands()}"/>')
    x += glyphs[name].width * scale + adjust
width = round(x + 10, 4)
viewbox = f"0 0 {width} 115"
outline = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}"><title>verlark</title><g fill="#000000">' + "".join(paths) + '</g></svg>\n'
(ROOT / 'source/wordmark-outline.svg').write_text(outline)
font64 = base64.b64encode(font_path.read_bytes()).decode()
xs = " ".join(map(str, positions))
editable = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">
<title>verlark — text editable Manrope wordmark</title>
<style>@font-face{{font-family:VerlarkManrope;src:url(data:font/ttf;base64,{font64}) format('truetype');font-weight:200 800}}text{{font-family:VerlarkManrope;font-size:100px;font-weight:650;font-kerning:none;font-variant-ligatures:none}}</style>
<text x="{xs}" y="95" fill="#000000">verlark</text>
</svg>\n'''
(ROOT / 'source/wordmark-text.svg').write_text(editable)
(ROOT / 'source/wordmark-metrics.json').write_text(json.dumps({'font':'Manrope','weight':650,'size':100,'unitsPerEm':units,'text':'verlark','positions':positions,'width':width,'height':115,'baseline':95},indent=2)+'\n')
print(json.dumps({'wordmarkWidth':width,'glyphs':len(paths),'fontWeight':650}))
