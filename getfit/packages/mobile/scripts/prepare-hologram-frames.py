#!/usr/bin/env python3
"""
Turns rendered hologram frames into app assets.

The renders arrive as opaque images on a near-black navy background. The app
draws them over a bright blue field, so they need three things done to them:
the background keyed out to alpha, the figure cropped and scaled to a common
frame, and the result sized for a phone rather than a render farm.

    python3 scripts/prepare-hologram-frames.py <source-dir> [--out assets/hologram]

Keying a glow is not the same as keying a photo. There is no hard edge to find:
the figure fades into its own halo, and a threshold that looks clean on the
torso eats the halo entirely. So alpha comes from luminance above the
background, with a gamma that keeps the faint outer glow rather than clipping
it, and the colour is left alone — the app composites these additively, which
is how a hologram behaves and why the dark interior is supposed to let the
field show through.

Frames are normalised by the height of the figure, not by the canvas. The
renders are framed inconsistently, and a figure that changes size between body
fat bands would read as the user growing rather than gaining.
"""

from __future__ import annotations

import argparse
import os
import sys

from PIL import Image

# A hologram is additive light: drawn over the app's blue field it should get
# brighter, not replace what is behind it. React Native's <Image> only blends
# normally, so the additive result is baked in here instead — a steeper alpha
# curve to stop the field washing the body out, and a brightness lift to make
# up the light that adding would have contributed. Tuned by compositing both
# ways against the real field and comparing.
ALPHA_GAMMA = 0.38
BRIGHTNESS = 1.45

# The canvas every frame is normalised onto. Portrait, and twice as tall as it
# is wide, which is roughly a standing figure with its arms clear of the body.
CANVAS = (640, 1280)
# How much of the canvas height the figure fills, leaving room for the halo.
FIGURE_HEIGHT = 0.88


def luminance(pixel: tuple[int, int, int]) -> float:
    r, g, b = pixel
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def background_level(image: Image.Image) -> float:
    """The darkest corner, taken as the background the figure was rendered on."""
    w, h = image.size
    px = image.load()
    corners = [px[3, 3], px[w - 4, 3], px[3, h - 4], px[w - 4, h - 4]]
    return min(luminance(c) for c in corners)


def key_background(image: Image.Image) -> Image.Image:
    """Alpha from luminance above the background, keeping the halo."""
    rgb = image.convert('RGB')
    floor = background_level(rgb)
    # The top of the range is set from the image rather than assumed: these
    # renders do not all peak at white, and a fixed ceiling would flatten the
    # dimmer ones.
    peak = max(luminance(p) for p in rgb.getdata())
    span = max(peak - floor, 1.0)

    out = Image.new('RGBA', rgb.size)
    source = rgb.load()
    target = out.load()
    for y in range(rgb.size[1]):
        for x in range(rgb.size[0]):
            pixel = source[x, y]
            level = (luminance(pixel) - floor) / span
            # These renders carry a soft vignette rather than a flat black, so
            # the cut has to clear the background gradient. Too low and the
            # whole canvas keys in as a faint haze.
            if level <= 0.035:
                target[x, y] = (0, 0, 0, 0)
                continue
            # Gamma below 1 lifts the faint glow, which a linear ramp throws
            # away — and the glow is most of what makes it read as a hologram.
            alpha = min(1.0, level ** ALPHA_GAMMA)
            lit = tuple(min(255, int(channel * BRIGHTNESS)) for channel in pixel)
            target[x, y] = (*lit, int(alpha * 255))
    return out


# Where the body is, as opposed to where its glow reaches. The two are very
# different numbers: the halo on a bright render spreads to the canvas edge, and
# framing on that shrinks the figure to fit a box that is mostly empty light.
BODY_ALPHA = 70


def figure_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    """The body's box, which is what the framing is normalised against."""
    alpha = image.getchannel('A')
    mask = alpha.point(lambda a: 255 if a > BODY_ALPHA else 0)
    box = mask.getbbox()
    if box is None:
        raise ValueError('no figure found — is the background actually dark?')
    return box


def normalise(image: Image.Image) -> Image.Image:
    """Scales the body to a fixed height and centres it on a fixed canvas.

    The crop is padded outwards from the body's box so the halo survives, but
    the scale is set by the body alone. Scaling by the halo instead lets a
    brighter render come out smaller, which on screen reads as the user
    shrinking between one assessment and the next.
    """
    left, top, right, bottom = figure_bounds(image)
    pad = int((bottom - top) * 0.06)
    box = (
        max(0, left - pad),
        max(0, top - pad),
        min(image.size[0], right + pad),
        min(image.size[1], bottom + pad),
    )
    body_height = bottom - top
    figure = image.crop(box)

    # Scale so the BODY is FIGURE_HEIGHT of the canvas; the padded crop it sits
    # in ends up a little larger, which is what leaves room for the halo.
    scale = (CANVAS[1] * FIGURE_HEIGHT) / body_height
    width = max(1, round(figure.size[0] * scale))
    height = max(1, round(figure.size[1] * scale))
    figure = figure.resize((width, height), Image.LANCZOS)

    if width > CANVAS[0]:
        # An arms-out pose is wider than the canvas; fit to width instead so
        # nothing is cropped off, at the cost of a shorter figure.
        scale = CANVAS[0] / figure.size[0]
        figure = figure.resize(
            (CANVAS[0], max(1, int(figure.size[1] * scale))), Image.LANCZOS
        )

    canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    canvas.paste(
        figure,
        ((CANVAS[0] - figure.size[0]) // 2, (CANVAS[1] - figure.size[1]) // 2),
    )
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', help='directory of rendered frames')
    parser.add_argument('--out', default='assets/hologram')
    parser.add_argument(
        '--prefix', default='body', help='output name, numbered in sorted order'
    )
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    names = sorted(
        name
        for name in os.listdir(args.source)
        if name.lower().endswith(('.png', '.webp', '.jpg', '.jpeg'))
    )
    if not names:
        print(f'no images in {args.source}', file=sys.stderr)
        return 1

    for index, name in enumerate(names):
        with Image.open(os.path.join(args.source, name)) as image:
            keyed = key_background(image)
            framed = normalise(keyed)
            out = os.path.join(args.out, f'{args.prefix}-{index:02d}.png')
            framed.save(out, optimize=True)
            size_kb = os.path.getsize(out) // 1024
            print(f'  {name:14s} -> {os.path.basename(out)}  {size_kb} KB')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
