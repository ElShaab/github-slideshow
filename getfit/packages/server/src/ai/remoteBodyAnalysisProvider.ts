import type { BodyAnalysisResult } from '@getfit/shared';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { buildHologramData, makeRandom } from './mockBodyAnalysisProvider';
import type { BodyAnalysisInput, BodyAnalysisProvider } from './types';

/**
 * Production provider. It posts the photo and profile to a configured vision
 * endpoint and normalises the response into BodyAnalysisResult.
 *
 * The endpoint is expected to return:
 *   { bodyFatPercent, muscleMassKg, waistBodyRatio, symmetryPercent, confidence }
 * Hologram geometry is derived locally from those metrics so the renderer
 * contract stays identical no matter which provider is configured.
 */
export class RemoteBodyAnalysisProvider implements BodyAnalysisProvider {
  readonly name: string;

  constructor(private readonly baseUrl: string, private readonly apiKey: string, name = 'remote-v1') {
    this.name = name;
  }

  async analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult> {
    if (!this.baseUrl || !this.apiKey) {
      throw new AppError('analysis_unavailable', 'Body analysis is temporarily unavailable.', 503);
    }

    let payload: RemoteResponse;
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/body-analysis`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          image: input.photo.toString('base64'),
          contentType: input.contentType,
          profile: input.profile,
          previous: input.previous ?? null,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        logger.warn('Body analysis provider returned a non-OK status', { status: response.status });
        throw new AppError('analysis_failed', 'We could not analyse that photo. Please try again.', 502);
      }
      payload = (await response.json()) as RemoteResponse;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Body analysis provider request failed', error);
      throw new AppError('analysis_failed', 'We could not analyse that photo. Please try again.', 502);
    }

    const bodyFatPercent = requireNumber(payload.bodyFatPercent, 'bodyFatPercent');
    const muscleMassKg = requireNumber(payload.muscleMassKg, 'muscleMassKg');
    const waistBodyRatio = requireNumber(payload.waistBodyRatio, 'waistBodyRatio');
    const symmetryPercent = requireNumber(payload.symmetryPercent, 'symmetryPercent');

    return {
      bodyFatPercent: round1(bodyFatPercent),
      estimatedMuscleMassKg: round1(muscleMassKg),
      waistBodyRatio: Math.round(waistBodyRatio * 1000) / 1000,
      symmetryPercent: round1(symmetryPercent),
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.8,
      provider: this.name,
      hologramData: buildHologramData({
        bodyFatPercent,
        muscleMassKg,
        waistBodyRatio,
        symmetryPercent,
        heightCm: input.profile.heightCm,
        weightKg: input.profile.weightKg,
        sex: input.profile.sex,
        seed: Math.floor(Math.random() * 0xffffffff),
        rand: makeRandom(Math.floor(bodyFatPercent * 1000 + symmetryPercent)),
      }),
    };
  }
}

interface RemoteResponse {
  bodyFatPercent?: unknown;
  muscleMassKg?: unknown;
  waistBodyRatio?: unknown;
  symmetryPercent?: unknown;
  confidence?: unknown;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    logger.warn('Body analysis provider returned a malformed field', { field });
    throw new AppError('analysis_failed', 'We could not analyse that photo. Please try again.', 502);
  }
  return value;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

let cached: BodyAnalysisProvider | null = null;

/** Resolves the provider named by MOCK_AI_MODE / AI_PROVIDER. */
export function getBodyAnalysisProvider(): BodyAnalysisProvider {
  if (cached) return cached;
  const { MockBodyAnalysisProvider } = require('./mockBodyAnalysisProvider') as typeof import('./mockBodyAnalysisProvider');
  if (env.mockAiMode || env.aiProvider === 'mock') {
    logger.info('Body analysis running in MOCK_AI_MODE');
    cached = new MockBodyAnalysisProvider();
  } else {
    cached = new RemoteBodyAnalysisProvider(env.aiBaseUrl, env.aiApiKey, env.aiProvider);
  }
  return cached;
}

/** Test seam — lets tests inject a provider without touching the environment. */
export function setBodyAnalysisProvider(provider: BodyAnalysisProvider | null): void {
  cached = provider;
}
