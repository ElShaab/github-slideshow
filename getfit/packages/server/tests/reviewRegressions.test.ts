/**
 * Regression tests for the code-review findings.
 *
 * Each test fails against the code as it was before the corresponding fix, so
 * these are the net that stops the same defects coming back. Grouped by the
 * finding they cover.
 *
 * Skipped automatically when no database is reachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import * as path from 'node:path';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.MOCK_BILLING = 'true';
process.env.DEV_MODE = 'true';
process.env.LOG_LEVEL = 'error';

let baseUrl = '';
let server: Server | null = null;
let databaseAvailable = true;

async function boot(): Promise<void> {
  const { pool } = await import('../src/db/pool');
  try {
    await pool.query('SELECT 1');
  } catch {
    databaseAvailable = false;
    return;
  }

  const { runMigrations } = await import('../src/db/migrate');
  const { seed } = await import('../src/db/seed');
  await runMigrations();
  await seed();

  const { createApp } = await import('../src/app');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server?.address();
  if (address && typeof address === 'object') baseUrl = `http://127.0.0.1:${address.port}`;
}

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; form?: FormData } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: string | FormData | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return { status: response.status, body: {} as T };
  }
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

function jpegFixture(seed: string): Blob {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x40, 0x04, 0xb0, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const payload = Buffer.alloc(160_000);
  payload.write(seed.repeat(64));
  payload.fill(seed.charCodeAt(0), 64);
  return new Blob([header, payload, Buffer.from([0xff, 0xd9])], { type: 'image/jpeg' });
}

interface Account {
  token: string;
  userId: string;
  email: string;
}

/** Guest → onboarded → analysed → paid → registered. */
async function paidAccount(seed: string): Promise<Account> {
  const guest = await api<{ accessToken: string; userId: string }>('POST', '/api/auth/guest');
  let token = guest.body.accessToken;

  await api('POST', '/api/onboarding', {
    token,
    body: {
      age: 30, sex: 'male', heightCm: 180, weightKg: 82,
      trainingLevel: 'intermediate', trainingLocation: 'gym',
      trainingDays: 4, sessionDurationMinutes: 60,
      goals: ['muscle_gain'], equipment: [],
    },
  });

  const form = new FormData();
  form.append('photo', jpegFixture(seed), 'body.jpg');
  await api('POST', '/api/assessments/initial', { token, form });

  await api('POST', '/api/subscription/purchase', {
    token,
    body: { platform: 'mock', receipt: 'mock-success' },
  });

  const email = `rr-${seed}-${randomBytes(4).toString('hex')}@getfit.test`;
  const account = await api<{ accessToken: string }>('POST', '/api/auth/account', {
    token,
    body: { email, password: 'a-strong-password' },
  });
  token = account.body.accessToken;

  return { token, userId: guest.body.userId, email };
}

before(async () => {
  await boot();
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closePool } = await import('../src/db/pool');
  await closePool().catch(() => undefined);
});

describe('account takeover via /auth/account (#2)', () => {
  test('a registered account cannot have its credentials rewritten', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t1');

    // The same still-valid token must not be able to move the account to an
    // attacker's email and password without proving the current one.
    const hijack = await api<{ error: { code: string } }>('POST', '/api/auth/account', {
      token: account.token,
      body: { email: `attacker-${randomBytes(3).toString('hex')}@evil.test`, password: 'attacker-password' },
    });
    assert.notEqual(hijack.status, 200, 'a registered account was re-registered');
    assert.equal(hijack.status, 409);

    // The original owner still signs in with what they set.
    const login = await api<{ accessToken: string }>('POST', '/api/auth/login', {
      body: { email: account.email, password: 'a-strong-password' },
    });
    assert.equal(login.status, 200, 'the real owner was locked out');
  });

  test('a guest can still complete their account exactly once', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t2');
    const me = await api<{ isGuest: boolean }>('GET', '/api/auth/me', { token: account.token });
    assert.equal(me.body.isGuest, false, 'the guest upgrade stopped working');
  });
});

describe('subscription gate bypass (#12)', () => {
  test('program-rebuilding settings are refused without a membership', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t3');
    await api('POST', '/api/dev/subscription/expire', { token: account.token });

    const gated: Array<[string, string, unknown]> = [
      ['PATCH', '/api/settings/profile', { trainingDays: 5 }],
      ['PUT', '/api/settings/goals', { goals: [{ goalType: 'fat_loss' }] }],
      ['PUT', '/api/settings/equipment', { equipment: ['dumbbells'] }],
      ['POST', '/api/exercises/preferences/generate', undefined],
    ];

    for (const [method, path, body] of gated) {
      const response = await api<{ error: { code: string } }>(method, path, {
        token: account.token,
        body,
      });
      assert.equal(response.status, 402, `${method} ${path} regenerated a program unpaid`);
      assert.equal(response.body.error.code, 'subscription_required');
    }
  });

  test('an expired member can still read settings to fix their billing', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t4');
    await api('POST', '/api/dev/subscription/expire', { token: account.token });

    const settings = await api('GET', '/api/settings', { token: account.token });
    assert.equal(settings.status, 200, 'an expired member was locked out of their own settings');

    const entitlement = await api('GET', '/api/subscription/entitlement', { token: account.token });
    assert.equal(entitlement.status, 200);
  });
});

describe('billing verification (#1)', () => {
  test('a failed verification never takes away a paid period', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t5');

    const before = await api<{ active: boolean; expiresAt: string }>(
      'GET',
      '/api/subscription/entitlement',
      { token: account.token },
    );
    assert.equal(before.body.active, true);

    // Simulates an App Store outage during "Restore purchase".
    const failed = await api('POST', '/api/subscription/purchase', {
      token: account.token,
      body: { platform: 'mock', receipt: 'mock-failed' },
    });
    assert.equal(failed.status, 402);

    const after = await api<{ active: boolean; expiresAt: string }>(
      'GET',
      '/api/subscription/entitlement',
      { token: account.token },
    );
    assert.equal(after.body.active, true, 'a live membership was destroyed by a failed verification');
    assert.equal(after.body.expiresAt, before.body.expiresAt, 'the paid period was rewritten');
  });
});

describe('receipt binding (#5)', () => {
  test('one store receipt cannot entitle two accounts', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const { query } = await import('../src/db/pool');
    const [a, b] = await Promise.all([paidAccount('t6'), paidAccount('t7')]);
    const sharedReceipt = `apple-txn-${randomUUID()}`;

    const bind = (userId: string) =>
      query(
        `UPDATE subscriptions SET platform = 'apple', original_transaction_id = $2
         WHERE user_id = $1`,
        [userId, sharedReceipt],
      );

    await bind(a.userId);
    await assert.rejects(
      () => bind(b.userId),
      /duplicate key|unique/i,
      'the same receipt was bound to a second account',
    );
  });
});

describe('receipt binding cannot be poisoned', () => {
  test('a receipt that fails verification is never bound to the submitter', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    // Introduced while fixing #5: the invalid-receipt branch wrote the
    // transaction id before the binding check ran. Anyone could submit a
    // stranger's refunded receipt, claim its permanent id onto their own row,
    // and lock the rightful owner out of ever subscribing.
    const attacker = await paidAccount('t11');
    const { query } = await import('../src/db/pool');

    await query(`UPDATE subscriptions SET original_transaction_id = NULL WHERE user_id = $1`, [
      attacker.userId,
    ]);

    const rejected = await api('POST', '/api/subscription/purchase', {
      token: attacker.token,
      body: { platform: 'mock', receipt: 'mock-revoked' },
    });
    assert.notEqual(rejected.status, 201);

    const row = await query<{ original_transaction_id: string | null }>(
      `SELECT original_transaction_id FROM subscriptions WHERE user_id = $1`,
      [attacker.userId],
    );
    assert.equal(
      row.rows[0]?.original_transaction_id ?? null,
      null,
      'a receipt that failed verification was bound to the account that submitted it',
    );
  });
});

describe('rest days and stale schedules (#8)', () => {
  test('no workout is offered on a rest day', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t8');
    await api('POST', '/api/program/generate', { token: account.token });

    const { query } = await import('../src/db/pool');
    // Push every remaining session into the future: today is a rest day.
    await query(
      `UPDATE scheduled_workouts SET scheduled_date = CURRENT_DATE + INTERVAL '3 days'
       WHERE user_id = $1 AND status IN ('scheduled','rescheduled')`,
      [account.userId],
    );

    const today = await api<{ workout: unknown }>('GET', '/api/workouts/today', {
      token: account.token,
    });
    assert.equal(today.status, 200);
    assert.equal(today.body.workout, null, 'a rest day still demanded a workout');
  });

  test('an abandoned schedule does not block a fresh week', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t9');
    await api('POST', '/api/program/generate', { token: account.token });

    const { query } = await import('../src/db/pool');
    // A month away: these sit outside the reorganisation window entirely.
    await query(
      `UPDATE scheduled_workouts SET scheduled_date = CURRENT_DATE - INTERVAL '30 days'
       WHERE user_id = $1`,
      [account.userId],
    );

    // Any read that refreshes the schedule should lay out a new week.
    await api('GET', '/api/program/schedule', { token: account.token });

    const upcoming = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM scheduled_workouts
       WHERE user_id = $1 AND status IN ('scheduled','rescheduled')
         AND scheduled_date >= CURRENT_DATE`,
      [account.userId],
    );
    assert.ok(
      Number(upcoming.rows[0].count) > 0,
      'a month-old schedule left the user with nothing to train',
    );

    const stale = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM scheduled_workouts
       WHERE user_id = $1 AND status IN ('scheduled','rescheduled')
         AND scheduled_date < CURRENT_DATE - INTERVAL '7 days'`,
      [account.userId],
    );
    assert.equal(Number(stale.rows[0].count), 0, 'stale sessions were left pending forever');
  });
});

/** Boots src/config/env in a child process and returns what happened. */
async function bootEnv(overrides: Record<string, string | undefined>) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value !== undefined) env[key] = value;
  }

  try {
    await run(process.execPath, ['-e', "require('tsx/cjs'); require('./src/config/env');"], {
      cwd: path.resolve(__dirname, '..'),
      env,
    });
    return { started: true, stderr: '' };
  } catch (error) {
    return { started: false, stderr: (error as Error & { stderr?: string }).stderr ?? '' };
  }
}

/** A production configuration with nothing wrong with it. */
const SAFE_PRODUCTION_ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: randomBytes(48).toString('base64'),
  MOCK_BILLING: 'false',
  DEV_MODE: 'false',
  CORS_ORIGINS: 'https://app.getfit.example',
  STORAGE_DRIVER: 's3',
  STORAGE_S3_BUCKET: 'getfit-photos',
  STORAGE_S3_REGION: 'us-east-1',
  APPLE_SHARED_SECRET: 's',
  GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
  DATABASE_SSL: 'false',
  DATABASE_SSL_INSECURE: 'false',
  // Explicitly unset, so a variable left over in the shell cannot mask a
  // regression here.
  MOCK_AI_MODE: undefined,
  AI_PROVIDER: undefined,
  AI_BASE_URL: undefined,
  AI_API_KEY: undefined,
  DATABASE_CA_CERT: undefined,
};

describe('database TLS (#7)', () => {
  test('production refuses to start without certificate verification', async () => {
    // Encrypting without verifying the server stops a passive eavesdropper but
    // not an active one, and every row here is personal health data.
    const result = await bootEnv({
      ...SAFE_PRODUCTION_ENV,
      DATABASE_SSL: 'true',
      DATABASE_SSL_INSECURE: 'true',
    });

    assert.equal(result.started, false, 'production started with certificate verification disabled');
    assert.match(result.stderr, /DATABASE_SSL_INSECURE must be false/);
  });
});

describe('body analysis needs no AI provider', () => {
  test('production starts with no AI configuration at all', async () => {
    // Body composition is computed locally from tape measurements, so there is
    // nothing to configure and nothing to pay for.
    const result = await bootEnv(SAFE_PRODUCTION_ENV);

    assert.equal(
      result.started,
      true,
      `production refused to start without an AI provider:\n${result.stderr}`,
    );
  });

  test('a half-configured provider is refused rather than failing per request', async () => {
    // A named provider with no endpoint or key would return 502 on every
    // assessment. Better to never start than to look healthy and serve errors.
    for (const missing of [
      { AI_PROVIDER: 'openai', AI_BASE_URL: 'https://ai.example' },
      { AI_PROVIDER: 'openai', AI_API_KEY: 'k' },
      { AI_PROVIDER: 'openai' },
    ]) {
      const result = await bootEnv({ ...SAFE_PRODUCTION_ENV, ...missing });
      assert.equal(result.started, false, `started with ${JSON.stringify(missing)}`);
      assert.match(result.stderr, /AI_BASE_URL and AI_API_KEY are required/);
    }
  });

  test('a fully configured provider still starts', async () => {
    const result = await bootEnv({
      ...SAFE_PRODUCTION_ENV,
      AI_PROVIDER: 'openai',
      AI_BASE_URL: 'https://ai.example',
      AI_API_KEY: 'k',
    });

    assert.equal(result.started, true, `a complete AI configuration was refused:\n${result.stderr}`);
  });
});

describe('completed workouts link to their program (#11)', () => {
  test('program_id is populated', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await paidAccount('t10');
    await api('POST', '/api/program/generate', { token: account.token });

    const today = await api<{
      workout: { scheduledWorkoutId: string; day: { id: string; exercises: Array<{
        id: string; exerciseId: string; prescribedSets: Array<{ setNumber: number;
          prescribedWeight: number | null; prescribedRepsMin: number;
          prescribedRepsMax: number; isWarmup: boolean }> }> } };
    }>('GET', '/api/workouts/today', { token: account.token });

    const day = today.body.workout.day;
    const completed = await api<{ summary: { id: string } }>('POST', '/api/workouts/complete', {
      token: account.token,
      body: {
        scheduledWorkoutId: today.body.workout.scheduledWorkoutId,
        workoutDayId: day.id,
        startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        durationSeconds: 1800,
        cardioMinutes: 5,
        exercises: day.exercises.map((exercise, index) => ({
          exerciseId: exercise.exerciseId,
          workoutExerciseId: exercise.id,
          orderIndex: index,
          sets: exercise.prescribedSets.map((set) => ({
            setNumber: set.setNumber,
            actualWeight: set.prescribedWeight,
            actualReps: set.prescribedRepsMax,
            prescribedWeight: set.prescribedWeight,
            prescribedRepsMin: set.prescribedRepsMin,
            prescribedRepsMax: set.prescribedRepsMax,
            isWarmup: set.isWarmup,
            completedAt: new Date().toISOString(),
          })),
        })),
      },
    });
    assert.equal(completed.status, 201);

    const { query } = await import('../src/db/pool');
    const row = await query<{ program_id: string | null }>(
      `SELECT program_id FROM completed_workouts WHERE id = $1`,
      [completed.body.summary.id],
    );
    assert.ok(row.rows[0].program_id, 'the completed workout was not linked to its program');
  });
});

describe('yearly membership', () => {
  test('the plan endpoint offers monthly and a badged yearly deal', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{
      priceUsd: number;
      freeTrial: boolean;
      plans: Array<{
        productId: string;
        period: string;
        priceUsd: number;
        listPriceUsd: number | null;
        badge: string | null;
        limitedTime: boolean;
      }>;
    }>('GET', '/api/subscription/plan');

    assert.equal(response.status, 200);
    // The flat monthly fields stay for clients that predate the catalogue.
    assert.equal(response.body.priceUsd, 5);
    assert.equal(response.body.freeTrial, false);

    const monthly = response.body.plans.find((p) => p.period === 'month');
    const yearly = response.body.plans.find((p) => p.period === 'year');

    assert.ok(monthly, 'the monthly plan disappeared');
    assert.equal(monthly.priceUsd, 5);
    assert.equal(monthly.listPriceUsd, null, 'the monthly plan should carry no offer');

    assert.ok(yearly, 'no yearly plan was offered');
    assert.equal(yearly.priceUsd, 20);
    assert.equal(yearly.listPriceUsd, 40, '$40 must be shown struck through');
    assert.equal(yearly.badge, 'BEST DEAL');
    assert.equal(yearly.limitedTime, true);
  });

  test('buying the yearly plan grants a year and stores its price', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const guest = await api<{ accessToken: string; userId: string }>('POST', '/api/auth/guest');
    const token = guest.body.accessToken;

    const purchase = await api<{ entitlement: { active: boolean; expiresAt: string } }>(
      'POST',
      '/api/subscription/purchase',
      {
        token,
        body: {
          platform: 'mock',
          receipt: 'mock-success',
          productId: 'getfit_membership_yearly',
        },
      },
    );

    assert.equal(purchase.status, 201);
    assert.equal(purchase.body.entitlement.active, true);

    // A year, not the monthly period the mock used to hand out regardless.
    const days =
      (new Date(purchase.body.entitlement.expiresAt).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 300, `yearly purchase granted only ${Math.round(days)} days`);

    const { query } = await import('../src/db/pool');
    const row = await query<{ price_usd: string; product_id: string }>(
      `SELECT price_usd, product_id FROM subscriptions WHERE user_id = $1`,
      [guest.body.userId],
    );
    assert.equal(Number(row.rows[0].price_usd), 20, 'the yearly plan was priced as monthly');
    assert.equal(row.rows[0].product_id, 'getfit_membership_yearly');
  });

  test('a product we do not sell is refused', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const guest = await api<{ accessToken: string }>('POST', '/api/auth/guest');
    const response = await api<{ error: { code: string } }>('POST', '/api/subscription/purchase', {
      token: guest.body.accessToken,
      body: {
        platform: 'mock',
        receipt: 'mock-success',
        productId: 'getfit_membership_lifetime_free',
      },
    });

    assert.equal(response.status, 422, 'an unknown product id was accepted');
    assert.equal(response.body.error.code, 'invalid_input');
  });
});
