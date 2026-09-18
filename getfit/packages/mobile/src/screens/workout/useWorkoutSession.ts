import { useCallback, useMemo, useRef, useState } from 'react';
import { EXERCISE_BY_ID, MAX_CARDIO_MINUTES, type Exercise, type ProgramDay } from '@getfit/shared';
import type { CompleteWorkoutPayload } from '../../api/endpoints';

export interface LoggedSet {
  setNumber: number;
  actualWeight: number | null;
  actualReps: number | null;
  prescribedWeight: number | null;
  prescribedRepsMin: number;
  prescribedRepsMax: number;
  isWarmup: boolean;
  completedAt: string;
}

export type SessionPhase = 'exercise' | 'set' | 'rest' | 'cardio' | 'review';

export interface SessionPosition {
  exerciseIndex: number;
  setIndex: number;
}

/**
 * Drives a guided workout: which exercise, which set, what was logged and what
 * gets sent to the server.
 *
 * The prescription is carried through untouched alongside whatever the user
 * actually lifted — the server stores both, and progression uses the actual.
 */
export function useWorkoutSession(day: ProgramDay) {
  const startedAt = useRef(new Date().toISOString());
  const [position, setPosition] = useState<SessionPosition>({ exerciseIndex: 0, setIndex: 0 });
  const [phase, setPhase] = useState<SessionPhase>('set');
  const [logged, setLogged] = useState<Record<number, LoggedSet[]>>({});
  const [cardioMinutes, setCardioMinutesState] = useState(day.cardio?.minutes ?? 0);

  /**
   * Cardio minutes are held inside the range the API accepts. Relying on the
   * input to clamp on blur was not enough: finishing straight from the keyboard
   * skips the blur, and one out-of-range value fails validation for the whole
   * request — losing every set logged in the session with it.
   */
  const setCardioMinutes = useCallback((minutes: number) => {
    const safe = Number.isFinite(minutes) ? minutes : 0;
    setCardioMinutesState(Math.round(Math.min(MAX_CARDIO_MINUTES, Math.max(0, safe))));
  }, []);

  const exercises = day.exercises;
  const currentProgramExercise = exercises[position.exerciseIndex];
  const currentExercise: Exercise | undefined = currentProgramExercise
    ? currentProgramExercise.exercise ?? EXERCISE_BY_ID[currentProgramExercise.exerciseId]
    : undefined;
  const currentSet = currentProgramExercise?.prescribedSets[position.setIndex];

  const totalSets = useMemo(
    () => exercises.reduce((sum, entry) => sum + entry.prescribedSets.length, 0),
    [exercises],
  );

  const completedSets = useMemo(
    () => Object.values(logged).reduce((sum, list) => sum + list.length, 0),
    [logged],
  );

  const workingSetsForCurrentExercise = useMemo(
    () => currentProgramExercise?.prescribedSets.filter((s) => !s.isWarmup).length ?? 0,
    [currentProgramExercise],
  );

  /** Records a set and moves to rest, the next exercise, or the review step. */
  const completeSet = useCallback(
    (weight: number | null, reps: number | null) => {
      if (!currentProgramExercise || !currentSet) return;

      const entry: LoggedSet = {
        setNumber: currentSet.setNumber,
        actualWeight: weight,
        actualReps: reps,
        prescribedWeight: currentSet.prescribedWeight,
        prescribedRepsMin: currentSet.prescribedRepsMin,
        prescribedRepsMax: currentSet.prescribedRepsMax,
        isWarmup: currentSet.isWarmup,
        completedAt: new Date().toISOString(),
      };

      setLogged((current) => {
        const existing = current[position.exerciseIndex] ?? [];
        // Re-logging the same set replaces it rather than duplicating it.
        const filtered = existing.filter((s) => s.setNumber !== entry.setNumber);
        return { ...current, [position.exerciseIndex]: [...filtered, entry] };
      });

      const isLastSet = position.setIndex >= currentProgramExercise.prescribedSets.length - 1;
      const isLastExercise = position.exerciseIndex >= exercises.length - 1;

      if (!isLastSet) {
        setPhase('rest');
        return;
      }
      if (!isLastExercise) {
        setPhase('rest');
        return;
      }
      setPhase(day.cardio && day.cardio.minutes > 0 ? 'cardio' : 'review');
    },
    [currentProgramExercise, currentSet, day.cardio, exercises.length, position],
  );

  /** Called when the rest timer finishes or is skipped. */
  const advanceAfterRest = useCallback(() => {
    if (!currentProgramExercise) return;
    const isLastSet = position.setIndex >= currentProgramExercise.prescribedSets.length - 1;

    if (!isLastSet) {
      setPosition((current) => ({ ...current, setIndex: current.setIndex + 1 }));
      setPhase('set');
      return;
    }

    const isLastExercise = position.exerciseIndex >= exercises.length - 1;
    if (!isLastExercise) {
      setPosition({ exerciseIndex: position.exerciseIndex + 1, setIndex: 0 });
      setPhase('exercise');
      return;
    }
    setPhase(day.cardio && day.cardio.minutes > 0 ? 'cardio' : 'review');
  }, [currentProgramExercise, day.cardio, exercises.length, position]);

  /** Skips the remainder of the current exercise. */
  const skipExercise = useCallback(() => {
    const isLastExercise = position.exerciseIndex >= exercises.length - 1;
    if (!isLastExercise) {
      setPosition({ exerciseIndex: position.exerciseIndex + 1, setIndex: 0 });
      setPhase('exercise');
      return;
    }
    setPhase(day.cardio && day.cardio.minutes > 0 ? 'cardio' : 'review');
  }, [day.cardio, exercises.length, position.exerciseIndex]);

  const buildPayload = useCallback(
    (scheduledWorkoutId: string | null): CompleteWorkoutPayload => ({
      scheduledWorkoutId,
      workoutDayId: day.id ?? '',
      startedAt: startedAt.current,
      durationSeconds: Math.max(
        1,
        Math.round((Date.now() - new Date(startedAt.current).getTime()) / 1000),
      ),
      cardioMinutes,
      exercises: exercises
        .map((entry, index) => ({
          exerciseId: entry.exerciseId,
          workoutExerciseId: entry.id ?? null,
          orderIndex: index,
          sets: (logged[index] ?? []).sort((a, b) => a.setNumber - b.setNumber),
        }))
        // Exercises the user skipped entirely are not reported as performed.
        .filter((entry) => entry.sets.length > 0),
    }),
    [cardioMinutes, day.id, exercises, logged],
  );

  return {
    phase,
    setPhase,
    position,
    setPosition,
    exercises,
    currentProgramExercise,
    currentExercise,
    currentSet,
    logged,
    completedSets,
    totalSets,
    workingSetsForCurrentExercise,
    cardioMinutes,
    setCardioMinutes,
    completeSet,
    advanceAfterRest,
    skipExercise,
    buildPayload,
    startedAt: startedAt.current,
  };
}
