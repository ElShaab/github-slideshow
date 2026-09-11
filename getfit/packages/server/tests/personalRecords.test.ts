import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateOneRepMax } from '@getfit/shared';
import { detectPersonalRecords } from '../src/services/personalRecordService';
import { setsOf } from './helpers';

const achievedAt = new Date().toISOString();
const noRecords = { weight: null, reps: null, estimated_1rm: null, volume: null };

test('the first session on an exercise sets every record', () => {
  const records = detectPersonalRecords({
    exerciseId: 'bench_press',
    sets: setsOf(3, 60, 10),
    existing: noRecords,
    achievedAt,
  });

  const types = records.map((r) => r.recordType).sort();
  assert.deepEqual(types, ['estimated_1rm', 'reps', 'volume', 'weight']);
  assert.equal(records.find((r) => r.recordType === 'weight')?.value, 60);
  assert.equal(records.find((r) => r.recordType === 'volume')?.value, 1800);
});

test('beating the previous best weight records a PR with the old value', () => {
  const records = detectPersonalRecords({
    exerciseId: 'bench_press',
    sets: setsOf(3, 62.5, 10),
    existing: { weight: 60, reps: 10, estimated_1rm: 80, volume: 1800 },
    achievedAt,
  });

  const weightPr = records.find((r) => r.recordType === 'weight');
  assert.ok(weightPr);
  assert.equal(weightPr.value, 62.5);
  assert.equal(weightPr.previousValue, 60);
});

test('matching a previous best is not a record', () => {
  const records = detectPersonalRecords({
    exerciseId: 'bench_press',
    sets: setsOf(3, 60, 10),
    existing: {
      weight: 60,
      reps: 10,
      estimated_1rm: estimateOneRepMax(60, 10),
      volume: 1800,
    },
    achievedAt,
  });
  assert.equal(records.length, 0);
});

test('warm-up sets never count toward a record', () => {
  const records = detectPersonalRecords({
    exerciseId: 'bench_press',
    sets: [
      ...setsOf(2, 100, 3, { isWarmup: true }),
      ...setsOf(2, 50, 10),
    ],
    existing: { weight: 60, reps: 10, estimated_1rm: 80, volume: 1800 },
    achievedAt,
  });
  assert.equal(records.find((r) => r.recordType === 'weight'), undefined);
});

test('a light high-rep set does not fake a rep record', () => {
  const records = detectPersonalRecords({
    exerciseId: 'bench_press',
    sets: setsOf(3, 30, 25),
    existing: { weight: 60, reps: 10, estimated_1rm: 80, volume: 1800 },
    achievedAt,
  });
  assert.equal(records.find((r) => r.recordType === 'reps'), undefined);
});

test('extra reps at the record weight do count', () => {
  const records = detectPersonalRecords({
    exerciseId: 'bench_press',
    sets: setsOf(3, 60, 12),
    existing: { weight: 60, reps: 10, estimated_1rm: 80, volume: 5000 },
    achievedAt,
  });
  const repPr = records.find((r) => r.recordType === 'reps');
  assert.ok(repPr);
  assert.equal(repPr.value, 12);
});

test('bodyweight work records reps with no weight', () => {
  const records = detectPersonalRecords({
    exerciseId: 'push_up',
    sets: setsOf(3, 0, 30),
    existing: noRecords,
    achievedAt,
  });
  const repPr = records.find((r) => r.recordType === 'reps');
  assert.ok(repPr);
  assert.equal(repPr.value, 30);
  assert.equal(records.find((r) => r.recordType === 'weight'), undefined);
});

test('an unfinished exercise produces no records', () => {
  const records = detectPersonalRecords({
    exerciseId: 'bench_press',
    sets: setsOf(2, 60, 0),
    existing: noRecords,
    achievedAt,
  });
  assert.equal(records.length, 0);
});
