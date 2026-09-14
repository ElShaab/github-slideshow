import {
  EXERCISE_BY_ID,
  estimateOneRepMax,
  type BodyTrends,
  type ProgressOverview,
  type StrengthProgressEntry,
  type TrainingStats,
} from '@getfit/shared';
import { assessmentRepository } from '../repositories/assessmentRepository';
import { progressRepository } from '../repositories/progressRepository';
import { userRepository } from '../repositories/userRepository';
import { workoutRepository } from '../repositories/workoutRepository';
import { GoalTrackingService } from './goalTrackingService';

/**
 * ProgressAnalysisService
 *
 * Assembles everything the Progress tab renders: body trends from the stored
 * metric rows, strength curves from real completed sets, training stats and
 * goal progress. Nothing here is fabricated — every series is read back from
 * data the user generated.
 */
export class ProgressAnalysisService {
  constructor(private readonly goals = new GoalTrackingService()) {}

  async overview(userId: string): Promise<ProgressOverview> {
    const [latestAssessment, firstAssessment, trends, strength, personalRecords, training, userGoals] =
      await Promise.all([
        assessmentRepository.latest(userId),
        assessmentRepository.first(userId),
        this.bodyTrends(userId),
        this.strengthProgress(userId),
        workoutRepository.listPersonalRecords(userId),
        this.trainingStats(userId),
        userRepository.getGoals(userId),
      ]);

    const goals = this.goals.track({
      goals: userGoals,
      firstAssessment,
      latestAssessment,
      personalRecords,
      workoutsCompleted: training.workoutsCompleted,
      workoutsScheduled: training.workoutsScheduled,
    });

    return { latestAssessment, trends, strength, personalRecords, training, goals };
  }

  async bodyTrends(userId: string): Promise<BodyTrends> {
    const [weightKg, bodyFatPercent, muscleMassKg, waistBodyRatio, symmetryPercent] = await Promise.all([
      assessmentRepository.trend(userId, 'weight_kg'),
      assessmentRepository.trend(userId, 'body_fat_percent'),
      assessmentRepository.trend(userId, 'muscle_mass_kg'),
      assessmentRepository.trend(userId, 'waist_body_ratio'),
      assessmentRepository.trend(userId, 'symmetry_percent'),
    ]);
    return { weightKg, bodyFatPercent, muscleMassKg, waistBodyRatio, symmetryPercent };
  }

  async strengthProgress(userId: string, limit = 8): Promise<StrengthProgressEntry[]> {
    const exerciseIds = await workoutRepository.trainedExercises(userId, limit);
    const entries: StrengthProgressEntry[] = [];

    for (const exerciseId of exerciseIds) {
      const points = await workoutRepository.strengthTrend(userId, exerciseId);
      if (points.length === 0) continue;

      const exercise = EXERCISE_BY_ID[exerciseId];
      const bestWeight = Math.max(...points.map((p) => p.value));
      const lastPerformance = await workoutRepository.lastPerformance(userId, exerciseId);
      const best1rm = lastPerformance
        ? Math.max(
            ...lastPerformance.sets
              .filter((s) => !s.isWarmup)
              .map((s) => estimateOneRepMax(s.weight ?? 0, s.reps ?? 0)),
            0,
          )
        : 0;

      entries.push({
        exerciseId,
        exerciseName: exercise?.name ?? exerciseId,
        points,
        bestWeight,
        bestEstimated1rm: Math.round(best1rm * 10) / 10,
      });
    }

    // Lead with the lifts that have the most history to show.
    return entries.sort((a, b) => b.points.length - a.points.length);
  }

  async trainingStats(userId: string): Promise<TrainingStats> {
    const [counts, totals, weeklyVolume, completed] = await Promise.all([
      workoutRepository.countSchedule(userId),
      workoutRepository.totals(userId),
      workoutRepository.weeklyVolume(userId),
      workoutRepository.listCompleted(userId, 60),
    ]);

    // Snapshots cover sessions logged since they were introduced; the
    // aggregate over completed_workouts remains the source of truth so older
    // history is never dropped from the chart.
    const snapshotVolume = await progressRepository
      .series(userId, 'workout_volume')
      .catch(() => []);

    return {
      completionRatePercent:
        counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100),
      workoutsCompleted: totals.workouts,
      workoutsScheduled: counts.total,
      weeklyVolume: weeklyVolume.length > 0 ? weeklyVolume : snapshotVolume,
      totalSets: totals.sets,
      currentStreakDays: computeStreak(completed.map((w) => w.completedAt)),
    };
  }
}

/**
 * Consecutive days ending today (or yesterday) on which a workout was completed.
 * A rest day does not break the streak — only a missed training day would, and
 * that is already captured by completion rate.
 */
export function computeStreak(completedAtIso: string[], now = new Date()): number {
  if (completedAtIso.length === 0) return 0;

  const days = new Set(completedAtIso.map((iso) => iso.slice(0, 10)));
  const sorted = [...days].sort().reverse();
  const mostRecent = new Date(`${sorted[0]}T00:00:00Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const daysSinceLast = Math.round((today.getTime() - mostRecent.getTime()) / 86_400_000);

  // More than three days without training ends the streak.
  if (daysSinceLast > 3) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const current = new Date(`${sorted[i]}T00:00:00Z`);
    const previous = new Date(`${sorted[i - 1]}T00:00:00Z`);
    const gap = Math.round((previous.getTime() - current.getTime()) / 86_400_000);
    if (gap > 3) break;
    streak += 1;
  }
  return streak;
}

export const progressAnalysisService = new ProgressAnalysisService();
