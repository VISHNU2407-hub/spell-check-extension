"""Generate simple AutoCorrect AI icons (gradient + white 'A') using only stdlib."""
import zlib
import struct
import os

FONT = {
    'A': [
        '01110',
        '10001',
        '10001',
        '11111',
        '10001',
        '10001',
        '10001',
    ]
}

def lerp(a, b, t):
    return int(a + (b - a) * t)

def make_icon(size, path):
    # gradient from indigo (91,108,255) to purple (157,107,255), diagonal
    scale = size // 32  # letter pixel scale
    glyph = FONT['A']
    gw, gh = 5 * scale, 7 * scale
    ox = (size - gw) // 2
    oy = (size - gh) // 2
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter byte
        for x in range(size):
            t = (x + y) / (2 * size)
            r = lerp(91, 157, t)
            g = lerp(108, 107, t)
            b = lerp(255, 255, t)
            # rounded corners: transparent outside radius
            rad = size * 0.22
            cx = min(x, size - 1 - x)
            cy = min(y, size - 1 - y)
            corner = min(cx, cy)
            alpha = 255
            if cx < 0 or cy < 0:
                alpha = 0
            elif x < rad and y < rad:
                dx, dy = rad - x, rad - y
                if dx * dx + dy * dy > rad * rad:
                    alpha = 0
            elif x >= size - rad and y < rad:
                dx, dy = x - (size - rad), rad - y
                if dx * dx + dy * dy > rad * rad:
                    alpha = 0
            elif x < rad and y >= size - rad:
                dx, dy = rad - x, y - (size - rad)
                if dx * dx + dy * dy > rad * rad:
                    alpha = 0
            elif x >= size - rad and y >= size - rad:
                dx, dy = x - (size - rad), y - (size - rad)
                if dx * dx + dy * dy > rad * rad:
                    alpha = 0
            # letter mask
            gx, gy = x - ox, y - oy
            if 0 <= gx < gw and 0 <= gy < gh:
                if glyph[gy // scale][gx // scale] == '1':
                    r, g, b = 255, 255, 255
            raw.extend((r, g, b, alpha))

    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        c += struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'wrote {path} ({len(png)} bytes)')

base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'icons')
os.makedirs(base, exist_ok=True)
for s in (16, 48, 128):
    make_icon(s, os.path.join(base, f'icon{s}.png'))
