import {
  GYM_EQUIPMENT,
  type EquipmentId,
  type UserProfile,
  type WorkoutProgram,
} from '@getfit/shared';
import { assessmentRepository } from '../repositories/assessmentRepository';
import { programRepository } from '../repositories/programRepository';
import { userRepository } from '../repositories/userRepository';
import { workoutRepository } from '../repositories/workoutRepository';
import { errors } from '../utils/errors';
import { logger } from '../utils/logger';
import { ExerciseSelectionService } from '@getfit/shared';
import { ProgramGenerationService } from '@getfit/shared';
import { WorkoutAdaptationService } from '@getfit/shared';

/**
 * ProgramService
 *
 * Persistence-aware wrapper around ProgramGenerationService. It gathers the
 * user's current inputs, generates a program, stores it as a new version and
 * lays out the coming week's schedule. Historical programs and completed
 * workouts are always preserved.
 */
export class ProgramService {
  constructor(
    private readonly generator = new ProgramGenerationService(),
    private readonly selection = new ExerciseSelectionService(),
    private readonly adaptation = new WorkoutAdaptationService(),
  ) {}

  /** Gym users implicitly have access to standard commercial gym equipment. */
  async resolveEquipment(userId: string, profile: UserProfile): Promise<EquipmentId[]> {
    if (profile.trainingLocation === 'gym') return GYM_EQUIPMENT;
    const owned = await userRepository.getEquipment(userId);
    return owned.length > 0 ? owned : (['bodyweight'] as EquipmentId[]);
  }

  async generateAndSave(userId: string, reason: string): Promise<WorkoutProgram> {
    const profile = await userRepository.getProfile(userId);
    if (!profile) throw errors.invalidInput('Complete your profile before generating a program.');

    const [goals, preferences, assessment, previousPerformance] = await Promise.all([
      userRepository.getGoals(userId),
      userRepository.getPreferences(userId),
      assessmentRepository.latest(userId),
      workoutRepository.bestWorkingWeights(userId),
    ]);

    const equipment = await this.resolveEquipment(userId, profile);

    // If the user never visited preferences, the AI fills them in itself
    // rather than failing to build a program.
    const effectivePreferences =
      preferences.length > 0
        ? preferences
        : this.selection.generatePreferences({
            location: profile.trainingLocation,
            equipment,
            level: profile.trainingLevel,
            goals: goals.map((g) => g.goalType),
          });

    let program: WorkoutProgram;
    try {
      program = this.generator.generate({
        profile: {
          age: profile.age,
          sex: profile.sex,
          heightCm: profile.heightCm,
          weightKg: profile.weightKg,
          trainingLevel: profile.trainingLevel,
          trainingLocation: profile.trainingLocation,
          trainingDays: profile.trainingDays,
          sessionDurationMinutes: profile.sessionDurationMinutes,
        },
        goals: goals.map((g) => g.goalType),
        equipment,
        exercisePreferences: effectivePreferences,
        bodyMetrics: assessment
          ? {
              bodyFatPercent: assessment.bodyFatPercent,
              muscleMassKg: assessment.estimatedMuscleMassKg,
            }
          : null,
        previousPerformance,
      });
    } catch (error) {
      logger.error('Program generation failed', error);
      throw errors.programGenerationFailed();
    }

    if (program.days.every((day) => day.exercises.length === 0)) {
      throw errors.programGenerationFailed(
        'We could not find enough exercises for the equipment you selected.',
      );
    }

    const saved = await programRepository.save(userId, program, reason);
    await this.scheduleWeek(userId, saved);
    return saved;
  }

  /** Lays out the coming training week from the saved program. */
  async scheduleWeek(userId: string, program: WorkoutProgram, startDate = new Date()): Promise<void> {
    if (!program.id) return;

    const dayIds = program.days.map((d) => d.id).filter((id): id is string => Boolean(id));
    const plan = this.adaptation.planWeek(
      startDate,
      program.trainingDays,
      program.days.map((d) => d.dayNumber),
    );

    const entries = plan
      .map((slot, index) => ({ workoutDayId: dayIds[index], scheduledDate: slot.date }))
      .filter((entry): entry is { workoutDayId: string; scheduledDate: string } =>
        Boolean(entry.workoutDayId),
      );

    await workoutRepository.replaceSchedule(userId, program.id, entries);
  }

  /**
   * Extends the schedule when the user runs out of planned sessions, and folds
   * any missed sessions back into the remaining week first.
   */
  async refreshSchedule(userId: string, now = new Date()): Promise<void> {
    const program = await programRepository.getActive(userId);
    if (!program?.id) return;

    const weekStart = new Date(now);
    const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
    const slots = await workoutRepository.listSchedule(
      userId,
      new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10),
      weekEnd.toISOString().slice(0, 10),
    );

    const reorganisation = this.adaptation.reorganiseWeek(
      slots.map((slot) => ({
        id: slot.id,
        workoutDayId: slot.programDayId,
        dayNumber: slot.dayNumber,
        focus: slot.focus,
        scheduledDate: slot.scheduledDate,
        status: slot.status,
      })),
      now,
      weekEnd,
    );

    for (const update of reorganisation.updates) {
      await workoutRepository.updateScheduleEntry(userId, update.id, {
        scheduledDate: update.scheduledDate,
        status: update.status,
      });
    }

    // Anything older than the window above was never reachable by the
    // reorganisation, so retire it rather than let it sit "scheduled" forever.
    await workoutRepository.markStaleAsMissed(
      userId,
      new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10),
    );

    const upcoming = await workoutRepository.listUpcoming(userId, 1);
    if (upcoming.length === 0) {
      await this.scheduleWeek(userId, program, weekStart);
    }
  }
}

export const programService = new ProgramService();
