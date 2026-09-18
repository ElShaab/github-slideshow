import { EXERCISE_BY_ID } from '../exercises';
import { roundToIncrement } from '../format';
import type { Exercise, Sex, TrainingLevel } from '../types';

export interface StartingWeightContext {
  bodyWeightKg: number;
  sex: Sex;
  level: TrainingLevel;
  /** exerciseId → best recent working weight, from the user's actual history. */
  previousPerformance: Record<string, number>;
}

const LEVEL_MULTIPLIER: Record<TrainingLevel, number> = {
  beginner: 0.55,
  intermediate: 0.78,
  advanced: 1.0,
};

/**
 * Decides the weight to prescribe the first time a user meets an exercise.
 *
 * Priority order:
 *  1. What they actually lifted on this exercise before.
 *  2. What they lifted on a closely related exercise, scaled by relative load.
 *  3. A deliberately conservative estimate from bodyweight, level and sex.
 *
 * Bodyweight and timed movements return null — there is nothing to load.
 */
export function estimateStartingWeight(
  exercise: Exercise,
  context: StartingWeightContext,
): number | null {
  const direct = context.previousPerformance[exercise.id];
  if (direct && direct > 0) return roundToIncrement(direct, incrementFor(exercise));

  if (exercise.loadFactor === undefined) return null;

  const related = estimateFromRelated(exercise, context);
  if (related !== null) return related;

  const sexFactor = context.sex === 'male' ? 1 : isLowerBody(exercise) ? 0.82 : 0.68;
  const estimate =
    context.bodyWeightKg * exercise.loadFactor * LEVEL_MULTIPLIER[context.level] * sexFactor;

  const increment = incrementFor(exercise);
  const rounded = roundToIncrement(estimate, increment);
  return Math.max(minimumLoad(exercise), rounded);
}

/**
 * Transfers strength from a movement the user has already trained. Two
 * exercises are related when they share a primary muscle and category, so the
 * ratio of their load factors is a reasonable scaler.
 */
function estimateFromRelated(exercise: Exercise, context: StartingWeightContext): number | null {
  if (exercise.loadFactor === undefined) return null;

  let best: { weight: number; ratio: number } | null = null;

  for (const [exerciseId, weight] of Object.entries(context.previousPerformance)) {
    if (weight <= 0) continue;
    const other = EXERCISE_BY_ID[exerciseId];
    if (!other || other.id === exercise.id) continue;
    if (other.primaryMuscle !== exercise.primaryMuscle) continue;
    if (other.category !== exercise.category) continue;
    if (other.loadFactor === undefined || other.loadFactor <= 0) continue;

    const ratio = exercise.loadFactor / other.loadFactor;
    if (!best || ratio < best.ratio) best = { weight, ratio };
  }

  if (!best) return null;

  // Start 10% below the transferred estimate: an untrained movement pattern is
  // always weaker than the raw load ratio suggests.
  const transferred = best.weight * best.ratio * 0.9;
  return Math.max(minimumLoad(exercise), roundToIncrement(transferred, incrementFor(exercise)));
}

/** Dumbbell and cable work moves in smaller jumps than barbell work. */
export function incrementFor(exercise: Exercise): number {
  if (exercise.equipment.includes('barbell') || exercise.equipment.includes('smith_machine')) return 2.5;
  if (exercise.equipment.includes('resistance_machines') || exercise.equipment.includes('cable_machine')) {
    return 2.5;
  }
  if (exercise.equipment.includes('dumbbells') || exercise.equipment.includes('kettlebell')) return 2;
  return 1.25;
}

function minimumLoad(exercise: Exercise): number {
  if (exercise.equipment.includes('barbell')) return 20; // an empty olympic bar
  if (exercise.equipment.includes('ez_bar')) return 10;
  return incrementFor(exercise);
}

function isLowerBody(exercise: Exercise): boolean {
  return ['quads', 'hamstrings', 'glutes', 'calves'].includes(exercise.primaryMuscle);
}
