/**
 * Which rendered hologram frame belongs to which body.
 *
 * Pure: band numbers in, a band number or null out. The images themselves live
 * in `frameSources.ts`, because a `require` of a PNG only resolves under Metro
 * and would make this logic untestable outside a running app — which is the
 * half most worth testing.
 */

/**
 * The body-fat bands a frame has been rendered at, ascending.
 *
 * Two so far. Adding a render means adding its band here and its file there;
 * nothing else in the app changes.
 */
export const RENDERED_BANDS = [15, 30] as const;

/**
 * How far a body may be from a rendered band before the render stops being a
 * picture of it.
 *
 * Ten points is two bands. Beyond that the app draws the figure it builds from
 * the user's own measurements instead: a worse drawing of the right body,
 * which is the better trade. A 50% figure drawn with a 30% render is not an
 * approximation, it is somebody else.
 */
export const FRAME_TOLERANCE = 10;

/** The rendered band to draw for a body, or null when none is close enough. */
export function nearestRenderedBand(band: number | undefined): number | null {
  if (band === undefined || !Number.isFinite(band)) return null;

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const rendered of RENDERED_BANDS) {
    const distance = Math.abs(rendered - band);
    if (distance < bestDistance) {
      best = rendered;
      bestDistance = distance;
    }
  }

  return best !== null && bestDistance <= FRAME_TOLERANCE ? best : null;
}
