#!/usr/bin/env python3
"""
Ash Stair layout preview.

  python3 dev/content/dungeon-preview.py              -> docs/rpg-dungeon-ash-stair.png (flat-colour schematic, committed)
  python3 dev/content/dungeon-preview.py --art OUT    -> OUT rendered with the real sheet art (NOT committed;
                                                         default /workspace/rpg-content-preview/ash_stair_art.png)

Reads the dungeon through node (js/rpg/content/index.js), so the picture is
always the shipped data. Schematic: 16x9 px per tile (half of GD's 32x18).
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
JS = r"""
const C=require(process.argv[1]);const D=C.Dungeon;
console.log(JSON.stringify({rows:D.rows,props:D.props,spawns:D.spawns,entry:D.entry,exits:D.exits,rooms:D.rooms,bossRoom:D.bossRoom,
 keyGrid:D.keyGrid(),walk:D.walkSeconds(D.entry,{x:11,y:67}),legend:D.legend,
 path:(function(){const d=D.bfs(D.entry);return Array.from(d).map(v=>v===Infinity?-1:v);})(), w:D.width,h:D.height}));
"""

def load():
    out = subprocess.check_output(['node', '-e', JS, os.path.join(REPO, 'js/rpg/content/index.js')])
    return json.loads(out)

COL = {'.': (38, 52, 36), 's': (128, 128, 122), 'd': (120, 92, 60), 'c': (170, 160, 140)}
MON = {'skeleton': (226, 226, 210), 'imp': (230, 110, 40), 'brute': (200, 60, 200), 'ashmaw': (230, 30, 40)}

def schematic(d, out):
    TW, TH = 16, 9
    W, H = d['w'] * TW, d['h'] * TH
    pad_r = 150
    img = Image.new('RGB', (W + pad_r, H), (20, 20, 22))
    g = ImageDraw.Draw(img)
    for y, row in enumerate(d['rows']):
        for x, ch in enumerate(row):
            g.rectangle([x * TW, y * TH, x * TW + TW - 1, y * TH + TH - 1], fill=COL[ch])
    for p in d['props']:
        if p.get('decor'):
            c = (60, 70, 50) if 'wall' not in p['key'] else (90, 84, 76)
        else:
            c = (60, 60, 60) if p.get('block') else (150, 140, 110)
        if 'stairs' in p['key']:
            c = (80, 140, 230)
        if 'brazier' in p['key']:
            c = (240, 170, 60)
        g.rectangle([p['x'] * TW + 3, p['y'] * TH + 1, p['x'] * TW + TW - 4, p['y'] * TH + TH - 2], fill=c)
    br = d['bossRoom']
    g.rectangle([br['x'] * TW, br['y'] * TH, (br['x'] + br['w']) * TW - 1, (br['y'] + br['h']) * TH - 1], outline=(230, 30, 40), width=2)
    for s in d['spawns']:
        cx, cy = s['x'] * TW + TW // 2, s['y'] * TH + TH // 2
        r = 7 if s['monsterId'] in ('brute', 'ashmaw') else 4
        g.ellipse([cx - r, cy - r, cx + r, cy + r], fill=MON[s['monsterId']], outline=(0, 0, 0))
    e = d['entry']
    g.rectangle([e['x'] * TW + 2, e['y'] * TH + 1, e['x'] * TW + TW - 3, e['y'] * TH + TH - 2], outline=(60, 230, 90), width=2)
    for r in d['rooms']:
        g.text((r['x'] * TW + 3, r['y'] * TH + 2), r['id'], fill=(255, 255, 255))
    lx = W + 8
    lines = [('The Ash Stair', (255, 255, 255)), ('%dx%d tiles' % (d['w'], d['h']), (200, 200, 200)),
             ('walk entry->boss', (200, 200, 200)), ('%.1f s (GD metric)' % d['walk'], (200, 200, 200)), ('', None),
             ('entry', (60, 230, 90)), ('stairs = exit', (80, 140, 230)), ('boss room', (230, 30, 40)),
             ('skeleton pack', MON['skeleton']), ('imp pack', MON['imp']), ('brute', MON['brute']), ('ashmaw', MON['ashmaw']),
             ('brazier', (240, 170, 60)), ('blocking prop', (60, 60, 60)), ('stone floor', COL['s']), ('dirt corridor', COL['d']),
             ('cobble landing', COL['c']), ('grass void', (70, 95, 66))]
    y = 8
    for t, c in lines:
        if c:
            g.text((lx, y), t, fill=c)
        y += 14
    img.save(out, optimize=True)
    return out

def art(d, out):
    sheets = {}
    for name in ('phaseb', 'town'):
        base = '/workspace/rsc-look/%s/' % name
        meta = json.load(open(base + 'sheet.json'))
        img = Image.open(base + meta.get('meta', {}).get('image', 'sheet.png')).convert('RGBA')
        sheets[name] = (meta['frames'], img)
    def sprite(key):
        for fr, img in sheets.values():
            if key in fr:
                f = fr[key]
                f = f.get('frame', f)
                x, y, w, h = f['x'], f['y'], f['w'], f['h']
                return img.crop((x, y, x + w, y + h))
        raise KeyError(key)
    TW, TH = 32, 18
    canvas = Image.new('RGBA', (d['w'] * TW, d['h'] * TH), (0, 0, 0, 255))
    for y, row in enumerate(d['keyGrid']):
        for x, cell in enumerate(row):
            canvas.alpha_composite(sprite(cell['base']), (x * TW, y * TH))
            for k in cell['edges']:
                canvas.alpha_composite(sprite(k), (x * TW, y * TH))
    for p in sorted(d['props'], key=lambda p: p['y']):
        s = sprite(p['key'])
        if p.get('tile'):
            canvas.alpha_composite(s, (p['x'] * TW - 1, p['y'] * TH - 1))
        else:
            fx, fy = int((p['x'] + 0.5) * TW), (p['y'] + 1) * TH - 4
            canvas.alpha_composite(s, (fx - s.width // 2, max(0, fy - s.height + 2)))
    g = ImageDraw.Draw(canvas)
    for s in d['spawns']:
        cx, cy = int((s['x'] + 0.5) * TW), int((s['y'] + 0.5) * TH)
        g.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], outline=MON[s['monsterId']] + (255,), width=2)
    canvas.convert('RGB').save(out, optimize=True)
    return out

if __name__ == '__main__':
    d = load()
    if '--art' in sys.argv:
        i = sys.argv.index('--art')
        out = sys.argv[i + 1] if len(sys.argv) > i + 1 else '/workspace/rpg-content-preview/ash_stair_art.png'
        os.makedirs(os.path.dirname(out), exist_ok=True)
        print(art(d, out))
    else:
        print(schematic(d, os.path.join(REPO, 'docs', 'rpg-dungeon-ash-stair.png')))
