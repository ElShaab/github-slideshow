/**
 * Spec 51: the simulator must never claim a level is beatable when real
 * gameplay would kill the player.  These tests step the live engagement
 * (LaneEngagement, what the game runs) against the analytic model
 * (CombatModel.resolveLaneStream, what the simulator runs) and require the
 * live result to match -- or beat -- the simulated one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { WeaponStats } from '../src/core/WeaponStats.js';
import { resolveLaneStream } from '../src/core/CombatModel.js';
import { LaneEngagement } from '../src/core/LaneEngagement.js';

/**
 * Runs the live, frame-stepped engagement exactly the way the game does:
 * enemies spawn spaced `spacing` apart and close at (squadSpeed + enemySpeed).
 */
function playLive ({ squadSize, weapon, enemyHp, enemyCount, enemySpeed, spacing, dt }) {
  const closing = CONFIG.squad.forwardSpeed + enemySpeed;
  const enemies = [];
  for (let i = 0; i < enemyCount; i++) {
    enemies.push({ hp: enemyHp, distance: weapon.range + i * spacing });
  }

  const engagement = new LaneEngagement(CONFIG);
  let squad = squadSize;
  let kills = 0;
  let contacts = 0;
  let time = 0;
  const limit = (weapon.range + enemyCount * spacing) / closing + 5;

  while (enemies.length > 0 && squad > 0 && time < limit) {
    for (const enemy of enemies) enemy.distance -= closing * dt;
    const result = engagement.step({ squadSize: squad, weapon, enemies, dt });
    kills += result.kills;
    contacts += result.contacts;
    squad = result.squadAfter;
    time += dt;
  }
  return { squadAfter: squad, kills, contacts, dead: squad <= 0 };
}

test('live combat matches the analytic model closely and is never worse', () => {
  const cases = [];
  for (const squadSize of [8, 15, 30, 60, 120, 240]) {
    for (const enemyCount of [10, 25, 60, 110]) {
      for (const hpScale of [0.5, 1, 2.5, 6]) {
        cases.push({ squadSize, enemyCount, hpScale });
      }
    }
  }

  let worseCount = 0;
  for (const testCase of cases) {
    const weapon = WeaponStats.fromLevels({ damage: 2, fireRate: 1, range: 1 });
    const params = {
      squadSize: testCase.squadSize,
      weapon,
      enemyHp: CONFIG.enemies.baseHp * testCase.hpScale * 3,
      enemyCount: testCase.enemyCount,
      enemySpeed: CONFIG.enemies.baseSpeed,
      spacing: CONFIG.enemies.spacing
    };

    const simulated = resolveLaneStream({ ...params, efficiency: CONFIG.combat.simulatorEfficiency });
    const live = playLive({ ...params, dt: 1 / 60 });

    // The live game must not do worse than what the simulator promised.
    if (live.squadAfter < simulated.squadAfter) worseCount++;
    assert.ok(live.squadAfter >= simulated.squadAfter - 1,
      `live ${live.squadAfter} vs simulated ${simulated.squadAfter} for ${JSON.stringify(testCase)}`);
    if (!simulated.dead) {
      assert.equal(live.dead, false,
        `simulator promised survival but the live run died for ${JSON.stringify(testCase)}`);
    }
  }
  assert.equal(worseCount, 0, 'the live game came out behind the simulation in some cases');
});

test('frame rate does not change the outcome (30fps vs 144fps)', () => {
  const weapon = WeaponStats.fromLevels({ damage: 1, bullets: 1 });
  const params = {
    squadSize: 40, weapon, enemyHp: 260, enemyCount: 55,
    enemySpeed: CONFIG.enemies.baseSpeed, spacing: CONFIG.enemies.spacing
  };
  const slow = playLive({ ...params, dt: 1 / 30 });
  const fast = playLive({ ...params, dt: 1 / 144 });
  assert.ok(Math.abs(slow.squadAfter - fast.squadAfter) <= 2,
    `frame rate changed the outcome: ${slow.squadAfter} vs ${fast.squadAfter}`);
});

test('an enemy reaching the squad always costs exactly one soldier live', () => {
  const weapon = new WeaponStats();
  const result = playLive({
    squadSize: 50, weapon, enemyHp: 1e9, enemyCount: 20,
    enemySpeed: CONFIG.enemies.baseSpeed, spacing: CONFIG.enemies.spacing, dt: 1 / 60
  });
  assert.equal(result.contacts, 20);
  assert.equal(result.squadAfter, 30);
  assert.equal(result.kills, 0);
});

test('enemies that ran past in another lane never hurt a squad that swerves in', () => {
  const weapon = new WeaponStats();
  const engagement = new LaneEngagement(CONFIG);

  // A lane the squad ignored: its enemies are already well behind.
  const strays = [
    { hp: 999999, distance: -9 },
    { hp: 999999, distance: -6 },
    { hp: 999999, distance: -4 }
  ];
  let passed = 0;
  const result = engagement.step({
    dt: 1 / 60, squadSize: 20, weapon, enemies: strays,
    onPassed: () => { passed++; }
  });
  assert.equal(result.contacts, 0, 'enemies behind the squad must not cost soldiers');
  assert.equal(result.squadAfter, 20);
  assert.equal(passed, 3);
  assert.equal(strays.length, 0, 'they should still be cleared out');

  // An enemy that has just touched the front rank still costs one soldier.
  const arriving = [{ hp: 999999, distance: -0.2 }];
  const hit = engagement.step({ dt: 1 / 60, squadSize: 20, weapon, enemies: arriving });
  assert.equal(hit.contacts, 1);
  assert.equal(hit.squadAfter, 19);
});
