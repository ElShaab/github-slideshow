import { query } from '../db/pool';
import type { TrendPoint } from '@getfit/shared';

export type ProgressRecordType =
  | 'workout_volume'
  | 'workout_duration'
  | 'workout_sets'
  | 'cardio_minutes'
  | 'body_fat_percent'
  | 'muscle_mass_kg'
  | 'weight_kg';

export interface ProgressRecordInput {
  userId: string;
  recordDate: string;
  recordType: ProgressRecordType;
  referenceId?: string | null;
  value: number;
  unit: string;
  metadata?: Record<string, unknown>;
}

/**
 * Denormalised progress snapshots.
 *
 * The Progress tab could recompute everything from completed_sets and
 * body_metrics, but that cost grows with every session a user logs. Writing a
 * small row per event keeps the dashboard queries flat as history accumulates.
 */
export const progressRepository = {
  async record(input: ProgressRecordInput): Promise<void> {
    await query(
      `INSERT INTO progress_records (user_id, record_date, record_type, reference_id, value, unit, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.userId,
        input.recordDate,
        input.recordType,
        input.referenceId ?? null,
        input.value,
        input.unit,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  },

  async recordMany(inputs: ProgressRecordInput[]): Promise<void> {
    for (const input of inputs) {
      await this.record(input);
    }
  },

  async series(userId: string, recordType: ProgressRecordType): Promise<TrendPoint[]> {
    const result = await query<{ record_date: Date; value: string }>(
      `SELECT record_date, SUM(value) AS value
       FROM progress_records
       WHERE user_id = $1 AND record_type = $2
       GROUP BY record_date ORDER BY record_date ASC`,
      [userId, recordType],
    );
    return result.rows.map((row) => ({
      date:
        row.record_date instanceof Date
          ? row.record_date.toISOString()
          : String(row.record_date),
      value: Number(row.value),
    }));
  },

  async deleteForUser(userId: string): Promise<void> {
    await query(`DELETE FROM progress_records WHERE user_id = $1`, [userId]);
  },
};
