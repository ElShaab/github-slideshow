import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate } from '@getfit/shared';
import { WorkoutAdaptationService, WEEK_LAYOUTS } from '../src/services/workoutAdaptationService';

const adaptation = new WorkoutAdaptationService();

function slot(id: string, date: string, focus = 'Upper Body') {
  return {
    id,
    workoutDayId: `day-${id}`,
    dayNumber: Number(id),
    focus,
    scheduledDate: date,
    status: 'scheduled' as const,
  };
}

test('a missed workout is moved, never deleted', () => {
  const today = new Date('2026-03-04T09:00:00Z');
  const weekEnd = new Date('2026-03-08T00:00:00Z');

  const result = adaptation.reorganiseWeek(
    [
      slot('1', '2026-03-02', 'Upper Body'), // missed
      slot('2', '2026-03-05', 'Lower Body'),
    ],
    today,
    weekEnd,
  );

  assert.equal(result.updates.length, 1);
  const moved = result.updates[0];
  assert.equal(moved.id, '1');
  assert.equal(moved.status, 'rescheduled');
  assert.ok(moved.scheduledDate >= isoDate(today), 'moved into the future');
  assert.notEqual(moved.scheduledDate, '2026-03-05', 'did not double up on an existing day');
});

test('multiple missed workouts all get a new slot', () => {
  const today = new Date('2026-03-05T09:00:00Z');
  const weekEnd = new Date('2026-03-09T00:00:00Z');

  const result = adaptation.reorganiseWeek(
    [slot('1', '2026-03-02'), slot('2', '2026-03-03'), slot('3', '2026-03-08')],
    today,
    weekEnd,
  );

  assert.equal(result.updates.length, 2);
  const dates = result.updates.map((u) => u.scheduledDate);
  assert.equal(new Set(dates).size, dates.length, 'two sessions were stacked on one day');
});

test('a full week pushes the missed session past the week rather than dropping it', () => {
  const today = new Date('2026-03-06T09:00:00Z');
  const weekEnd = new Date('2026-03-07T00:00:00Z');

  const result = adaptation.reorganiseWeek(
    [slot('1', '2026-03-03'), slot('2', '2026-03-06'), slot('3', '2026-03-07')],
    today,
    weekEnd,
  );

  assert.equal(result.updates.length, 1);
  assert.ok(result.updates[0].scheduledDate > '2026-03-07');
  assert.equal(result.updates[0].status, 'rescheduled');
});

test('nothing changes when no session was missed', () => {
  const today = new Date('2026-03-04T09:00:00Z');
  const result = adaptation.reorganiseWeek(
    [slot('1', '2026-03-04'), slot('2', '2026-03-06')],
    today,
    new Date('2026-03-08T00:00:00Z'),
  );
  assert.equal(result.updates.length, 0);
});

test('week layouts spread sessions instead of stacking them', () => {
  for (const [days, offsets] of Object.entries(WEEK_LAYOUTS)) {
    assert.equal(offsets.length, Number(days), `${days} days should have ${days} slots`);
    assert.equal(new Set(offsets).size, offsets.length, `${days} days has duplicate slots`);
    assert.ok(Math.max(...offsets) <= 6, `${days} days runs past the week`);
  }

  // Four training days should include rest days, not four back-to-back.
  assert.deepEqual(WEEK_LAYOUTS[4], [0, 1, 3, 4]);
});

test('planWeek assigns every training day a distinct date', () => {
  const plan = adaptation.planWeek(new Date('2026-03-02T00:00:00Z'), 4, [1, 2, 3, 4]);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((p) => p.dayNumber), [1, 2, 3, 4]);
  assert.equal(new Set(plan.map((p) => p.date)).size, 4);
  assert.equal(plan[0].date, '2026-03-02');
});
