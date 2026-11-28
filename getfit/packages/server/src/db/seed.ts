import { CARDIO_EXERCISES, EXERCISES, MUSCLE_GROUPS } from '@getfit/shared';
import { closePool, pool } from './pool';
import { logger } from '../utils/logger';
import { runMigrations } from './migrate';

/**
 * Seeds the muscle-group and exercise library from the shared package so the
 * database and the mobile client can never drift apart.
 */
export async function seed(): Promise<{ muscleGroups: number; exercises: number }> {
  for (const group of MUSCLE_GROUPS) {
    await pool.query(
      `INSERT INTO muscle_groups (id, name, region, is_major, weekly_sets_min, weekly_sets_max, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         region = EXCLUDED.region,
         is_major = EXCLUDED.is_major,
         weekly_sets_min = EXCLUDED.weekly_sets_min,
         weekly_sets_max = EXCLUDED.weekly_sets_max,
         display_order = EXCLUDED.display_order`,
      [group.id, group.name, group.region, group.isMajor, group.weeklySetsMin, group.weeklySetsMax, group.displayOrder],
    );
  }

  for (const exercise of EXERCISES) {
    await pool.query(
      `INSERT INTO exercises (
         id, name, primary_muscle, secondary_muscles, equipment, availability, difficulty,
         is_compound, category, instructions, setup, execution, common_mistakes,
         rep_range_min, rep_range_max, rest_seconds, illustration, load_factor,
         is_bodyweight, is_unilateral, is_timed, is_cardio
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,FALSE)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         primary_muscle = EXCLUDED.primary_muscle,
         secondary_muscles = EXCLUDED.secondary_muscles,
         equipment = EXCLUDED.equipment,
         availability = EXCLUDED.availability,
         difficulty = EXCLUDED.difficulty,
         is_compound = EXCLUDED.is_compound,
         category = EXCLUDED.category,
         instructions = EXCLUDED.instructions,
         setup = EXCLUDED.setup,
         execution = EXCLUDED.execution,
         common_mistakes = EXCLUDED.common_mistakes,
         rep_range_min = EXCLUDED.rep_range_min,
         rep_range_max = EXCLUDED.rep_range_max,
         rest_seconds = EXCLUDED.rest_seconds,
         illustration = EXCLUDED.illustration,
         load_factor = EXCLUDED.load_factor,
         is_bodyweight = EXCLUDED.is_bodyweight,
         is_unilateral = EXCLUDED.is_unilateral,
         is_timed = EXCLUDED.is_timed`,
      [
        exercise.id,
        exercise.name,
        exercise.primaryMuscle,
        exercise.secondaryMuscles,
        exercise.equipment,
        exercise.availability,
        exercise.difficulty,
        exercise.isCompound,
        exercise.category,
        exercise.instructions,
        exercise.setup,
        exercise.execution,
        exercise.commonMistakes,
        exercise.repRangeMin,
        exercise.repRangeMax,
        exercise.restSeconds,
        exercise.illustration,
        exercise.loadFactor ?? null,
        exercise.isBodyweight ?? false,
        exercise.isUnilateral ?? false,
        exercise.isTimed ?? false,
      ],
    );
  }

  // Cardio lives in the same table flagged is_cardio so workout_exercises and
  // completed_exercises can reference it with a real foreign key.
  for (const cardio of CARDIO_EXERCISES) {
    await pool.query(
      `INSERT INTO exercises (
         id, name, primary_muscle, secondary_muscles, equipment, availability, difficulty,
         is_compound, category, instructions, setup, execution, common_mistakes,
         rep_range_min, rep_range_max, rest_seconds, illustration, is_bodyweight, is_timed, is_cardio
       ) VALUES ($1,$2,'quads','{"cardio"}',$3,$4,'beginner',TRUE,'cardio',$5,$6,$7,$8,0,0,0,$9,TRUE,TRUE,TRUE)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         equipment = EXCLUDED.equipment,
         availability = EXCLUDED.availability,
         instructions = EXCLUDED.instructions,
         setup = EXCLUDED.setup,
         execution = EXCLUDED.execution,
         common_mistakes = EXCLUDED.common_mistakes,
         illustration = EXCLUDED.illustration`,
      [
        cardio.id,
        cardio.name,
        cardio.equipment,
        cardio.availability,
        cardio.instructions,
        cardio.setup,
        cardio.execution,
        cardio.commonMistakes,
        cardio.illustration,
      ],
    );
  }

  return { muscleGroups: MUSCLE_GROUPS.length, exercises: EXERCISES.length + CARDIO_EXERCISES.length };
}

if (require.main === module) {
  runMigrations()
    .then(() => seed())
    .then((result) => {
      logger.info('Seed complete', result);
      return closePool();
    })
    .then(() => process.exit(0))
    .catch(async (error) => {
      logger.error('Seed failed', error);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
