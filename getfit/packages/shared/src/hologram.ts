import { limbBalance, shoulderToWaistRatio } from './bodyComposition';
import type { BodyMeasurements, HologramData, HologramSegment, Sex } from './types';

/**
 * Hologram geometry.
 *
 * Everything the renderer draws is derived from the user's own numbers: body
 * fat and muscle mass from the circumference formulas, the waist from the tape,
 * and each limb's left/right offset from the two sides actually measured. There
 * is no randomness. A segment nobody measured is drawn even, because nothing is
 * known about it — that is the honest default, not a claim of symmetry.
 */
export interface HologramInput {
  bodyFatPercent: number;
  muscleMassKg: number;
  waistBodyRatio: number;
  heightCm: number;
  sex: Sex;
  measurements: BodyMeasurements;
}

export function buildHologramData(input: HologramInput): HologramData {
  const { bodyFatPercent, muscleMassKg, waistBodyRatio, sex, measurements } = input;

  const heightM = input.heightCm / 100;
  // Skeletal muscle index (kg of muscle per m^2), placed on the range that
  // spans a sarcopenic adult to a heavily trained one.
  const muscleIndex = muscleMassKg / (heightM * heightM);
  const floor = sex === 'male' ? 7 : 5.5;
  const ceiling = sex === 'male' ? 14 : 11;
  const muscleNormalized = clamp01((muscleIndex - floor) / (ceiling - floor));

  const bodyFatNormalized = clamp01(
    (bodyFatPercent - (sex === 'male' ? 6 : 12)) / (sex === 'male' ? 32 : 34),
  );

  // Shoulder-to-waist is what actually reads as "athletic" in a silhouette.
  // Use the measured ratio when the user gave a shoulder reading; otherwise
  // derive it from muscle mass and the measured waist.
  const measuredShoulderToWaist = shoulderToWaistRatio(measurements);
  const shoulderToWaist =
    measuredShoulderToWaist ??
    round3(
      clamp(
        (sex === 'male' ? 1.42 : 1.3) +
          muscleNormalized * 0.28 -
          clamp01((waistBodyRatio - 0.38) / 0.24) * 0.3,
        1.02,
        1.85,
      ),
    );

  const armBalance = limbBalance(measurements.leftArmCm, measurements.rightArmCm);
  const thighBalance = limbBalance(measurements.leftThighCm, measurements.rightThighCm);

  // Where a limb was actually measured, its own girth is a far better
  // description of it than a whole-body muscle index. Fall back to the index
  // only for limbs nobody put a tape around.
  const armDevelopment =
    girthDevelopment(
      average(measurements.leftArmCm, measurements.rightArmCm),
      sex === 'male' ? 28 : 23,
      sex === 'male' ? 45 : 37,
    ) ?? muscleNormalized * 0.92;

  const thighDevelopment =
    girthDevelopment(
      average(measurements.leftThighCm, measurements.rightThighCm),
      sex === 'male' ? 48 : 45,
      sex === 'male' ? 74 : 70,
    ) ?? muscleNormalized * 0.95 - bodyFatNormalized * 0.05;

  // A measured limb difference is a real difference, but the silhouette would
  // look grotesque at 1:1 — a 6% arm gap is visible, not a missing arm.
  const visible = (balance: number): number => round3(clamp(balance * 1.5, -0.35, 0.35));

  const segment = (
    key: HologramSegment['key'],
    development: number,
    balance = 0,
  ): HologramSegment => ({
    key,
    development: round3(clamp01(development)),
    balance: visible(balance),
  });

  // Left/right balance is only reported for the segments whose sides were
  // measured. The rest are drawn even rather than invented.
  return {
    version: 1,
    shoulderToWaist: round3(shoulderToWaist),
    bodyFatNormalized: round3(bodyFatNormalized),
    muscleNormalized: round3(muscleNormalized),
    symmetryNormalized: round3(symmetryNormalized(armBalance, thighBalance, measurements)),
    heightCm: input.heightCm,
    sex,
    seed: geometrySeed(input),
    accentPalette: ['#22E3F2', '#0FB9D6', '#7CF6FF'],
    segments: [
      segment('shoulders', muscleNormalized * 1.05 - bodyFatNormalized * 0.12),
      segment('chest', muscleNormalized * 0.98 - bodyFatNormalized * 0.06),
      segment('back', muscleNormalized * 1.02 - bodyFatNormalized * 0.08),
      segment('arms', armDevelopment, armBalance),
      segment('waist', bodyFatNormalized * 1.05),
      segment('hips', bodyFatNormalized * 0.75 + (sex === 'female' ? 0.18 : 0.04)),
      segment('quads', thighDevelopment, thighBalance),
      // Calves follow the legs, which is the closest measured signal there is.
      segment('calves', thighDevelopment * 0.86),
    ],
  };
}

/**
 * 0..1 evenness for the renderer's glow. An unmeasured body sits at the neutral
 * 1.0 the even silhouette already shows; the number the user reads is the
 * nullable symmetry percentage, which stays null in that case.
 */
function symmetryNormalized(
  armBalance: number,
  thighBalance: number,
  measurements: BodyMeasurements,
): number {
  const measured: number[] = [];
  if (measurements.leftArmCm && measurements.rightArmCm) measured.push(Math.abs(armBalance));
  if (measurements.leftThighCm && measurements.rightThighCm) measured.push(Math.abs(thighBalance));
  if (measured.length === 0) return 1;
  const average = measured.reduce((sum, d) => sum + d, 0) / measured.length;
  return clamp01(1 - average * 8);
}

/**
 * Deterministic seed so the same assessment always renders identically. It is
 * derived from the figures being drawn, not from a photo, so an assessment
 * taken without a photo still reproduces exactly.
 */
function geometrySeed(input: HologramInput): number {
  const m = input.measurements;
  const canonical = [
    input.sex,
    input.heightCm,
    input.bodyFatPercent.toFixed(1),
    input.muscleMassKg.toFixed(1),
    input.waistBodyRatio.toFixed(3),
    m.waistCm ?? '',
    m.neckCm ?? '',
    m.hipCm ?? '',
    m.shoulderCm ?? '',
    m.leftArmCm ?? '',
    m.rightArmCm ?? '',
    m.leftThighCm ?? '',
    m.rightThighCm ?? '',
  ].join('|');
  return hash32(canonical);
}

/**
 * FNV-1a, in plain arithmetic.
 *
 * This used to be a SHA-256 prefix, which needed node:crypto and therefore a
 * server. The seed is stored so an assessment can be identified, and nothing
 * in the geometry is derived from it — every segment comes from the
 * measurements — so any stable hash does the job, and this one runs anywhere.
 */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mean of a measured pair, or null when neither side was measured. */
function average(left?: number, right?: number): number | null {
  const values = [left, right].filter((v): v is number => typeof v === 'number' && v > 0);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Places a measured girth on the range from an untrained limb to a large one. */
function girthDevelopment(girthCm: number | null, floor: number, ceiling: number): number | null {
  if (girthCm === null) return null;
  return clamp01((girthCm - floor) / (ceiling - floor));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
