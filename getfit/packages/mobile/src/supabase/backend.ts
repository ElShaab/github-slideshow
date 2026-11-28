import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushPayload, RemoteSnapshot, SyncBackend } from './sync';
import type {
  AssessmentRow,
  CompletedWorkoutRow,
  EquipmentRow,
  GoalRow,
  PersonalRecordRow,
  PreferenceRow,
  ProfileRow,
  ProgramRow,
  ScheduledWorkoutRow,
} from './rows';

/**
 * The sync engine's backend, spoken over PostgREST.
 *
 * Nothing here decides anything: reconciliation happens in the engine, and this
 * only moves rows. Every statement is scoped to one user id, and row-level
 * security enforces the same thing on the server — the client is not trusted to
 * scope its own reads.
 */

/** Postgres rejects an oversized statement, so pushes go up in batches. */
const BATCH = 200;

async function inBatches<T>(rows: T[], send: (slice: T[]) => Promise<void>): Promise<void> {
  for (let at = 0; at < rows.length; at += BATCH) {
    await send(rows.slice(at, at + BATCH));
  }
}

export function createSupabaseBackend(client: SupabaseClient): SyncBackend {
  /** PostgREST reports failures in the body, not by throwing. */
  const check = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };

  const rowsOf = async <T>(table: string, userId: string): Promise<T[]> => {
    const { data, error } = await client.from(table).select('*').eq('user_id', userId);
    check(`read ${table}`, error);
    return (data ?? []) as T[];
  };

  const upsert = async (table: string, rows: unknown[]): Promise<void> => {
    if (rows.length === 0) return;
    await inBatches(rows, async (slice) => {
      const { error } = await client.from(table).upsert(slice);
      check(`write ${table}`, error);
    });
  };

  /**
   * Removes the rows this device no longer has.
   *
   * Upserting alone would leave a deleted goal or a rescheduled slot behind
   * forever. The upsert runs first, so the rows being kept are already current
   * when the delete lands — a failure between the two leaves extra rows, never
   * missing ones.
   */
  const deleteMissing = async (
    table: string,
    userId: string,
    column: string,
    keep: string[],
  ): Promise<void> => {
    let query = client.from(table).delete().eq('user_id', userId);
    if (keep.length > 0) {
      // PostgREST's `in` list is a literal; ids are app-generated and contain
      // no quotes or commas, but they are quoted regardless so a future id
      // format cannot break out of the filter.
      query = query.not(column, 'in', `(${keep.map((id) => `"${id}"`).join(',')})`);
    }
    const { error } = await query;
    check(`prune ${table}`, error);
  };

  return {
    async fetchAll(userId: string): Promise<RemoteSnapshot> {
      const [profiles, goals, equipment, preferences, programs, schedule, completed, records, assessments] =
        await Promise.all([
          rowsOf<ProfileRow & { updated_at: string }>('profiles', userId),
          rowsOf<GoalRow>('user_goals', userId),
          rowsOf<EquipmentRow>('user_equipment', userId),
          rowsOf<PreferenceRow>('exercise_preferences', userId),
          rowsOf<ProgramRow & { updated_at: string }>('programs', userId),
          rowsOf<ScheduledWorkoutRow & { updated_at: string }>('scheduled_workouts', userId),
          rowsOf<CompletedWorkoutRow>('completed_workouts', userId),
          rowsOf<PersonalRecordRow>('personal_records', userId),
          rowsOf<AssessmentRow>('assessments', userId),
        ]);

      const profile = profiles[0] ?? null;
      const program = programs.find((row) => row.is_active) ?? programs[0] ?? null;

      // The programme and its schedule are one unit, so "when did the plan last
      // change" is the latest stamp across both.
      const programUpdatedAt = [program, ...schedule]
        .map((row) => row?.updated_at)
        .filter((at): at is string => typeof at === 'string')
        .sort()
        .pop();

      return {
        profile: profile ? { profile, goals, equipment, preferences } : null,
        profileUpdatedAt: profile?.updated_at ?? null,
        program: { program, schedule },
        programUpdatedAt: programUpdatedAt ?? null,
        workouts: { completed, records },
        assessments,
      };
    },

    /**
     * Two kinds of table go up here.
     *
     * Goals, equipment, preferences, the programme and the schedule are sets
     * the device owns outright: what it sends replaces what is there, so they
     * are upserted and then pruned. Completed workouts, records and assessments
     * are history — appended to, never pruned, because the rows this device has
     * not seen belong to another one the user also trains on.
     */
    async push(userId: string, payload: PushPayload): Promise<void> {
      // The profile row first: every other table's foreign key is to auth.users
      // rather than to it, but a partial push that left no profile behind would
      // read back as an empty account and adopt the next device's data.
      await upsert('profiles', [payload.profile.profile]);

      await upsert('user_goals', payload.profile.goals);
      await upsert('user_equipment', payload.profile.equipment);
      await upsert('exercise_preferences', payload.profile.preferences);
      if (payload.program.program) await upsert('programs', [payload.program.program]);
      await upsert('scheduled_workouts', payload.program.schedule);

      await upsert('completed_workouts', payload.workouts.completed);
      await upsert('personal_records', payload.workouts.records);
      await upsert('assessments', payload.assessments);

      await deleteMissing('user_goals', userId, 'id', payload.profile.goals.map((row) => row.id));
      await deleteMissing(
        'user_equipment',
        userId,
        'equipment_id',
        payload.profile.equipment.map((row) => row.equipment_id),
      );
      await deleteMissing(
        'exercise_preferences',
        userId,
        'muscle_group',
        payload.profile.preferences.map((row) => row.muscle_group),
      );
      await deleteMissing(
        'scheduled_workouts',
        userId,
        'id',
        payload.program.schedule.map((row) => row.id),
      );
      await deleteMissing(
        'programs',
        userId,
        'id',
        payload.program.program ? [payload.program.program.id] : [],
      );
    },

    /**
     * Account deletion.
     *
     * Removing the auth record needs privileges a shipped app must never carry,
     * so it happens inside `delete_own_account()`, which can only ever delete
     * the caller's own row. Every table cascades from auth.users, so this takes
     * the data with it and leaves nothing behind — not even an email address.
     *
     * Any failure is raised rather than swallowed: the caller keeps the local
     * copy and tells the user nothing was deleted, which is better than a
     * deletion the user believes in and did not get.
     */
    async deleteAll(_userId: string): Promise<void> {
      const { error } = await client.rpc('delete_own_account');
      check('delete account', error);
    },
  };
}
