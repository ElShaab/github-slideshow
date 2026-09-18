import * as fs from 'node:fs';
import * as path from 'node:path';
import { closePool, pool } from './pool';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runMigrations(): Promise<string[]> {
  await ensureMigrationsTable();

  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const executed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      executed.push(file);
      logger.info(`Applied migration ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Migration ${file} failed`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  if (executed.length === 0) logger.info('No pending migrations.');
  return executed;
}

if (require.main === module) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (error) => {
      logger.error('Migration run failed', error);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
