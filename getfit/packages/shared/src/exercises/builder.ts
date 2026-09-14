import type { Exercise } from '../types';

type ExerciseDef = Omit<Exercise, 'illustration'> & { illustration?: string };

/**
 * Fills in the defaults every exercise shares so each definition below only
 * states what is actually specific to that movement.
 */
export function defineExercise(def: ExerciseDef): Exercise {
  return {
    illustration: 'generic',
    ...def,
  };
}

export const ex = defineExercise;
