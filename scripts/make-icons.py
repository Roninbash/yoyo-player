"""Draws the YoYo Player logo: a yo-yo hanging from its string.

    python3 scripts/make-icons.py

Writes the extension icons (src/icons/), the full-size logo (assets/logo.png) and,
when the Safari project exists, the Mac app icons. Needs Pillow (pip install Pillow).
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
TOP, BOTTOM = (255, 122, 69), (240, 36, 90)  # background gradient
DEEP = (200, 23, 74)                         # yo-yo's inner disc
BACK = (255, 196, 210)                       # far half of the yo-yo
WHITE = (255, 255, 255)
SUPERSAMPLE = 8


def logo(size, padding=0.0):
    """The logo at `size` px. `padding` is the fraction of empty space around the tile."""
    s = size * SUPERSAMPLE
    small = size <= 32  # thicker lines and no finger loop so it still reads at toolbar size

    tile = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    gradient = Image.new('RGBA', (s, s))
    g = ImageDraw.Draw(gradient)
    for y in range(s):
        t = y / (s - 1)
        g.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * 0.225), fill=255)
    tile.paste(gradient, (0, 0), mask)

    d = ImageDraw.Draw(tile)
    u = lambda f: round(f * s)  # noqa: E731  unit -> pixels
    disc = lambda x, y, rad, **kw: d.ellipse([u(x - rad), u(y - rad), u(x + rad), u(y + rad)], **kw)  # noqa: E731
    r = 0.31 if small else 0.28
    cx, cy = 0.46, 0.60
    depth = 0.07 if small else 0.08  # how far the back half shows, for a three-quarter view
    string_w = 0.085 if small else 0.034

    # Back half, then the string running into the gap, then the front half over it.
    disc(cx + depth, cy - depth * 0.35, r, fill=BACK)
    d.line([(u(cx + depth * 0.5 + 0.10), 0), (u(cx + depth * 0.5), u(cy - depth * 0.2))],
           fill=WHITE, width=u(string_w))
    disc(cx, cy, r, fill=WHITE)
    disc(cx, cy, r * 0.62, fill=DEEP)
    disc(cx, cy, r * 0.24, fill=WHITE)
    if not small:
        # A soft shine on the rim.
        shine = r * 0.84
        d.arc([u(cx - shine), u(cy - shine), u(cx + shine), u(cy + shine)], start=200, end=250,
              fill=(255, 220, 228), width=u(0.022))

    tile = tile.resize((size, size), Image.LANCZOS)
    if not padding:
        return tile
    inner_size = round(size * (1 - 2 * padding))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(tile.resize((inner_size, inner_size), Image.LANCZOS), ((size - inner_size) // 2,) * 2)
    return out


def main():
    icons = ROOT / 'src' / 'icons'
    for n in (16, 32, 48, 128):
        # Chrome's guidelines leave a little transparent margin on the larger icons.
        logo(n, padding=0 if n <= 32 else 0.0625).save(icons / f'icon{n}.png')
    (ROOT / 'assets').mkdir(exist_ok=True)
    logo(1024).save(ROOT / 'assets' / 'logo.png')

    # Mac app icons: macOS draws app icons at about 80% of the canvas.
    for appiconset in ROOT.glob('safari/*/*/Assets.xcassets/AppIcon.appiconset'):
        contents = json.loads((appiconset / 'Contents.json').read_text())
        for image in contents['images']:
            if 'filename' not in image:
                continue
            points = float(image['size'].split('x')[0])
            scale = int(image['scale'].rstrip('x'))
            logo(round(points * scale), padding=0.1).save(appiconset / image['filename'])
        resources = appiconset.parent.parent / 'Resources'
        if (resources / 'Icon.png').exists():
            logo(256, padding=0.1).save(resources / 'Icon.png')
    print('icons written')


if __name__ == '__main__':
    main()
