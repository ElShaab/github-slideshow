import type { Exercise, ProgramExercise } from '@getfit/shared';

/** Seconds of general setup at the start of a session. */
const SESSION_OVERHEAD_SECONDS = 90;
/** Seconds spent walking to and setting up the next exercise. */
const TRANSITION_SECONDS = 45;
/** Average seconds per rep under load. */
const SECONDS_PER_REP = 3.4;
/** Getting in and out of position for a working set. */
const SET_OVERHEAD_SECONDS = 12;
/** Warm-up sets are light and fast, with short rests. */
const WARMUP_REST_SECONDS = 45;

export interface TimedExerciseEstimate {
  exercise: Exercise;
  sets: number;
  warmupSets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
}

/**
 * Estimates how long an exercise takes including rest, so the generator can
 * guarantee the finished workout actually fits the session the user chose.
 */
export function estimateExerciseSeconds(entry: TimedExerciseEstimate): number {
  const avgReps = (entry.repsMin + entry.repsMax) / 2;
  const workSeconds = entry.exercise.isTimed ? avgReps : avgReps * SECONDS_PER_REP;
  const perSideMultiplier = entry.exercise.isUnilateral ? 2 : 1;

  const workingSets =
    entry.sets * (workSeconds * perSideMultiplier + SET_OVERHEAD_SECONDS + entry.restSeconds);

  const warmupSets =
    entry.warmupSets * (workSeconds * 0.6 + SET_OVERHEAD_SECONDS + WARMUP_REST_SECONDS);

  // The final rest of the last exercise runs into the transition, not extra time.
  return workingSets + warmupSets + TRANSITION_SECONDS;
}

export function estimateWorkoutSeconds(
  entries: TimedExerciseEstimate[],
  cardioMinutes: number,
): number {
  const strength = entries.reduce((total, entry) => total + estimateExerciseSeconds(entry), 0);
  const cardio = cardioMinutes > 0 ? cardioMinutes * 60 + 60 : 0;
  return SESSION_OVERHEAD_SECONDS + strength + cardio;
}

export function estimateProgramDaySeconds(
  exercises: ProgramExercise[],
  lookup: (id: string) => Exercise | undefined,
  cardioMinutes: number,
): number {
  const entries: TimedExerciseEstimate[] = [];
  for (const programExercise of exercises) {
    const exercise = lookup(programExercise.exerciseId);
    if (!exercise) continue;
    entries.push({
      exercise,
      sets: programExercise.sets,
      warmupSets: programExercise.warmupSets,
      repsMin: programExercise.repsMin,
      repsMax: programExercise.repsMax,
      restSeconds: programExercise.restSeconds,
    });
  }
  return estimateWorkoutSeconds(entries, cardioMinutes);
}
