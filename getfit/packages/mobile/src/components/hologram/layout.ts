/**
 * How big the figure is drawn, and where.
 *
 * Split out of the viewer for the same reason `frames.ts` was: a `require` of
 * a PNG only resolves under Metro, so anything that lives next to one cannot
 * be tested. The arithmetic that decides whether the figure lands inside its
 * own box is the half most worth testing, so it lives here.
 *
 * The bug this exists to prevent: the rendered frames are 640x1280 PNGs, and
 * a React Native `<Image>` carries that as its intrinsic size. Pinning it with
 * `StyleSheet.absoluteFill` and nothing else leaves the intrinsic size to win,
 * so the figure painted at 640x1280 *points* from the box's top-left corner —
 * ten times its box, spilling across the screen. On Home the card clipped all
 * but a head in the far corner; on the result screen it ran off the right
 * edge. Every other node in the viewer (the stage SVG, the GL surface) is
 * given explicit dimensions, which is why only the frames moved.
 */

/** The rendered frames are all this shape. See `assets/hologram/`. */
export const FRAME_WIDTH = 640;
export const FRAME_HEIGHT = 1280;

export interface Box {
  width: number;
  height: number;
}

/**
 * The viewer's box for a requested height.
 *
 * Callers pass a height — `size` — because the figure is what has to match
 * the text beside it; the width follows from the drawing's own proportions.
 */
export function viewerBox(size: number, viewWidth: number, viewHeight: number): Box {
  return { width: (size * viewWidth) / viewHeight, height: size };
}

/**
 * The figure as `resizeMode="contain"` actually draws it: scaled to touch the
 * nearer pair of edges, centred on the other axis, never larger than the box.
 *
 * The viewer passes the box straight to the image, so this is a description of
 * what the platform will do rather than something the app computes. It is here
 * so a test can assert the one property that matters — that it fits.
 */
export function containedBox(box: Box, aspect: number): Box {
  if (!Number.isFinite(aspect) || aspect <= 0) return { width: 0, height: 0 };
  const byHeight = { width: box.height * aspect, height: box.height };
  return byHeight.width <= box.width ? byHeight : { width: box.width, height: box.width / aspect };
}

/** The aspect ratio of the rendered frames. */
export const FRAME_ASPECT = FRAME_WIDTH / FRAME_HEIGHT;
