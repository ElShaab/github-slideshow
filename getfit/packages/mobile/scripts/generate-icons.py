#!/usr/bin/env python3
"""
Generates the app icon, Android adaptive foreground and splash artwork.

The assets are produced from code rather than checked in as opaque binaries so
the brand marks can be regenerated when the palette changes. Everything is
drawn at 4x and downsampled, which is what gives the curves clean edges.

    python3 scripts/generate-icons.py

Outputs into assets/:
    icon.png            1024x1024, fully opaque (the App Store rejects alpha)
    adaptive-icon.png   1024x1024 with alpha, artwork inside the safe circle
    splash.png          1024x1024 with alpha, centred on the launch background
    favicon.png         48x48 for the web build
"""

from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw

# The product palette, matching packages/mobile/src/theme/palette.ts.
# BACKGROUND is AZURE[700] and BACKGROUND_LIFT is AZURE[500] — the deep and
# bright ends of the field the app is painted on, so the icon and the splash
# are the same blue the first screen fades up from.
BACKGROUND = (6, 42, 102)
BACKGROUND_LIFT = (10, 70, 147)
ACCENT = (34, 227, 242)
ACCENT_DEEP = (10, 147, 172)  # reserved for future marks

SUPERSAMPLE = 4
OUT = os.path.join(os.path.dirname(__file__), "..", "assets")


def radial_background(size: int) -> Image.Image:
    """Deep azure ground with a bloom behind the mark, so it is not flat."""
    image = Image.new("RGB", (size, size), BACKGROUND)
    pixels = image.load()
    centre = size / 2
    longest = math.hypot(centre, centre)

    for y in range(size):
        for x in range(size):
            distance = math.hypot(x - centre, y - centre) / longest
            weight = max(0.0, 1.0 - distance * 1.35) ** 2
            pixels[x, y] = tuple(
                round(BACKGROUND[i] + (BACKGROUND_LIFT[i] - BACKGROUND[i]) * weight)
                for i in range(3)
            )
    return image


def draw_mark(draw: ImageDraw.ImageDraw, size: int, scale: float = 1.0) -> None:
    """
    The GetFit mark: an open scan ring around three ascending bars.

    The ring echoes the body-scan and rest-timer rings in the app; the bars read
    as progress. Both are heavy enough to survive being shown at 40 points.
    """
    centre = size / 2
    ring_radius = size * 0.33 * scale
    ring_width = size * 0.072 * scale

    box = [
        centre - ring_radius,
        centre - ring_radius,
        centre + ring_radius,
        centre + ring_radius,
    ]

    # Open at the top right, which keeps the silhouette from reading as a plain
    # circle at small sizes.
    draw.arc(box, start=305, end=215, fill=ACCENT, width=round(ring_width))

    # Three ascending bars, bottom-aligned.
    bar_width = size * 0.062 * scale
    gap = size * 0.038 * scale
    heights = [size * 0.115 * scale, size * 0.185 * scale, size * 0.255 * scale]
    total_width = bar_width * 3 + gap * 2
    left = centre - total_width / 2
    baseline = centre + size * 0.135 * scale
    radius = bar_width / 2

    for index, height in enumerate(heights):
        x0 = left + index * (bar_width + gap)
        draw.rounded_rectangle(
            [x0, baseline - height, x0 + bar_width, baseline],
            radius=radius,
            fill=ACCENT if index == 2 else (255, 255, 255),
        )


def render(size: int, *, opaque: bool, scale: float = 1.0) -> Image.Image:
    work = size * SUPERSAMPLE

    if opaque:
        canvas = radial_background(work)
    else:
        canvas = Image.new("RGBA", (work, work), (0, 0, 0, 0))

    draw = ImageDraw.Draw(canvas)
    draw_mark(draw, work, scale)
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    # App Store icons must be fully opaque with no transparency.
    render(1024, opaque=True).save(os.path.join(OUT, "icon.png"))

    # Android masks the adaptive foreground to a circle and crops roughly a
    # third, so the mark is drawn smaller to stay inside the safe zone.
    render(1024, opaque=False, scale=0.62).save(os.path.join(OUT, "adaptive-icon.png"))

    # The splash sits on the launch background colour, so only the mark is drawn.
    render(1024, opaque=False, scale=0.78).save(os.path.join(OUT, "splash.png"))

    render(48, opaque=True).save(os.path.join(OUT, "favicon.png"))

    for name in ("icon.png", "adaptive-icon.png", "splash.png", "favicon.png"):
        path = os.path.join(OUT, name)
        with Image.open(path) as image:
            print(f"  {name:<20} {image.size[0]}x{image.size[1]} {image.mode}")


if __name__ == "__main__":
    main()
