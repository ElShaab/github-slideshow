import type { HologramData, HologramSegment } from '@getfit/shared';
import { buildAnatomy, type Belly, type Fibre } from './anatomy';
import {
  CX,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  Y,
  buildArm,
  buildFace,
  buildHead,
  buildLeg,
  buildNeck,
  buildTorso,
  at,
  type Side,
  type Sign,
  type Widths,
} from './figure';
import { buildStipple } from './stipple';

export { VIEW_HEIGHT, VIEW_WIDTH } from './figure';

/**
 * Turns a body-composition estimate into the figure the HologramViewer draws.
 *
 * This is a pure function over a versioned payload: swapping in a real 3D
 * model later means replacing the renderer, not the contract. The geometry
 * describes the user's CURRENT estimate — there is no projection of a future
 * physique anywhere in here.
 *
 * The figure is built as two bodies. The muscle body is the person with the
 * fat taken off, and carries all the anatomy; the outer body is the outline a
 * tape measure goes around. The gap between them is the subcutaneous layer,
 * drawn translucent so the muscle reads through it — which is how both
 * reference renders are lit, and why muscle someone has built is never erased
 * by the fat over it.
 *
 * Body fat arrives already rounded to a 5-point band (see `bodyFatBand` in
 * @getfit/shared), so nothing here guards against a figure that redraws itself
 * on tape noise.
 */

/** One body's outline. */
export interface Silhouette {
  torsoPath: string;
  leftLegPath: string;
  rightLegPath: string;
  leftArmPath: string;
  rightArmPath: string;
  neckPath: string;
}

export interface HologramGeometry {
  /** The outer body — muscle plus the fat over it. */
  torsoPath: string;
  leftLegPath: string;
  rightLegPath: string;
  leftArmPath: string;
  rightArmPath: string;
  neckPath: string;
  /** The body underneath, which carries the anatomy. */
  muscle: Silhouette;
  /** Cranium and jaw, and the lines that make it read as a face. */
  headPath: string;
  facePaths: string[];
  /** Muscle bellies, brightened by development and by what is over them. */
  bellies: Array<{ d: string; intensity: number; key: Belly['key'] }>;
  /** Fibre lines running the way each muscle pulls. */
  fibres: Array<{ d: string; opacity: number }>;
  /** Contour rings that read as a wireframe wrapped around a volume. */
  contours: Array<{ d: string; opacity: number }>;
  /**
   * The subcutaneous layer, in three parts. `ring` is the band between the two
   * bodies, where there is fat and nothing else behind it — the green fringe in
   * both references. `wash` is the light tint over everything, which is what
   * makes the layer read as translucent. `rim` is the bright edge line.
   */
  fatLayer: { thickness: number; ring: number; wash: number; rim: number };
  /** The ring as even-odd paths: outer body, then its muscle counterpart. */
  fatRingPaths: string[];
  /** Soft folds across the abdomen, which only a covering layer can make. */
  softBands: Array<{ d: string; opacity: number }>;
  /** The scanned-surface point cloud, as one path to be clipped to the body. */
  stipple: { d: string; opacity: number };
  adiposity: number;
  definition: number;
  head: { cx: number; cy: number; r: number };
  width: number;
  height: number;
  /**
   * The two bodies as raw widths.
   *
   * Exposed so the 3D renderer can loft the same shapes the flat one outlines.
   * One assessment has to produce one body: if the mesh recomputed these from
   * the payload it would drift from the fallback drawing the moment either
   * side changed, and the user would see two different people depending on
   * whether their phone gave us a GL context.
   */
  leanWidths: Widths;
  outerWidths: Widths;
}

/**
 * How thick the layer is, and how sharply the muscle reads through it.
 *
 * Version 2 payloads carry both, already banded. Version 1 predates the layer,
 * so they are derived from the one fat figure it did store — an older stored
 * assessment still draws, and still never draws a blank shell.
 */
function surface(data: HologramData): { adiposity: number; definition: number } {
  const adiposity = clamp01(data.adiposity ?? data.bodyFatNormalized);
  const definition = clamp01(
    data.definition ??
      (0.25 + 0.75 * (1 - data.bodyFatNormalized)) * (0.62 + 0.38 * data.muscleNormalized),
  );
  return { adiposity, definition };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function segmentMap(data: HologramData): Record<HologramSegment['key'], HologramSegment> {
  const map = {} as Record<HologramSegment['key'], HologramSegment>;
  for (const segment of data.segments) map[segment.key] = segment;
  return map;
}

/** Balance shifts mass between sides without changing the total. */
function sided(base: number, range: number, segment: HologramSegment | undefined): Side {
  const development = segment?.development ?? 0.5;
  const balance = segment?.balance ?? 0;
  const width = base + development * range;
  return {
    left: Math.max(4, width * (1 + balance)),
    right: Math.max(4, width * (1 - balance)),
  };
}

function scale(side: Side, factor: number): Side {
  return { left: side.left * factor, right: side.right * factor };
}

/**
 * The abdomen.
 *
 * On a lean figure this is the taper between the ribs and the waist, so it sits
 * between the two. As fat is added it swells past both, until it is the widest
 * point of the whole figure — the single change that makes a silhouette read as
 * heavy rather than as a large athlete.
 */
function belly(chest: Side, waist: Side, adiposity: number): Side {
  const swell = (chestWidth: number, waistWidth: number): number =>
    lerp((chestWidth + waistWidth) / 2, waistWidth * 1.34, adiposity);
  return { left: swell(chest.left, waist.left), right: swell(chest.right, waist.right) };
}

/**
 * Builds one body at a given amount of fat over it.
 *
 * Called twice with the same segments — once at the user's adiposity for the
 * outer body, once at zero for the muscle underneath — which is what makes the
 * two outlines the same person.
 */
function widthsAt(
  data: HologramData,
  segments: Record<HologramSegment['key'], HologramSegment>,
  { adiposity, lean }: { adiposity: number; lean: boolean },
): Widths {
  const female = data.sex === 'female';

  // Fat does not only sit on the abdomen. Limbs thicken too, which is what
  // stops a heavy figure reading as a thin person with a balloon taped on.
  const limb = 1 + adiposity * 0.22;

  const chest = sided(female ? 42 : 46, 15, segments.chest);

  // The waist and hip are the two measurements fat dominates, so the muscle
  // body cannot use them: taking the measured girth for both would make the
  // body underneath as wide as the body on top and leave nothing for the layer
  // to be. Underneath, the trunk is the frame and what it carries; over it,
  // the tape reading, unmodified.
  const waist = lean
    ? sided(female ? 28 : 29, 10, segments.chest)
    : sided(female ? 29 : 31, 26, segments.waist);
  const hip = lean
    ? sided(female ? 38 : 34, 10, segments.quads)
    : sided(female ? 42 : 37, 18, segments.hips);

  return {
    shoulder: sided(female ? 46 : 52, 23, segments.shoulders),
    chest,
    belly: belly(chest, waist, adiposity),
    waist,
    hip,
    thigh: scale(sided(female ? 26 : 25, 11, segments.quads), limb),
    knee: scale(sided(16, 4, segments.quads), 1 + adiposity * 0.1),
    calf: scale(sided(16, 7, segments.calves), limb),
    ankle: scale(sided(9.5, 1.5, segments.calves), 1 + adiposity * 0.08),
    upperArm: scale(sided(female ? 11 : 12.5, 7, segments.arms), limb),
    forearm: scale(sided(female ? 9 : 10, 5, segments.arms), 1 + adiposity * 0.16),
  };
}

function silhouette(w: Widths): Silhouette {
  return {
    torsoPath: buildTorso(w),
    leftLegPath: buildLeg(w, -1),
    rightLegPath: buildLeg(w, 1),
    leftArmPath: buildArm(w, -1),
    rightArmPath: buildArm(w, 1),
    neckPath: buildNeck(w),
  };
}

/** Widens `body` wherever `floor` is wider, so the first encloses the second. */
function atLeast(body: Widths, floor: Widths): Widths {
  const widest = (a: Side, b: Side): Side => ({
    left: Math.max(a.left, b.left),
    right: Math.max(a.right, b.right),
  });
  const result = {} as Widths;
  for (const key of Object.keys(body) as Array<keyof Widths>) {
    result[key] = widest(body[key], floor[key]);
  }
  return result;
}

export function buildGeometry(data: HologramData): HologramGeometry {
  const segments = segmentMap(data);
  const { adiposity, definition } = surface(data);

  const lean = widthsAt(data, segments, { adiposity: 0, lean: true });
  // `atLeast` guarantees the outer body encloses the muscle body. Almost always
  // it does by construction, but a measured waist can come in under the frame
  // it sits on, and an inner outline poking through the outer one turns the
  // even-odd ring inside out — a hole in the figure where the layer should be.
  const outer = atLeast(widthsAt(data, segments, { adiposity, lean: false }), lean);

  const body = silhouette(outer);
  const muscle = silhouette(lean);
  const anatomy = buildAnatomy(lean);

  // How much of the anatomy survives the layer over it. Never zero: fat is
  // translucent, and muscle someone has built does not stop existing.
  const visible = 0.24 + 0.76 * definition;

  return {
    ...body,
    muscle,
    headPath: buildHead(),
    facePaths: buildFace(),
    bellies: anatomy.bellies.map((item) => ({
      d: item.d,
      key: item.key,
      intensity: round2(
        clamp01(
          item.driver === 'definition'
            ? definition * item.weight
            : (segments[item.key]?.development ?? 0.5) * item.weight * visible,
        ),
      ),
    })),
    fibres: anatomy.fibres.map((item: Fibre) => ({
      d: item.d,
      opacity: round2(clamp01((0.14 + definition * 0.38) * item.weight)),
    })),
    contours: buildContours(lean),
    fatLayer: {
      // A lean figure still has a hairline of it — nobody is at zero.
      thickness: round2(1.2 + adiposity * 8),
      ring: round2(0.34 + adiposity * 0.32),
      // Capped well short of opaque: past about a quarter the muscle stops
      // reading through and the figure becomes the blank shell this whole
      // arrangement exists to avoid.
      wash: round2(0.05 + adiposity * 0.17),
      rim: round2(0.4 + adiposity * 0.45),
    },
    fatRingPaths: [
      `${body.leftArmPath} ${muscle.leftArmPath}`,
      `${body.rightArmPath} ${muscle.rightArmPath}`,
      `${body.leftLegPath} ${muscle.leftLegPath}`,
      `${body.rightLegPath} ${muscle.rightLegPath}`,
      `${body.torsoPath} ${muscle.torsoPath}`,
    ],
    softBands: buildSoftBands(outer, adiposity),
    stipple: {
      d: buildStipple(data.seed, 1400).d,
      opacity: round2(0.3 + definition * 0.28),
    },
    adiposity: round2(adiposity),
    definition: round2(definition),
    head: { cx: CX, cy: Y.headCenter, r: 25 },
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    leanWidths: lean,
    outerWidths: outer,
  };
}

/**
 * Contour rings: shallow arcs across the body at a given height, the cue that
 * the silhouette is a volume rather than a flat cut-out.
 */
function buildContours(w: Widths): Array<{ d: string; opacity: number }> {
  const rings: Array<{ y: number; left: number; right: number; opacity: number; bow: number }> = [
    { y: Y.chest, left: w.chest.left * 0.94, right: w.chest.right * 0.94, opacity: 0.26, bow: 9 },
    { y: Y.belly, left: w.belly.left * 0.94, right: w.belly.right * 0.94, opacity: 0.22, bow: 8 },
    { y: Y.hip - 6, left: w.hip.left * 0.95, right: w.hip.right * 0.95, opacity: 0.2, bow: 8 },
  ];

  const arcs = rings.map((ring) => ({
    opacity: ring.opacity,
    d: `M ${CX - ring.left} ${ring.y} C ${CX - ring.left * 0.55} ${ring.y + ring.bow} ${
      CX + ring.right * 0.55
    } ${ring.y + ring.bow} ${CX + ring.right} ${ring.y}`,
  }));

  for (const sign of [-1, 1] as Sign[]) {
    const hip = sign === 1 ? w.hip.right : w.hip.left;
    const thigh = sign === 1 ? w.thigh.right : w.thigh.left;
    const legCenter = at(sign, hip * 0.46);
    arcs.push({
      opacity: 0.18,
      d: `M ${legCenter - thigh} ${Y.thigh} C ${legCenter - thigh * 0.5} ${Y.thigh + 7} ${
        legCenter + thigh * 0.5
      } ${Y.thigh + 7} ${legCenter + thigh} ${Y.thigh}`,
    });
  }

  return arcs;
}

/**
 * The folds a covering layer makes across the abdomen.
 *
 * A lean figure has none — there is nothing to fold — so this returns an empty
 * list below the threshold rather than drawing faint ones nobody asked for.
 */
function buildSoftBands(w: Widths, adiposity: number): Array<{ d: string; opacity: number }> {
  if (adiposity < 0.26) return [];

  const count = adiposity > 0.62 ? 3 : adiposity > 0.42 ? 2 : 1;
  const bands: Array<{ d: string; opacity: number }> = [];

  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const y = lerp(Y.chest + 30, Y.waist + 6, t);
    const spread = lerp(0.72, 0.86, 1 - Math.abs(t - 0.5) * 2);
    const left = w.belly.left * spread;
    const right = w.belly.right * spread;
    const bow = 9 + adiposity * 5;

    bands.push({
      opacity: round2(0.14 + adiposity * 0.3),
      d: `M ${CX - left} ${y} C ${CX - left * 0.5} ${y + bow} ${CX + right * 0.5} ${y + bow} ${
        CX + right
      } ${y}`,
    });
  }

  return bands;
}
