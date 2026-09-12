import type { BodyFatMethod, BodyMeasurements, Sex } from './types';

/**
 * Body composition from tape measurements.
 *
 * Everything here is a published anthropometric formula evaluated on numbers the
 * user actually measured. No model, no inference, no network call — the same
 * inputs always produce the same reading, and a user can check the arithmetic.
 *
 * The previous implementation estimated body fat from BMI and then added
 * `(hash(photo) - 0.5) * 7`, which moved the result by up to 3.5 percentage
 * points on nothing but file bytes. A tape measure beats that comfortably.
 */

const CM_PER_INCH = 2.54;

const cmToInches = (cm: number): number => cm / CM_PER_INCH;

export interface BodyFatEstimate {
  bodyFatPercent: number;
  method: BodyFatMethod;
  /**
   * Rough confidence in the reading. The circumference method validates at
   * roughly ±3-4% against DEXA; a BMI-only estimate is materially worse,
   * especially for muscular or older people.
   */
  confidence: number;
}

/** Plausible human range, used to keep a mistyped tape reading in bounds. */
function plausibleRange(sex: Sex): { min: number; max: number } {
  return sex === 'male' ? { min: 3, max: 60 } : { min: 8, max: 65 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * US Navy circumference method.
 *
 *   men:   86.010 * log10(waist - neck) - 70.041 * log10(height) + 36.76
 *   women: 163.205 * log10(waist + hip - neck) - 97.684 * log10(height) - 78.387
 *
 * The constants are defined for inches, so centimetres are converted first.
 * Returns null when the measurements needed are missing or physically
 * impossible — a neck wider than the waist has no logarithm to take.
 */
export function bodyFatFromCircumference(
  measurements: BodyMeasurements,
  profile: { sex: Sex; heightCm: number },
): number | null {
  const { waistCm, neckCm, hipCm } = measurements;
  if (!waistCm || !neckCm || waistCm <= 0 || neckCm <= 0) return null;

  const height = cmToInches(profile.heightCm);
  const waist = cmToInches(waistCm);
  const neck = cmToInches(neckCm);

  let value: number;

  if (profile.sex === 'male') {
    const girth = waist - neck;
    if (girth <= 0) return null;
    value = 86.010 * Math.log10(girth) - 70.041 * Math.log10(height) + 36.76;
  } else {
    if (!hipCm || hipCm <= 0) return null;
    const girth = waist + cmToInches(hipCm) - neck;
    if (girth <= 0) return null;
    value = 163.205 * Math.log10(girth) - 97.684 * Math.log10(height) - 78.387;
  }

  if (!Number.isFinite(value)) return null;

  const { min, max } = plausibleRange(profile.sex);
  return clamp(value, min, max);
}

/**
 * Deurenberg BMI-based estimate, used only when there is no tape reading.
 *
 *   %BF = 1.2 * BMI + 0.23 * age - 10.8 * (male ? 1 : 0) - 5.4
 *
 * It cannot tell muscle from fat, so it overestimates for trained people and
 * underestimates for sedentary ones. That is why it is the fallback.
 */
export function bodyFatFromBmi(profile: {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
}): number {
  const heightM = profile.heightCm / 100;
  const bmi = profile.weightKg / (heightM * heightM);
  const value = 1.2 * bmi + 0.23 * profile.age - 10.8 * (profile.sex === 'male' ? 1 : 0) - 5.4;

  const { min, max } = plausibleRange(profile.sex);
  return clamp(value, min, max);
}

/** Prefers the measured reading and falls back to BMI, reporting which it used. */
export function estimateBodyFat(
  measurements: BodyMeasurements,
  profile: { sex: Sex; age: number; heightCm: number; weightKg: number },
): BodyFatEstimate {
  const measured = bodyFatFromCircumference(measurements, profile);
  if (measured !== null) {
    return { bodyFatPercent: round1(measured), method: 'navy', confidence: 0.88 };
  }
  return { bodyFatPercent: round1(bodyFatFromBmi(profile)), method: 'bmi', confidence: 0.62 };
}

/**
 * Skeletal muscle mass.
 *
 * Fat-free mass is exact once body fat is known. Skeletal muscle is the part of
 * it that training actually moves — bone, organs and water make up the rest —
 * and sits near 53% of fat-free mass in adults.
 */
export function estimateSkeletalMuscleKg(weightKg: number, bodyFatPercent: number): number {
  const fatFreeMassKg = weightKg * (1 - bodyFatPercent / 100);
  return round1(fatFreeMassKg * 0.53);
}

/** Fat-free mass: everything that is not fat. Exact, given body fat. */
export function leanMassKg(weightKg: number, bodyFatPercent: number): number {
  return round1(weightKg * (1 - bodyFatPercent / 100));
}

/**
 * Waist-to-height ratio, a better predictor of metabolic risk than BMI.
 * Below 0.5 is the usual healthy threshold.
 */
export function waistToHeightRatio(waistCm: number, heightCm: number): number {
  return Math.round((waistCm / heightCm) * 1000) / 1000;
}

/**
 * Left/right balance from limb measurements.
 *
 * Returns null when neither pair was measured — an unmeasured body is not a
 * symmetrical one, and reporting 100% would be an invention. A 1% difference
 * between sides is normal, so the score only falls off beyond that.
 */
export function estimateSymmetry(measurements: BodyMeasurements): number | null {
  const pairs: Array<[number | undefined, number | undefined]> = [
    [measurements.leftArmCm, measurements.rightArmCm],
    [measurements.leftThighCm, measurements.rightThighCm],
  ];

  const differences: number[] = [];
  for (const [left, right] of pairs) {
    if (!left || !right || left <= 0 || right <= 0) continue;
    const mean = (left + right) / 2;
    differences.push(Math.abs(left - right) / mean);
  }

  if (differences.length === 0) return null;

  const averageDifference = differences.reduce((sum, d) => sum + d, 0) / differences.length;
  // 0% difference reads as 100; each further 1% costs about 4 points.
  const score = 100 - Math.max(0, averageDifference * 100 - 1) * 4;
  return round1(clamp(score, 50, 100));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Left/right balance for one limb pair, as a -1..1 offset.
 *
 * Positive means the right side measures larger. Returns 0 when the pair was
 * not measured, which the renderer draws as an even figure — the honest
 * reading for a body nobody has measured.
 */
export function limbBalance(left?: number, right?: number): number {
  if (!left || !right || left <= 0 || right <= 0) return 0;
  const mean = (left + right) / 2;
  return round3(clamp((right - left) / mean, -1, 1));
}

/**
 * Shoulder-to-waist ratio, measured when the user gave a shoulder reading.
 * Returns null otherwise, so callers can fall back to an estimate and say which
 * they used.
 */
export function shoulderToWaistRatio(measurements: BodyMeasurements): number | null {
  const { shoulderCm, waistCm } = measurements;
  if (!shoulderCm || !waistCm || shoulderCm <= 0 || waistCm <= 0) return null;
  return round3(clamp(shoulderCm / waistCm, 1.0, 2.2));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
