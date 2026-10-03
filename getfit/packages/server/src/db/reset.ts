import { env } from '../config/env';
import { closePool, pool } from './pool';
import { logger } from '../utils/logger';
import { runMigrations } from './migrate';
import { seed } from './seed';

/** Drops and rebuilds the public schema. Refuses to run in production. */
async function reset(): Promise<void> {
  if (env.isProduction) {
    throw new Error('Refusing to reset the database in production.');
  }
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  logger.info('Schema dropped and recreated.');
  await runMigrations();
  const result = await seed();
  logger.info('Reset complete', result);
}

reset()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error('Reset failed', error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
