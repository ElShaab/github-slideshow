import {
  ASSESSMENT_INTERVAL_DAYS,
  addDays,
  type AssessmentAvailability,
  type BodyAnalysisResult,
  type BodyAssessment,
  type UserProfile,
} from '@getfit/shared';
import { getBodyAnalysisProvider } from '../ai/remoteBodyAnalysisProvider';
import { assessmentRepository } from '../repositories/assessmentRepository';
import { workoutRepository } from '../repositories/workoutRepository';
import { errors } from '../utils/errors';
import { logger } from '../utils/logger';
import { photoStorageService } from './photoStorageService';

export interface AnalyzeArgs {
  userId: string;
  profile: UserProfile;
  photo: Buffer;
  contentType: string;
  /** Weight at the time of the assessment; defaults to the profile weight. */
  weightKg?: number;
  /** The first analysis happens before any subscription and ignores the lock. */
  enforceInterval: boolean;
}

/**
 * BodyAnalysisService
 *
 * Orchestrates a body assessment: enforces the seven-day lock, stores the photo
 * privately, runs the configured AI provider, and persists the assessment, its
 * metrics and its hologram geometry.
 *
 * Imperfect framing is never a blocker. A usable-but-imperfect photo lowers the
 * confidence score and the analysis proceeds.
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

    const { photo } = await photoStorageService.store({
      userId: args.userId,
      buffer: args.photo,
      contentType: args.contentType,
      purpose: 'assessment',
    });

    const previous = await assessmentRepository.latest(args.userId);
    const adherence = await this.trainingAdherence(args.userId);
    const weightKg = args.weightKg ?? args.profile.weightKg;

    let analysis: BodyAnalysisResult;
    try {
      analysis = await getBodyAnalysisProvider().analyze({
        photo: args.photo,
        contentType: args.contentType,
        profile: {
          age: args.profile.age,
          sex: args.profile.sex,
          heightCm: args.profile.heightCm,
          weightKg,
        },
        previous: previous
          ? {
              bodyFatPercent: previous.bodyFatPercent,
              muscleMassKg: previous.estimatedMuscleMassKg,
              symmetryPercent: previous.symmetryPercent,
              waistBodyRatio: previous.waistBodyRatio,
              daysSince: Math.max(
                1,
                Math.round((now.getTime() - new Date(previous.createdAt).getTime()) / 86_400_000),
              ),
            }
          : undefined,
        trainingAdherence: adherence,
      });
    } catch (error) {
      logger.error('Body analysis failed', error);
      throw errors.analysisFailed();
    }

    return assessmentRepository.create({
      userId: args.userId,
      weightKg,
      analysis,
      sourcePhotoId: photo.id,
    });
  }

  /** Fraction of scheduled sessions the user actually completed. */
  private async trainingAdherence(userId: string): Promise<number> {
    const counts = await workoutRepository.countSchedule(userId);
    if (counts.total === 0) return 0.5;
    return Math.max(0, Math.min(1, counts.completed / counts.total));
  }
}

export const bodyAnalysisService = new BodyAnalysisService();
