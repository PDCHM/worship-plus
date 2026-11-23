"""Generate iOS PWA startup images (apple-touch-startup-image) into public/splash.

iOS ignores the manifest's background_color, so without these an installed
Worship+ launches on a white screen. Each image is the app's dark splash
(#020617) with the REAL public/icon-512.png composited, unmodified, at the same
size and centre as the in-app LaunchSplash (160pt below 768pt wide, 224pt
from 768pt up), so the OS → app handoff doesn't move or resize the logo.

Run:  python3 scripts/gen-ios-splash.py   (needs Pillow)
Also prints the startupImage list used in app/layout.tsx.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICON = Image.open(ROOT / "public/icon-512.png").convert("RGBA")
OUT = ROOT / "public/splash"
BG = (2, 6, 23, 255)  # #020617 — manifest background_color / .wp-splash

# (css width, css height, device pixel ratio, has landscape)
DEVICES = [
    (440, 956, 3, False),  # iPhone 16 Pro Max
    (402, 874, 3, False),  # iPhone 16 Pro
    (430, 932, 3, False),  # iPhone 14 Pro Max, 15 Plus / Pro Max, 16 Plus
    (393, 852, 3, False),  # iPhone 14 Pro, 15, 15 Pro, 16
    (428, 926, 3, False),  # iPhone 12/13 Pro Max, 14 Plus
    (390, 844, 3, False),  # iPhone 12, 13, 14, 12/13 Pro
    (375, 812, 3, False),  # iPhone X, XS, 11 Pro, 12/13 mini
    (414, 896, 3, False),  # iPhone XS Max, 11 Pro Max
    (414, 896, 2, False),  # iPhone XR, 11
    (414, 736, 3, False),  # iPhone 6/7/8 Plus
    (375, 667, 2, False),  # iPhone 6/7/8, SE 2/3
    (320, 568, 2, False),  # iPhone SE 1
    (1032, 1376, 2, True),  # iPad Pro 13" (M4)
    (1024, 1366, 2, True),  # iPad Pro 12.9"
    (834, 1210, 2, True),  # iPad Pro 11" (M4)
    (834, 1194, 2, True),  # iPad Pro 11"
    (820, 1180, 2, True),  # iPad Air 4/5, iPad 10
    (834, 1112, 2, True),  # iPad Air 3, Pro 10.5"
    (810, 1080, 2, True),  # iPad 7/8/9
    (768, 1024, 2, True),  # iPad mini 5, older iPads
    (744, 1133, 2, True),  # iPad mini 6
]


def render(w, h, dpr):
    size_pt = 224 if w >= 768 else 160
    px = size_pt * dpr
    icon = ICON if px == ICON.width else ICON.resize((px, px), Image.LANCZOS)
    canvas = Image.new("RGBA", (w * dpr, h * dpr), BG)
    canvas.alpha_composite(icon, ((w * dpr - px) // 2, (h * dpr - px) // 2))
    return canvas.convert("RGB")


entries = []
for w, h, dpr, landscape in DEVICES:
    for orient in (["portrait", "landscape"] if landscape else ["portrait"]):
        cw, ch = (w, h) if orient == "portrait" else (h, w)
        name = f"splash-{cw}x{ch}@{dpr}x.png"
        render(cw, ch, dpr).save(OUT / name, optimize=True)
        media = (f"(device-width: {w}px) and (device-height: {h}px) and "
                 f"(-webkit-device-pixel-ratio: {dpr}) and (orientation: {orient})")
        entries.append((f"/splash/{name}", media))

for url, media in entries:
    print(f'    {{ url: "{url}", media: "{media}" }},')
