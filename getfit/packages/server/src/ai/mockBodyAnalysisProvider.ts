import { createHash } from 'node:crypto';
import type { BodyAnalysisResult, HologramData, HologramSegment, Sex } from '@getfit/shared';
import type { BodyAnalysisInput, BodyAnalysisProvider } from './types';

/**
 * Deterministic development provider.
 *
 * It is not a vision model: it derives a plausible body-composition estimate
 * from the profile using published anthropometric relationships, then perturbs
 * it with a hash of the actual photo bytes. That gives results that are
 * different for every user and every photo (never hardcoded), stable for the
 * same photo, and coherent week to week — which is what the rest of the app
 * needs in order to be built and tested without production AI credentials.
 */
export class MockBodyAnalysisProvider implements BodyAnalysisProvider {
  readonly name = 'mock-v1';

  async analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult> {
    const { profile, photo, previous, trainingAdherence = 0.5 } = input;

    const seed = hashToUnit(photo);
    const rand = makeRandom(seedInt(photo));

    const heightM = profile.heightCm / 100;
    const bmi = profile.weightKg / (heightM * heightM);
    const sexFactor = profile.sex === 'male' ? 1 : 0;

    // Deurenberg estimate from BMI, age and sex as the anchor point.
    let bodyFat = 1.2 * bmi + 0.23 * profile.age - 10.8 * sexFactor - 5.4;

    // Photo-derived signal: stands in for what a vision model would read off
    // the image (proportions, visible definition, shading).
    const photoSignal = (seed - 0.5) * 7;
    bodyFat += photoSignal;

    if (previous) {
      // Anchor to the previous estimate so week-to-week readings are coherent,
      // and let consistent training move the number in the right direction.
      const weeks = Math.max(1, previous.daysSince / 7);
      const trainingEffect = (trainingAdherence - 0.45) * 0.55 * weeks;
      const anchored = previous.bodyFatPercent - trainingEffect + (rand() - 0.5) * 0.5;
      bodyFat = anchored * 0.72 + bodyFat * 0.28;
    }

    bodyFat = clamp(bodyFat, profile.sex === 'male' ? 4.5 : 10.5, profile.sex === 'male' ? 48 : 55);

    const leanMassKg = profile.weightKg * (1 - bodyFat / 100);
    // Skeletal muscle is a portion of fat-free mass; the remainder is bone,
    // organs and water.
    let muscleMassKg = leanMassKg * (0.935 + (seed - 0.5) * 0.04);
    if (previous) {
      const weeks = Math.max(1, previous.daysSince / 7);
      const gain = trainingAdherence * 0.12 * weeks;
      muscleMassKg = Math.max(muscleMassKg, previous.muscleMassKg + gain - 0.08);
    }

    const waistBodyRatio = estimateWaistBodyRatio(bodyFat, profile.sex, seed);
    const symmetryPercent = estimateSymmetry(rand, previous?.symmetryPercent, trainingAdherence);
    const confidence = estimateConfidence(photo, input.contentType, rand);

    const result: BodyAnalysisResult = {
      bodyFatPercent: round1(bodyFat),
      estimatedMuscleMassKg: round1(muscleMassKg),
      waistBodyRatio: round3(waistBodyRatio),
      symmetryPercent: round1(symmetryPercent),
      confidence: round3(confidence),
      provider: this.name,
      hologramData: buildHologramData({
        bodyFatPercent: bodyFat,
        muscleMassKg,
        waistBodyRatio,
        symmetryPercent,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        sex: profile.sex,
        seed: seedInt(photo),
        rand,
      }),
    };

    return result;
  }
}

function estimateWaistBodyRatio(bodyFat: number, sex: Sex, seed: number): number {
  // Waist-to-height ratio rises roughly linearly with body fat; the intercept
  // differs between sexes because fat distribution does.
  const base = sex === 'male' ? 0.404 : 0.386;
  const slope = sex === 'male' ? 0.0059 : 0.0048;
  const ratio = base + bodyFat * slope + (seed - 0.5) * 0.018;
  return clamp(ratio, 0.36, 0.78);
}

function estimateSymmetry(rand: () => number, previous: number | undefined, adherence: number): number {
  if (previous !== undefined) {
    // Symmetry drifts slowly, and balanced training nudges it upward.
    const drift = (rand() - 0.45) * 1.2 + adherence * 0.4;
    return clamp(previous + drift, 62, 98);
  }
  return clamp(78 + rand() * 16, 62, 98);
}

/**
 * Confidence reflects how much signal the image plausibly carries. It is never
 * used to reject a photo — imperfect framing lowers confidence and analysis
 * continues.
 */
function estimateConfidence(photo: Buffer, contentType: string, rand: () => number): number {
  let confidence = 0.74;

  const kb = photo.byteLength / 1024;
  if (kb < 40) confidence -= 0.16;
  else if (kb < 120) confidence -= 0.06;
  else if (kb > 500) confidence += 0.05;

  const dimensions = readImageDimensions(photo, contentType);
  if (dimensions) {
    const { width, height } = dimensions;
    const shortEdge = Math.min(width, height);
    if (shortEdge < 480) confidence -= 0.1;
    else if (shortEdge >= 900) confidence += 0.05;

    // A full standing body is usually captured in portrait orientation.
    const aspect = height / width;
    if (aspect >= 1.2) confidence += 0.05;
    else if (aspect < 0.85) confidence -= 0.08;
  } else {
    confidence -= 0.04;
  }

  confidence += (rand() - 0.5) * 0.06;
  return clamp(confidence, 0.45, 0.94);
}

/** Reads intrinsic dimensions from JPEG/PNG headers without decoding pixels. */
export function readImageDimensions(
  buffer: Buffer,
  contentType: string,
): { width: number; height: number } | null {
  try {
    if (contentType.includes('png') && buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        const length = buffer.readUInt16BE(offset + 2);
        if (isSof) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

interface HologramInput {
  bodyFatPercent: number;
  muscleMassKg: number;
  waistBodyRatio: number;
  symmetryPercent: number;
  heightCm: number;
  weightKg: number;
  sex: Sex;
  seed: number;
  rand: () => number;
}

/**
 * Builds the geometry payload the HologramViewer renders. It describes the
 * user's CURRENT estimated composition only — it never projects a future body.
 */
export function buildHologramData(input: HologramInput): HologramData {
  const { bodyFatPercent, muscleMassKg, waistBodyRatio, symmetryPercent, sex, rand } = input;

  const leanIndex = muscleMassKg / Math.pow(input.heightCm / 100, 2) / (sex === 'male' ? 22 : 18);
  const muscleNormalized = clamp01((leanIndex - 0.45) / 0.5);
  const bodyFatNormalized = clamp01(
    (bodyFatPercent - (sex === 'male' ? 6 : 12)) / (sex === 'male' ? 32 : 34),
  );
  const symmetryNormalized = clamp01((symmetryPercent - 60) / 38);

  // Shoulder-to-waist is what actually reads as "athletic" in a silhouette.
  // The waist term uses the measured waist-to-height ratio rather than body fat
  // so the drawn waist agrees with the figure shown beside the hologram.
  const waistNormalized = clamp01((waistBodyRatio - 0.38) / 0.24);
  const shoulderToWaist = clamp(
    (sex === 'male' ? 1.42 : 1.3) + muscleNormalized * 0.28 - waistNormalized * 0.3,
    1.02,
    1.85,
  );

  const imbalance = (1 - symmetryNormalized) * 0.12;
  const segment = (
    key: HologramSegment['key'],
    development: number,
  ): HologramSegment => ({
    key,
    development: round3(clamp01(development)),
    balance: round3((rand() - 0.5) * 2 * imbalance),
  });

  return {
    version: 1,
    shoulderToWaist: round3(shoulderToWaist),
    bodyFatNormalized: round3(bodyFatNormalized),
    muscleNormalized: round3(muscleNormalized),
    symmetryNormalized: round3(symmetryNormalized),
    heightCm: input.heightCm,
    sex,
    seed: input.seed,
    accentPalette: ['#22E3F2', '#0FB9D6', '#7CF6FF'],
    segments: [
      segment('shoulders', muscleNormalized * 1.05 - bodyFatNormalized * 0.12),
      segment('chest', muscleNormalized * 0.98 - bodyFatNormalized * 0.06),
      segment('back', muscleNormalized * 1.02 - bodyFatNormalized * 0.08),
      segment('arms', muscleNormalized * 0.92),
      segment('waist', bodyFatNormalized * 1.05),
      segment('hips', bodyFatNormalized * 0.75 + (sex === 'female' ? 0.18 : 0.04)),
      segment('quads', muscleNormalized * 0.95 - bodyFatNormalized * 0.05),
      segment('calves', muscleNormalized * 0.82),
    ],
  };
}

/* ---------------------------- numeric helpers --------------------------- */

function hashToUnit(buffer: Buffer): number {
  const digest = createHash('sha256').update(buffer).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

/** Stable 32-bit seed derived from the photo bytes. */
export function seedInt(buffer: Buffer): number {
  const digest = createHash('sha256').update(buffer).digest();
  return digest.readUInt32BE(4);
}

/** Mulberry32 — small, fast, fully deterministic for a given seed. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
