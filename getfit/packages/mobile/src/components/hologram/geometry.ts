import type { HologramData, HologramSegment } from '@getfit/shared';

/**
 * Turns a body-composition estimate into the silhouette geometry the
 * HologramViewer draws.
 *
 * This is deliberately a pure function over a versioned data payload: swapping
 * in a real 3D model later means replacing the renderer, not the contract.
 * The geometry describes the user's CURRENT estimate — there is no projection
 * of a future physique anywhere in here.
 *
 * Two things move with body fat, and they move in opposite directions. The
 * subcutaneous layer — the green rim around the outside — thickens, and the
 * belly swells past the ribcage until the widest point of the torso is below
 * the chest rather than at the shoulders. Meanwhile the muscle detail under it
 * disappears: striations fade, then the plates, until the surface is smooth and
 * only soft horizontal bands remain. A figure at 40% and the same figure at 20%
 * are not the same drawing at two opacities; they are built from different
 * parts.
 *
 * Body fat arrives already rounded to a 5-point band (see `bodyFatBand` in
 * @getfit/shared), so nothing here needs to guard against a figure that
 * redraws itself on tape noise.
 */

export const VIEW_WIDTH = 240;
export const VIEW_HEIGHT = 540;
const CX = VIEW_WIDTH / 2;

export interface HologramGeometry {
  /** Head, torso, legs and arms are separate paths so each can be shaped independently. */
  torsoPath: string;
  leftLegPath: string;
  rightLegPath: string;
  leftArmPath: string;
  rightArmPath: string;
  /** Horizontal contour rings that read as a wireframe wrapped around a volume. */
  contours: Array<{ d: string; opacity: number }>;
  /** Vertical seams running down the figure. */
  seams: string[];
  /** Muscle-group plates whose brightness tracks estimated development. */
  plates: Array<{ d: string; intensity: number; key: HologramSegment['key'] }>;
  /**
   * The subcutaneous layer: a green rim stroked around every silhouette path,
   * under the body fill, so only the half outside the outline shows. Thickness
   * is the layer's depth in view units.
   */
  fatLayer: { thickness: number; opacity: number };
  /**
   * Soft horizontal bands across the abdomen — the folds a covering layer
   * makes. Absent on a lean figure, which has nothing to fold.
   */
  softBands: Array<{ d: string; opacity: number }>;
  /**
   * Muscle fibre lines. These are the first thing a layer of fat hides, so they
   * are the first thing to disappear as body fat rises, and the surface is bare
   * of them well before the plates fade.
   */
  striations: Array<{ d: string; opacity: number }>;
  /** 0..1, echoed from the payload so the renderer can tint the outer bloom. */
  adiposity: number;
  /** 0..1, echoed for the same reason. */
  definition: number;
  head: { cx: number; cy: number; r: number };
  width: number;
  height: number;
}

/**
 * How thick the layer is, and how much detail survives underneath it.
 *
 * Version 2 payloads carry both, already banded. Version 1 predates the layer,
 * so they are derived from the one fat figure it did store — an older stored
 * assessment still draws, just without the benefit of the banding.
 */
function surface(data: HologramData): { adiposity: number; definition: number } {
  const adiposity = clamp01(data.adiposity ?? data.bodyFatNormalized);
  const definition = clamp01(
    data.definition ?? (1 - data.bodyFatNormalized) * (0.62 + 0.38 * data.muscleNormalized),
  );
  return { adiposity, definition };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Vertical landmarks, tuned so the figure reads at roughly human proportions. */
const Y = {
  headCenter: 50,
  neck: 80,
  shoulder: 102,
  chest: 150,
  // The belly sits between the ribs and the waist. At low body fat it is the
  // narrowest part of the torso; at high body fat it is the widest part of the
  // whole figure, which is what changes the silhouette's read.
  belly: 186,
  waist: 212,
  hip: 252,
  crotch: 272,
  thigh: 310,
  knee: 366,
  calf: 410,
  ankle: 478,
  foot: 494,
} as const;

interface Side {
  left: number;
  right: number;
}

interface Widths {
  shoulder: Side;
  chest: Side;
  belly: Side;
  waist: Side;
  hip: Side;
  thigh: Side;
  knee: Side;
  calf: Side;
  ankle: Side;
  upperArm: Side;
  forearm: Side;
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

export function buildGeometry(data: HologramData): HologramGeometry {
  const segments = segmentMap(data);
  const female = data.sex === 'female';
  const { adiposity, definition } = surface(data);

  // Fat does not only sit on the abdomen. Limbs thicken too, which is what
  // stops a heavy figure reading as a thin person with a balloon taped on.
  const limb = 1 + adiposity * 0.22;

  const chest = sided(female ? 38 : 42, 14, segments.chest);
  const waist = sided(female ? 27 : 29, 25, segments.waist);

  const widths: Widths = {
    shoulder: sided(female ? 42 : 48, 22, segments.shoulders),
    chest,
    belly: belly(chest, waist, adiposity),
    waist,
    hip: sided(female ? 40 : 35, 17, segments.hips),
    thigh: scale(sided(female ? 25 : 24, 10, segments.quads), limb),
    knee: scale(sided(15, 4, segments.quads), 1 + adiposity * 0.1),
    calf: scale(sided(15, 7, segments.calves), limb),
    ankle: scale(sided(9, 1.5, segments.calves), 1 + adiposity * 0.08),
    upperArm: scale(sided(female ? 10 : 11, 7, segments.arms), limb),
    forearm: scale(sided(female ? 8 : 9, 5, segments.arms), 1 + adiposity * 0.16),
  };

  return {
    torsoPath: buildTorso(widths),
    leftLegPath: buildLeg(widths, 'left'),
    rightLegPath: buildLeg(widths, 'right'),
    leftArmPath: buildArm(widths, 'left'),
    rightArmPath: buildArm(widths, 'right'),
    contours: buildContours(widths),
    seams: buildSeams(widths),
    plates: buildPlates(widths, segments, definition),
    fatLayer: {
      // A lean figure still has a hairline of it — nobody is at zero.
      thickness: round2(1.2 + adiposity * 8),
      opacity: round2(0.34 + adiposity * 0.46),
    },
    softBands: buildSoftBands(widths, adiposity),
    striations: buildStriations(widths, segments, definition),
    adiposity: round2(adiposity),
    definition: round2(definition),
    head: { cx: CX, cy: Y.headCenter, r: female ? 21 : 22 },
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
  };
}

/**
 * The abdomen.
 *
 * On a lean figure this is just the taper between the ribs and the waist, so it
 * sits between the two. As fat is added it swells past both, until it is the
 * widest point of the whole figure — which is the single change that makes a
 * silhouette read as heavy rather than as a large athlete.
 */
function belly(chest: Side, waist: Side, adiposity: number): Side {
  const swell = (chestWidth: number, waistWidth: number): number =>
    lerp((chestWidth + waistWidth) / 2, waistWidth * 1.34, adiposity);
  return { left: swell(chest.left, waist.left), right: swell(chest.right, waist.right) };
}

function scale(side: Side, factor: number): Side {
  return { left: side.left * factor, right: side.right * factor };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Neck, shoulders, torso and pelvis as one closed shape. */
function buildTorso(w: Widths): string {
  const r = (value: number): number => CX + value;
  const l = (value: number): number => CX - value;

  return [
    `M ${r(9)} ${Y.neck}`,
    // Trapezius sweeping out to the deltoid.
    `C ${r(20)} ${Y.neck + 4} ${r(w.shoulder.right - 16)} ${Y.shoulder - 14} ${r(w.shoulder.right)} ${Y.shoulder + 2}`,
    // Deltoid down into the ribcage.
    `C ${r(w.shoulder.right + 1)} ${Y.shoulder + 20} ${r(w.chest.right + 2)} ${Y.chest - 26} ${r(w.chest.right)} ${Y.chest}`,
    // Ribcage into the abdomen. On a lean figure this is a taper; on a heavy
    // one the belly is wider than the ribs and the curve bows outward instead.
    `C ${r(w.chest.right)} ${Y.chest + 20} ${r(w.belly.right)} ${Y.belly - 22} ${r(w.belly.right)} ${Y.belly}`,
    // Abdomen down to the waist.
    `C ${r(w.belly.right)} ${Y.belly + 14} ${r(w.waist.right + 1)} ${Y.waist - 14} ${r(w.waist.right)} ${Y.waist}`,
    // Waist flaring into the hip.
    `C ${r(w.waist.right + 1)} ${Y.waist + 16} ${r(w.hip.right)} ${Y.hip - 18} ${r(w.hip.right)} ${Y.hip}`,
    // Pelvic arch: the torso closes in an inverted V so the legs read as
    // emerging from it rather than being cut off by a horizontal band.
    `C ${r(w.hip.right - 1)} ${Y.hip + 14} ${r(w.hip.right * 0.55)} ${Y.crotch + 4} ${r(3)} ${Y.crotch + 2}`,
    `C ${l(3)} ${Y.crotch + 2} ${l(w.hip.left * 0.55)} ${Y.crotch + 4} ${l(w.hip.left - 1)} ${Y.hip + 14}`,
    `L ${l(w.hip.left)} ${Y.hip}`,
    `C ${l(w.hip.left)} ${Y.hip - 18} ${l(w.waist.left + 1)} ${Y.waist + 16} ${l(w.waist.left)} ${Y.waist}`,
    `C ${l(w.waist.left + 1)} ${Y.waist - 14} ${l(w.belly.left)} ${Y.belly + 14} ${l(w.belly.left)} ${Y.belly}`,
    `C ${l(w.belly.left)} ${Y.belly - 22} ${l(w.chest.left)} ${Y.chest + 20} ${l(w.chest.left)} ${Y.chest}`,
    `C ${l(w.chest.left + 2)} ${Y.chest - 26} ${l(w.shoulder.left + 1)} ${Y.shoulder + 20} ${l(w.shoulder.left)} ${Y.shoulder + 2}`,
    `C ${l(w.shoulder.left - 16)} ${Y.shoulder - 14} ${l(20)} ${Y.neck + 4} ${l(9)} ${Y.neck}`,
    'Z',
  ].join(' ');
}

/**
 * One leg, drawn down the outer edge and back up the inner edge so the two legs
 * stay separated rather than converging into a sliver at the centre line.
 */
function buildLeg(w: Widths, side: 'left' | 'right'): string {
  const sign = side === 'right' ? 1 : -1;
  const hip = side === 'right' ? w.hip.right : w.hip.left;
  const thigh = side === 'right' ? w.thigh.right : w.thigh.left;
  const knee = side === 'right' ? w.knee.right : w.knee.left;
  const calf = side === 'right' ? w.calf.right : w.calf.left;
  const ankle = side === 'right' ? w.ankle.right : w.ankle.left;

  // Each leg hangs from the middle of its half of the pelvis.
  const legCenter = hip * 0.48;
  const footCenter = hip * 0.40;
  const x = (value: number): number => CX + sign * value;

  const outerThigh = legCenter + thigh;
  const innerThigh = Math.max(3, legCenter - thigh);
  const outerKnee = legCenter + knee;
  const innerKnee = Math.max(2, legCenter - knee);
  const outerCalf = footCenter + calf;
  const innerCalf = Math.max(2, footCenter - calf);
  const outerAnkle = footCenter + ankle;
  const innerAnkle = Math.max(1, footCenter - ankle);

  return [
    // Start under the pelvic arch and run down the outside of the leg.
    `M ${x(hip)} ${Y.hip - 2}`,
    `C ${x(hip + 1)} ${Y.hip + 18} ${x(outerThigh)} ${Y.thigh - 28} ${x(outerThigh)} ${Y.thigh}`,
    `C ${x(outerThigh)} ${Y.thigh + 26} ${x(outerKnee + 1)} ${Y.knee - 22} ${x(outerKnee)} ${Y.knee}`,
    `C ${x(outerKnee)} ${Y.knee + 12} ${x(outerCalf)} ${Y.calf - 22} ${x(outerCalf)} ${Y.calf}`,
    `C ${x(outerCalf)} ${Y.calf + 34} ${x(outerAnkle + 1)} ${Y.ankle - 20} ${x(outerAnkle)} ${Y.ankle}`,
    // Foot.
    `L ${x(outerAnkle + 4)} ${Y.foot}`,
    `L ${x(innerAnkle - 2)} ${Y.foot}`,
    // Back up the inside.
    `L ${x(innerAnkle)} ${Y.ankle}`,
    `C ${x(innerAnkle)} ${Y.ankle - 20} ${x(innerCalf)} ${Y.calf + 34} ${x(innerCalf)} ${Y.calf}`,
    `C ${x(innerCalf)} ${Y.calf - 22} ${x(innerKnee)} ${Y.knee + 12} ${x(innerKnee)} ${Y.knee}`,
    `C ${x(innerKnee)} ${Y.knee - 22} ${x(innerThigh)} ${Y.thigh + 26} ${x(innerThigh)} ${Y.thigh}`,
    `C ${x(innerThigh)} ${Y.thigh - 24} ${x(6)} ${Y.crotch + 16} ${x(4)} ${Y.crotch + 2}`,
    'Z',
  ].join(' ');
}

/** Upper arm and forearm hanging just clear of the torso. */
function buildArm(w: Widths, side: 'left' | 'right'): string {
  const sign = side === 'right' ? 1 : -1;
  const shoulder = side === 'right' ? w.shoulder.right : w.shoulder.left;
  const upper = side === 'right' ? w.upperArm.right : w.upperArm.left;
  const fore = side === 'right' ? w.forearm.right : w.forearm.left;

  const x = (value: number): number => CX + sign * value;

  const shoulderX = shoulder - 6;
  const elbowX = shoulder + 3;
  const wristX = shoulder + 6;
  const elbowY = Y.chest + 60;
  const wristY = Y.waist + 66;
  const handY = wristY + 20;

  return [
    `M ${x(shoulderX)} ${Y.shoulder + 6}`,
    // Outer edge: deltoid → biceps → forearm.
    `C ${x(shoulderX + upper + 4)} ${Y.shoulder + 14} ${x(elbowX + upper)} ${elbowY - 34} ${x(elbowX + upper * 0.6)} ${elbowY}`,
    `C ${x(elbowX + fore * 0.9)} ${elbowY + 24} ${x(wristX + fore * 0.5)} ${wristY - 22} ${x(wristX + fore * 0.3)} ${wristY}`,
    // Hand.
    `C ${x(wristX + fore * 0.4)} ${handY - 6} ${x(wristX + fore * 0.1)} ${handY} ${x(wristX - fore * 0.3)} ${handY}`,
    `C ${x(wristX - fore * 0.7)} ${handY} ${x(wristX - fore * 0.9)} ${handY - 8} ${x(wristX - fore * 0.7)} ${wristY}`,
    // Inner edge back up to the shoulder.
    `C ${x(elbowX - fore * 0.5)} ${wristY - 24} ${x(elbowX - upper * 0.5)} ${elbowY + 22} ${x(elbowX - upper * 0.55)} ${elbowY}`,
    `C ${x(elbowX - upper * 0.7)} ${elbowY - 32} ${x(shoulderX - upper * 0.3)} ${Y.shoulder + 26} ${x(shoulderX - upper * 0.5)} ${Y.shoulder + 8}`,
    'Z',
  ].join(' ');
}

/**
 * Contour rings. Each is a shallow arc across the body at a given height — the
 * cue that the silhouette is a volume rather than a flat cut-out.
 */
function buildContours(w: Widths): Array<{ d: string; opacity: number }> {
  const rings: Array<{ y: number; left: number; right: number; opacity: number; bow: number }> = [
    { y: Y.shoulder + 10, left: w.shoulder.left * 0.94, right: w.shoulder.right * 0.94, opacity: 0.5, bow: 9 },
    { y: Y.chest, left: w.chest.left * 0.96, right: w.chest.right * 0.96, opacity: 0.46, bow: 9 },
    { y: Y.belly, left: w.belly.left * 0.96, right: w.belly.right * 0.96, opacity: 0.3, bow: 8 },
    { y: Y.waist, left: w.waist.left * 0.98, right: w.waist.right * 0.98, opacity: 0.46, bow: 8 },
    { y: Y.hip - 4, left: w.hip.left * 0.97, right: w.hip.right * 0.97, opacity: 0.38, bow: 8 },
  ];

  const arcs = rings.map((ring) => ({
    opacity: ring.opacity,
    d: `M ${CX - ring.left} ${ring.y} C ${CX - ring.left * 0.55} ${ring.y + ring.bow} ${
      CX + ring.right * 0.55
    } ${ring.y + ring.bow} ${CX + ring.right} ${ring.y}`,
  }));

  // Rings around each leg, drawn per side so they follow the leg, not the body.
  for (const side of [-1, 1] as const) {
    const hip = side === 1 ? w.hip.right : w.hip.left;
    const thigh = side === 1 ? w.thigh.right : w.thigh.left;
    const calf = side === 1 ? w.calf.right : w.calf.left;
    const legCenter = CX + side * hip * 0.48;
    const footCenter = CX + side * hip * 0.4;

    arcs.push({
      opacity: 0.3,
      d: `M ${legCenter - thigh} ${Y.thigh} C ${legCenter - thigh * 0.5} ${Y.thigh + 7} ${
        legCenter + thigh * 0.5
      } ${Y.thigh + 7} ${legCenter + thigh} ${Y.thigh}`,
    });
    arcs.push({
      opacity: 0.22,
      d: `M ${footCenter - calf} ${Y.calf} C ${footCenter - calf * 0.5} ${Y.calf + 6} ${
        footCenter + calf * 0.5
      } ${Y.calf + 6} ${footCenter + calf} ${Y.calf}`,
    });
  }

  return arcs;
}

function buildSeams(w: Widths): string[] {
  return [
    // Sternum and linea alba down the centre of the torso.
    `M ${CX} ${Y.neck + 10} L ${CX} ${Y.hip - 6}`,
    // Lateral lines tracing the outside of the torso.
    `M ${CX - w.chest.left * 0.7} ${Y.chest - 8} C ${CX - w.belly.left * 0.82} ${Y.belly - 10} ${
      CX - w.waist.left * 0.78
    } ${Y.waist} ${CX - w.hip.left * 0.72} ${Y.hip - 8}`,
    `M ${CX + w.chest.right * 0.7} ${Y.chest - 8} C ${CX + w.belly.right * 0.82} ${Y.belly - 10} ${
      CX + w.waist.right * 0.78
    } ${Y.waist} ${CX + w.hip.right * 0.72} ${Y.hip - 8}`,
  ];
}

/**
 * Stylised muscle plates — delts, pecs, abs, quads.
 *
 * Brightness is development scaled by how much of it is visible through the
 * layer on top. A well-developed muscle under 40% body fat is still there; you
 * just cannot see its shape, so the plate dims rather than shrinking.
 */
function buildPlates(
  w: Widths,
  segments: Record<HologramSegment['key'], HologramSegment>,
  definition: number,
): Array<{ d: string; intensity: number; key: HologramSegment['key'] }> {
  const visible = 0.2 + 0.8 * definition;
  const chest = (segments.chest?.development ?? 0.5) * visible;
  // Abs are the first thing to go, so they track definition alone.
  const abs = definition;
  const quads = (segments.quads?.development ?? 0.5) * visible;
  const shoulders = (segments.shoulders?.development ?? 0.5) * visible;
  const calves = (segments.calves?.development ?? 0.5) * visible;

  /** A rounded cap over the deltoid rather than an angular wedge. */
  const delt = (side: -1 | 1, shoulderWidth: number): string => {
    const outer = shoulderWidth - 2;
    const inner = shoulderWidth - 24;
    const x = (value: number): number => CX + side * value;
    return [
      `M ${x(inner)} ${Y.shoulder + 4}`,
      `C ${x(inner + 6)} ${Y.shoulder - 8} ${x(outer - 2)} ${Y.shoulder - 6} ${x(outer)} ${Y.shoulder + 10}`,
      `C ${x(outer + 1)} ${Y.shoulder + 26} ${x(outer - 6)} ${Y.shoulder + 34} ${x(inner + 8)} ${Y.shoulder + 28}`,
      `C ${x(inner + 2)} ${Y.shoulder + 22} ${x(inner - 1)} ${Y.shoulder + 12} ${x(inner)} ${Y.shoulder + 4}`,
      'Z',
    ].join(' ');
  };

  const pec = (side: -1 | 1, chestWidth: number): string => {
    const inner = 5;
    const outer = chestWidth * 0.78;
    const x = (value: number): number => CX + side * value;
    return [
      `M ${x(inner)} ${Y.chest - 28}`,
      `C ${x(chestWidth * 0.45)} ${Y.chest - 34} ${x(outer)} ${Y.chest - 26} ${x(outer)} ${Y.chest - 6}`,
      `C ${x(outer)} ${Y.chest + 10} ${x(chestWidth * 0.36)} ${Y.chest + 14} ${x(inner)} ${Y.chest + 8}`,
      `C ${x(inner - 1)} ${Y.chest - 4} ${x(inner - 1)} ${Y.chest - 18} ${x(inner)} ${Y.chest - 28}`,
      'Z',
    ].join(' ');
  };

  const absBlock = (row: number, half: number): string => {
    const y = Y.chest + 24 + row * 17;
    return [
      `M ${CX - half} ${y + 2}`,
      `Q ${CX} ${y - 1} ${CX + half} ${y + 2}`,
      `L ${CX + half - 1} ${y + 12}`,
      `Q ${CX} ${y + 15} ${CX - half + 1} ${y + 12}`,
      'Z',
    ].join(' ');
  };

  const quad = (side: -1 | 1, hip: number, thigh: number): string => {
    const legCenter = hip * 0.48;
    const x = (value: number): number => CX + side * value;
    return [
      `M ${x(legCenter - thigh * 0.45)} ${Y.crotch + 14}`,
      `C ${x(legCenter - thigh * 0.6)} ${Y.thigh + 10} ${x(legCenter - thigh * 0.4)} ${Y.knee - 34} ${x(legCenter - thigh * 0.1)} ${Y.knee - 20}`,
      `C ${x(legCenter + thigh * 0.35)} ${Y.knee - 32} ${x(legCenter + thigh * 0.6)} ${Y.thigh + 8} ${x(legCenter + thigh * 0.45)} ${Y.crotch + 12}`,
      `C ${x(legCenter + thigh * 0.2)} ${Y.crotch + 4} ${x(legCenter - thigh * 0.2)} ${Y.crotch + 4} ${x(legCenter - thigh * 0.45)} ${Y.crotch + 14}`,
      'Z',
    ].join(' ');
  };

  const calfPlate = (side: -1 | 1, hip: number, calf: number): string => {
    const footCenter = hip * 0.4;
    const x = (value: number): number => CX + side * value;
    return [
      `M ${x(footCenter - calf * 0.55)} ${Y.knee + 12}`,
      `C ${x(footCenter - calf * 0.75)} ${Y.calf} ${x(footCenter - calf * 0.4)} ${Y.calf + 26} ${x(footCenter)} ${Y.calf + 30}`,
      `C ${x(footCenter + calf * 0.4)} ${Y.calf + 26} ${x(footCenter + calf * 0.75)} ${Y.calf} ${x(footCenter + calf * 0.55)} ${Y.knee + 12}`,
      'Z',
    ].join(' ');
  };

  return [
    { d: delt(-1, w.shoulder.left), intensity: shoulders, key: 'shoulders' },
    { d: delt(1, w.shoulder.right), intensity: shoulders, key: 'shoulders' },
    { d: pec(-1, w.chest.left), intensity: chest, key: 'chest' },
    { d: pec(1, w.chest.right), intensity: chest, key: 'chest' },
    { d: absBlock(0, Math.min(13, w.waist.left * 0.42)), intensity: abs, key: 'waist' },
    { d: absBlock(1, Math.min(13, w.waist.left * 0.42)), intensity: abs * 0.92, key: 'waist' },
    { d: absBlock(2, Math.min(12, w.waist.left * 0.38)), intensity: abs * 0.82, key: 'waist' },
    { d: quad(-1, w.hip.left, w.thigh.left), intensity: quads, key: 'quads' },
    { d: quad(1, w.hip.right, w.thigh.right), intensity: quads, key: 'quads' },
    { d: calfPlate(-1, w.hip.left, w.calf.left), intensity: calves, key: 'calves' },
    { d: calfPlate(1, w.hip.right, w.calf.right), intensity: calves, key: 'calves' },
  ];
}

/**
 * The folds a covering layer makes across the abdomen.
 *
 * A lean figure has none — there is nothing to fold — so this returns an empty
 * list below the threshold rather than drawing faint ones nobody asked for.
 * Bands appear one at a time as the layer thickens, which is what gives the
 * 5-point steps something visible to do in the upper bands, where the outline
 * has already stopped changing much.
 */
function buildSoftBands(w: Widths, adiposity: number): Array<{ d: string; opacity: number }> {
  if (adiposity < 0.26) return [];

  const count = adiposity > 0.62 ? 3 : adiposity > 0.42 ? 2 : 1;
  const bands: Array<{ d: string; opacity: number }> = [];

  for (let index = 0; index < count; index += 1) {
    // Spread the bands across the belly, the widest first.
    const t = count === 1 ? 0.5 : index / (count - 1);
    const y = lerp(Y.chest + 26, Y.waist + 6, t);
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

/**
 * Muscle fibre lines.
 *
 * These are the texture covering the reference figure at 20% — the fan across
 * the pecs, the obliques under the ribs, the long fibres down the quads and the
 * upper arms. They are the finest detail on the figure and the first thing a
 * layer of fat hides.
 *
 * Each group has its own threshold, so they go out one at a time in the order a
 * body actually loses them as fat is gained: the obliques first, then the
 * quads, then the pecs, with the arms last. Fading them together instead would
 * put a cliff between two neighbouring bands, where a figure that was fully
 * striated at 35% is bare at 40%.
 */
const STRIATION_THRESHOLDS = {
  obliques: 0.7,
  quads: 0.52,
  pecs: 0.34,
  arms: 0.12,
} as const;

function buildStriations(
  w: Widths,
  segments: Record<HologramSegment['key'], HologramSegment>,
  definition: number,
): Array<{ d: string; opacity: number }> {
  if (definition < STRIATION_THRESHOLDS.arms) return [];

  const lines: Array<{ d: string; opacity: number }> = [];
  const opacity = round2(0.12 + definition * 0.34);
  const push = (d: string, weight = 1): void =>
    void lines.push({ d, opacity: round2(opacity * weight) });

  // Pec fan: fibres running from the sternum out to the shoulder.
  if (definition >= STRIATION_THRESHOLDS.pecs) {
    for (const side of [-1, 1] as const) {
      const chest = side === 1 ? w.chest.right : w.chest.left;
      const x = (value: number): number => CX + side * value;
      for (let index = 0; index < 3; index += 1) {
        const t = index / 2;
        const startY = Y.chest - 22 + t * 24;
        const endY = Y.chest - 18 + t * 10;
        push(`M ${x(6)} ${startY} Q ${x(chest * 0.45)} ${startY - 2} ${x(chest * 0.74)} ${endY}`, 0.9);
      }
    }
  }

  // Obliques and serratus: short diagonals under the ribs, down onto the waist.
  if (definition >= STRIATION_THRESHOLDS.obliques) {
    for (const side of [-1, 1] as const) {
      const belly = side === 1 ? w.belly.right : w.belly.left;
      const x = (value: number): number => CX + side * value;
      for (let index = 0; index < 3; index += 1) {
        const y = Y.chest + 18 + index * 14;
        push(
          `M ${x(belly * 0.28)} ${y} Q ${x(belly * 0.6)} ${y + 3} ${x(belly * 0.82)} ${y - 6}`,
          0.72,
        );
      }
    }
  }

  // Quads: long fibres down the front of each thigh.
  if (definition >= STRIATION_THRESHOLDS.quads) {
    for (const side of [-1, 1] as const) {
      const hip = side === 1 ? w.hip.right : w.hip.left;
      const thigh = side === 1 ? w.thigh.right : w.thigh.left;
      const legCenter = hip * 0.48;
      const x = (value: number): number => CX + side * value;
      for (const offset of [-0.42, 0, 0.42]) {
        push(
          `M ${x(legCenter + thigh * offset * 0.5)} ${Y.crotch + 16} C ${x(
            legCenter + thigh * offset,
          )} ${Y.thigh} ${x(legCenter + thigh * offset * 0.9)} ${Y.knee - 44} ${x(
            legCenter + thigh * offset * 0.4,
          )} ${Y.knee - 18}`,
          0.66,
        );
      }
    }
  }

  // Biceps and triceps: one fibre down each upper arm, the last detail to go.
  const armsDeveloped = (segments.arms?.development ?? 0.5) > 0.3;
  if (armsDeveloped) {
    for (const side of [-1, 1] as const) {
      const shoulder = side === 1 ? w.shoulder.right : w.shoulder.left;
      const upper = side === 1 ? w.upperArm.right : w.upperArm.left;
      const x = (value: number): number => CX + side * value;
      push(
        `M ${x(shoulder + upper * 0.1)} ${Y.shoulder + 28} C ${x(shoulder + upper * 0.45)} ${
          Y.chest + 10
        } ${x(shoulder + upper * 0.4)} ${Y.chest + 36} ${x(shoulder + upper * 0.15)} ${
          Y.chest + 54
        }`,
        0.6,
      );
    }
  }

  return lines;
}
