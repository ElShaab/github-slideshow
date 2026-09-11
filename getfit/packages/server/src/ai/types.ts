import type { BodyAnalysisResult, Sex } from '@getfit/shared';

export interface BodyAnalysisInput {
  /** Raw photo bytes. Never persisted by the provider itself. */
  photo: Buffer;
  contentType: string;
  profile: {
    age: number;
    sex: Sex;
    heightCm: number;
    weightKg: number;
  };
  /** Previous assessment, when one exists, so estimates stay coherent over time. */
  previous?: {
    bodyFatPercent: number;
    muscleMassKg: number;
    symmetryPercent: number;
    waistBodyRatio: number;
    daysSince: number;
  };
  /** 0..1 how much of the prescribed training the user actually completed. */
  trainingAdherence?: number;
}

export interface BodyAnalysisProvider {
  readonly name: string;
  analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult>;
}
