import type { Exercise, EquipmentId, MuscleGroup, TrainingLocation } from '../types';
import { CHEST_EXERCISES } from './chest';
import { BACK_EXERCISES } from './back';
import { SHOULDER_EXERCISES } from './shoulders';
import { BICEPS_EXERCISES, TRICEPS_EXERCISES, FOREARM_EXERCISES } from './arms';
import { QUAD_EXERCISES, HAMSTRING_EXERCISES, GLUTE_EXERCISES, CALF_EXERCISES } from './legs';
import { AB_EXERCISES } from './abs';

export { CARDIO_EXERCISES, CARDIO_BY_ID } from './cardio';

export const EXERCISES: Exercise[] = [
  ...CHEST_EXERCISES,
  ...BACK_EXERCISES,
  ...SHOULDER_EXERCISES,
  ...BICEPS_EXERCISES,
  ...TRICEPS_EXERCISES,
  ...FOREARM_EXERCISES,
  ...QUAD_EXERCISES,
  ...HAMSTRING_EXERCISES,
  ...GLUTE_EXERCISES,
  ...CALF_EXERCISES,
  ...AB_EXERCISES,
];

export const EXERCISE_BY_ID: Record<string, Exercise> = Object.fromEntries(
  EXERCISES.map((e) => [e.id, e]),
);

export function getExercise(id: string): Exercise | undefined {
  return EXERCISE_BY_ID[id];
}

export function exercisesForMuscle(muscle: MuscleGroup): Exercise[] {
  return EXERCISES.filter((e) => e.primaryMuscle === muscle);
}

/**
 * An exercise is trainable when the user's location allows it and they own
 * every piece of equipment it needs. Exercises listing several interchangeable
 * options (`dumbbells` OR `kettlebell`) are modelled as alternatives: owning
 * any one of them is enough, plus bodyweight is always available.
 */
export function isExerciseAvailable(
  exercise: Exercise,
  location: TrainingLocation,
  ownedEquipment: EquipmentId[],
): boolean {
  if (exercise.availability !== 'both' && exercise.availability !== location) return false;
  if (exercise.equipment.length === 0) return true;

  const owned = new Set<EquipmentId>([...ownedEquipment, 'bodyweight']);

  // Equipment that must be present regardless of alternatives (support gear).
  const required = exercise.equipment.filter((e) => REQUIRED_SUPPORT_EQUIPMENT.has(e));
  const alternatives = exercise.equipment.filter((e) => !REQUIRED_SUPPORT_EQUIPMENT.has(e));

  for (const item of required) {
    if (!owned.has(item)) return false;
  }
  if (alternatives.length === 0) return true;
  return alternatives.some((item) => owned.has(item));
}

/**
 * Support equipment cannot be substituted — a bench press needs a bench even if
 * the user owns every barbell alternative.
 */
const REQUIRED_SUPPORT_EQUIPMENT = new Set<EquipmentId>([
  'bench',
  'squat_rack',
  'pullup_bar',
  'dip_station',
]);

export function availableExercises(
  location: TrainingLocation,
  ownedEquipment: EquipmentId[],
): Exercise[] {
  return EXERCISES.filter((e) => isExerciseAvailable(e, location, ownedEquipment));
}

export {
  CHEST_EXERCISES,
  BACK_EXERCISES,
  SHOULDER_EXERCISES,
  BICEPS_EXERCISES,
  TRICEPS_EXERCISES,
  FOREARM_EXERCISES,
  QUAD_EXERCISES,
  HAMSTRING_EXERCISES,
  GLUTE_EXERCISES,
  CALF_EXERCISES,
  AB_EXERCISES,
};
