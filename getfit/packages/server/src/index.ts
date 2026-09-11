import { createApp } from './app';
import { env } from './config/env';
import { closePool } from './db/pool';
import { runMigrations } from './db/migrate';
import { seed } from './db/seed';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  // Migrations and the exercise seed run at boot so a fresh environment is
  // usable immediately. Both are idempotent.
  await runMigrations();
  await seed();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`GetFit API listening on port ${env.port}`, {
      nodeEnv: env.nodeEnv,
      mockAiMode: env.mockAiMode,
      devMode: env.devMode,
    });
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down.`);
    server.close(async () => {
      await closePool().catch(() => undefined);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(async (error) => {
  logger.error('Failed to start server', error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
