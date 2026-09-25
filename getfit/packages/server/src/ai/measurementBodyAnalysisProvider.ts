import { analyzeBody, type BodyAnalysisResult } from '@getfit/shared';
import type { BodyAnalysisInput, BodyAnalysisProvider } from './types';

/**
 * The default body analyser, wrapping the shared pure function.
 *
 * The formulas live in @getfit/shared so the app can run them with no network;
 * this adapter exists only to present them through the provider interface the
 * server's routes expect.
 */
export class MeasurementBodyAnalysisProvider implements BodyAnalysisProvider {
  readonly name = 'measurement-v1';

  async analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult> {
    return analyzeBody({ measurements: input.measurements, profile: input.profile });
  }
}
