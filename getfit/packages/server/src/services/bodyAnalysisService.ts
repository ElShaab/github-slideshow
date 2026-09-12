import {
  ASSESSMENT_INTERVAL_DAYS,
  addDays,
  type AssessmentAvailability,
  type BodyAnalysisResult,
  type BodyAssessment,
  type BodyMeasurements,
  type UserProfile,
} from '@getfit/shared';
import { getBodyAnalysisProvider } from '../ai/remoteBodyAnalysisProvider';
import { assessmentRepository } from '../repositories/assessmentRepository';
import { progressRepository } from '../repositories/progressRepository';
import { errors } from '../utils/errors';
import { logger } from '../utils/logger';
import { photoStorageService } from './photoStorageService';

export interface AnalyzeArgs {
  userId: string;
  profile: UserProfile;
  /** Tape readings the analysis is computed from. All fields are optional. */
  measurements: BodyMeasurements;
  /**
   * An optional progress photo. It is stored privately for the user's own
   * before/after comparison; the default analyser never looks at it.
   */
  photo?: Buffer;
  contentType?: string;
  /** Weight at the time of the assessment; defaults to the profile weight. */
  weightKg?: number;
  /** The first analysis happens before any subscription and ignores the lock. */
  enforceInterval: boolean;
}

/**
 * BodyAnalysisService
 *
 * Orchestrates a body assessment: enforces the seven-day lock, stores the
 * optional progress photo privately, runs the analyser, and persists the
 * assessment, its metrics and its hologram geometry.
 *
 * The analyser is local and formula-based by default, so an assessment needs no
 * photo and no external service. A photo is kept only for the user to compare
 * against later.
 */
export class BodyAnalysisService {
  /**
   * Reports whether a new official assessment is unlocked. Availability is
   * computed server-side so a client clock cannot unlock it early.
   */
  async checkAvailability(userId: string, now = new Date()): Promise<AssessmentAvailability> {
    const latest = await assessmentRepository.latest(userId);
    if (!latest) {
      return { available: true, daysRemaining: 0, nextAvailableAt: null, lastAssessmentAt: null };
    }

    const last = new Date(latest.createdAt);
    const nextAvailable = addDays(last, ASSESSMENT_INTERVAL_DAYS);
    const msRemaining = nextAvailable.getTime() - now.getTime();

    if (msRemaining <= 0) {
      return {
        available: true,
        daysRemaining: 0,
        nextAvailableAt: nextAvailable.toISOString(),
        lastAssessmentAt: latest.createdAt,
      };
    }

    return {
      available: false,
      daysRemaining: Math.ceil(msRemaining / (1000 * 60 * 60 * 24)),
      nextAvailableAt: nextAvailable.toISOString(),
      lastAssessmentAt: latest.createdAt,
    };
  }

  async analyze(args: AnalyzeArgs): Promise<BodyAssessment> {
    const now = new Date();

    if (args.enforceInterval) {
      const availability = await this.checkAvailability(args.userId, now);
      if (!availability.available) {
        throw errors.assessmentLocked(
          `Your next assessment unlocks in ${availability.daysRemaining} ${
            availability.daysRemaining === 1 ? 'day' : 'days'
          }.`,
        );
      }
    }

    let sourcePhotoId: string | null = null;
    if (args.photo) {
      const { photo } = await photoStorageService.store({
        userId: args.userId,
        buffer: args.photo,
        contentType: args.contentType ?? 'image/jpeg',
        purpose: 'assessment',
      });
      sourcePhotoId = photo.id;
    }

    const weightKg = args.weightKg ?? args.profile.weightKg;

    let analysis: BodyAnalysisResult;
    try {
      analysis = await getBodyAnalysisProvider().analyze({
        measurements: args.measurements,
        photo: args.photo,
        contentType: args.contentType,
        profile: {
          age: args.profile.age,
          sex: args.profile.sex,
          heightCm: args.profile.heightCm,
          weightKg,
        },
      });
    } catch (error) {
      logger.error('Body analysis failed', error);
      throw errors.analysisFailed();
    }

    const assessment = await assessmentRepository.create({
      userId: args.userId,
      weightKg,
      analysis,
      measurements: args.measurements,
      sourcePhotoId,
    });

    const recordDate = assessment.createdAt.slice(0, 10);
    try {
      await progressRepository.recordMany([
        { userId: args.userId, recordDate, recordType: 'weight_kg', referenceId: assessment.id, value: weightKg, unit: 'kg' },
        {
          userId: args.userId,
          recordDate,
          recordType: 'body_fat_percent',
          referenceId: assessment.id,
          value: analysis.bodyFatPercent,
          unit: '%',
        },
        {
          userId: args.userId,
          recordDate,
          recordType: 'muscle_mass_kg',
          referenceId: assessment.id,
          value: analysis.estimatedMuscleMassKg,
          unit: 'kg',
        },
      ]);
    } catch (error) {
      // The assessment itself is already saved; a snapshot failure is not fatal.
      logger.warn('Failed to write assessment progress snapshot', { error: String(error) });
    }

    return assessment;
  }
}

export const bodyAnalysisService = new BodyAnalysisService();
