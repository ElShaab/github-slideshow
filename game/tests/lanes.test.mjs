/**
 * Lane geometry and controls (spec 2).
 *
 * The camera sits behind the squad looking along +z, which makes world -x the
 * camera's right-hand side.  Lane 0 must therefore be at positive x to appear
 * on the player's LEFT -- and a left swipe must move towards it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { LaneController } from '../src/systems/LaneController.js';

test('there are exactly three lanes, centred on the road', () => {
  const lanes = new LaneController();
  assert.equal(lanes.laneCount, 3);
  assert.equal(lanes.laneX(1), 0);
  assert.equal(lanes.laneX(0), CONFIG.lanes.width);
  assert.equal(lanes.laneX(2), -CONFIG.lanes.width);
});

test('lane 0 is on the player\'s left: swiping left moves towards +x', () => {
  const lanes = new LaneController();
  assert.equal(lanes.lane, 1, 'runs start in the centre lane');
  lanes.move(-1);
  assert.equal(lanes.lane, 0);
  assert.ok(lanes.targetX > 0, 'the LEFT lane must be at positive x for this camera');
  lanes.move(1);
  lanes.move(1);
  assert.equal(lanes.lane, 2);
  assert.ok(lanes.targetX < 0);
});

test('the squad cannot leave the road', () => {
  const lanes = new LaneController();
  lanes.move(-1); lanes.move(-1); lanes.move(-1);
  assert.equal(lanes.lane, 0);
  lanes.move(1); lanes.move(1); lanes.move(1); lanes.move(1);
  assert.equal(lanes.lane, 2);
});

test('laneAt is the exact inverse of laneX', () => {
  const lanes = new LaneController();
  for (let lane = 0; lane < CONFIG.lanes.count; lane++) {
    assert.equal(lanes.laneAt(lanes.laneX(lane)), lane);
  }
});

test('lane changes are smooth, finite and frame-rate independent', () => {
  const fast = new LaneController();
  const slow = new LaneController();
  fast.move(1);
  slow.move(1);
  for (let i = 0; i < 400; i++) fast.update(1 / 240);
  for (let i = 0; i < 50; i++) slow.update(1 / 30);
  assert.ok(Math.abs(fast.x - fast.targetX) < 1e-9);
  assert.ok(Math.abs(slow.x - slow.targetX) < 1e-9);

  // A single lane change must complete quickly enough to dodge a wave.
  const timed = new LaneController();
  timed.move(-1);
  let elapsed = 0;
  while (Math.abs(timed.x - timed.targetX) > 1e-9 && elapsed < 5) {
    timed.update(1 / 60);
    elapsed += 1 / 60;
  }
  assert.ok(elapsed < 0.5, `a lane change took ${elapsed.toFixed(2)}s`);
});
