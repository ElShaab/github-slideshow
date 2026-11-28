import { VIEW_HEIGHT, VIEW_WIDTH } from './figure';

/**
 * The point cloud scattered across the figure's surface.
 *
 * It is the most recognisable thing about the reference renders and the
 * cheapest to reproduce: a field of small bright dots, denser where the
 * surface turns away from the viewer, which reads as a scanned volume rather
 * than a flat fill.
 *
 * Two things matter for it to work on a phone. It has to be deterministic, so
 * the same assessment draws the same cloud every time it is opened — that is
 * what the stored seed is for, and until now nothing used it. And it has to be
 * one path rather than hundreds of circles: a few hundred SVG nodes costs more
 * than the effect is worth, while a few hundred subpaths inside one node costs
 * almost nothing.
 */

/** mulberry32 — small, fast, and good enough for scattering dots. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One dot, as a subpath: move to it, then a full circle in two arcs. */
function dot(cx: number, cy: number, r: number): string {
  return `M ${round(cx - r)} ${round(cy)} a ${round(r)} ${round(r)} 0 1 0 ${round(r * 2)} 0 a ${round(
    r,
  )} ${round(r)} 0 1 0 ${round(-r * 2)} 0`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface StippleField {
  /** One path holding every dot. Clip it to the body when drawing. */
  d: string;
  count: number;
}

/**
 * Scatters `count` dots over the figure's box.
 *
 * The caller clips the result to the body outline, which is both simpler and
 * more accurate than trying to test each point against a dozen curves. Density
 * is weighted towards the edges of the figure, where a real surface turns away
 * and its texture bunches up.
 */
export function buildStipple(seed: number, count: number): StippleField {
  const random = seededRandom(seed || 1);
  const parts: string[] = [];

  for (let index = 0; index < count; index += 1) {
    // Bias x towards the sides: two samples, take the one further out.
    const a = random();
    const b = random();
    const t = Math.abs(a - 0.5) > Math.abs(b - 0.5) ? a : b;
    const cx = t * VIEW_WIDTH;
    const cy = random() * VIEW_HEIGHT;
    const r = 0.35 + random() * 0.55;
    parts.push(dot(cx, cy, r));
  }

  return { d: parts.join(' '), count };
}
