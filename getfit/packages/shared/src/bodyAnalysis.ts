import {
  estimateBodyFat,
  estimateSkeletalMuscleKg,
  estimateSymmetry,
  typicalSymmetry,
  waistToHeightRatio,
} from './bodyComposition';
import { buildHologramData } from './hologram';
import type { BodyAnalysisResult, BodyMeasurements, Sex } from './types';

export interface BodyAnalysisInput {
  measurements: BodyMeasurements;
  profile: { age: number; sex: Sex; heightCm: number; weightKg: number };
}

/**
 * Body composition from tape measurements.
 *
 * A pure function: no network, no database, no model. It ran on the server and
 * it runs on the device, and it produces identical figures in both — which is
 * what makes the analysis something the user could check by hand.
 */
export function analyzeBody(input: BodyAnalysisInput): BodyAnalysisResult {
  const { profile, measurements } = input;

  const { bodyFatPercent, method, confidence } = estimateBodyFat(measurements, profile);
  const estimatedMuscleMassKg = estimateSkeletalMuscleKg(profile.weightKg, bodyFatPercent);

  // With a tape reading the ratio is measured. Without one, the waist is
  // inferred from the body-fat estimate, which is why confidence is already
  // lower in that branch.
  const waistBodyRatio = measurements.waistCm
    ? waistToHeightRatio(measurements.waistCm, profile.heightCm)
    : inferredWaistRatio(bodyFatPercent, profile.sex);

  // Measured when both sides of a limb pair went round a tape; otherwise the
  // population figure, flagged as an estimate. The same trade the waist ratio
  // above already makes: a number the user can act on beats a dash, as long as
  // the app is straight about where it came from.
  const measuredSymmetry = estimateSymmetry(measurements);

  return {
    bodyFatPercent,
    estimatedMuscleMassKg,
    waistBodyRatio,
    symmetryPercent: measuredSymmetry ?? typicalSymmetry(profile),
    symmetryMethod: measuredSymmetry === null ? 'estimated' : 'measured',
    method,
    confidence,
    provider: 'measurement-v1',
    hologramData: buildHologramData({
      bodyFatPercent,
      muscleMassKg: estimatedMuscleMassKg,
      waistBodyRatio,
      heightCm: profile.heightCm,
      sex: profile.sex,
      measurements,
    }),
  };
}

/**
 * Waist-to-height rises close to linearly with body fat, with a different
 * intercept per sex because fat distribution differs. Only used to keep the
 * drawn figure sensible when the user skipped the tape.
 */
function inferredWaistRatio(bodyFatPercent: number, sex: Sex): number {
  const base = sex === 'male' ? 0.404 : 0.386;
  const slope = sex === 'male' ? 0.0059 : 0.0048;
  const ratio = base + bodyFatPercent * slope;
  return Math.round(Math.min(0.78, Math.max(0.36, ratio)) * 1000) / 1000;
}
