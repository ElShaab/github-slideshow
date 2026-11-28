import {
  EXERCISE_BY_ID,
  GoalTrackingService,
  ProgressionService,
  detectPersonalRecords,
  errors,
  estimateOneRepMax,
  isoDate,
  type CompletedExercise,
  type CompletedSet,
  type CompletedWorkout,
  type ExistingRecords,
  type PersonalRecord,
  type ProgramDay,
  type ProgressOverview,
  type TrendPoint,
} from '@getfit/shared';
import { localId, type LocalRepository } from './repository';

export interface CompleteWorkoutInput {
  scheduledWorkoutId: string | null;
  workoutDayId: string;
  startedAt: string;
  durationSeconds: number;
  cardioMinutes: number;
  exercises: Array<{
    exerciseId: string;
    workoutExerciseId: string | null;
    orderIndex: number;
    sets: CompletedSet[];
  }>;
}

export interface WorkoutSummary extends CompletedWorkout {
  exerciseCount: number;
  progressionNotes: string[];
}

/** Working sets only — a warm-up is not a performance. */
const working = (sets: CompletedSet[]): CompletedSet[] => sets.filter((set) => !set.isWarmup);

function volumeOf(exercises: CompletedExercise[]): number {
  let total = 0;
  for (const exercise of exercises) {
    for (const set of working(exercise.sets)) {
      if (typeof set.actualWeight === 'number' && typeof set.actualReps === 'number') {
        total += set.actualWeight * set.actualReps;
      }
    }
  }
  return Math.round(total * 10) / 10;
}

/** The best existing record per type, which a new one has to beat. */
function existingFor(records: PersonalRecord[], exerciseId: string): ExistingRecords {
  const mine = records.filter((record) => record.exerciseId === exerciseId);
  const best = (type: PersonalRecord['recordType']): number | null => {
    const values = mine.filter((r) => r.recordType === type).map((r) => r.value);
    return values.length > 0 ? Math.max(...values) : null;
  };
  return {
    weight: best('weight'),
    reps: best('reps'),
    estimated_1rm: best('estimated_1rm'),
    volume: best('volume'),
  };
}

/**
 * Finishing a workout.
 *
 * Writes the session, detects personal records, and moves the next
 * prescription on from what was actually lifted — the same three steps the
 * server took, in the same order, using the same rules from @getfit/shared.
 */
export async function completeWorkout(
  repo: LocalRepository,
  input: CompleteWorkoutInput,
): Promise<WorkoutSummary> {
  if (input.exercises.length === 0) {
    throw errors.invalidInput('Log at least one set before finishing the workout.');
  }

  const day = await repo.programDay(input.workoutDayId);
  const now = new Date().toISOString();

  const exercises: CompletedExercise[] = input.exercises.map((entry) => ({
    exerciseId: entry.exerciseId,
    orderIndex: entry.orderIndex,
    // The prescription is copied as-is and never overwritten by what was
    // actually lifted — both are needed for honest progression.
    sets: entry.sets.map((set) => ({ ...set, completedAt: set.completedAt ?? now })),
  }));

  const completed: CompletedWorkout = {
    id: localId('workout'),
    userId: (await repo.profileDoc()).userId,
    programDayId: day.id ?? null,
    dayNumber: day.dayNumber,
    focus: day.focus,
    startedAt: input.startedAt,
    completedAt: now,
    durationSeconds: input.durationSeconds,
    totalSets: exercises.reduce((n, e) => n + working(e.sets).length, 0),
    totalVolumeKg: volumeOf(exercises),
    cardioMinutes: input.cardioMinutes,
    exercises,
    personalRecords: [],
  };

  const doc = await repo.updateWorkoutsDoc((current) => {
    const fresh: PersonalRecord[] = [];
    for (const exercise of exercises) {
      fresh.push(
        ...detectPersonalRecords({
          exerciseId: exercise.exerciseId,
          sets: exercise.sets,
          existing: existingFor(current.records, exercise.exerciseId),
          achievedAt: now,
        }),
      );
    }
    completed.personalRecords = fresh;
    return {
      completed: [...current.completed, completed],
      records: [...current.records, ...fresh],
    };
  });

  const progressionNotes = await applyProgression(repo, day, exercises);

  // Mark the slot done so the same session is not offered again tomorrow.
  if (input.scheduledWorkoutId) {
    await repo.updateProgramDoc((current) => ({
      ...current,
      schedule: current.schedule.map((slot) =>
        slot.id === input.scheduledWorkoutId
          ? { ...slot, status: 'completed' as const, completedWorkoutId: completed.id }
          : slot,
      ),
    }));
  }

  const stored = doc.completed[doc.completed.length - 1];
  return {
    ...stored,
    exerciseCount: exercises.length,
    progressionNotes,
  };
}

/**
 * Moves each exercise's prescription on from the session just logged.
 *
 * A failure here must never lose the completed workout, so the programme write
 * is attempted per exercise and a bad one is skipped rather than thrown.
 */
async function applyProgression(
  repo: LocalRepository,
  day: ProgramDay,
  performed: CompletedExercise[],
): Promise<string[]> {
  const { profile } = await repo.profileDoc();
  if (!profile) return [];

  const progression = new ProgressionService();
  const notes: string[] = [];
  const decisions = new Map<string, { weight: number | null; sets: number; min: number; max: number }>();

  for (const entry of performed) {
    const exercise = EXERCISE_BY_ID[entry.exerciseId];
    const prescribed = day.exercises.find((e) => e.exerciseId === entry.exerciseId);
    if (!exercise || !prescribed) continue;

    const sets = working(entry.sets);
    if (sets.length === 0) continue;

    const decision = progression.decide({
      exercise,
      location: profile.trainingLocation,
      baseSets: prescribed.sets,
      repsMin: prescribed.repsMin,
      repsMax: prescribed.repsMax,
      lastPerformance: {
        exerciseId: entry.exerciseId,
        performedAt: new Date().toISOString(),
        sets: entry.sets.map((s) => ({
          weight: s.actualWeight,
          reps: s.actualReps,
          isWarmup: s.isWarmup,
        })),
        prescribedWeight: sets[0]?.prescribedWeight ?? prescribed.startingWeight,
        prescribedSets: prescribed.sets,
        prescribedRepsMin: sets[0]?.prescribedRepsMin ?? prescribed.repsMin,
        prescribedRepsMax: sets[0]?.prescribedRepsMax ?? prescribed.repsMax,
      },
    });

    decisions.set(entry.exerciseId, {
      weight: decision.nextWeight,
      sets: decision.nextSets,
      min: decision.nextRepsMin,
      max: decision.nextRepsMax,
    });

    if (decision.action !== 'hold' && decision.action !== 'initial') {
      notes.push(`${exercise.name}: ${decision.reason}`);
    }
  }

  if (decisions.size > 0) {
    await repo.updateProgramDoc((current) => {
      if (!current.program) return current;
      return {
        ...current,
        program: {
          ...current.program,
          days: current.program.days.map((entry) =>
            entry.id !== day.id
              ? entry
              : {
                  ...entry,
                  exercises: entry.exercises.map((exercise) => {
                    const next = decisions.get(exercise.exerciseId);
                    return next
                      ? {
                          ...exercise,
                          startingWeight: next.weight,
                          sets: next.sets,
                          repsMin: next.min,
                          repsMax: next.max,
                        }
                      : exercise;
                  }),
                },
          ),
        },
      };
    });
  }

  return notes;
}

/** Everything the Progress tab renders, computed from local history. */
export async function progressOverview(repo: LocalRepository): Promise<ProgressOverview> {
  const assessments = [...(await repo.assessments())].reverse(); // oldest first
  const { completed, records } = await repo.workoutsDoc();
  const { schedule } = await repo.programDoc();
  const { goals } = await repo.profileDoc();

  const trend = (pick: (a: (typeof assessments)[number]) => number | null): TrendPoint[] =>
    assessments
      .map((a) => ({ date: a.createdAt, value: pick(a) }))
      .filter((point): point is TrendPoint => point.value !== null);

  const strength = Object.values(
    completed
      .flatMap((workout) =>
        workout.exercises.map((exercise) => ({ workout, exercise })),
      )
      .reduce<Record<string, { exerciseId: string; exerciseName: string; points: TrendPoint[]; bestWeight: number; bestEstimated1rm: number }>>(
        (acc, { workout, exercise }) => {
          const sets = working(exercise.sets).filter(
            (s) => typeof s.actualWeight === 'number' && typeof s.actualReps === 'number',
          );
          if (sets.length === 0) return acc;

          const topWeight = Math.max(...sets.map((s) => s.actualWeight ?? 0));
          const top1rm = Math.max(
            ...sets.map((s) => estimateOneRepMax(s.actualWeight ?? 0, s.actualReps ?? 0)),
          );

          const entry = (acc[exercise.exerciseId] ??= {
            exerciseId: exercise.exerciseId,
            exerciseName: EXERCISE_BY_ID[exercise.exerciseId]?.name ?? exercise.exerciseId,
            points: [],
            bestWeight: 0,
            bestEstimated1rm: 0,
          });

          entry.points.push({ date: workout.completedAt, value: topWeight });
          entry.bestWeight = Math.max(entry.bestWeight, topWeight);
          entry.bestEstimated1rm = Math.max(entry.bestEstimated1rm, Math.round(top1rm * 10) / 10);
          return acc;
        },
        {},
      ),
  ).sort((a, b) => b.bestEstimated1rm - a.bestEstimated1rm);

  const scheduled = schedule.length;
  const done = schedule.filter((slot) => slot.status === 'completed').length;

  return {
    latestAssessment: assessments[assessments.length - 1] ?? null,
    trends: {
      weightKg: trend((a) => a.weightKg),
      bodyFatPercent: trend((a) => a.bodyFatPercent),
      muscleMassKg: trend((a) => a.estimatedMuscleMassKg),
      waistBodyRatio: trend((a) => a.waistBodyRatio),
      symmetryPercent: trend((a) => a.symmetryPercent),
    },
    strength,
    personalRecords: [...records].sort(
      (a, b) => Date.parse(b.achievedAt) - Date.parse(a.achievedAt),
    ),
    training: {
      completionRatePercent: scheduled === 0 ? 0 : Math.round((done / scheduled) * 100),
      workoutsCompleted: completed.length,
      workoutsScheduled: scheduled,
      weeklyVolume: completed.map((w) => ({ date: w.completedAt, value: w.totalVolumeKg })),
      totalSets: completed.reduce((n, w) => n + w.totalSets, 0),
      currentStreakDays: streakDays(completed),
    },
    goals: new GoalTrackingService().track({
      goals,
      // Goal progress is measured from where the user started, so the first
      // assessment matters as much as the latest one.
      firstAssessment: assessments[0] ?? null,
      latestAssessment: assessments[assessments.length - 1] ?? null,
      personalRecords: records,
      workoutsCompleted: completed.length,
      workoutsScheduled: scheduled,
    }),
  };
}

/** Consecutive days, counting back from the most recent session. */
export function streakDays(completed: CompletedWorkout[]): number {
  const days = [...new Set(completed.map((w) => isoDate(new Date(w.completedAt))))].sort().reverse();
  if (days.length === 0) return 0;

  let streak = 1;
  for (let i = 1; i < days.length; i += 1) {
    const gap = Date.parse(days[i - 1]) - Date.parse(days[i]);
    if (gap > 86_400_000) break;
    streak += 1;
  }
  return streak;
}
