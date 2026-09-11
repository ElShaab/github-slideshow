import type { BodyAnalysisResult, BodyAssessment, TrendPoint } from '@getfit/shared';
import { query, transaction } from '../db/pool';

export const assessmentRepository = {
  async create(args: {
    userId: string;
    weightKg: number;
    analysis: BodyAnalysisResult;
    sourcePhotoId: string | null;
  }): Promise<BodyAssessment> {
    return transaction(async (client) => {
      const numberResult = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(assessment_number), 0) + 1 AS next FROM body_assessments WHERE user_id = $1`,
        [args.userId],
      );
      const assessmentNumber = Number(numberResult.rows[0].next);

      const inserted = await client.query(
        `INSERT INTO body_assessments (
           user_id, assessment_number, weight_kg, body_fat_percent, muscle_mass_kg,
           waist_body_ratio, symmetry_percent, confidence, provider, hologram_data, source_photo_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          args.userId,
          assessmentNumber,
          args.weightKg,
          args.analysis.bodyFatPercent,
          args.analysis.estimatedMuscleMassKg,
          args.analysis.waistBodyRatio,
          args.analysis.symmetryPercent,
          args.analysis.confidence,
          args.analysis.provider,
          JSON.stringify(args.analysis.hologramData),
          args.sourcePhotoId,
        ],
      );
      const row = inserted.rows[0];

      const metrics: Array<[string, number, string]> = [
        ['weight_kg', args.weightKg, 'kg'],
        ['body_fat_percent', args.analysis.bodyFatPercent, '%'],
        ['muscle_mass_kg', args.analysis.estimatedMuscleMassKg, 'kg'],
        ['waist_body_ratio', args.analysis.waistBodyRatio, 'ratio'],
        ['symmetry_percent', args.analysis.symmetryPercent, '%'],
      ];
      for (const [key, value, unit] of metrics) {
        await client.query(
          `INSERT INTO body_metrics (user_id, assessment_id, metric_key, metric_value, unit, recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [args.userId, row.id, key, value, unit, row.created_at],
        );
      }

      await client.query(
        `INSERT INTO body_holograms (user_id, assessment_id, version, seed, geometry)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          args.userId,
          row.id,
          args.analysis.hologramData.version,
          args.analysis.hologramData.seed,
          JSON.stringify(args.analysis.hologramData),
        ],
      );

      return mapAssessment(row);
    });
  },

  async latest(userId: string): Promise<BodyAssessment | null> {
    const result = await query(
      `SELECT * FROM body_assessments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapAssessment(result.rows[0]) : null;
  },

  async first(userId: string): Promise<BodyAssessment | null> {
    const result = await query(
      `SELECT * FROM body_assessments WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapAssessment(result.rows[0]) : null;
  },

  async history(userId: string, limit = 52): Promise<BodyAssessment[]> {
    const result = await query(
      `SELECT * FROM body_assessments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map(mapAssessment);
  },

  async findById(userId: string, assessmentId: string): Promise<BodyAssessment | null> {
    const result = await query(
      `SELECT * FROM body_assessments WHERE user_id = $1 AND id = $2`,
      [userId, assessmentId],
    );
    return result.rows[0] ? mapAssessment(result.rows[0]) : null;
  },

  async trend(userId: string, metricKey: string): Promise<TrendPoint[]> {
    const result = await query<{ recorded_at: Date; metric_value: string }>(
      `SELECT recorded_at, metric_value FROM body_metrics
       WHERE user_id = $1 AND metric_key = $2
       ORDER BY recorded_at ASC`,
      [userId, metricKey],
    );
    return result.rows.map((row) => ({
      date: row.recorded_at.toISOString(),
      value: Number(row.metric_value),
    }));
  },
};

export function mapAssessment(row: Record<string, unknown>): BodyAssessment {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    assessmentNumber: Number(row.assessment_number),
    createdAt: (row.created_at as Date).toISOString(),
    weightKg: Number(row.weight_kg),
    bodyFatPercent: Number(row.body_fat_percent),
    estimatedMuscleMassKg: Number(row.muscle_mass_kg),
    waistBodyRatio: Number(row.waist_body_ratio),
    symmetryPercent: Number(row.symmetry_percent),
    confidence: Number(row.confidence),
    provider: row.provider as string,
    hologramData: row.hologram_data as BodyAssessment['hologramData'],
    sourcePhotoId: (row.source_photo_id as string) ?? null,
  };
}
