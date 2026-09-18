/**
 * The on-device data layer.
 *
 * These exercise the journey the API used to serve — onboarding, an analysis,
 * a generated programme, a schedule — entirely against local storage and the
 * shared programme rules. Nothing here can reach a network, which is the point:
 * if these pass, the app works with no server.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ExerciseSelectionService } from '@getfit/shared';
import { DOCUMENT_KEYS } from '../src/local/documents';
import type { KeyValueStore } from '../src/local/keyValue';
import { LocalRepository, bestWeights, layOutWeek } from '../src/local/repository';
import { DocumentStore } from '../src/local/store';

class MemoryStorage implements KeyValueStore {
  data = new Map<string, string>();
  writes = 0;
  corrupt = new Set<string>();

  async getItem(key: string): Promise<string | null> {
    if (this.corrupt.has(key)) return '{{ not json';
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.writes += 1;
    this.data.set(key, value);
  }

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }
}

function build(): { storage: MemoryStorage; repo: LocalRepository } {
  const storage = new MemoryStorage();
  return { storage, repo: new LocalRepository(new DocumentStore(storage)) };
}

/** Completes onboarding, as the onboarding screens will. */
async function onboard(repo: LocalRepository): Promise<void> {
  const context = {
    location: 'home' as const,
    equipment: ['dumbbells' as const],
    level: 'beginner' as const,
    goals: ['muscle_gain' as const],
  };
  const preferences = new ExerciseSelectionService().generatePreferences(context);

  await repo.updateProfileDoc((doc) => ({
    ...doc,
    profile: {
      userId: doc.userId,
      age: 30,
      sex: 'male',
      heightCm: 180,
      weightKg: 82,
      trainingLevel: 'beginner',
      trainingLocation: 'home',
      trainingDays: 3,
      sessionDurationMinutes: 45,
      onboardingCompleted: true,
    },
    goals: [{ goalType: 'muscle_gain' }],
    equipment: ['dumbbells'],
    preferences,
    preferencesChosen: false,
  }));
}

describe('the journey runs with no server', () => {
  test('onboarding, analysis and a programme, all on device', async () => {
    const { repo } = build();
    await onboard(repo);

    const assessment = await repo.createAssessment({
      measurements: { waistCm: 85, neckCm: 38 },
      enforceInterval: false,
    });
    // The same circumference formula the server ran, producing the same figure.
    assert.ok(Math.abs(assessment.bodyFatPercent - 16.2) < 0.5, `got ${assessment.bodyFatPercent}`);
    assert.equal(assessment.method, 'navy');
    assert.equal(assessment.assessmentNumber, 1);

    const program = await repo.generateProgram();
    assert.equal(program.days.length, 3);
    assert.ok(program.days.every((day) => day.exercises.length > 0));

    const schedule = await repo.schedule();
    assert.equal(schedule.length, 3);
    assert.ok(schedule.every((slot) => slot.status === 'scheduled'));

    const today = await repo.todaysWorkout();
    assert.ok(today, 'nothing was due on the first day of a fresh programme');
    assert.equal(today.day.id, today.scheduled.programDayId);
  });

  test('a programme cannot be built before onboarding', async () => {
    const { repo } = build();
    await assert.rejects(() => repo.generateProgram(), /onboarding/i);
  });

  test('the analysis needs a profile', async () => {
    const { repo } = build();
    await assert.rejects(
      () => repo.createAssessment({ measurements: {}, enforceInterval: false }),
      /onboarding/i,
    );
  });
});

describe('the seven-day assessment lock', () => {
  test('a fresh install may assess immediately', async () => {
    const { repo } = build();
    const availability = await repo.assessmentAvailability();
    assert.equal(availability.available, true);
    assert.equal(availability.lastAssessmentAt, null);
  });

  test('a second assessment is locked, and says for how long', async () => {
    const { repo } = build();
    await onboard(repo);
    await repo.createAssessment({ measurements: { waistCm: 85, neckCm: 38 }, enforceInterval: false });

    const availability = await repo.assessmentAvailability();
    assert.equal(availability.available, false);
    assert.equal(availability.daysRemaining, 7);

    await assert.rejects(
      () => repo.createAssessment({ measurements: { waistCm: 84, neckCm: 38 }, enforceInterval: true }),
      /unlocks in 7 days/,
    );
  });

  test('it unlocks exactly seven days on', async () => {
    const { repo } = build();
    await onboard(repo);
    await repo.createAssessment({ measurements: { waistCm: 85, neckCm: 38 }, enforceInterval: false });

    const week = new Date(Date.now() + 7 * 86_400_000 + 1000);
    assert.equal((await repo.assessmentAvailability(week)).available, true);
  });
});

describe('storage behaves under real conditions', () => {
  test('concurrent writes to one document do not lose each other', async () => {
    // Logging sets fires several writes in quick succession. A plain
    // read-modify-write pair would have the last one discard the rest.
    const { storage, repo } = build();
    await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        repo.updateWorkoutsDoc((doc) => ({
          ...doc,
          records: [
            ...doc.records,
            {
              exerciseId: `ex-${index}`,
              recordType: 'weight',
              value: index,
              previousValue: null,
              achievedAt: new Date().toISOString(),
            },
          ],
        })),
      ),
    );

    const { records } = await repo.workoutsDoc();
    assert.equal(records.length, 12, 'concurrent writes overwrote one another');
    assert.equal(storage.data.size, 1);
  });

  test('a corrupt document costs its own area, not the app', async () => {
    const { storage, repo } = build();
    await onboard(repo);
    storage.corrupt.add(DOCUMENT_KEYS.program);

    // The programme document is unreadable, so it reads as empty …
    assert.equal((await repo.programDoc()).program, null);
    // … while the profile beside it is untouched.
    assert.ok((await repo.profileDoc()).profile);
  });

  test('deleting the account really removes everything', async () => {
    const { storage, repo } = build();
    await onboard(repo);
    await repo.createAssessment({ measurements: { waistCm: 85, neckCm: 38 }, enforceInterval: false });
    await repo.generateProgram();
    assert.ok(storage.data.size >= 3);

    await repo.deleteEverything();
    assert.equal(storage.data.size, 0);
    assert.equal((await repo.profileDoc()).profile, null);
    assert.deepEqual((await repo.assessments()), []);
  });
});

describe('earned progress survives a rebuild', () => {
  test('the best working weight per exercise is carried forward', () => {
    const best = bestWeights([
      {
        id: 'w1', userId: 'u', programDayId: null, dayNumber: 1, focus: 'Full Body A',
        startedAt: '', completedAt: '', durationSeconds: 0, totalSets: 0, totalVolumeKg: 0,
        cardioMinutes: 0, personalRecords: [],
        exercises: [
          {
            exerciseId: 'goblet_squat', orderIndex: 0,
            sets: [
              { setNumber: 1, actualWeight: 20, actualReps: 8, isWarmup: true } as never,
              { setNumber: 2, actualWeight: 40, actualReps: 8, isWarmup: false } as never,
              { setNumber: 3, actualWeight: 45, actualReps: 6, isWarmup: false } as never,
            ],
          } as never,
        ],
      },
    ]);

    assert.equal(best.goblet_squat, 45);
  });

  test('warm-up sets are not mistaken for working weight', () => {
    const best = bestWeights([
      {
        id: 'w1', userId: 'u', programDayId: null, dayNumber: 1, focus: '',
        startedAt: '', completedAt: '', durationSeconds: 0, totalSets: 0, totalVolumeKg: 0,
        cardioMinutes: 0, personalRecords: [],
        exercises: [
          {
            exerciseId: 'push_up', orderIndex: 0,
            sets: [{ setNumber: 1, actualWeight: 100, actualReps: 5, isWarmup: true } as never],
          } as never,
        ],
      },
    ]);
    assert.equal(best.push_up, undefined);
  });
});

describe('the week is laid out with rest days', () => {
  test('three training days are spread, not stacked', async () => {
    const { repo } = build();
    await onboard(repo);
    const program = await repo.generateProgram();

    const slots = layOutWeek(program, 3, new Date('2026-09-14T08:00:00Z'));
    const dates = slots.map((slot) => slot.scheduledDate);

    assert.equal(new Set(dates).size, 3, 'two sessions landed on the same day');
    assert.deepEqual([...dates].sort(), dates, 'the week is out of order');
    // A three-day week should not run on three consecutive days.
    const spans = dates.slice(1).map((d, i) => Date.parse(d) - Date.parse(dates[i]));
    assert.ok(spans.some((gap) => gap > 86_400_000), 'no rest day between sessions');
  });
});
