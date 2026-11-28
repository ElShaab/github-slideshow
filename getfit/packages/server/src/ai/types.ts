import type { BodyAnalysisResult, BodyMeasurements, Sex } from '@getfit/shared';

export interface BodyAnalysisInput {
  /** The tape readings the analysis is computed from. */
  measurements: BodyMeasurements;
  profile: {
    age: number;
    sex: Sex;
    heightCm: number;
    weightKg: number;
  };
  /**
   * An optional progress photo. The default analyser never reads it — it is
   * kept for the user's own before/after comparison — and it is only passed to
   * a provider that has been explicitly configured to look at one.
   */
  photo?: Buffer;
  contentType?: string;
}

export interface BodyAnalysisProvider {
  readonly name: string;
  analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult>;
}
