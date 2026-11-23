"""Generate iOS PWA startup images (apple-touch-startup-image) into public/splash.

iOS ignores the manifest's background_color, so without these an installed
Worship+ launches on a white/gray screen. Each image is PLAIN #020617 (the
in-app splash colour) with NO logo: the in-app LaunchSplash is the only thing
that draws the W+ icon, so it appears exactly once (a logo baked into the
launch image could never be pixel-aligned with the in-app one and showed twice).

Run:  python3 scripts/gen-ios-splash.py   (needs Pillow)
Also prints the startupImage list used in app/layout.tsx.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/splash"
BG = (2, 6, 23, 255)  # #020617 — manifest background_color / .wp-splash

# (css width, css height, device pixel ratio, has landscape)
DEVICES = [
    (440, 956, 3, False),  # iPhone 16/17 Pro Max
    (420, 912, 3, False),  # iPhone Air
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
    return Image.new("RGB", (w * dpr, h * dpr), BG[:3])


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
