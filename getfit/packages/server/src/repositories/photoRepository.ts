import { query } from '../db/pool';

export interface PhotoRow {
  id: string;
  user_id: string;
  storage_key: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  purpose: string;
  created_at: Date;
  deleted_at: Date | null;
}

export const photoRepository = {
  async create(args: {
    userId: string;
    storageKey: string;
    contentType: string;
    byteSize: number;
    checksum: string;
    purpose: string;
  }): Promise<PhotoRow> {
    const result = await query<PhotoRow>(
      `INSERT INTO user_photos (user_id, storage_key, content_type, byte_size, checksum, purpose)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [args.userId, args.storageKey, args.contentType, args.byteSize, args.checksum, args.purpose],
    );
    return result.rows[0];
  },

  /**
   * Always scoped by user_id. A photo is only ever readable by its owner —
   * ownership is enforced in the query itself, not by a later check.
   */
  async findOwned(userId: string, photoId: string): Promise<PhotoRow | null> {
    const result = await query<PhotoRow>(
      `SELECT * FROM user_photos WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [photoId, userId],
    );
    return result.rows[0] ?? null;
  },

  async listOwned(userId: string): Promise<PhotoRow[]> {
    const result = await query<PhotoRow>(
      `SELECT * FROM user_photos WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  },

  async softDeleteAll(userId: string): Promise<string[]> {
    const result = await query<{ storage_key: string }>(
      `UPDATE user_photos SET deleted_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL RETURNING storage_key`,
      [userId],
    );
    return result.rows.map((r) => r.storage_key);
  },
};
