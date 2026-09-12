import type {
  CardioPrescription,
  PrescribedSet,
  ProgramDay,
  ProgramExercise,
  SessionDuration,
  TrainingDays,
  VolumeSummary,
  WorkoutProgram,
} from '@getfit/shared';
import { query, transaction } from '../db/pool';

export const programRepository = {
  /**
   * Stores a new program version and archives the previous one. Historical
   * programs are never deleted — completed workouts point back at them.
   */
  async save(
    userId: string,
    program: WorkoutProgram,
    generationReason: string,
  ): Promise<WorkoutProgram> {
    return transaction(async (client) => {
      const previous = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0) AS version FROM workout_programs WHERE user_id = $1`,
        [userId],
      );
      const version = Number(previous.rows[0].version) + 1;

      await client.query(
        `UPDATE workout_programs SET is_active = FALSE, archived_at = NOW()
         WHERE user_id = $1 AND is_active`,
        [userId],
      );

      const inserted = await client.query(
        `INSERT INTO workout_programs (
           user_id, version, split_name, training_days, session_duration_minutes,
           volume_summary, generation_reason, is_active
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *`,
        [
          userId,
          version,
          program.splitName,
          program.trainingDays,
          program.sessionDurationMinutes,
          JSON.stringify(program.volumeSummary),
          generationReason,
        ],
      );
      const programId = inserted.rows[0].id as string;

      const days: ProgramDay[] = [];

      for (const day of program.days) {
        const dayRow = await client.query(
          `INSERT INTO workout_days (
             program_id, user_id, day_number, focus, duration_minutes,
             cardio_type, cardio_minutes, cardio_exercise_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            programId,
            userId,
            day.dayNumber,
            day.focus,
            day.durationMinutes,
            day.cardio?.type ?? null,
            day.cardio?.minutes ?? 0,
            day.cardio?.exerciseId ?? null,
          ],
        );
        const dayId = dayRow.rows[0].id as string;
        const exercises: ProgramExercise[] = [];

        for (const exercise of day.exercises) {
          const exerciseRow = await client.query(
            `INSERT INTO workout_exercises (
               workout_day_id, user_id, exercise_id, order_index, sets, warmup_sets,
               reps_min, reps_max, starting_weight, rest_seconds
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [
              dayId,
              userId,
              exercise.exerciseId,
              exercise.orderIndex,
              exercise.sets,
              exercise.warmupSets,
              exercise.repsMin,
              exercise.repsMax,
              exercise.startingWeight,
              exercise.restSeconds,
            ],
          );
          const workoutExerciseId = exerciseRow.rows[0].id as string;
          const prescribedSets: PrescribedSet[] = [];

          for (const set of exercise.prescribedSets) {
            const setRow = await client.query(
              `INSERT INTO prescribed_sets (
                 workout_exercise_id, user_id, set_number, prescribed_weight,
                 prescribed_reps_min, prescribed_reps_max, rest_seconds, is_warmup
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [
                workoutExerciseId,
                userId,
                set.setNumber,
                set.prescribedWeight,
                set.prescribedRepsMin,
                set.prescribedRepsMax,
                set.restSeconds,
                set.isWarmup,
              ],
            );
            prescribedSets.push(mapPrescribedSet(setRow.rows[0]));
          }

          exercises.push({ ...exercise, id: workoutExerciseId, prescribedSets });
        }

        days.push({ ...day, id: dayId, exercises });
      }

      return {
        ...program,
        id: programId,
        userId,
        version,
        isActive: true,
        generatedAt: (inserted.rows[0].generated_at as Date).toISOString(),
        days,
      };
    });
  },

  /** The program a day belongs to, scoped to its owner. */
  async getProgramIdForDay(userId: string, workoutDayId: string): Promise<string | null> {
    const result = await query<{ program_id: string }>(
      `SELECT program_id FROM workout_days WHERE id = $1 AND user_id = $2`,
      [workoutDayId, userId],
    );
    return result.rows[0]?.program_id ?? null;
  },

  async getActive(userId: string): Promise<WorkoutProgram | null> {
    const programResult = await query(
      `SELECT * FROM workout_programs WHERE user_id = $1 AND is_active LIMIT 1`,
      [userId],
    );
    const programRow = programResult.rows[0];
    if (!programRow) return null;
    return this.hydrate(userId, programRow);
  },

  async getById(userId: string, programId: string): Promise<WorkoutProgram | null> {
    const programResult = await query(
      `SELECT * FROM workout_programs WHERE user_id = $1 AND id = $2`,
      [userId, programId],
    );
    const programRow = programResult.rows[0];
    if (!programRow) return null;
    return this.hydrate(userId, programRow);
  },

  async hydrate(userId: string, programRow: Record<string, unknown>): Promise<WorkoutProgram> {
    const programId = programRow.id as string;

    const dayRows = await query(
      `SELECT * FROM workout_days WHERE program_id = $1 ORDER BY day_number`,
      [programId],
    );
    const exerciseRows = await query(
      `SELECT we.* FROM workout_exercises we
       JOIN workout_days wd ON wd.id = we.workout_day_id
       WHERE wd.program_id = $1 ORDER BY we.order_index`,
      [programId],
    );
    const setRows = await query(
      `SELECT ps.* FROM prescribed_sets ps
       JOIN workout_exercises we ON we.id = ps.workout_exercise_id
       JOIN workout_days wd ON wd.id = we.workout_day_id
       WHERE wd.program_id = $1 ORDER BY ps.set_number`,
      [programId],
    );

    const setsByExercise = new Map<string, PrescribedSet[]>();
    for (const row of setRows.rows) {
      const key = row.workout_exercise_id as string;
      const list = setsByExercise.get(key) ?? [];
      list.push(mapPrescribedSet(row));
      setsByExercise.set(key, list);
    }

    const exercisesByDay = new Map<string, ProgramExercise[]>();
    for (const row of exerciseRows.rows) {
      const key = row.workout_day_id as string;
      const list = exercisesByDay.get(key) ?? [];
      list.push({
        id: row.id as string,
        exerciseId: row.exercise_id as string,
        orderIndex: Number(row.order_index),
        sets: Number(row.sets),
        warmupSets: Number(row.warmup_sets),
        repsMin: Number(row.reps_min),
        repsMax: Number(row.reps_max),
        startingWeight: row.starting_weight === null ? null : Number(row.starting_weight),
        restSeconds: Number(row.rest_seconds),
        prescribedSets: setsByExercise.get(row.id as string) ?? [],
      });
      exercisesByDay.set(key, list);
    }

    const days: ProgramDay[] = dayRows.rows.map((row) => {
      const cardio: CardioPrescription | null = row.cardio_exercise_id
        ? {
            type: row.cardio_type as string,
            minutes: Number(row.cardio_minutes),
            exerciseId: row.cardio_exercise_id as string,
          }
        : null;
      return {
        id: row.id as string,
        dayNumber: Number(row.day_number),
        focus: row.focus as string,
        durationMinutes: Number(row.duration_minutes),
        exercises: exercisesByDay.get(row.id as string) ?? [],
        cardio,
      };
    });

    return {
      id: programId,
      userId,
      version: Number(programRow.version),
      splitName: programRow.split_name as string,
      trainingDays: Number(programRow.training_days) as TrainingDays,
      sessionDurationMinutes: Number(programRow.session_duration_minutes) as SessionDuration,
      generatedAt: (programRow.generated_at as Date).toISOString(),
      isActive: Boolean(programRow.is_active),
      days,
      volumeSummary: programRow.volume_summary as VolumeSummary,
    };
  },

  async getDay(userId: string, workoutDayId: string): Promise<ProgramDay | null> {
    const dayResult = await query(
      `SELECT * FROM workout_days WHERE id = $1 AND user_id = $2`,
      [workoutDayId, userId],
    );
    const dayRow = dayResult.rows[0];
    if (!dayRow) return null;

    const program = await this.getById(userId, dayRow.program_id as string);
    return program?.days.find((d) => d.id === workoutDayId) ?? null;
  },

  /**
   * Updates the stored prescription for one exercise after a progression
   * decision. The historical completed sets are untouched.
   */
  async updatePrescription(
    userId: string,
    workoutExerciseId: string,
    next: { weight: number | null; sets: number; repsMin: number; repsMax: number },
  ): Promise<void> {
    await transaction(async (client) => {
      const existing = await client.query(
        `SELECT * FROM workout_exercises WHERE id = $1 AND user_id = $2`,
        [workoutExerciseId, userId],
      );
      if (!existing.rows[0]) return;
      const warmupSets = Number(existing.rows[0].warmup_sets);
      const restSeconds = Number(existing.rows[0].rest_seconds);

      await client.query(
        `UPDATE workout_exercises
         SET sets = $3, reps_min = $4, reps_max = $5, starting_weight = $6
         WHERE id = $1 AND user_id = $2`,
        [workoutExerciseId, userId, next.sets, next.repsMin, next.repsMax, next.weight],
      );

      await client.query(`DELETE FROM prescribed_sets WHERE workout_exercise_id = $1`, [
        workoutExerciseId,
      ]);

      let setNumber = 1;
      for (let i = 0; i < warmupSets; i += 1) {
        const fraction = warmupSets === 1 ? 0.6 : 0.5 + i * 0.2;
        await client.query(
          `INSERT INTO prescribed_sets (
             workout_exercise_id, user_id, set_number, prescribed_weight,
             prescribed_reps_min, prescribed_reps_max, rest_seconds, is_warmup
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
          [
            workoutExerciseId,
            userId,
            setNumber,
            next.weight === null ? null : Math.round(next.weight * fraction * 2) / 2,
            Math.max(3, Math.round(next.repsMin * 0.7)),
            Math.max(5, Math.round(next.repsMax * 0.7)),
            45,
          ],
        );
        setNumber += 1;
      }
      for (let i = 0; i < next.sets; i += 1) {
        await client.query(
          `INSERT INTO prescribed_sets (
             workout_exercise_id, user_id, set_number, prescribed_weight,
             prescribed_reps_min, prescribed_reps_max, rest_seconds, is_warmup
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)`,
          [workoutExerciseId, userId, setNumber, next.weight, next.repsMin, next.repsMax, restSeconds],
        );
        setNumber += 1;
      }
    });
  },
};

function mapPrescribedSet(row: Record<string, unknown>): PrescribedSet {
  return {
    id: row.id as string,
    setNumber: Number(row.set_number),
    prescribedWeight: row.prescribed_weight === null ? null : Number(row.prescribed_weight),
    prescribedRepsMin: Number(row.prescribed_reps_min),
    prescribedRepsMax: Number(row.prescribed_reps_max),
    restSeconds: Number(row.rest_seconds),
    isWarmup: Boolean(row.is_warmup),
  };
}
