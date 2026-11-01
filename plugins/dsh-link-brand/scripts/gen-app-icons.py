#!/usr/bin/env python3
"""Generate the application icon ladder for DSH Link from the brand artwork.

    python plugins/dsh-link-brand/scripts/gen-app-icons.py

The geometry is the convention the upstream desktop icon uses, measured from
`apps/desktop/resources/icon-windows.svg` and `icon-macos.svg` — the plate and its
corner radius, not the artwork:

  Windows   plate 93.75% of the canvas, corner radius 18.75% of the plate
  macOS     plate 80.47% of the canvas, corner radius 22.46% of the plate

Every icon is therefore a white (#FBFBFB) rounded rectangle with the DSH Link symbol
centred at 84% of the plate. A plate rather than a bare mark is the point: the taskbar,
the tray and Explorer draw the icon over their own surface, and the mark's ink is dark,
so an unplated mark disappears on a dark taskbar.

Writes, all from the renders in `assets/`:

  assets/plated/windows-<n>.png   the Windows ladder, 16 … 1024
  assets/plated/macos-<n>.png     the macOS ladder (its own plate geometry)
  src-tauri/icons/*.png           the slots Tauri and the Windows Store packages name
  src-tauri/icons/icon.ico        16, 24, 32, 48, 64, 128, 256 (PNG frames)
  src-tauri/icons/icon.icns       ic07…ic12 (128, 256, 512, 1024, 64, 32)

Replacing an icon is not enough on its own: the executable's icon is a Windows resource
built by `tauri_build`, so `src-tauri/build.rs` declares `icons` as an input and cargo
rebuilds and relinks it. Run `cargo build` (or the debug launcher) afterwards.
"""
import os
import struct
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(PLUGIN))
ASSETS = os.path.join(PLUGIN, 'assets')
PLATED = os.path.join(ASSETS, 'plated')
ICONS = os.path.join(REPO, 'src-tauri', 'icons')

# Measured from the upstream icon artwork: plate share of the canvas, and corner
# radius as a share of the plate.
PROFILES = {
    'windows': {'plate': 0.9375, 'radius': 0.1875},
    'macos': {'plate': 0.8046875, 'radius': 0.2246},
}
PLATE_FILL = (251, 251, 251, 255)   # #FBFBFB, the upstream plate colour
GLYPH_SHARE = 0.84                  # the mark's share of the plate
SUPERSAMPLE = 4                     # for the plate's rounded corners

# The mark's own renders, hand-tuned by the design at the small sizes; each target
# takes the smallest render that still covers it, so nothing is upscaled needlessly.
SYMBOL_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

# Slots uTauri and the Windows Store packaging name, as size in pixels.
PNG_SLOTS = {
    '32x32.png': 32, '64x64.png': 64, '128x128.png': 128, '128x128@2x.png': 256,
    'icon.png': 512,
    'Square30x30Logo.png': 32, 'Square44x44Logo.png': 48, 'Square71x71Logo.png': 128,
    'Square89x89Logo.png': 128, 'Square107x107Logo.png': 128, 'Square142x142Logo.png': 256,
    'Square150x150Logo.png': 256, 'Square284x284Logo.png': 512, 'Square310x310Logo.png': 512,
    'StoreLogo.png': 48,
}

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICNS_SIZES = {'ic07': 128, 'ic08': 256, 'ic09': 512, 'ic10': 1024, 'ic11': 32, 'ic12': 64}
LADDER = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

_masters = {}


def symbol(size_px):
    """The mark's render covering `size_px`, scaled to it."""
    render = next((s for s in SYMBOL_SIZES if s >= size_px), SYMBOL_SIZES[-1])
    if render not in _masters:
        _masters[render] = Image.open(os.path.join(ASSETS, 'symbol-v2-%d.png' % render)).convert('RGBA')
    master = _masters[render]
    if master.width == size_px:
        return master
    return master.resize((size_px, size_px), Image.LANCZOS)


def plated(size, profile):
    """One icon: the white plate with the mark centred on it."""
    spec = PROFILES[profile]
    plate = int(round(size * spec['plate']))
    radius = max(1, int(round(plate * spec['radius'])))
    margin = (size - plate) // 2
    # The plate's corner is the only curved edge in the icon, so it is drawn
    # supersampled and reduced; the mark is reduced straight from its own render.
    big = plate * SUPERSAMPLE
    layer = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle((0, 0, big - 1, big - 1), radius=radius * SUPERSAMPLE, fill=PLATE_FILL)
    layer = layer.resize((plate, plate), Image.LANCZOS)
    glyph = symbol(max(8, int(round(plate * GLYPH_SHARE))))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(layer, (margin, margin))
    offset = margin + (plate - glyph.width) // 2
    canvas.alpha_composite(glyph, (offset, offset))
    return canvas


def write_png(image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, 'PNG', optimize=True)
    return os.path.getsize(path)


def write_ico(images, path):
    """An ICO with PNG-compressed frames, smallest first."""
    header = struct.pack('<HHH', 0, 1, len(images))
    entries, payloads, offset = b'', b'', 6 + 16 * len(images)
    for size, image in images:
        payload = _png_bytes(image)
        entries += struct.pack('<BBBBHHII', 0 if size >= 256 else size, 0 if size >= 256 else size,
                               0, 0, 1, 32, len(payload), offset)
        payloads += payload
        offset += len(payload)
    with open(path, 'wb') as handle:
        handle.write(header + entries + payloads)
    return os.path.getsize(path)


def write_icns(images, path):
    """An ICNS: each type is one PNG payload, four-byte length prefixed."""
    body = b''
    for kind, (_, image) in images:
        payload = _png_bytes(image)
        body += kind.encode('ascii') + struct.pack('>I', len(payload) + 8) + payload
    with open(path, 'wb') as handle:
        handle.write(b'icns' + struct.pack('>I', len(body) + 8) + body)
    return os.path.getsize(path)


def _png_bytes(image):
    import io
    buffer = io.BytesIO()
    image.save(buffer, 'PNG', optimize=True)
    return buffer.getvalue()


def main():
    print('Pillow %s' % Image.__version__)
    windows = {size: plated(size, 'windows') for size in LADDER}
    macos = {size: plated(size, 'macos') for size in LADDER}
    for profile, ladder in (('windows', windows), ('macos', macos)):
        for size, image in ladder.items():
            path = os.path.join(PLATED, '%s-%d.png' % (profile, size))
            print('  %-28s %d bytes' % (os.path.relpath(path, REPO), write_png(image, path)))
    for name, size in PNG_SLOTS.items():
        path = os.path.join(ICONS, name)
        print('  %-28s %d bytes' % (os.path.relpath(path, REPO), write_png(windows[size], path)))
    ico = os.path.join(ICONS, 'icon.ico')
    print('  %-28s %d bytes' % (os.path.relpath(ico, REPO), write_ico([(s, windows[s]) for s in ICO_SIZES], ico)))
    icns = os.path.join(ICONS, 'icon.icns')
    print('  %-28s %d bytes' % (os.path.relpath(icns, REPO), write_icns([(k, (k, macos[s])) for k, s in ICNS_SIZES.items()], icns)))


main()
