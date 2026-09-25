/**
 * What happens when two copies of the same account meet.
 *
 * This is the part of the sync that can lose a user's data, so the tests are
 * written as the promise rather than as the implementation: after any merge, in
 * either direction, every workout and every assessment either side held is
 * still there. A merge that dropped one would be a silent, permanent loss the
 * user would discover weeks later.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BodyAssessment, CompletedWorkout, PersonalRecord } from '@getfit/shared';
import {
  emptyAssessments,
  emptyProfile,
  emptyProgram,
  emptyWorkouts,
  type AssessmentsDocument,
  type ProfileDocument,
  type ProgramDocument,
  type WorkoutsDocument,
} from '../src/local/documents';
import {
  mergeAssessments,
  mergeProfile,
  mergeProgram,
  mergeWorkouts,
  newerSide,
} from '../src/supabase/merge';

const assessment = (id: string, at: string, number = 1): BodyAssessment =>
  ({
    id,
    userId: 'user_1',
    createdAt: at,
    weightKg: 80,
    assessmentNumber: number,
    sourcePhotoId: null,
    measurements: { waistCm: 85, neckCm: 38 },
    bodyFatPercent: 22,
    estimatedMuscleMassKg: 35,
    waistBodyRatio: 0.47,
    symmetryPercent: 95,
    method: 'navy',
    confidence: 0.8,
    hologramData: {},
    provider: 'local',
  }) as unknown as BodyAssessment;

const workout = (id: string, at: string): CompletedWorkout =>
  ({
    id,
    userId: 'user_1',
    programDayId: 'day_1',
    dayNumber: 1,
    focus: 'Push',
    startedAt: at,
    completedAt: at,
    durationSeconds: 3600,
    totalSets: 20,
    totalVolumeKg: 5000,
    cardioMinutes: 0,
    exercises: [],
    personalRecords: [],
  }) as CompletedWorkout;

const record = (exerciseId: string, at: string): PersonalRecord => ({
  exerciseId,
  recordType: 'weight',
  value: 100,
  previousValue: 90,
  achievedAt: at,
});

const docs = {
  assessments: (items: BodyAssessment[]): AssessmentsDocument => ({ assessments: items }),
  workouts: (
    completed: CompletedWorkout[],
    records: PersonalRecord[] = [],
  ): WorkoutsDocument => ({ completed, records }),
};

describe('deciding which side is newer', () => {
  test('the more recent stamp wins', () => {
    assert.equal(newerSide('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'), 'remote');
    assert.equal(newerSide('2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z'), 'local');
  });

  test('a side that has never been written cannot win', () => {
    assert.equal(newerSide('2026-01-01T00:00:00Z', null), 'local');
    assert.equal(newerSide(null, '2026-01-01T00:00:00Z'), 'remote');
  });

  test('a tie goes to the device, which is the copy in the user’s hands', () => {
    assert.equal(newerSide('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), 'local');
  });

  test('an unparseable stamp does not silently become the winner', () => {
    assert.equal(newerSide('2026-01-01T00:00:00Z', 'not a date'), 'local');
    assert.equal(newerSide('not a date', '2026-01-01T00:00:00Z'), 'remote');
  });
});

describe('merging training history', () => {
  test('a workout logged on either device survives', () => {
    const local = docs.workouts([workout('w1', '2026-01-01T10:00:00Z')]);
    const remote = docs.workouts([workout('w2', '2026-01-02T10:00:00Z')]);

    const merged = mergeWorkouts(local, remote);
    assert.deepEqual(
      merged.completed.map((entry) => entry.id),
      ['w1', 'w2'],
    );
  });

  test('the same workout on both sides is kept once', () => {
    const shared = workout('w1', '2026-01-01T10:00:00Z');
    const merged = mergeWorkouts(docs.workouts([shared]), docs.workouts([{ ...shared }]));
    assert.equal(merged.completed.length, 1);
  });

  test('merging is symmetric: neither device is privileged over the other', () => {
    const a = docs.workouts([workout('w1', '2026-01-01T10:00:00Z')]);
    const b = docs.workouts([workout('w2', '2026-01-02T10:00:00Z')]);

    assert.deepEqual(
      mergeWorkouts(a, b).completed.map((entry) => entry.id),
      mergeWorkouts(b, a).completed.map((entry) => entry.id),
    );
  });

  test('records are unioned even though the local model gives them no id', () => {
    const merged = mergeWorkouts(
      docs.workouts([], [record('bench_press', '2026-01-01T10:00:00Z')]),
      docs.workouts([], [record('squat', '2026-01-02T10:00:00Z')]),
    );
    assert.deepEqual(
      merged.records.map((entry) => entry.exerciseId),
      ['bench_press', 'squat'],
    );
  });

  test('the same record pushed and pulled back does not duplicate', () => {
    const one = record('deadlift', '2026-01-01T10:00:00Z');
    const merged = mergeWorkouts(docs.workouts([], [one]), docs.workouts([], [{ ...one }]));
    assert.equal(merged.records.length, 1);
  });

  test('an empty side never removes anything', () => {
    const local = docs.workouts([workout('w1', '2026-01-01T10:00:00Z')]);
    assert.equal(mergeWorkouts(local, emptyWorkouts()).completed.length, 1);
    assert.equal(mergeWorkouts(emptyWorkouts(), local).completed.length, 1);
  });
});

describe('merging assessments', () => {
  test('assessments from both devices survive, oldest first', () => {
    const merged = mergeAssessments(
      docs.assessments([assessment('a2', '2026-02-01T10:00:00Z')]),
      docs.assessments([assessment('a1', '2026-01-01T10:00:00Z')]),
    );
    assert.deepEqual(
      merged.assessments.map((entry) => entry.id),
      ['a1', 'a2'],
    );
  });

  test('"your Nth analysis" is renumbered from the real order', () => {
    // Both devices ran one offline and each called it number two.
    const merged = mergeAssessments(
      docs.assessments([
        assessment('a1', '2026-01-01T10:00:00Z', 1),
        assessment('a3', '2026-03-01T10:00:00Z', 2),
      ]),
      docs.assessments([
        assessment('a1', '2026-01-01T10:00:00Z', 1),
        assessment('a2', '2026-02-01T10:00:00Z', 2),
      ]),
    );

    assert.deepEqual(
      merged.assessments.map((entry) => entry.assessmentNumber),
      [1, 2, 3],
    );
    assert.deepEqual(
      merged.assessments.map((entry) => entry.id),
      ['a1', 'a2', 'a3'],
    );
  });
});

describe('merging the profile', () => {
  const complete = (userId: string, weight: number): ProfileDocument => ({
    ...emptyProfile(userId, '2026-01-01T00:00:00Z'),
    profile: {
      userId,
      age: 30,
      sex: 'male',
      heightCm: 180,
      weightKg: weight,
      trainingLevel: 'intermediate',
      trainingLocation: 'gym',
      trainingDays: 4,
      sessionDurationMinutes: 60,
      onboardingCompleted: true,
    },
  });

  test('the more recently edited side wins', () => {
    const local = complete('user_1', 80);
    const remote = complete('user_1', 85);
    assert.equal(mergeProfile(local, remote, 'remote').profile?.weightKg, 85);
    assert.equal(mergeProfile(local, remote, 'local').profile?.weightKg, 80);
  });

  test('a fresh install never wipes the account it just signed in to', () => {
    // Signing in writes an empty profile a moment after the real one, so by
    // timestamp alone the empty side would win and erase everything.
    const fresh = emptyProfile('user_new', '2026-06-01T00:00:00Z');
    const stored = complete('user_1', 85);

    assert.equal(mergeProfile(fresh, stored, 'local').profile?.weightKg, 85);
  });

  test('an onboarded device is not overwritten by an empty account either', () => {
    const stored = complete('user_1', 85);
    const empty = emptyProfile('user_new', '2026-06-01T00:00:00Z');
    assert.equal(mergeProfile(stored, empty, 'remote').profile?.weightKg, 85);
  });
});

describe('merging the programme', () => {
  const withProgram = (splitName: string): ProgramDocument => ({
    program: {
      id: 'program_1',
      version: 1,
      splitName,
      trainingDays: 4,
      sessionDurationMinutes: 60,
      days: [],
      volumeSummary: {},
    } as unknown as ProgramDocument['program'],
    schedule: [],
  });

  test('the newer plan wins whole, schedule included', () => {
    const local = withProgram('Upper/Lower');
    const remote = withProgram('Push/Pull/Legs');
    assert.equal(mergeProgram(local, remote, 'remote').program?.splitName, 'Push/Pull/Legs');
    assert.equal(mergeProgram(local, remote, 'local').program?.splitName, 'Upper/Lower');
  });

  test('a side with no programme cannot win', () => {
    const local = withProgram('Upper/Lower');
    assert.equal(mergeProgram(local, emptyProgram(), 'remote').program?.splitName, 'Upper/Lower');
    assert.equal(mergeProgram(emptyProgram(), local, 'local').program?.splitName, 'Upper/Lower');
  });
});

describe('the promise the merge makes', () => {
  test('no history entry is ever lost, whichever way round the merge runs', () => {
    const local = docs.workouts(
      [workout('w1', '2026-01-01T10:00:00Z'), workout('w2', '2026-01-02T10:00:00Z')],
      [record('bench_press', '2026-01-01T10:00:00Z')],
    );
    const remote = docs.workouts(
      [workout('w2', '2026-01-02T10:00:00Z'), workout('w3', '2026-01-03T10:00:00Z')],
      [record('squat', '2026-01-02T10:00:00Z')],
    );

    for (const merged of [mergeWorkouts(local, remote), mergeWorkouts(remote, local)]) {
      const ids = new Set(merged.completed.map((entry) => entry.id));
      for (const side of [local, remote]) {
        for (const entry of side.completed) assert.ok(ids.has(entry.id), `lost ${entry.id}`);
      }
      assert.equal(merged.records.length, 2);
    }
  });

  test('the same holds for assessments', () => {
    const local = docs.assessments([
      assessment('a1', '2026-01-01T10:00:00Z'),
      assessment('a2', '2026-02-01T10:00:00Z'),
    ]);
    const remote = docs.assessments([
      assessment('a2', '2026-02-01T10:00:00Z'),
      assessment('a3', '2026-03-01T10:00:00Z'),
    ]);

    for (const merged of [mergeAssessments(local, remote), mergeAssessments(remote, local)]) {
      assert.deepEqual(
        merged.assessments.map((entry) => entry.id),
        ['a1', 'a2', 'a3'],
      );
    }
  });

  test('merging an empty account against an empty device stays empty', () => {
    assert.deepEqual(mergeAssessments(emptyAssessments(), emptyAssessments()).assessments, []);
    assert.deepEqual(mergeWorkouts(emptyWorkouts(), emptyWorkouts()).completed, []);
  });
});
