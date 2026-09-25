/**
 * The sync engine, driven against an in-memory account.
 *
 * The cases that matter are the ones a user actually hits: signing up on a
 * phone that already has a programme, signing in on a second device, and losing
 * signal halfway through. In all three the device is the working copy and must
 * come out of it with at least as much data as it went in with.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DOCUMENT_KEYS,
  emptyAssessments,
  emptyProfile,
  emptyProgram,
  emptyWorkouts,
  type AssessmentsDocument,
  type ProfileDocument,
  type ProgramDocument,
  type WorkoutsDocument,
} from '../src/local/documents';
import { DocumentStore } from '../src/local/store';
import type { KeyValueStore } from '../src/local/keyValue';
import {
  SYNC_KEY,
  SyncEngine,
  emptySyncMeta,
  type PushPayload,
  type RemoteSnapshot,
  type SyncBackend,
  type SyncMeta,
} from '../src/supabase/sync';
import {
  assessmentsDocToRows,
  profileDocToRows,
  programDocToRows,
  workoutsDocToRows,
} from '../src/supabase/rows';

const USER = '11111111-1111-1111-1111-111111111111';

/** AsyncStorage, in a Map. */
function memoryStorage(seed: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => Promise.resolve(data.get(key) ?? null),
    setItem: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    multiRemove: (keys) => {
      for (const key of keys) data.delete(key);
      return Promise.resolve();
    },
  };
}

/** The account, as a backend that keeps its rows in memory. */
function memoryBackend(seed?: Partial<RemoteSnapshot>) {
  let snapshot: RemoteSnapshot = {
    profile: null,
    profileUpdatedAt: null,
    program: { program: null, schedule: [] },
    programUpdatedAt: null,
    workouts: { completed: [], records: [] },
    assessments: [],
    ...seed,
  };

  const state = {
    pushes: 0,
    deletes: 0,
    failFetch: false,
    failPush: false,
    get snapshot() {
      return snapshot;
    },
  };

  const backend: SyncBackend = {
    fetchAll: () => {
      if (state.failFetch) return Promise.reject(new Error('offline'));
      return Promise.resolve(snapshot);
    },
    push: (_userId: string, payload: PushPayload) => {
      if (state.failPush) return Promise.reject(new Error('offline'));
      state.pushes += 1;
      snapshot = {
        profile: payload.profile,
        profileUpdatedAt: new Date().toISOString(),
        program: payload.program,
        programUpdatedAt: new Date().toISOString(),
        workouts: payload.workouts,
        assessments: payload.assessments,
      };
      return Promise.resolve();
    },
    deleteAll: () => {
      state.deletes += 1;
      snapshot = {
        profile: null,
        profileUpdatedAt: null,
        program: { program: null, schedule: [] },
        programUpdatedAt: null,
        workouts: { completed: [], records: [] },
        assessments: [],
      };
      return Promise.resolve();
    },
  };

  return { backend, state };
}

const onboardedProfile = (weightKg = 80): ProfileDocument => ({
  ...emptyProfile('user_local', '2026-01-01T00:00:00Z'),
  profile: {
    userId: 'user_local',
    age: 30,
    sex: 'male',
    heightCm: 180,
    weightKg,
    trainingLevel: 'intermediate',
    trainingLocation: 'gym',
    trainingDays: 4,
    sessionDurationMinutes: 60,
    onboardingCompleted: true,
  },
  equipment: ['dumbbells', 'bench'],
  goals: [{ goalType: 'muscle_gain', isActive: true }],
});

const workoutsWith = (ids: string[]): WorkoutsDocument => ({
  completed: ids.map((id) => ({
    id,
    userId: 'user_local',
    programDayId: 'day_1',
    dayNumber: 1,
    focus: 'Push',
    startedAt: `2026-01-0${id.slice(-1)}T10:00:00Z`,
    completedAt: `2026-01-0${id.slice(-1)}T11:00:00Z`,
    durationSeconds: 3600,
    totalSets: 20,
    totalVolumeKg: 5000,
    cardioMinutes: 0,
    exercises: [],
    personalRecords: [],
  })) as WorkoutsDocument['completed'],
  records: [],
});

async function seedLocal(
  store: DocumentStore,
  docs: {
    profile?: ProfileDocument;
    program?: ProgramDocument;
    workouts?: WorkoutsDocument;
    assessments?: AssessmentsDocument;
  },
): Promise<void> {
  if (docs.profile) await store.write(DOCUMENT_KEYS.profile, docs.profile);
  if (docs.program) await store.write(DOCUMENT_KEYS.program, docs.program);
  if (docs.workouts) await store.write(DOCUMENT_KEYS.workouts, docs.workouts);
  if (docs.assessments) await store.write(DOCUMENT_KEYS.assessments, docs.assessments);
}

const readDoc = <T>(store: DocumentStore, key: string, fallback: () => T): Promise<T> =>
  store.read<T>(key, fallback);

describe('the first sync after signing up', () => {
  test('an empty account adopts what is already on the phone', async () => {
    const store = new DocumentStore(memoryStorage());
    const { backend, state } = memoryBackend();
    await seedLocal(store, {
      profile: onboardedProfile(),
      workouts: workoutsWith(['w1', 'w2']),
    });

    const result = await new SyncEngine(store, backend).sync(USER);

    assert.equal(result.outcome, 'synced');
    assert.equal(state.pushes, 1);
    assert.equal(state.snapshot.workouts.completed.length, 2);
    assert.equal(state.snapshot.profile?.profile.weight_kg, 80);
  });

  test('the account is keyed to the signed-in user, not the device id', async () => {
    const store = new DocumentStore(memoryStorage());
    const { backend, state } = memoryBackend();
    await seedLocal(store, { profile: onboardedProfile() });

    await new SyncEngine(store, backend).sync(USER);

    assert.equal(state.snapshot.profile?.profile.user_id, USER);
    // The device's own id rides along, so assessments keep pointing at it.
    assert.equal(state.snapshot.profile?.profile.local_user_id, 'user_local');
  });

  test('the phone keeps everything it had', async () => {
    const store = new DocumentStore(memoryStorage());
    const { backend } = memoryBackend();
    await seedLocal(store, {
      profile: onboardedProfile(),
      workouts: workoutsWith(['w1', 'w2']),
    });

    await new SyncEngine(store, backend).sync(USER);

    const local = await readDoc(store, DOCUMENT_KEYS.workouts, emptyWorkouts);
    assert.deepEqual(
      local.completed.map((entry) => entry.id),
      ['w1', 'w2'],
    );
  });
});

describe('signing in on a second device', () => {
  test('the account’s history comes down', async () => {
    const stocked = new DocumentStore(memoryStorage());
    await seedLocal(stocked, {
      profile: onboardedProfile(85),
      workouts: workoutsWith(['w1', 'w2']),
      assessments: emptyAssessments(),
    });

    const { backend } = memoryBackend({
      profile: profileDocToRows(USER, onboardedProfile(85)),
      profileUpdatedAt: '2026-05-01T00:00:00Z',
      program: programDocToRows(USER, emptyProgram()),
      workouts: workoutsDocToRows(USER, workoutsWith(['w1', 'w2'])),
      assessments: assessmentsDocToRows(USER, emptyAssessments()),
    });

    // A fresh phone: nothing stored at all.
    const fresh = new DocumentStore(memoryStorage());
    const result = await new SyncEngine(fresh, backend).sync(USER);

    assert.equal(result.outcome, 'synced');
    const workouts = await readDoc(fresh, DOCUMENT_KEYS.workouts, emptyWorkouts);
    assert.deepEqual(
      workouts.completed.map((entry) => entry.id),
      ['w1', 'w2'],
    );
    const profile = await readDoc(fresh, DOCUMENT_KEYS.profile, () =>
      emptyProfile('none', '2026-01-01T00:00:00Z'),
    );
    assert.equal(profile.profile?.weightKg, 85);
  });

  test('training done before signing in is not thrown away', async () => {
    const { backend } = memoryBackend({
      profile: profileDocToRows(USER, onboardedProfile(85)),
      profileUpdatedAt: '2026-05-01T00:00:00Z',
      program: programDocToRows(USER, emptyProgram()),
      workouts: workoutsDocToRows(USER, workoutsWith(['w1'])),
      assessments: assessmentsDocToRows(USER, emptyAssessments()),
    });

    const store = new DocumentStore(memoryStorage());
    await seedLocal(store, {
      profile: onboardedProfile(80),
      workouts: workoutsWith(['w9']),
    });

    await new SyncEngine(store, backend).sync(USER);

    const workouts = await readDoc(store, DOCUMENT_KEYS.workouts, emptyWorkouts);
    assert.deepEqual(
      workouts.completed.map((entry) => entry.id).sort(),
      ['w1', 'w9'],
    );
  });

  test('a signed-in empty phone is not mistaken for a new account', async () => {
    // The dangerous case: an empty local profile written a moment ago looks
    // newer than the real one on the server.
    const { backend, state } = memoryBackend({
      profile: profileDocToRows(USER, onboardedProfile(85)),
      profileUpdatedAt: '2020-01-01T00:00:00Z',
      program: programDocToRows(USER, emptyProgram()),
      workouts: workoutsDocToRows(USER, workoutsWith(['w1'])),
      assessments: assessmentsDocToRows(USER, emptyAssessments()),
    });

    const store = new DocumentStore(memoryStorage());
    await seedLocal(store, { profile: emptyProfile('user_new', new Date().toISOString()) });

    await new SyncEngine(store, backend).sync(USER);

    const profile = await readDoc(store, DOCUMENT_KEYS.profile, () =>
      emptyProfile('none', '2026-01-01T00:00:00Z'),
    );
    assert.equal(profile.profile?.weightKg, 85, 'the account was wiped by an empty install');
    assert.equal(state.snapshot.workouts.completed.length, 1);
  });
});

describe('when the network is not there', () => {
  test('a failed fetch leaves the device untouched and marks work as unsent', async () => {
    const store = new DocumentStore(memoryStorage());
    const { backend, state } = memoryBackend();
    state.failFetch = true;
    await seedLocal(store, { workouts: workoutsWith(['w1']) });

    const result = await new SyncEngine(store, backend).sync(USER);

    assert.equal(result.outcome, 'failed');
    const workouts = await readDoc(store, DOCUMENT_KEYS.workouts, emptyWorkouts);
    assert.equal(workouts.completed.length, 1);
    const meta = await readDoc<SyncMeta>(store, SYNC_KEY, emptySyncMeta);
    assert.equal(meta.pending, true);
    assert.equal(meta.lastSyncedAt, null);
  });

  test('a failed push still keeps the merge, so the next try is not a re-run', async () => {
    const { backend, state } = memoryBackend({
      profile: profileDocToRows(USER, onboardedProfile(85)),
      profileUpdatedAt: '2026-05-01T00:00:00Z',
      program: programDocToRows(USER, emptyProgram()),
      workouts: workoutsDocToRows(USER, workoutsWith(['w1'])),
      assessments: assessmentsDocToRows(USER, emptyAssessments()),
    });
    state.failPush = true;

    const store = new DocumentStore(memoryStorage());
    await seedLocal(store, { profile: onboardedProfile(80), workouts: workoutsWith(['w9']) });

    const result = await new SyncEngine(store, backend).sync(USER);

    assert.equal(result.outcome, 'failed');
    const workouts = await readDoc(store, DOCUMENT_KEYS.workouts, emptyWorkouts);
    assert.deepEqual(
      workouts.completed.map((entry) => entry.id).sort(),
      ['w1', 'w9'],
    );
  });

  test('a later sync succeeds and clears the pending flag', async () => {
    const store = new DocumentStore(memoryStorage());
    const { backend, state } = memoryBackend();
    state.failFetch = true;
    await seedLocal(store, { profile: onboardedProfile() });

    const engine = new SyncEngine(store, backend);
    await engine.sync(USER);
    state.failFetch = false;
    const result = await engine.sync(USER);

    assert.equal(result.outcome, 'synced');
    const meta = await readDoc<SyncMeta>(store, SYNC_KEY, emptySyncMeta);
    assert.equal(meta.pending, false);
    assert.ok(meta.lastSyncedAt);
  });
});

describe('bookkeeping', () => {
  test('a local write marks the account as having unsent work', async () => {
    const store = new DocumentStore(memoryStorage());
    const engine = new SyncEngine(store, memoryBackend().backend);

    await engine.noteLocalChange(DOCUMENT_KEYS.profile);

    const meta = await engine.meta();
    assert.equal(meta.pending, true);
    assert.ok(meta.profileUpdatedAt);
  });

  test('only the overwritable documents are stamped; history needs no winner', async () => {
    const store = new DocumentStore(memoryStorage());
    const engine = new SyncEngine(store, memoryBackend().backend);

    await engine.noteLocalChange(DOCUMENT_KEYS.workouts);

    const meta = await engine.meta();
    assert.equal(meta.pending, true);
    assert.equal(meta.profileUpdatedAt, null);
    assert.equal(meta.programUpdatedAt, null);
  });

  test('overlapping syncs share the one in flight', async () => {
    const store = new DocumentStore(memoryStorage());
    const { backend, state } = memoryBackend();
    await seedLocal(store, { profile: onboardedProfile() });

    const engine = new SyncEngine(store, backend);
    await Promise.all([engine.sync(USER), engine.sync(USER), engine.sync(USER)]);

    assert.equal(state.pushes, 1);
  });
});

describe('deleting the account', () => {
  test('the rows go', async () => {
    const store = new DocumentStore(memoryStorage());
    const { backend, state } = memoryBackend();
    await seedLocal(store, { profile: onboardedProfile(), workouts: workoutsWith(['w1']) });

    const engine = new SyncEngine(store, backend);
    await engine.sync(USER);
    await engine.deleteRemote(USER);

    assert.equal(state.deletes, 1);
    assert.equal(state.snapshot.profile, null);
    assert.equal(state.snapshot.workouts.completed.length, 0);
  });
});
