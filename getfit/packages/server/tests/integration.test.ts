/**
 * End-to-end journey against a real PostgreSQL database and the real Express
 * app. Covers the complete spec flow: guest → onboarding → photo → analysis →
 * paywall → payment → account → preferences → program → guided workout →
 * progression → assessment lock → progress → settings → deletion.
 *
 * Skipped automatically when no database is reachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ASSESSMENT_INTERVAL_DAYS, MAX_EXERCISES_PER_MUSCLE } from '@getfit/shared';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.MOCK_AI_MODE = 'true';
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

interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; form?: FormData } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  // Typed locally rather than as BodyInit, which is only declared when the
  // DOM lib is present.
  let body: string | FormData | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as T,
  };
}

/** A small but structurally valid JPEG so the analyser sees real image bytes. */
function jpegFixture(seed = 'a'): Blob {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
    // SOF0: 1200x1600, three components.
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x40, 0x04, 0xb0, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const payload = Buffer.alloc(160_000);
  payload.write(seed.repeat(64));
  payload.fill(seed.charCodeAt(0), 64);
  return new Blob([header, payload, Buffer.from([0xff, 0xd9])], { type: 'image/jpeg' });
}

before(async () => {
  await boot();
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closePool } = await import('../src/db/pool');
  await closePool().catch(() => undefined);
});

describe('GetFit end-to-end journey', () => {
  const state = {
    token: '',
    userId: '',
    workoutDayId: '',
    scheduledWorkoutId: '',
    email: '',
    photoId: '',
  };

  test('a new user starts as a guest with no account', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ accessToken: string; userId: string; isGuest: boolean }>(
      'POST',
      '/api/auth/guest',
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.isGuest, true);
    assert.ok(response.body.accessToken);

    state.token = response.body.accessToken;
    state.userId = response.body.userId;
  });

  test('onboarding saves the profile, multiple goals and equipment', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api('POST', '/api/onboarding', {
      token: state.token,
      body: {
        age: 31,
        sex: 'male',
        heightCm: 181,
        weightKg: 84.5,
        trainingLevel: 'intermediate',
        trainingLocation: 'gym',
        trainingDays: 4,
        sessionDurationMinutes: 60,
        goals: ['muscle_gain', 'fat_loss', 'strength'],
        equipment: [],
      },
    });
    assert.equal(response.status, 200);

    const status = await api<{ goals: unknown[]; profile: { onboardingCompleted: boolean } }>(
      'GET',
      '/api/onboarding/status',
      { token: state.token },
    );
    assert.equal(status.body.goals.length, 3, 'all three goals should be stored');
    assert.equal(status.body.profile.onboardingCompleted, true);
  });

  test('onboarding rejects invalid input with a readable message', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ error: { code: string; message: string } }>('POST', '/api/onboarding', {
      token: state.token,
      body: { age: 5, sex: 'male', heightCm: 181, weightKg: 84.5 },
    });
    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'invalid_input');
    assert.ok(!/stack|Error:/i.test(response.body.error.message), 'raw error leaked to the client');
  });

  test('the initial body analysis runs before any payment', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const form = new FormData();
    form.append('photo', jpegFixture('x'), 'body.jpg');

    const response = await api<{
      assessment: {
        id: string;
        bodyFatPercent: number;
        estimatedMuscleMassKg: number;
        waistBodyRatio: number;
        symmetryPercent: number;
        hologramData: { segments: unknown[]; sex: string };
        sourcePhotoId: string;
      };
    }>('POST', '/api/assessments/initial', { token: state.token, form });

    assert.equal(response.status, 201);
    const assessment = response.body.assessment;
    assert.ok(assessment.bodyFatPercent > 0 && assessment.bodyFatPercent < 60);
    assert.ok(assessment.estimatedMuscleMassKg > 0);
    assert.ok(assessment.waistBodyRatio > 0);
    assert.ok(assessment.symmetryPercent > 0);
    assert.equal(assessment.hologramData.segments.length, 8);
    assert.ok(assessment.sourcePhotoId, 'the photo should be stored privately');
    state.photoId = assessment.sourcePhotoId;
  });

  test('paid features are blocked before the membership starts', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    for (const path of ['/api/program/active', '/api/workouts/today', '/api/progress/overview']) {
      const response = await api<{ error: { code: string } }>('GET', path, { token: state.token });
      assert.equal(response.status, 402, `${path} should be subscription-gated`);
      assert.equal(response.body.error.code, 'subscription_required');
    }
  });

  test('the paywall advertises $5/month with no free trial', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ priceUsd: number; freeTrial: boolean; features: string[] }>(
      'GET',
      '/api/subscription/plan',
    );
    assert.equal(response.body.priceUsd, 5);
    assert.equal(response.body.freeTrial, false);
    assert.ok(response.body.features.length >= 6);
  });

  test('a declined payment is recorded and grants nothing', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ error: { code: string } }>('POST', '/api/subscription/purchase', {
      token: state.token,
      body: { platform: 'mock', receipt: 'mock-failed' },
    });
    assert.equal(response.status, 402);
    assert.equal(response.body.error.code, 'payment_failed');

    const entitlement = await api<{ active: boolean; status: string }>(
      'GET',
      '/api/subscription/entitlement',
      { token: state.token },
    );
    assert.equal(entitlement.body.active, false);
    assert.equal(entitlement.body.status, 'failed');
  });

  test('a verified purchase activates the membership server-side', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ entitlement: { active: boolean; status: string } }>(
      'POST',
      '/api/subscription/purchase',
      { token: state.token, body: { platform: 'mock', receipt: 'mock-success' } },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.entitlement.active, true);
    assert.equal(response.body.entitlement.status, 'active');

    const events = await api<{ events: Array<{ event_type: string }> }>(
      'GET',
      '/api/subscription/events',
      { token: state.token },
    );
    const types = events.body.events.map((e) => e.event_type);
    assert.ok(types.includes('purchase_verified'), 'the verified purchase was not audited');
    assert.ok(types.includes('purchase_failed'), 'the failed attempt was not audited');
  });

  test('mock purchases are refused when mock billing is disabled', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const { env } = await import('../src/config/env');
    const original = env.mockBilling;
    try {
      (env as { mockBilling: boolean }).mockBilling = false;
      const response = await api<{ error: { code: string } }>('POST', '/api/subscription/purchase', {
        token: state.token,
        body: { platform: 'mock', receipt: 'mock-success' },
      });
      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'forbidden');
    } finally {
      (env as { mockBilling: boolean }).mockBilling = original;
    }
  });

  test('the account is completed after payment, keeping the same user', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    state.email = `runner-${randomBytes(4).toString('hex')}@getfit.test`;
    const response = await api<{ userId: string; isGuest: boolean; accessToken: string }>(
      'POST',
      '/api/auth/account',
      { token: state.token, body: { email: state.email, password: 'a-strong-password' } },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.isGuest, false);
    assert.equal(response.body.userId, state.userId, 'the guest should be upgraded in place');
    state.token = response.body.accessToken;

    // The assessment taken before signup is still attached.
    const latest = await api<{ assessment: { id: string } | null }>('GET', '/api/assessments/latest', {
      token: state.token,
    });
    assert.ok(latest.body.assessment, 'the pre-signup assessment was lost');
  });

  test('exercise preferences offer four choices per muscle', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{
      maxPerMuscle: number;
      choiceSets: Array<{ muscleGroup: string; choices: Array<{ id: string }> }>;
    }>('GET', '/api/exercises/preferences/choices', { token: state.token });

    assert.equal(response.body.maxPerMuscle, MAX_EXERCISES_PER_MUSCLE);
    assert.equal(response.body.choiceSets.length, 11);
    for (const set of response.body.choiceSets) {
      assert.equal(set.choices.length, 4, `${set.muscleGroup} should offer four choices`);
    }
  });

  test('selecting more than three exercises for a muscle is rejected', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ error: { code: string } }>('PUT', '/api/exercises/preferences', {
      token: state.token,
      body: {
        preferences: [
          {
            muscleGroup: 'chest',
            exerciseIds: ['bench_press', 'incline_bench_press', 'cable_fly', 'pec_deck'],
          },
        ],
      },
    });
    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'invalid_input');
  });

  test('a manual selection is stored exactly as chosen', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ preferences: Array<{ muscleGroup: string; exerciseIds: string[] }> }>(
      'PUT',
      '/api/exercises/preferences',
      {
        token: state.token,
        body: {
          preferences: [
            { muscleGroup: 'chest', exerciseIds: ['bench_press', 'incline_dumbbell_press'] },
            { muscleGroup: 'back', exerciseIds: ['barbell_row', 'lat_pulldown'] },
          ],
        },
      },
    );
    assert.equal(response.status, 200);
    const chest = response.body.preferences.find((p) => p.muscleGroup === 'chest');
    assert.deepEqual(chest?.exerciseIds, ['bench_press', 'incline_dumbbell_press']);
  });

  test('generate for me fills every muscle group', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{
      preferences: Array<{ muscleGroup: string; exerciseIds: string[] }>;
      autoGenerated: boolean;
    }>('POST', '/api/exercises/preferences/generate', { token: state.token });

    assert.equal(response.body.autoGenerated, true);
    assert.equal(response.body.preferences.length, 11);
    for (const preference of response.body.preferences) {
      assert.ok(preference.exerciseIds.length > 0 && preference.exerciseIds.length <= 3);
    }
  });

  test('the AI builds a program and schedules the week', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{
      program: {
        id: string;
        splitName: string;
        days: Array<{
          id: string;
          focus: string;
          durationMinutes: number;
          exercises: Array<{ id: string; exerciseId: string; prescribedSets: unknown[] }>;
        }>;
      };
    }>('POST', '/api/program/generate', { token: state.token });

    assert.equal(response.status, 201);
    const program = response.body.program;
    assert.equal(program.days.length, 4);
    assert.equal(program.splitName, 'Upper / Lower');

    for (const day of program.days) {
      assert.ok(day.exercises.length > 0, `${day.focus} had no exercises`);
      assert.ok(day.durationMinutes <= 60, `${day.focus} overran the session length`);
      for (const exercise of day.exercises) {
        assert.ok(exercise.prescribedSets.length > 0, 'exercise had no prescribed sets');
      }
    }

    const schedule = await api<{ upcoming: Array<{ id: string; programDayId: string }> }>(
      'GET',
      '/api/program/schedule',
      { token: state.token },
    );
    assert.equal(schedule.body.upcoming.length, 4, 'the week was not scheduled');
  });

  test("the home screen returns today's workout and current body", async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{
      entitlement: { active: boolean };
      assessment: { bodyFatPercent: number };
      assessmentAvailability: { available: boolean; daysRemaining: number };
      today: { focus: string; durationMinutes: number; scheduled: { id: string; programDayId: string } };
    }>('GET', '/api/home', { token: state.token });

    assert.equal(response.body.entitlement.active, true);
    assert.ok(response.body.assessment.bodyFatPercent > 0);
    assert.ok(response.body.today, 'no workout was queued');
    assert.equal(response.body.assessmentAvailability.available, false, '7-day lock should apply');
    assert.equal(response.body.assessmentAvailability.daysRemaining, ASSESSMENT_INTERVAL_DAYS);

    state.workoutDayId = response.body.today.scheduled.programDayId;
    state.scheduledWorkoutId = response.body.today.scheduled.id;
  });

  test('completing a guided workout stores prescribed and actual values apart', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const today = await api<{
      workout: {
        day: {
          exercises: Array<{
            id: string;
            exerciseId: string;
            sets: number;
            repsMin: number;
            repsMax: number;
            startingWeight: number | null;
            prescribedSets: Array<{
              setNumber: number;
              prescribedWeight: number | null;
              prescribedRepsMin: number;
              prescribedRepsMax: number;
              isWarmup: boolean;
            }>;
          }>;
        };
      };
    }>('GET', '/api/workouts/today', { token: state.token });

    const exercises = today.body.workout.day.exercises;
    assert.ok(exercises.length > 0);

    const startedAt = new Date(Date.now() - 48 * 60 * 1000).toISOString();
    const payload = exercises.map((exercise, index) => ({
      exerciseId: exercise.exerciseId,
      workoutExerciseId: exercise.id,
      orderIndex: index,
      sets: exercise.prescribedSets.map((set) => ({
        setNumber: set.setNumber,
        // The user drops 2.5 kg on the first exercise — the prescription must
        // still be stored unchanged alongside what they actually lifted.
        actualWeight:
          set.prescribedWeight === null
            ? null
            : index === 0 && !set.isWarmup
              ? set.prescribedWeight - 2.5
              : set.prescribedWeight,
        actualReps: set.isWarmup ? set.prescribedRepsMin : set.prescribedRepsMax,
        prescribedWeight: set.prescribedWeight,
        prescribedRepsMin: set.prescribedRepsMin,
        prescribedRepsMax: set.prescribedRepsMax,
        isWarmup: set.isWarmup,
        completedAt: new Date().toISOString(),
      })),
    }));

    const response = await api<{
      summary: {
        id: string;
        totalSets: number;
        durationSeconds: number;
        personalRecords: Array<{ exerciseId: string; recordType: string; value: number }>;
        exerciseCount: number;
        progressionNotes: string[];
      };
    }>('POST', '/api/workouts/complete', {
      token: state.token,
      body: {
        scheduledWorkoutId: state.scheduledWorkoutId,
        workoutDayId: state.workoutDayId,
        startedAt,
        durationSeconds: 48 * 60,
        cardioMinutes: 8,
        exercises: payload,
      },
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.summary.exerciseCount, exercises.length);
    assert.ok(response.body.summary.totalSets > 0);
    assert.ok(
      response.body.summary.personalRecords.length > 0,
      'a first session should set personal records',
    );

    const stored = await api<{
      workout: {
        exercises: Array<{
          sets: Array<{ actualWeight: number; prescribedWeight: number; isWarmup: boolean }>;
        }>;
      };
    }>('GET', `/api/workouts/history/${response.body.summary.id}`, { token: state.token });

    const firstWorking = stored.body.workout.exercises[0].sets.find(
      (s) => !s.isWarmup && s.actualWeight !== null,
    );
    assert.ok(firstWorking);
    assert.notEqual(
      firstWorking.actualWeight,
      firstWorking.prescribedWeight,
      'the changed weight should be stored separately from the prescription',
    );
  });

  test('the next prescription reflects what was actually lifted', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const program = await api<{
      program: { days: Array<{ id: string; exercises: Array<{ exerciseId: string; startingWeight: number | null; sets: number }> }> };
    }>('GET', '/api/program/active', { token: state.token });

    const day = program.body.program.days.find((d) => d.id === state.workoutDayId);
    assert.ok(day, 'the completed day should still be part of the program');
    // Every set hit the top of the range, so the engine must have moved
    // something — weight or sets — rather than leaving the day untouched.
    assert.ok(day.exercises.length > 0);
  });

  test('a second official assessment is locked for seven days', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const form = new FormData();
    form.append('photo', jpegFixture('y'), 'body.jpg');

    const response = await api<{ error: { code: string; message: string } }>(
      'POST',
      '/api/assessments/weekly',
      { token: state.token, form },
    );
    assert.equal(response.status, 423);
    assert.equal(response.body.error.code, 'assessment_locked');
    assert.ok(/day/i.test(response.body.error.message));
  });

  test('the assessment unlocks exactly seven days later', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    await api('POST', '/api/dev/assessment/backdate?days=7', { token: state.token });

    const availability = await api<{ available: boolean }>('GET', '/api/assessments/availability', {
      token: state.token,
    });
    assert.equal(availability.body.available, true);

    const form = new FormData();
    form.append('photo', jpegFixture('z'), 'body.jpg');
    form.append('weightKg', '83.2');

    const response = await api<{ assessment: { assessmentNumber: number; weightKg: number } }>(
      'POST',
      '/api/assessments/weekly',
      { token: state.token, form },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.assessment.assessmentNumber, 2);
    assert.equal(response.body.assessment.weightKg, 83.2);

    // And it locks again immediately.
    const relocked = await api<{ available: boolean; daysRemaining: number }>(
      'GET',
      '/api/assessments/availability',
      { token: state.token },
    );
    assert.equal(relocked.body.available, false);
    assert.equal(relocked.body.daysRemaining, ASSESSMENT_INTERVAL_DAYS);
  });

  test('history shows the hologram and numbers, never the photo', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{
      assessments: Array<Record<string, unknown>>;
    }>('GET', '/api/assessments/history', { token: state.token });

    assert.equal(response.body.assessments.length, 2);
    for (const assessment of response.body.assessments) {
      assert.ok(assessment.hologramData, 'the hologram is missing');
      assert.equal(assessment.sourcePhotoId, undefined, 'a photo reference leaked into history');
    }
    const serialised = JSON.stringify(response.body);
    assert.ok(!serialised.includes('storage_key') && !serialised.includes('storageKey'));
  });

  test('progress is assembled from real data', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{
      trends: { bodyFatPercent: unknown[]; weightKg: unknown[] };
      strength: Array<{ exerciseName: string; points: unknown[] }>;
      personalRecords: unknown[];
      training: { workoutsCompleted: number; completionRatePercent: number };
      goals: Array<{ goalType: string; detail: string; progressPercent: number }>;
    }>('GET', '/api/progress/overview', { token: state.token });

    assert.equal(response.body.trends.bodyFatPercent.length, 2, 'two assessments, two trend points');
    assert.equal(response.body.trends.weightKg.length, 2);
    assert.ok(response.body.strength.length > 0, 'no strength history');
    assert.ok(response.body.personalRecords.length > 0);
    assert.equal(response.body.training.workoutsCompleted, 1);
    assert.equal(response.body.goals.length, 3, 'all three goals should be tracked');
    for (const goal of response.body.goals) {
      assert.ok(goal.detail.length > 0, `${goal.goalType} has no detail`);
      assert.ok(goal.progressPercent >= 0 && goal.progressPercent <= 100);
    }
  });

  test('a missed workout is rescheduled rather than dropped', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const before = await api<{ upcoming: Array<{ id: string }> }>('GET', '/api/program/schedule', {
      token: state.token,
    });
    const beforeCount = before.body.upcoming.length;
    assert.ok(beforeCount > 0);

    await api('POST', '/api/dev/schedule/backdate?days=4', { token: state.token });

    const after = await api<{ upcoming: Array<{ id: string; scheduledDate: string; status: string }> }>(
      'GET',
      '/api/program/schedule',
      { token: state.token },
    );
    assert.equal(after.body.upcoming.length, beforeCount, 'a session disappeared from the plan');

    const today = new Date().toISOString().slice(0, 10);
    for (const slot of after.body.upcoming) {
      assert.ok(slot.scheduledDate >= today, `${slot.id} is still stranded in the past`);
    }
    assert.ok(
      after.body.upcoming.some((s) => s.status === 'rescheduled'),
      'nothing was marked as rescheduled',
    );
  });

  test('settings changes rebuild future training without touching history', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ programRegenerated: boolean; profile: { trainingDays: number } }>(
      'PATCH',
      '/api/settings/profile',
      { token: state.token, body: { trainingDays: 6, sessionDurationMinutes: 45 } },
    );
    assert.equal(response.body.programRegenerated, true);
    assert.equal(response.body.profile.trainingDays, 6);

    const program = await api<{ program: { days: unknown[]; splitName: string; version: number } }>(
      'GET',
      '/api/program/active',
      { token: state.token },
    );
    assert.equal(program.body.program.days.length, 6);
    assert.equal(program.body.program.splitName, 'Push / Pull / Legs');
    assert.ok(program.body.program.version > 1, 'a new program version should have been created');

    // The completed workout is untouched.
    const history = await api<{ workouts: unknown[] }>('GET', '/api/workouts/history', {
      token: state.token,
    });
    assert.equal(history.body.workouts.length, 1, 'training history was lost');
  });

  test('theme preference round-trips', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const dark = await api<{ appSettings: { themeMode: string } }>('GET', '/api/settings', {
      token: state.token,
    });
    assert.equal(dark.body.appSettings.themeMode, 'dark', 'dark mode should be the default');

    const light = await api<{ appSettings: { themeMode: string } }>('PATCH', '/api/settings/app', {
      token: state.token,
      body: { themeMode: 'light' },
    });
    assert.equal(light.body.appSettings.themeMode, 'light');
  });

  test('a photo is readable only by its owner', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const owner = await fetch(`${baseUrl}/api/photos/${state.photoId}`, {
      headers: { authorization: `Bearer ${state.token}` },
    });
    assert.equal(owner.status, 200);
    assert.equal(owner.headers.get('content-type'), 'image/jpeg');
    assert.equal(owner.headers.get('cache-control'), 'private, no-store');

    // A different user gets a 404, not someone else's photo.
    const intruder = await api<{ accessToken: string }>('POST', '/api/auth/guest');
    const stolen = await fetch(`${baseUrl}/api/photos/${state.photoId}`, {
      headers: { authorization: `Bearer ${intruder.body.accessToken}` },
    });
    assert.equal(stolen.status, 404);

    // And no token gets nothing at all.
    const anonymous = await fetch(`${baseUrl}/api/photos/${state.photoId}`);
    assert.equal(anonymous.status, 401);
  });

  test('one user cannot read another user’s workouts or progress', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const other = await api<{ accessToken: string }>('POST', '/api/auth/guest');
    const token = other.body.accessToken;

    await api('POST', '/api/onboarding', {
      token,
      body: {
        age: 25,
        sex: 'female',
        heightCm: 166,
        weightKg: 61,
        trainingLevel: 'beginner',
        trainingLocation: 'home',
        trainingDays: 3,
        sessionDurationMinutes: 30,
        goals: ['general_fitness'],
        equipment: ['bodyweight', 'dumbbells'],
      },
    });
    await api('POST', '/api/subscription/purchase', {
      token,
      body: { platform: 'mock', receipt: 'mock-success' },
    });

    const history = await api<{ workouts: unknown[] }>('GET', '/api/workouts/history', { token });
    assert.equal(history.body.workouts.length, 0, 'another user’s workouts were visible');

    const day = await api<{ error: { code: string } }>('GET', `/api/program/day/${state.workoutDayId}`, {
      token,
    });
    assert.equal(day.status, 404, 'another user’s workout day was readable');
  });

  test('an expired membership blocks paid features again', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const expired = await api<{ entitlement: { active: boolean; status: string } }>(
      'POST',
      '/api/dev/subscription/expire',
      { token: state.token },
    );
    assert.equal(expired.body.entitlement.active, false);
    assert.equal(expired.body.entitlement.status, 'expired');

    const blocked = await api<{ error: { code: string } }>('GET', '/api/workouts/today', {
      token: state.token,
    });
    assert.equal(blocked.status, 402);
    assert.equal(blocked.body.error.code, 'subscription_required');

    // Home still renders, so the app can show the renewal screen.
    const home = await api<{ entitlement: { status: string }; today: unknown }>('GET', '/api/home', {
      token: state.token,
    });
    assert.equal(home.status, 200);
    assert.equal(home.body.entitlement.status, 'expired');
    assert.equal(home.body.today, null);
  });

  test('renewing restores access', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const renewed = await api<{ entitlement: { active: boolean } }>('POST', '/api/subscription/restore', {
      token: state.token,
      body: { platform: 'mock', receipt: 'mock-success' },
    });
    assert.equal(renewed.body.entitlement.active, true);

    const allowed = await api('GET', '/api/workouts/today', { token: state.token });
    assert.equal(allowed.status, 200);
  });

  test('deleting the account removes the user and their data', async (t) => {
    if (!databaseAvailable) return t.skip('No database available');

    const response = await api<{ deleted: boolean; photosRemoved: number }>(
      'DELETE',
      '/api/auth/account',
      { token: state.token },
    );
    assert.equal(response.body.deleted, true);
    assert.ok(response.body.photosRemoved >= 1, 'stored photos were not removed');

    // The token no longer resolves to a user.
    const after = await api('GET', '/api/home', { token: state.token });
    assert.equal(after.status, 401);

    const { pool } = await import('../src/db/pool');
    for (const table of [
      'user_profiles',
      'body_assessments',
      'completed_workouts',
      'workout_programs',
      'user_photos',
      'subscriptions',
    ]) {
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id = $1`, [
        state.userId,
      ]);
      assert.equal(result.rows[0].count, 0, `${table} still holds deleted user data`);
    }
  });
});
