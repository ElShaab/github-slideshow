import {
  estimateSkeletalMuscleKg,
  estimateSymmetry,
  waistToHeightRatio,
  type BodyAnalysisResult,
} from '@getfit/shared';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { buildHologramData } from './hologram';
import { MeasurementBodyAnalysisProvider } from './measurementBodyAnalysisProvider';
import type { BodyAnalysisInput, BodyAnalysisProvider } from './types';

/**
 * Optional vision provider.
 *
 * GetFit does not need this — the built-in measurement analyser is the default
 * and requires no external service. Configuring AI_PROVIDER swaps in a vision
 * endpoint that reads the photo, for deployments that want one.
 *
 * The endpoint receives the photo, the profile and the tape measurements, and
 * is expected to return:
 *   { bodyFatPercent, muscleMassKg?, waistBodyRatio?, symmetryPercent? }
 * Anything it omits is filled in from the measurements, and the hologram
 * geometry is always derived locally so the renderer contract is identical
 * whichever provider is configured.
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
    if (!input.photo) {
      throw new AppError(
        'photo_required',
        'This analysis provider needs a photo. Add one, or measure yourself with a tape.',
        400,
      );
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
          contentType: input.contentType ?? 'image/jpeg',
          profile: input.profile,
          measurements: input.measurements,
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

    const bodyFatPercent = round1(requireNumber(payload.bodyFatPercent, 'bodyFatPercent'));
    const muscleMassKg = optionalNumber(payload.muscleMassKg) ?? null;
    const estimatedMuscleMassKg =
      muscleMassKg === null
        ? estimateSkeletalMuscleKg(input.profile.weightKg, bodyFatPercent)
        : round1(muscleMassKg);

    // Prefer the user's own tape reading over the provider's guess at it.
    const measuredWaistRatio = input.measurements.waistCm
      ? waistToHeightRatio(input.measurements.waistCm, input.profile.heightCm)
      : null;
    const waistBodyRatio =
      measuredWaistRatio ??
      round3(optionalNumber(payload.waistBodyRatio) ?? bodyFatPercent * 0.0059 + 0.404);

    const measuredSymmetry = estimateSymmetry(input.measurements);
    const symmetryPercent =
      measuredSymmetry ?? nullableRound1(optionalNumber(payload.symmetryPercent));

    return {
      bodyFatPercent,
      estimatedMuscleMassKg,
      waistBodyRatio,
      symmetryPercent,
      // The figure came off a photo, not the circumference formula, and the
      // app says so rather than borrowing the measured method's credibility.
      method: 'vision',
      confidence: clamp01(optionalNumber(payload.confidence) ?? 0.8),
      provider: this.name,
      hologramData: buildHologramData({
        bodyFatPercent,
        muscleMassKg: estimatedMuscleMassKg,
        waistBodyRatio,
        heightCm: input.profile.heightCm,
        sex: input.profile.sex,
        measurements: input.measurements,
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

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function nullableRound1(value: number | null): number | null {
  return value === null ? null : round1(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

let cached: BodyAnalysisProvider | null = null;

/**
 * Resolves the analyser. The local measurement analyser is the default and
 * needs no configuration; AI_PROVIDER opts into a remote vision endpoint.
 */
export function getBodyAnalysisProvider(): BodyAnalysisProvider {
  if (cached) return cached;
  if (env.aiProvider) {
    cached = new RemoteBodyAnalysisProvider(env.aiBaseUrl, env.aiApiKey, env.aiProvider);
  } else {
    cached = new MeasurementBodyAnalysisProvider();
  }
  return cached;
}

/** Test seam — lets tests inject a provider without touching the environment. */
export function setBodyAnalysisProvider(provider: BodyAnalysisProvider | null): void {
  cached = provider;
}
