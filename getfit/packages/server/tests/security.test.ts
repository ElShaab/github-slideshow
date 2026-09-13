/**
 * Cross-user isolation and authentication hardening.
 *
 * Builds two independent paid accounts and then tries, from each ID-bearing
 * route, to reach the other user's data. Nothing here may ever return another
 * user's record, and nothing may be mutated on their behalf.
 *
 * Skipped automatically when no database is reachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import * as jwt from 'jsonwebtoken';

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
  // Photo routes answer with image bytes, so only JSON is parsed.
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
  assessmentId: string;
  photoId: string;
  workoutDayId: string;
  scheduledWorkoutId: string;
  completedWorkoutId: string;
}

/** Drives one user all the way to a completed workout so every id exists. */
async function buildAccount(seed: string): Promise<Account> {
  const guest = await api<{ accessToken: string; userId: string }>('POST', '/api/auth/guest');
  let token = guest.body.accessToken;
  const userId = guest.body.userId;

  await api('POST', '/api/onboarding', {
    token,
    body: {
      age: 30,
      sex: 'male',
      heightCm: 180,
      weightKg: 82,
      trainingLevel: 'intermediate',
      trainingLocation: 'gym',
      trainingDays: 4,
      sessionDurationMinutes: 60,
      goals: ['muscle_gain'],
      equipment: [],
    },
  });

  const form = new FormData();
  form.append('photo', jpegFixture(seed), 'body.jpg');
  const assessment = await api<{ assessment: { id: string; sourcePhotoId: string } }>(
    'POST',
    '/api/assessments/initial',
    { token, form },
  );

  await api('POST', '/api/subscription/purchase', {
    token,
    body: { platform: 'mock', receipt: 'mock-success' },
  });

  const account = await api<{ accessToken: string }>('POST', '/api/auth/account', {
    token,
    body: {
      email: `sec-${seed}-${randomBytes(4).toString('hex')}@getfit.test`,
      password: 'a-strong-password',
    },
  });
  token = account.body.accessToken;

  await api('POST', '/api/exercises/preferences/generate', { token });
  await api('POST', '/api/program/generate', { token });

  const today = await api<{
    workout: { scheduledWorkoutId: string; day: { id: string; exercises: Array<{
      id: string; exerciseId: string; prescribedSets: Array<{ setNumber: number; prescribedWeight: number | null;
        prescribedRepsMin: number; prescribedRepsMax: number; isWarmup: boolean }> }> } };
  }>('GET', '/api/workouts/today', { token });

  const day = today.body.workout.day;
  const completed = await api<{ summary: { id: string } }>('POST', '/api/workouts/complete', {
    token,
    body: {
      scheduledWorkoutId: today.body.workout.scheduledWorkoutId,
      workoutDayId: day.id,
      startedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
      durationSeconds: 40 * 60,
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

  const schedule = await api<{ upcoming: Array<{ id: string }> }>('GET', '/api/program/schedule', {
    token,
  });

  return {
    token,
    userId,
    assessmentId: assessment.body.assessment.id,
    photoId: assessment.body.assessment.sourcePhotoId,
    workoutDayId: day.id,
    scheduledWorkoutId: schedule.body.upcoming[0]?.id ?? '',
    completedWorkoutId: completed.body.summary.id,
  };
}

before(async () => {
  await boot();
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closePool } = await import('../src/db/pool');
  await closePool().catch(() => undefined);
});

describe('cross-user isolation', () => {
  let alice: Account;
  let bob: Account;

  test('two independent paid accounts can be created', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    alice = await buildAccount('a');
    bob = await buildAccount('b');

    assert.notEqual(alice.userId, bob.userId);
    assert.ok(alice.photoId && bob.photoId, 'both users should have a stored photo');
    assert.ok(alice.completedWorkoutId && bob.completedWorkoutId);
    assert.notEqual(alice.workoutDayId, bob.workoutDayId);
  });

  test("another user's photo is never served", async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api('GET', `/api/photos/${alice.photoId}`, { token: bob.token });
    assert.equal(response.status, 404, "Bob reached Alice's photo");

    // And the owner still can.
    const owner = await api('GET', `/api/photos/${alice.photoId}`, { token: alice.token });
    assert.equal(owner.status, 200, 'the owner lost access to their own photo');
  });

  test('photos are never listed across users', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ photos: Array<{ id: string }> }>('GET', '/api/photos', {
      token: bob.token,
    });
    assert.equal(response.status, 200);
    const ids = response.body.photos.map((p) => p.id);
    assert.ok(!ids.includes(alice.photoId), "Alice's photo appeared in Bob's list");
  });

  test("another user's workout day is not readable", async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api('GET', `/api/program/day/${alice.workoutDayId}`, {
      token: bob.token,
    });
    assert.ok(
      response.status === 404 || response.status === 403,
      `expected 404/403, got ${response.status}`,
    );
  });

  test("another user's completed workout is not readable", async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api('GET', `/api/workouts/history/${alice.completedWorkoutId}`, {
      token: bob.token,
    });
    assert.ok(
      response.status === 404 || response.status === 403,
      `expected 404/403, got ${response.status}`,
    );

    const owner = await api('GET', `/api/workouts/history/${alice.completedWorkoutId}`, {
      token: alice.token,
    });
    assert.equal(owner.status, 200, 'the owner lost access to their own workout');
  });

  test("another user's scheduled workout cannot be skipped", async (t) => {
    if (!databaseAvailable) return t.skip('No database available');
    if (!alice.scheduledWorkoutId) return t.skip('No scheduled workout to test');

    const response = await api('POST', `/api/workouts/skip/${alice.scheduledWorkoutId}`, {
      token: bob.token,
    });
    assert.ok(
      response.status === 404 || response.status === 403,
      `Bob skipped Alice's workout (${response.status})`,
    );

    // The decisive check: Alice's schedule is untouched either way.
    const schedule = await api<{ upcoming: Array<{ id: string; status: string }> }>(
      'GET',
      '/api/program/schedule',
      { token: alice.token },
    );
    const entry = schedule.body.upcoming.find((e) => e.id === alice.scheduledWorkoutId);
    assert.ok(entry, "Alice's scheduled workout disappeared");
    assert.notEqual(entry.status, 'missed', "Bob marked Alice's workout as missed");
  });

  test("a workout cannot be completed against another user's day", async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api('POST', '/api/workouts/complete', {
      token: bob.token,
      body: {
        scheduledWorkoutId: alice.scheduledWorkoutId || null,
        workoutDayId: alice.workoutDayId,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        durationSeconds: 600,
        cardioMinutes: 0,
        exercises: [],
      },
    });
    assert.notEqual(response.status, 201, "Bob logged a workout against Alice's program");
  });

  test('progress and assessments only ever describe the caller', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const [aliceProgress, bobProgress] = await Promise.all([
      api<{ records: unknown[] }>('GET', '/api/progress/records', { token: alice.token }),
      api<{ records: unknown[] }>('GET', '/api/progress/records', { token: bob.token }),
    ]);
    assert.equal(aliceProgress.status, 200);
    assert.equal(bobProgress.status, 200);

    const serialised = JSON.stringify(bobProgress.body);
    assert.ok(!serialised.includes(alice.userId), "Bob's progress referenced Alice");
    assert.ok(
      !serialised.includes(alice.completedWorkoutId),
      "Bob's progress referenced Alice's workout",
    );
  });

  test('deleting one account leaves the other intact', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const victim = await buildAccount('c');
    const deletion = await api('DELETE', '/api/auth/account', { token: victim.token });
    assert.equal(deletion.status, 200);

    // The deleted user's token stops working immediately.
    const after = await api('GET', '/api/progress/records', { token: victim.token });
    assert.equal(after.status, 401, 'a deleted account kept a working session');

    // Their photo is gone for everyone, including them.
    const photo = await api('GET', `/api/photos/${victim.photoId}`, { token: alice.token });
    assert.equal(photo.status, 404);

    // Alice is untouched.
    const alive = await api('GET', '/api/progress/records', { token: alice.token });
    assert.equal(alive.status, 200, 'deleting one account broke another');
  });
});

describe('authentication hardening', () => {
  test('protected routes reject a missing or malformed token', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const paths = [
      '/api/progress/overview',
      '/api/program/active',
      '/api/workouts/today',
      '/api/settings',
      '/api/photos',
      '/api/subscription/entitlement',
    ];

    for (const path of paths) {
      const none = await api('GET', path);
      assert.equal(none.status, 401, `${path} served an unauthenticated request`);

      const malformed = await api('GET', path, { token: 'not-a-jwt' });
      assert.equal(malformed.status, 401, `${path} accepted a malformed token`);
    }
  });

  test('a token signed with the wrong secret is rejected', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const guest = await api<{ userId: string }>('POST', '/api/auth/guest');
    const forged = jwt.sign({ sub: guest.body.userId, guest: false }, 'not-the-real-secret', {
      expiresIn: '30d',
    });

    const response = await api('GET', '/api/progress/overview', { token: forged });
    assert.equal(response.status, 401, 'a forged token was accepted');
  });

  test('an expired token is rejected', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const { env } = await import('../src/config/env');
    const guest = await api<{ userId: string }>('POST', '/api/auth/guest');
    const expired = jwt.sign({ sub: guest.body.userId, guest: true }, env.jwtSecret, {
      expiresIn: '-1s',
    });

    const response = await api('GET', '/api/settings', { token: expired });
    assert.equal(response.status, 401, 'an expired token was accepted');
  });

  test('a token for a non-existent user is rejected', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const { env } = await import('../src/config/env');
    const ghost = jwt.sign(
      { sub: '00000000-0000-4000-8000-000000000000', guest: false },
      env.jwtSecret,
      { expiresIn: '30d' },
    );

    const response = await api('GET', '/api/settings', { token: ghost });
    assert.equal(response.status, 401, 'a token for a deleted user was accepted');
  });

  test('photo responses forbid caching and content sniffing', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const account = await buildAccount('d');
    const response = await fetch(`${baseUrl}/api/photos/${account.photoId}`, {
      headers: { authorization: `Bearer ${account.token}` },
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});

/**
 * Measurements are numbers a user types, and they feed a formula whose output
 * is presented as a health figure. Everything that reaches it has to be
 * validated at the boundary, and nobody's readings may leak to anyone else.
 */
describe('measurement input', () => {
  /** Runs an initial assessment on a fresh account with these form fields. */
  async function analyze(fields: Record<string, string>) {
    const guest = await api<{ accessToken: string }>('POST', '/api/auth/guest');
    const token = guest.body.accessToken;
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
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return api<{
      assessment: { bodyFatPercent: number; method: string; measurements: Record<string, number> };
      error: { code: string };
    }>('POST', '/api/assessments/initial', { token, form });
  }

  test('rejects readings outside the plausible human range', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    // A slipped decimal point would otherwise drive the logarithm somewhere
    // absurd and put a fabricated number in front of the user.
    const invalid: Array<Record<string, string>> = [
      { waistCm: '8.5', neckCm: '38' },
      { waistCm: '850', neckCm: '38' },
      { waistCm: '85', neckCm: '2' },
      { waistCm: '-85', neckCm: '38' },
      { waistCm: '85', neckCm: '38', leftArmCm: '500' },
    ];

    for (const fields of invalid) {
      const response = await analyze(fields);
      assert.equal(response.status, 422, `accepted ${JSON.stringify(fields)}`);
      assert.equal(response.body.error.code, 'invalid_input');
    }
  });

  test('rejects non-numeric and non-finite input', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    for (const waistCm of ['NaN', 'Infinity', '-Infinity', 'abc', "85'; DROP TABLE users;--", '1e400']) {
      const response = await analyze({ waistCm, neckCm: '38' });
      assert.equal(response.status, 422, `accepted waistCm=${waistCm}`);
    }

    // And the table is still there.
    const { pool } = await import('../src/db/pool');
    const users = await pool.query('SELECT count(*) AS count FROM users');
    assert.ok(Number(users.rows[0].count) > 0, 'the users table did not survive');
  });

  test('an empty field is treated as unmeasured, not as zero', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await analyze({ waistCm: '', neckCm: '' });
    assert.equal(response.status, 201);
    assert.equal(response.body.assessment.method, 'bmi');
    assert.deepEqual(response.body.assessment.measurements, {});
    assert.ok(response.body.assessment.bodyFatPercent > 0);
  });

  test('unknown fields cannot be smuggled into the stored measurements', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await analyze({
      waistCm: '85',
      neckCm: '38',
      bodyFatPercent: '3',
      confidence: '1',
      provider: 'spoofed',
      __proto__: 'polluted',
    });

    assert.equal(response.status, 201);
    assert.deepEqual(
      response.body.assessment.measurements,
      { waistCm: 85, neckCm: 38 },
      'an unexpected field was stored as a measurement',
    );
    // The body-fat figure came from the formula, not from the request.
    assert.ok(Math.abs(response.body.assessment.bodyFatPercent - 16.2) < 0.5);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("one user's measurements never reach another", async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const alice = await buildAccount('m1');
    const bob = await buildAccount('m2');

    const asBob = await api<{ assessment: { id: string } | null }>('GET', '/api/assessments/latest', {
      token: bob.token,
    });
    assert.notEqual(asBob.body.assessment?.id, alice.assessmentId);

    const history = await api<{ assessments: Array<{ userId: string }> }>(
      'GET',
      '/api/assessments/history',
      { token: bob.token },
    );
    assert.equal(history.status, 200);
    for (const assessment of history.body.assessments) {
      assert.equal(assessment.userId, bob.userId, "another user's assessment was returned");
    }
  });
});

/**
 * Guideline 5.1.1(v): an app that lets you create an account must let you
 * delete it, from inside the app, without obstruction. Putting deletion behind
 * the paywall is a guaranteed rejection and, worse, traps a user who has
 * already stopped paying with data they cannot remove.
 */
describe('account deletion is always reachable', () => {
  test('an unsubscribed user can open settings and delete everything', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const guest = await api<{ accessToken: string; userId: string }>('POST', '/api/auth/guest');
    const token = guest.body.accessToken;
    await api('POST', '/api/onboarding', {
      token,
      body: {
        age: 30, sex: 'male', heightCm: 180, weightKg: 82,
        trainingLevel: 'intermediate', trainingLocation: 'gym',
        trainingDays: 4, sessionDurationMinutes: 60,
        goals: ['muscle_gain'], equipment: [],
      },
    });

    // No purchase has been made, so every paid route is closed.
    const gated = await api<{ error: { code: string } }>('GET', '/api/program/active', { token });
    assert.equal(gated.status, 402, 'the account under test is not actually unsubscribed');

    // Settings still has to open, or there is no screen to delete from.
    const settings = await api('GET', '/api/settings', { token });
    assert.equal(settings.status, 200, 'settings was gated behind a subscription');

    const deleted = await api('DELETE', '/api/auth/account', { token });
    assert.ok(deleted.status === 200 || deleted.status === 204, `deletion returned ${deleted.status}`);

    // And it really is gone — the token no longer identifies anyone.
    const after = await api('GET', '/api/settings', { token });
    assert.equal(after.status, 401, 'the account survived its own deletion');

    const { pool } = await import('../src/db/pool');
    const rows = await pool.query('SELECT 1 FROM users WHERE id = $1', [guest.body.userId]);
    assert.equal(rows.rowCount, 0, 'the user row was left behind');
  });
});
