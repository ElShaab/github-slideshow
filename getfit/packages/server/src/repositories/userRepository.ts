import type {
  AppSettings,
  EquipmentId,
  ExercisePreference,
  GoalType,
  MuscleGroup,
  UserGoal,
  UserProfile,
} from '@getfit/shared';
import { query, transaction } from '../db/pool';

export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  is_guest: boolean;
  deleted_at: Date | null;
  created_at: Date;
}

export const userRepository = {
  async createGuest(): Promise<UserRow> {
    const result = await query<UserRow>(
      `INSERT INTO users (is_guest) VALUES (TRUE) RETURNING *`,
    );
    return result.rows[0];
  },

  async findById(userId: string): Promise<UserRow | null> {
    const result = await query<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await query<UserRow>(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [email],
    );
    return result.rows[0] ?? null;
  },

  async attachCredentials(userId: string, email: string, passwordHash: string): Promise<UserRow> {
    const result = await query<UserRow>(
      `UPDATE users SET email = $2, password_hash = $3, is_guest = FALSE
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [userId, email, passwordHash],
    );
    return result.rows[0];
  },

  /** Hard-deletes the user. Every user-owned table cascades from here. */
  async deleteAccount(userId: string): Promise<void> {
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
  },

  /* ---------------------------- profile ---------------------------- */

  async upsertProfile(userId: string, profile: Omit<UserProfile, 'userId'>): Promise<UserProfile> {
    const result = await query(
      `INSERT INTO user_profiles (
         user_id, age, sex, height_cm, weight_kg, training_level, training_location,
         training_days, session_duration_minutes, onboarding_completed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id) DO UPDATE SET
         age = EXCLUDED.age,
         sex = EXCLUDED.sex,
         height_cm = EXCLUDED.height_cm,
         weight_kg = EXCLUDED.weight_kg,
         training_level = EXCLUDED.training_level,
         training_location = EXCLUDED.training_location,
         training_days = EXCLUDED.training_days,
         session_duration_minutes = EXCLUDED.session_duration_minutes,
         onboarding_completed = EXCLUDED.onboarding_completed
       RETURNING *`,
      [
        userId,
        profile.age,
        profile.sex,
        profile.heightCm,
        profile.weightKg,
        profile.trainingLevel,
        profile.trainingLocation,
        profile.trainingDays,
        profile.sessionDurationMinutes,
        profile.onboardingCompleted,
      ],
    );
    return mapProfile(result.rows[0]);
  },

  async updateProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile | null> {
    const fields: string[] = [];
    const values: unknown[] = [userId];
    const map: Record<string, string> = {
      age: 'age',
      sex: 'sex',
      heightCm: 'height_cm',
      weightKg: 'weight_kg',
      trainingLevel: 'training_level',
      trainingLocation: 'training_location',
      trainingDays: 'training_days',
      sessionDurationMinutes: 'session_duration_minutes',
      onboardingCompleted: 'onboarding_completed',
    };

    for (const [key, column] of Object.entries(map)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    }
    if (fields.length === 0) return this.getProfile(userId);

    const result = await query(
      `UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = $1 RETURNING *`,
      values,
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  },

  async getProfile(userId: string): Promise<UserProfile | null> {
    const result = await query(`SELECT * FROM user_profiles WHERE user_id = $1`, [userId]);
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  },

  /* ----------------------------- goals ----------------------------- */

  async setGoals(userId: string, goals: UserGoal[]): Promise<UserGoal[]> {
    return transaction(async (client) => {
      await client.query(`UPDATE user_goals SET is_active = FALSE WHERE user_id = $1`, [userId]);
      const saved: UserGoal[] = [];
      for (const goal of goals) {
        const result = await client.query(
          `INSERT INTO user_goals (user_id, goal_type, target_value, target_unit, target_exercise_id, start_value, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE)
           ON CONFLICT (user_id, goal_type) WHERE is_active DO UPDATE SET
             target_value = EXCLUDED.target_value,
             target_unit = EXCLUDED.target_unit,
             target_exercise_id = EXCLUDED.target_exercise_id,
             is_active = TRUE
           RETURNING *`,
          [
            userId,
            goal.goalType,
            goal.targetValue ?? null,
            goal.targetUnit ?? null,
            goal.targetExerciseId ?? null,
            goal.startValue ?? null,
          ],
        );
        saved.push(mapGoal(result.rows[0]));
      }
      return saved;
    });
  },

  async getGoals(userId: string): Promise<UserGoal[]> {
    const result = await query(
      `SELECT * FROM user_goals WHERE user_id = $1 AND is_active ORDER BY created_at`,
      [userId],
    );
    return result.rows.map(mapGoal);
  },

  async setGoalStartValues(userId: string, values: Partial<Record<GoalType, number>>): Promise<void> {
    for (const [goalType, value] of Object.entries(values)) {
      if (value === undefined) continue;
      await query(
        `UPDATE user_goals SET start_value = COALESCE(start_value, $3)
         WHERE user_id = $1 AND goal_type = $2 AND is_active`,
        [userId, goalType, value],
      );
    }
  },

  /* --------------------------- equipment --------------------------- */

  async setEquipment(userId: string, equipment: EquipmentId[]): Promise<EquipmentId[]> {
    return transaction(async (client) => {
      await client.query(`DELETE FROM user_equipment WHERE user_id = $1`, [userId]);
      for (const item of equipment) {
        await client.query(
          `INSERT INTO user_equipment (user_id, equipment_id) VALUES ($1,$2)
           ON CONFLICT (user_id, equipment_id) DO NOTHING`,
          [userId, item],
        );
      }
      return equipment;
    });
  },

  async getEquipment(userId: string): Promise<EquipmentId[]> {
    const result = await query<{ equipment_id: EquipmentId }>(
      `SELECT equipment_id FROM user_equipment WHERE user_id = $1 ORDER BY equipment_id`,
      [userId],
    );
    return result.rows.map((r) => r.equipment_id);
  },

  /* -------------------------- preferences -------------------------- */

  async setPreferences(userId: string, preferences: ExercisePreference[]): Promise<ExercisePreference[]> {
    return transaction(async (client) => {
      await client.query(`DELETE FROM exercise_preferences WHERE user_id = $1`, [userId]);
      for (const preference of preferences) {
        await client.query(
          `INSERT INTO exercise_preferences (user_id, muscle_group, exercise_ids, auto_generated)
           VALUES ($1,$2,$3,$4)`,
          [userId, preference.muscleGroup, preference.exerciseIds, preference.autoGenerated],
        );
      }
      return preferences;
    });
  },

  async getPreferences(userId: string): Promise<ExercisePreference[]> {
    const result = await query<{
      muscle_group: MuscleGroup;
      exercise_ids: string[];
      auto_generated: boolean;
    }>(`SELECT muscle_group, exercise_ids, auto_generated FROM exercise_preferences WHERE user_id = $1`, [
      userId,
    ]);
    return result.rows.map((row) => ({
      muscleGroup: row.muscle_group,
      exerciseIds: row.exercise_ids,
      autoGenerated: row.auto_generated,
    }));
  },

  /* ---------------------------- settings --------------------------- */

  async getSettings(userId: string): Promise<AppSettings> {
    const result = await query(`SELECT * FROM app_settings WHERE user_id = $1`, [userId]);
    if (!result.rows[0]) {
      const created = await query(
        `INSERT INTO app_settings (user_id) VALUES ($1) RETURNING *`,
        [userId],
      );
      return mapSettings(created.rows[0]);
    }
    return mapSettings(result.rows[0]);
  },

  async updateSettings(userId: string, patch: Partial<AppSettings>): Promise<AppSettings> {
    const result = await query(
      `INSERT INTO app_settings (user_id, theme_mode, reduced_motion, units)
       VALUES ($1, COALESCE($2,'dark'), COALESCE($3,FALSE), COALESCE($4,'metric'))
       ON CONFLICT (user_id) DO UPDATE SET
         theme_mode = COALESCE($2, app_settings.theme_mode),
         reduced_motion = COALESCE($3, app_settings.reduced_motion),
         units = COALESCE($4, app_settings.units)
       RETURNING *`,
      [userId, patch.themeMode ?? null, patch.reducedMotion ?? null, patch.units ?? null],
    );
    return mapSettings(result.rows[0]);
  },
};

/* ---------------------------- row mappers ---------------------------- */

function mapProfile(row: Record<string, unknown>): UserProfile {
  return {
    userId: row.user_id as string,
    age: Number(row.age),
    sex: row.sex as UserProfile['sex'],
    heightCm: Number(row.height_cm),
    weightKg: Number(row.weight_kg),
    trainingLevel: row.training_level as UserProfile['trainingLevel'],
    trainingLocation: row.training_location as UserProfile['trainingLocation'],
    trainingDays: Number(row.training_days) as UserProfile['trainingDays'],
    sessionDurationMinutes: Number(row.session_duration_minutes) as UserProfile['sessionDurationMinutes'],
    onboardingCompleted: Boolean(row.onboarding_completed),
    createdAt: (row.created_at as Date)?.toISOString(),
    updatedAt: (row.updated_at as Date)?.toISOString(),
  };
}

function mapGoal(row: Record<string, unknown>): UserGoal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    goalType: row.goal_type as GoalType,
    targetValue: row.target_value === null ? null : Number(row.target_value),
    targetUnit: (row.target_unit as string) ?? null,
    targetExerciseId: (row.target_exercise_id as string) ?? null,
    startValue: row.start_value === null ? null : Number(row.start_value),
    isActive: Boolean(row.is_active),
    createdAt: (row.created_at as Date)?.toISOString(),
  };
}

function mapSettings(row: Record<string, unknown>): AppSettings {
  return {
    themeMode: row.theme_mode as AppSettings['themeMode'],
    reducedMotion: Boolean(row.reduced_motion),
    units: row.units as AppSettings['units'],
  };
}
