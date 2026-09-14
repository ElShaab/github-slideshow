import {
  estimateBodyFat,
  estimateSkeletalMuscleKg,
  estimateSymmetry,
  waistToHeightRatio,
  type BodyAnalysisResult,
} from '@getfit/shared';
import { buildHologramData } from './hologram';
import type { BodyAnalysisInput, BodyAnalysisProvider } from './types';

/**
 * The default body analyser. No AI, no network call, no photo.
 *
 * It evaluates published anthropometric formulas on the tape measurements the
 * user entered: the US Navy circumference method for body fat, fat-free mass
 * for muscle, the measured waist for the waist-to-height ratio, and the two
 * limb pairs for left/right balance. The same inputs always produce the same
 * reading, and every figure traces back to a number the user can re-measure.
 *
 * When there is no tape reading it falls back to the Deurenberg BMI estimate
 * and says so — `method: 'bmi'` with a markedly lower confidence — rather than
 * presenting a guess as a measurement.
 */
export class MeasurementBodyAnalysisProvider implements BodyAnalysisProvider {
  readonly name = 'measurement-v1';

  async analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult> {
    const { profile, measurements } = input;

    const { bodyFatPercent, method, confidence } = estimateBodyFat(measurements, profile);
    const estimatedMuscleMassKg = estimateSkeletalMuscleKg(profile.weightKg, bodyFatPercent);

    // With a tape reading the ratio is measured. Without one, the waist is
    // inferred from the body-fat estimate, which is why confidence is already
    // lower in that branch.
    const waistBodyRatio = measurements.waistCm
      ? waistToHeightRatio(measurements.waistCm, profile.heightCm)
      : inferredWaistRatio(bodyFatPercent, profile.sex);

    return {
      bodyFatPercent,
      estimatedMuscleMassKg,
      waistBodyRatio,
      symmetryPercent: estimateSymmetry(measurements),
      method,
      confidence,
      provider: this.name,
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
}

/**
 * Waist-to-height rises close to linearly with body fat, with a different
 * intercept per sex because fat distribution differs. Only used to keep the
 * drawn figure sensible when the user skipped the tape.
 */
function inferredWaistRatio(bodyFatPercent: number, sex: 'male' | 'female'): number {
  const base = sex === 'male' ? 0.404 : 0.386;
  const slope = sex === 'male' ? 0.0059 : 0.0048;
  const ratio = base + bodyFatPercent * slope;
  return Math.round(Math.min(0.78, Math.max(0.36, ratio)) * 1000) / 1000;
}
