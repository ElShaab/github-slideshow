import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * TLS verifies the server certificate by default. Encrypting without checking
 * who is on the other end stops a passive eavesdropper but not an active one,
 * and every row on this connection is personal health data.
 *
 * A self-signed certificate is supported by pointing DATABASE_CA_CERT at its
 * CA bundle. DATABASE_SSL_INSECURE exists only as a deliberate, named escape
 * hatch for local work, and production refuses to start with it set.
 */
function sslConfig(): { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (!env.databaseSsl) return undefined;
  if (env.databaseCaCert) return { rejectUnauthorized: true, ca: env.databaseCaCert };
  if (env.databaseSslInsecure) {
    logger.warn('Database TLS is not verifying the server certificate (DATABASE_SSL_INSECURE).');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.databasePoolMax,
  ssl: sslConfig(),
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Runs `fn` inside a transaction, rolling back on any thrown error. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
