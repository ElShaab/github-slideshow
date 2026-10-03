import type {
  CompletedExercise,
  CompletedSet,
  CompletedWorkout,
  ExercisePerformance,
  PersonalRecord,
  ScheduleStatus,
  ScheduledWorkout,
  TrendPoint,
} from '@getfit/shared';
import { query, transaction } from '../db/pool';
import type { ExistingRecords } from '@getfit/shared';

export interface CompleteWorkoutInput {
  userId: string;
  programId: string | null;
  workoutDayId: string | null;
  dayNumber: number;
  focus: string;
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

export const workoutRepository = {
  /* ---------------------------- schedule ---------------------------- */

  async replaceSchedule(
    userId: string,
    programId: string,
    entries: Array<{ workoutDayId: string; scheduledDate: string }>,
  ): Promise<void> {
    await transaction(async (client) => {
      // Completed and missed sessions are never removed — only slots that have
      // not happened yet, including ones already moved by the adaptation pass.
      await client.query(
        `DELETE FROM scheduled_workouts
         WHERE user_id = $1
           AND status IN ('scheduled', 'rescheduled')
           AND scheduled_date >= CURRENT_DATE`,
        [userId],
      );
      for (const entry of entries) {
        await client.query(
          `INSERT INTO scheduled_workouts (user_id, program_id, workout_day_id, scheduled_date)
           VALUES ($1,$2,$3,$4)`,
          [userId, programId, entry.workoutDayId, entry.scheduledDate],
        );
      }
    });
  },

  async listSchedule(userId: string, from: string, to: string): Promise<ScheduledWorkout[]> {
    const result = await query(
      `SELECT sw.*, wd.day_number, wd.focus, wd.duration_minutes
       FROM scheduled_workouts sw
       JOIN workout_days wd ON wd.id = sw.workout_day_id
       WHERE sw.user_id = $1 AND sw.scheduled_date BETWEEN $2 AND $3
       ORDER BY sw.scheduled_date ASC`,
      [userId, from, to],
    );
    return result.rows.map(mapScheduled);
  },

  /**
   * Sessions still to come. Anything already in the past is excluded, so a
   * long-abandoned schedule cannot masquerade as upcoming work and stop a new
   * week from being laid out.
   */
  async listUpcoming(userId: string, limit = 14): Promise<ScheduledWorkout[]> {
    const result = await query(
      `SELECT sw.*, wd.day_number, wd.focus, wd.duration_minutes
       FROM scheduled_workouts sw
       JOIN workout_days wd ON wd.id = sw.workout_day_id
       WHERE sw.user_id = $1 AND sw.status IN ('scheduled','rescheduled')
         AND sw.scheduled_date >= CURRENT_DATE
       ORDER BY sw.scheduled_date ASC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map(mapScheduled);
  },

  /**
   * Today's session, or one still owed from an earlier day. Without the date
   * bound this returned whatever came next, so the rest days the week layout
   * deliberately leaves empty were never shown and the user was prompted to
   * train every single day.
   */
  async findTodaysWorkout(userId: string): Promise<ScheduledWorkout | null> {
    const result = await query(
      `SELECT sw.*, wd.day_number, wd.focus, wd.duration_minutes
       FROM scheduled_workouts sw
       JOIN workout_days wd ON wd.id = sw.workout_day_id
       WHERE sw.user_id = $1 AND sw.status IN ('scheduled','rescheduled')
         AND sw.scheduled_date <= CURRENT_DATE
       ORDER BY sw.scheduled_date ASC LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapScheduled(result.rows[0]) : null;
  },

  /**
   * Marks sessions older than the reorganisation window as missed. They are
   * never deleted — the history stays honest — but they stop blocking a fresh
   * week from being scheduled after a long break.
   */
  async markStaleAsMissed(userId: string, before: string): Promise<number> {
    const result = await query(
      `UPDATE scheduled_workouts
       SET status = 'missed'
       WHERE user_id = $1 AND status IN ('scheduled','rescheduled')
         AND scheduled_date < $2`,
      [userId, before],
    );
    return result.rowCount ?? 0;
  },

  /** Returns false when the row does not exist or belongs to another user. */
  async updateScheduleEntry(
    userId: string,
    id: string,
    patch: { scheduledDate?: string; status?: ScheduleStatus; completedWorkoutId?: string | null },
  ): Promise<boolean> {
    const result = await query(
      `UPDATE scheduled_workouts
       SET scheduled_date = COALESCE($3, scheduled_date),
           status = COALESCE($4, status),
           completed_workout_id = COALESCE($5, completed_workout_id)
       WHERE id = $1 AND user_id = $2`,
      [id, userId, patch.scheduledDate ?? null, patch.status ?? null, patch.completedWorkoutId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async countSchedule(userId: string): Promise<{ completed: number; total: number }> {
    const result = await query<{ completed: string; total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE scheduled_date <= CURRENT_DATE) AS total
       FROM scheduled_workouts WHERE user_id = $1`,
      [userId],
    );
    return {
      completed: Number(result.rows[0]?.completed ?? 0),
      total: Number(result.rows[0]?.total ?? 0),
    };
  },

  /* --------------------------- completion --------------------------- */

  async completeWorkout(input: CompleteWorkoutInput): Promise<CompletedWorkout> {
    return transaction(async (client) => {
      const totals = input.exercises.reduce(
        (acc, exercise) => {
          for (const set of exercise.sets) {
            if (set.isWarmup) continue;
            acc.sets += 1;
            acc.volume += (set.actualWeight ?? 0) * (set.actualReps ?? 0);
          }
          return acc;
        },
        { sets: 0, volume: 0 },
      );

      const workoutRow = await client.query(
        `INSERT INTO completed_workouts (
           user_id, program_id, workout_day_id, day_number, focus, started_at,
           duration_seconds, total_sets, total_volume_kg, cardio_minutes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          input.userId,
          input.programId,
          input.workoutDayId,
          input.dayNumber,
          input.focus,
          input.startedAt,
          input.durationSeconds,
          totals.sets,
          Math.round(totals.volume * 100) / 100,
          input.cardioMinutes,
        ],
      );
      const completedWorkoutId = workoutRow.rows[0].id as string;
      const exercises: CompletedExercise[] = [];

      for (const exercise of input.exercises) {
        const exerciseRow = await client.query(
          `INSERT INTO completed_exercises (
             completed_workout_id, user_id, exercise_id, workout_exercise_id, order_index
           ) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [
            completedWorkoutId,
            input.userId,
            exercise.exerciseId,
            exercise.workoutExerciseId,
            exercise.orderIndex,
          ],
        );
        const completedExerciseId = exerciseRow.rows[0].id as string;
        const sets: CompletedSet[] = [];

        for (const set of exercise.sets) {
          const setRow = await client.query(
            `INSERT INTO completed_sets (
               completed_exercise_id, workout_exercise_id, user_id, set_number,
               actual_weight, actual_reps, prescribed_weight,
               prescribed_reps_min, prescribed_reps_max, is_warmup, completed_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
              completedExerciseId,
              exercise.workoutExerciseId,
              input.userId,
              set.setNumber,
              set.actualWeight,
              set.actualReps,
              set.prescribedWeight,
              set.prescribedRepsMin,
              set.prescribedRepsMax,
              set.isWarmup,
              set.completedAt,
            ],
          );
          sets.push(mapCompletedSet(setRow.rows[0]));
        }

        exercises.push({ id: completedExerciseId, exerciseId: exercise.exerciseId, orderIndex: exercise.orderIndex, sets });
      }

      return {
        id: completedWorkoutId,
        userId: input.userId,
        programDayId: input.workoutDayId,
        dayNumber: input.dayNumber,
        focus: input.focus,
        startedAt: input.startedAt,
        completedAt: (workoutRow.rows[0].completed_at as Date).toISOString(),
        durationSeconds: input.durationSeconds,
        totalSets: totals.sets,
        totalVolumeKg: Math.round(totals.volume * 100) / 100,
        cardioMinutes: input.cardioMinutes,
        exercises,
        personalRecords: [],
      };
    });
  },

  async listCompleted(userId: string, limit = 30): Promise<CompletedWorkout[]> {
    const result = await query(
      `SELECT * FROM completed_workouts WHERE user_id = $1 ORDER BY completed_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map(mapCompletedWorkout);
  },

  async getCompleted(userId: string, workoutId: string): Promise<CompletedWorkout | null> {
    const workoutResult = await query(
      `SELECT * FROM completed_workouts WHERE user_id = $1 AND id = $2`,
      [userId, workoutId],
    );
    if (!workoutResult.rows[0]) return null;

    // The workout above is already proven to belong to this user, but every
    // sub-query is scoped again so a future refactor cannot widen access.
    const exercisesResult = await query(
      `SELECT * FROM completed_exercises
       WHERE completed_workout_id = $1 AND user_id = $2 ORDER BY order_index`,
      [workoutId, userId],
    );
    const setsResult = await query(
      `SELECT cs.* FROM completed_sets cs
       JOIN completed_exercises ce ON ce.id = cs.completed_exercise_id
       WHERE ce.completed_workout_id = $1 AND cs.user_id = $2 ORDER BY cs.set_number`,
      [workoutId, userId],
    );
    const recordsResult = await query(
      `SELECT pr.*, e.name AS exercise_name FROM personal_records pr
       JOIN exercises e ON e.id = pr.exercise_id
       WHERE pr.completed_workout_id = $1 AND pr.user_id = $2`,
      [workoutId, userId],
    );

    const setsByExercise = new Map<string, CompletedSet[]>();
    for (const row of setsResult.rows) {
      const key = row.completed_exercise_id as string;
      const list = setsByExercise.get(key) ?? [];
      list.push(mapCompletedSet(row));
      setsByExercise.set(key, list);
    }

    const workout = mapCompletedWorkout(workoutResult.rows[0]);
    workout.exercises = exercisesResult.rows.map((row) => ({
      id: row.id as string,
      exerciseId: row.exercise_id as string,
      orderIndex: Number(row.order_index),
      sets: setsByExercise.get(row.id as string) ?? [],
    }));
    workout.personalRecords = recordsResult.rows.map(mapPersonalRecord);
    return workout;
  },

  /* -------------------------- performance --------------------------- */

  async lastPerformance(userId: string, exerciseId: string): Promise<ExercisePerformance | null> {
    const exerciseResult = await query(
      `SELECT ce.*, cw.completed_at FROM completed_exercises ce
       JOIN completed_workouts cw ON cw.id = ce.completed_workout_id
       WHERE ce.user_id = $1 AND ce.exercise_id = $2
       ORDER BY cw.completed_at DESC LIMIT 1`,
      [userId, exerciseId],
    );
    const row = exerciseResult.rows[0];
    if (!row) return null;

    const setsResult = await query(
      `SELECT * FROM completed_sets WHERE completed_exercise_id = $1 ORDER BY set_number`,
      [row.id],
    );
    const sets = setsResult.rows.map(mapCompletedSet);
    const working = sets.filter((s) => !s.isWarmup);

    return {
      exerciseId,
      performedAt: (row.completed_at as Date).toISOString(),
      sets: sets.map((s) => ({ weight: s.actualWeight, reps: s.actualReps, isWarmup: s.isWarmup })),
      prescribedWeight: working[0]?.prescribedWeight ?? null,
      prescribedSets: working.length,
      prescribedRepsMin: working[0]?.prescribedRepsMin ?? 0,
      prescribedRepsMax: working[0]?.prescribedRepsMax ?? 0,
    };
  },

  /** Best recent working weight per exercise — seeds starting weights. */
  async bestWorkingWeights(userId: string): Promise<Record<string, number>> {
    const result = await query<{ exercise_id: string; best: string }>(
      `SELECT ce.exercise_id, MAX(cs.actual_weight) AS best
       FROM completed_sets cs
       JOIN completed_exercises ce ON ce.id = cs.completed_exercise_id
       WHERE cs.user_id = $1 AND NOT cs.is_warmup AND cs.actual_weight IS NOT NULL
       GROUP BY ce.exercise_id`,
      [userId],
    );
    return Object.fromEntries(result.rows.map((row) => [row.exercise_id, Number(row.best)]));
  },

  async strengthTrend(userId: string, exerciseId: string): Promise<TrendPoint[]> {
    const result = await query<{ completed_at: Date; best: string }>(
      `SELECT cw.completed_at, MAX(cs.actual_weight) AS best
       FROM completed_sets cs
       JOIN completed_exercises ce ON ce.id = cs.completed_exercise_id
       JOIN completed_workouts cw ON cw.id = ce.completed_workout_id
       WHERE cs.user_id = $1 AND ce.exercise_id = $2 AND NOT cs.is_warmup AND cs.actual_weight IS NOT NULL
       GROUP BY cw.completed_at ORDER BY cw.completed_at ASC`,
      [userId, exerciseId],
    );
    return result.rows.map((row) => ({
      date: row.completed_at.toISOString(),
      value: Number(row.best),
    }));
  },

  async trainedExercises(userId: string, limit = 12): Promise<string[]> {
    const result = await query<{ exercise_id: string }>(
      `SELECT ce.exercise_id, COUNT(*) AS sessions
       FROM completed_exercises ce
       WHERE ce.user_id = $1
       GROUP BY ce.exercise_id ORDER BY sessions DESC, ce.exercise_id LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map((r) => r.exercise_id);
  },

  async weeklyVolume(userId: string): Promise<TrendPoint[]> {
    const result = await query<{ week: Date; volume: string }>(
      `SELECT DATE_TRUNC('week', completed_at) AS week, SUM(total_volume_kg) AS volume
       FROM completed_workouts WHERE user_id = $1
       GROUP BY week ORDER BY week ASC`,
      [userId],
    );
    return result.rows.map((row) => ({
      date: row.week.toISOString(),
      value: Math.round(Number(row.volume)),
    }));
  },

  async totals(userId: string): Promise<{ workouts: number; sets: number }> {
    const result = await query<{ workouts: string; sets: string }>(
      `SELECT COUNT(*) AS workouts, COALESCE(SUM(total_sets),0) AS sets
       FROM completed_workouts WHERE user_id = $1`,
      [userId],
    );
    return {
      workouts: Number(result.rows[0]?.workouts ?? 0),
      sets: Number(result.rows[0]?.sets ?? 0),
    };
  },

  /* ------------------------ personal records ------------------------ */

  async existingRecords(userId: string, exerciseId: string): Promise<ExistingRecords> {
    const result = await query<{ record_type: string; value: string }>(
      `SELECT DISTINCT ON (record_type) record_type, value
       FROM personal_records WHERE user_id = $1 AND exercise_id = $2
       ORDER BY record_type, value DESC`,
      [userId, exerciseId],
    );
    const map: ExistingRecords = { weight: null, reps: null, estimated_1rm: null, volume: null };
    for (const row of result.rows) {
      (map as unknown as Record<string, number | null>)[row.record_type] = Number(row.value);
    }
    return map;
  },

  async savePersonalRecords(
    userId: string,
    completedWorkoutId: string,
    records: PersonalRecord[],
  ): Promise<PersonalRecord[]> {
    const saved: PersonalRecord[] = [];
    for (const record of records) {
      const result = await query(
        `INSERT INTO personal_records (
           user_id, exercise_id, record_type, value, previous_value, completed_workout_id, achieved_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *, (SELECT name FROM exercises WHERE id = $2) AS exercise_name`,
        [
          userId,
          record.exerciseId,
          record.recordType,
          record.value,
          record.previousValue,
          completedWorkoutId,
          record.achievedAt,
        ],
      );
      saved.push(mapPersonalRecord(result.rows[0]));
    }
    return saved;
  },

  async listPersonalRecords(userId: string, limit = 40): Promise<PersonalRecord[]> {
    const result = await query(
      `SELECT pr.*, e.name AS exercise_name FROM personal_records pr
       JOIN exercises e ON e.id = pr.exercise_id
       WHERE pr.user_id = $1 ORDER BY pr.achieved_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map(mapPersonalRecord);
  },
};

/* ---------------------------- row mappers ---------------------------- */

function mapScheduled(row: Record<string, unknown>): ScheduledWorkout {
  return {
    id: row.id as string,
    programDayId: row.workout_day_id as string,
    dayNumber: Number(row.day_number),
    focus: row.focus as string,
    scheduledDate:
      row.scheduled_date instanceof Date
        ? row.scheduled_date.toISOString().slice(0, 10)
        : String(row.scheduled_date),
    status: row.status as ScheduleStatus,
    durationMinutes: Number(row.duration_minutes),
    completedWorkoutId: (row.completed_workout_id as string) ?? null,
  };
}

function mapCompletedWorkout(row: Record<string, unknown>): CompletedWorkout {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    programDayId: (row.workout_day_id as string) ?? null,
    dayNumber: Number(row.day_number),
    focus: row.focus as string,
    startedAt: (row.started_at as Date).toISOString(),
    completedAt: (row.completed_at as Date).toISOString(),
    durationSeconds: Number(row.duration_seconds),
    totalSets: Number(row.total_sets),
    totalVolumeKg: Number(row.total_volume_kg),
    cardioMinutes: Number(row.cardio_minutes),
    exercises: [],
    personalRecords: [],
  };
}

function mapCompletedSet(row: Record<string, unknown>): CompletedSet {
  return {
    id: row.id as string,
    setNumber: Number(row.set_number),
    actualWeight: row.actual_weight === null ? null : Number(row.actual_weight),
    actualReps: row.actual_reps === null ? null : Number(row.actual_reps),
    prescribedWeight: row.prescribed_weight === null ? null : Number(row.prescribed_weight),
    prescribedRepsMin: Number(row.prescribed_reps_min),
    prescribedRepsMax: Number(row.prescribed_reps_max),
    isWarmup: Boolean(row.is_warmup),
    completedAt: (row.completed_at as Date).toISOString(),
  };
}

function mapPersonalRecord(row: Record<string, unknown>): PersonalRecord {
  return {
    id: row.id as string,
    exerciseId: row.exercise_id as string,
    recordType: row.record_type as PersonalRecord['recordType'],
    value: Number(row.value),
    previousValue: row.previous_value === null ? null : Number(row.previous_value),
    achievedAt: (row.achieved_at as Date).toISOString(),
    exerciseName: (row.exercise_name as string) ?? undefined,
  };
}
