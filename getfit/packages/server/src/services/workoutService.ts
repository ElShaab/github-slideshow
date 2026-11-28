import {
  EXERCISE_BY_ID,
  type CompletedSet,
  type CompletedWorkout,
  type Exercise,
  type PersonalRecord,
  type ProgramDay,
  type ScheduledWorkout,
} from '@getfit/shared';
import { programRepository } from '../repositories/programRepository';
import { progressRepository } from '../repositories/progressRepository';
import { userRepository } from '../repositories/userRepository';
import { workoutRepository } from '../repositories/workoutRepository';
import { errors } from '../utils/errors';
import { logger } from '../utils/logger';
import { detectPersonalRecords } from '@getfit/shared';
import { ProgressionService } from '@getfit/shared';

export interface CompleteWorkoutRequest {
  userId: string;
  scheduledWorkoutId: string | null;
  workoutDayId: string;
  startedAt: string;
  durationSeconds: number;
  cardioMinutes: number;
  exercises: Array<{
    exerciseId: string;
    workoutExerciseId: string | null;
    orderIndex: number;
    sets: Array<{
      setNumber: number;
      actualWeight: number | null;
      actualReps: number | null;
      prescribedWeight: number | null;
      prescribedRepsMin: number;
      prescribedRepsMax: number;
      isWarmup: boolean;
      completedAt?: string;
    }>;
  }>;
}

export interface WorkoutSummary extends CompletedWorkout {
  exerciseCount: number;
  progressionNotes: string[];
}

/**
 * WorkoutService
 *
 * Owns starting and finishing a guided workout: hydrating today's session,
 * persisting what was actually lifted, detecting personal records, and feeding
 * the result into the progression engine so the next session is already
 * adjusted before the user opens it.
 */
export class WorkoutService {
  constructor(private readonly progression = new ProgressionService()) {}

  async getTodaysWorkout(
    userId: string,
  ): Promise<{ scheduled: ScheduledWorkout; day: ProgramDay } | null> {
    const scheduled = await workoutRepository.findTodaysWorkout(userId);
    if (!scheduled) return null;

    const day = await programRepository.getDay(userId, scheduled.programDayId);
    if (!day) return null;

    return { scheduled, day };
  }

  async complete(request: CompleteWorkoutRequest): Promise<WorkoutSummary> {
    const day = await programRepository.getDay(request.userId, request.workoutDayId);
    if (!day) throw errors.notFound('That workout is no longer part of your program.');

    if (request.exercises.length === 0) {
      throw errors.invalidInput('Log at least one set before finishing the workout.');
    }

    const now = new Date().toISOString();

    const sets = request.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      workoutExerciseId: exercise.workoutExerciseId,
      orderIndex: exercise.orderIndex,
      sets: exercise.sets.map(
        (set): CompletedSet => ({
          setNumber: set.setNumber,
          actualWeight: set.actualWeight,
          actualReps: set.actualReps,
          // The prescription is copied as-is and never overwritten by what was
          // actually lifted — both are needed for honest progression.
          prescribedWeight: set.prescribedWeight,
          prescribedRepsMin: set.prescribedRepsMin,
          prescribedRepsMax: set.prescribedRepsMax,
          isWarmup: set.isWarmup,
          completedAt: set.completedAt ?? now,
        }),
      ),
    }));

    // Link the record back to the program it came from, so history can still
    // be attributed after the program is regenerated or archived.
    const programId = await programRepository.getProgramIdForDay(
      request.userId,
      request.workoutDayId,
    );

    const completed = await workoutRepository.completeWorkout({
      userId: request.userId,
      programId,
      workoutDayId: request.workoutDayId,
      dayNumber: day.dayNumber,
      focus: day.focus,
      startedAt: request.startedAt,
      durationSeconds: request.durationSeconds,
      cardioMinutes: request.cardioMinutes,
      exercises: sets,
    });

    const personalRecords = await this.recordPersonalRecords(request.userId, completed.id, sets, now);
    const progressionNotes = await this.applyProgression(request.userId, day, sets);
    await this.recordProgressSnapshot(request.userId, completed, request.cardioMinutes);

    if (request.scheduledWorkoutId) {
      await workoutRepository.updateScheduleEntry(request.userId, request.scheduledWorkoutId, {
        status: 'completed',
        completedWorkoutId: completed.id,
      });
    }

    return {
      ...completed,
      personalRecords,
      exerciseCount: sets.length,
      progressionNotes,
    };
  }

  /** Snapshots the session so the Progress tab stays fast as history grows. */
  private async recordProgressSnapshot(
    userId: string,
    completed: CompletedWorkout,
    cardioMinutes: number,
  ): Promise<void> {
    const recordDate = completed.completedAt.slice(0, 10);
    try {
      await progressRepository.recordMany([
        {
          userId,
          recordDate,
          recordType: 'workout_volume',
          referenceId: completed.id,
          value: completed.totalVolumeKg,
          unit: 'kg',
          metadata: { focus: completed.focus, dayNumber: completed.dayNumber },
        },
        {
          userId,
          recordDate,
          recordType: 'workout_sets',
          referenceId: completed.id,
          value: completed.totalSets,
          unit: 'sets',
        },
        {
          userId,
          recordDate,
          recordType: 'workout_duration',
          referenceId: completed.id,
          value: completed.durationSeconds,
          unit: 'seconds',
        },
        ...(cardioMinutes > 0
          ? [
              {
                userId,
                recordDate,
                recordType: 'cardio_minutes' as const,
                referenceId: completed.id,
                value: cardioMinutes,
                unit: 'minutes',
              },
            ]
          : []),
      ]);
    } catch (error) {
      // A snapshot is a convenience, never a reason to lose a saved workout.
      logger.warn('Failed to write progress snapshot', { error: String(error) });
    }
  }

  private async recordPersonalRecords(
    userId: string,
    completedWorkoutId: string,
    exercises: Array<{ exerciseId: string; sets: CompletedSet[] }>,
    achievedAt: string,
  ): Promise<PersonalRecord[]> {
    const all: PersonalRecord[] = [];

    for (const exercise of exercises) {
      const existing = await workoutRepository.existingRecords(userId, exercise.exerciseId);
      const detected = detectPersonalRecords({
        exerciseId: exercise.exerciseId,
        sets: exercise.sets,
        existing,
        achievedAt,
      });
      if (detected.length === 0) continue;
      const saved = await workoutRepository.savePersonalRecords(userId, completedWorkoutId, detected);
      all.push(...saved);
    }

    return all;
  }

  /**
   * Runs the progression engine over everything that was just performed and
   * writes the next prescription back onto the program.
   */
  private async applyProgression(
    userId: string,
    day: ProgramDay,
    performed: Array<{ exerciseId: string; workoutExerciseId: string | null; sets: CompletedSet[] }>,
  ): Promise<string[]> {
    const profile = await userRepository.getProfile(userId);
    if (!profile) return [];

    const notes: string[] = [];

    for (const entry of performed) {
      const exercise: Exercise | undefined = EXERCISE_BY_ID[entry.exerciseId];
      if (!exercise) continue;

      const programExercise = day.exercises.find((e) => e.exerciseId === entry.exerciseId);
      if (!programExercise?.id) continue;

      const working = entry.sets.filter((s) => !s.isWarmup);
      if (working.length === 0) continue;

      const decision = this.progression.decide({
        exercise,
        location: profile.trainingLocation,
        baseSets: programExercise.sets,
        repsMin: programExercise.repsMin,
        repsMax: programExercise.repsMax,
        lastPerformance: {
          exerciseId: entry.exerciseId,
          performedAt: new Date().toISOString(),
          sets: entry.sets.map((s) => ({
            weight: s.actualWeight,
            reps: s.actualReps,
            isWarmup: s.isWarmup,
          })),
          prescribedWeight: working[0]?.prescribedWeight ?? programExercise.startingWeight,
          prescribedSets: programExercise.sets,
          prescribedRepsMin: working[0]?.prescribedRepsMin ?? programExercise.repsMin,
          prescribedRepsMax: working[0]?.prescribedRepsMax ?? programExercise.repsMax,
        },
      });

      try {
        await programRepository.updatePrescription(userId, programExercise.id, {
          weight: decision.nextWeight,
          sets: decision.nextSets,
          repsMin: decision.nextRepsMin,
          repsMax: decision.nextRepsMax,
        });
      } catch (error) {
        // A progression write failing must never lose the completed workout.
        logger.warn('Failed to apply progression', { exerciseId: entry.exerciseId, error: String(error) });
        continue;
      }

      if (decision.action !== 'hold' && decision.action !== 'initial') {
        notes.push(`${exercise.name}: ${decision.reason}`);
      }
    }

    return notes;
  }
}

export const workoutService = new WorkoutService();
