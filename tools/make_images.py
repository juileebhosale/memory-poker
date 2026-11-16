"""Generate Memory Poker images in the game's colours.

Writes into memory-poker/:
  og-image.png          1200x630 link preview (Open Graph / Twitter)
  favicon-32.png        32x32 browser tab icon (fallback for favicon.svg)
  apple-touch-icon.png  180x180 home-screen icon

Needs Pillow:   pip install pillow
Run from repo root:   python3 tools/make_images.py

Suits are drawn as shapes, so no special font is needed for them. Text uses the
first bold font found below, or Pillow's built-in font as a last resort.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "memory-poker"

# Same colours as memory-poker/styles.css
BG = (15, 81, 50)          # --bg
BG_DARK = (11, 61, 38)     # --bg-dark
TEXT = (244, 244, 240)     # --text
MUTED = (185, 211, 196)    # --muted
CARD_FACE = (253, 253, 251)
CARD_BACK = (29, 53, 87)
CARD_BACK_2 = (39, 75, 120)
RED = (200, 16, 46)
BLACK = (26, 26, 26)
ACCENT = (255, 200, 61)

S = 2  # draw at 2x, then shrink, for smooth edges

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf",
    "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
    "/Library/Fonts/Inter-Bold.otf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]
FONT_REGULAR_CANDIDATES = [
    "/usr/share/fonts/opentype/inter/Inter-Medium.otf",
    "/Library/Fonts/Inter-Medium.otf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def font(size, bold=True):
    for path in FONT_CANDIDATES if bold else FONT_REGULAR_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


# ---------- Shapes ----------

def suit(d, kind, cx, cy, size, fill):
    """Draw a suit symbol centred at (cx, cy); size = overall height."""
    r = size * 0.27
    if kind == "d":
        h, w = size / 2, size * 0.38
        d.polygon([(cx, cy - h), (cx + w, cy), (cx, cy + h), (cx - w, cy)], fill=fill)
    elif kind == "h":
        top = cy - size * 0.22
        for dx in (-r, r):
            d.ellipse([cx + dx - r, top - r, cx + dx + r, top + r], fill=fill)
        d.polygon([(cx - 2 * r, top + r * 0.15), (cx + 2 * r, top + r * 0.15), (cx, cy + size / 2)], fill=fill)
    elif kind == "s":
        bot = cy + size * 0.08
        for dx in (-r, r):
            d.ellipse([cx + dx - r, bot - r, cx + dx + r, bot + r], fill=fill)
        d.polygon([(cx - 2 * r, bot - r * 0.15), (cx + 2 * r, bot - r * 0.15), (cx, cy - size / 2)], fill=fill)
        d.polygon([(cx, bot), (cx - r * 0.8, cy + size / 2), (cx + r * 0.8, cy + size / 2)], fill=fill)
    elif kind == "c":
        cr = size * 0.22
        for (dx, dy) in ((0, -0.24), (-0.24, 0.06), (0.24, 0.06)):
            x, y = cx + dx * size, cy + dy * size
            d.ellipse([x - cr, y - cr, x + cr, y + cr], fill=fill)
        d.polygon([(cx, cy), (cx - cr * 0.9, cy + size / 2), (cx + cr * 0.9, cy + size / 2)], fill=fill)


def shadow(img, box, radius, offset, blur_alpha=70):
    x0, y0, x1, y1 = box
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        [x0, y0 + offset, x1, y1 + offset], radius, fill=(0, 0, 0, blur_alpha))
    img.alpha_composite(layer)


def face_card(img, x, y, w, h, rank, kind):
    d = ImageDraw.Draw(img)
    rad = w * 0.11
    shadow(img, (x, y, x + w, y + h), rad, w * 0.04)
    d.rounded_rectangle([x, y, x + w, y + h], rad, fill=CARD_FACE)
    color = RED if kind in "hd" else BLACK
    f = font(int(w * 0.24))
    d.text((x + w * 0.1, y + w * 0.07), rank, font=f, fill=color)
    suit(d, kind, x + w * 0.1 + w * 0.08, y + w * 0.47, w * 0.15, color)
    suit(d, kind, x + w / 2, y + h * 0.58, w * 0.46, color)


def back_card(img, x, y, w, h, letter, marker=None):
    rad = w * 0.11
    shadow(img, (x, y, x + w, y + h), rad, w * 0.04)
    # Striped back, clipped to a rounded rectangle.
    stripes = Image.new("RGBA", (int(w), int(h)), CARD_BACK)
    sd = ImageDraw.Draw(stripes)
    step = w * 0.09
    i = -h
    while i < w + h:
        sd.polygon([(i, 0), (i + step, 0), (i + step - h, h), (i - h, h)], fill=CARD_BACK_2)
        i += step * 2
    mask = Image.new("L", stripes.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], rad, fill=255)
    img.paste(stripes, (int(x), int(y)), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x, y, x + w, y + h], rad, outline=CARD_FACE, width=int(w * 0.035))
    f = font(int(w * 0.38))
    d.text((x + w / 2, y + h / 2), letter, font=f, fill=TEXT, anchor="mm")
    if marker:
        # Yellow ring + numbered badge, like a placed marker in the game.
        d.rounded_rectangle([x - w * 0.04, y - w * 0.04, x + w * 1.04, y + h + w * 0.04],
                            rad * 1.2, outline=ACCENT, width=int(w * 0.035))
        br = w * 0.17
        bx, by = x + w - br * 0.3, y + br * 0.3
        d.ellipse([bx - br, by - br, bx + br, by + br], fill=ACCENT)
        d.text((bx, by), marker, font=font(int(br * 1.15)), fill=BLACK, anchor="mm")


def background(w, h):
    """Radial gradient from --bg (top centre) to --bg-dark."""
    mask = Image.radial_gradient("L").resize((int(w * 1.6), int(h * 2.4)))
    mask = mask.crop((int(w * 0.3), 0, int(w * 0.3) + w, h))
    return Image.composite(Image.new("RGBA", (w, h), BG_DARK), Image.new("RGBA", (w, h), BG), mask)


# ---------- Images ----------

def og_image():
    W, H = 1200 * S, 630 * S
    img = background(W, H)
    d = ImageDraw.Draw(img)

    d.text((W / 2, 118 * S), "Memory Poker", font=font(96 * S), fill=TEXT, anchor="mm")
    d.text((W / 2, 200 * S), "Memorize the cards. Pick 2. Make the best hand.",
           font=font(34 * S, bold=False), fill=MUTED, anchor="mm")

    cw, ch, gap, group_gap = 150 * S, 210 * S, 24 * S, 70 * S
    total = 5 * cw + 3 * gap + group_gap
    x = (W - total) / 2
    y = 300 * S
    back_card(img, x, y, cw, ch, "B", marker="1")
    back_card(img, x + cw + gap, y, cw, ch, "G", marker="2")
    # "+" between the hidden picks and the open cards
    px = x + 2 * cw + gap + group_gap / 2
    d.text((px, y + ch / 2), "+", font=font(64 * S), fill=MUTED, anchor="mm")
    ox = x + 2 * cw + gap + group_gap
    for i, (rank, kind) in enumerate([("A", "h"), ("K", "h"), ("Q", "h")]):
        face_card(img, ox + i * (cw + gap), y, cw, ch, rank, kind)

    img.convert("RGB").resize((1200, 630), Image.LANCZOS).save(OUT / "og-image.png", optimize=True)


def icon(size, name):
    big = 512
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], 110, fill=BG)
    # A white card with a black spade and a yellow marker dot.
    cw, ch = 300, 400
    x, y = (big - cw) / 2, (big - ch) / 2
    d.rounded_rectangle([x, y, x + cw, y + ch], 40, fill=CARD_FACE)
    suit(d, "s", big / 2, big / 2 + 10, 210, BLACK)
    d.ellipse([x + cw - 70, y - 30, x + cw + 30, y + 70], fill=ACCENT)
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    og_image()
    icon(32, "favicon-32.png")
    icon(180, "apple-touch-icon.png")
    print("Wrote og-image.png, favicon-32.png, apple-touch-icon.png to", OUT)
