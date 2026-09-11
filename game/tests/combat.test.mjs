import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { WeaponStats } from '../src/core/WeaponStats.js';
import {
  resolveLaneStream, resolveWave, resolveBoss, resolveBossEncounter,
  squadDps, combatPower, minimumSquadForStream, effectiveSoldiers
} from '../src/core/CombatModel.js';
import { RunState } from '../src/core/RunState.js';
import { Profile, MemoryStorage } from '../src/core/Profile.js';

const weapon = () => new WeaponStats();

test('every enemy that reaches the squad removes exactly one soldier', () => {
  // Enemies with absurd hit points cannot be killed, so every one of them
  // reaches the squad: the squad must shrink by exactly the enemy count.
  const result = resolveLaneStream({
    squadSize: 30, weapon: weapon(), enemyHp: 1e9, enemyCount: 12,
    enemySpeed: CONFIG.enemies.baseSpeed
  });
  assert.equal(result.leaks, 12);
  assert.equal(result.squadAfter, 18);
  assert.equal(result.kills, 0);
});

test('the squad dies when the last soldier is taken, and never goes negative', () => {
  const result = resolveLaneStream({
    squadSize: 5, weapon: weapon(), enemyHp: 1e9, enemyCount: 40,
    enemySpeed: CONFIG.enemies.baseSpeed
  });
  assert.equal(result.squadAfter, 0);
  assert.equal(result.dead, true);
  assert.ok(result.leaks <= 40);
});

test('squad size stays a whole number through combat', () => {
  for (let size = 1; size <= 60; size += 7) {
    const result = resolveLaneStream({
      squadSize: size, weapon: weapon(), enemyHp: 140, enemyCount: 25,
      enemySpeed: CONFIG.enemies.baseSpeed
    });
    assert.ok(Number.isInteger(result.squadAfter));
    assert.ok(result.squadAfter >= 0);
  }
});

test('combat outcome is monotonic in squad size (more soldiers is never worse)', () => {
  let previous = -1;
  for (let size = 1; size <= 150; size++) {
    const result = resolveLaneStream({
      squadSize: size, weapon: weapon(), enemyHp: 260, enemyCount: 40,
      enemySpeed: CONFIG.enemies.baseSpeed
    });
    assert.ok(result.squadAfter >= previous, `squad ${size} did worse than ${size - 1}`);
    previous = result.squadAfter;
  }
});

test('weapon upgrades strictly increase firepower and combat power', () => {
  const base = weapon();
  const baseDps = squadDps(40, base, CONFIG);
  const basePower = combatPower(40, base, CONFIG);
  for (const stat of ['fireRate', 'damage', 'bullets', 'area']) {
    const upgraded = base.clone();
    upgraded.upgrade(stat);
    assert.ok(squadDps(40, upgraded, CONFIG) > baseDps, `${stat} did not raise dps`);
    assert.ok(combatPower(40, upgraded, CONFIG) > basePower, `${stat} did not raise power`);
  }
  // Range buys engagement time rather than raw dps, but must raise power.
  const ranged = base.clone();
  ranged.upgrade('range');
  assert.ok(combatPower(40, ranged, CONFIG) > basePower);
  assert.ok(ranged.range > base.range);
});

test('a longer range kills more of the same wave', () => {
  const short = weapon();
  const long = weapon();
  for (let i = 0; i < 8; i++) long.upgrade('range');
  const params = { enemyHp: 300, enemyCount: 30, enemySpeed: CONFIG.enemies.baseSpeed, squadSize: 25 };
  const a = resolveLaneStream({ ...params, weapon: short });
  const b = resolveLaneStream({ ...params, weapon: long });
  assert.ok(b.kills >= a.kills);
  assert.ok(b.squadAfter >= a.squadAfter);
});

test('the squad only fights the lane it stands in', () => {
  const wave = {
    lanes: [{ count: 40, hp: 500 }, { count: 0, hp: 500 }, { count: 40, hp: 500 }],
    speed: CONFIG.enemies.baseSpeed,
    spacing: CONFIG.enemies.spacing
  };
  const dodged = resolveWave({ squadSize: 20, weapon: weapon(), wave, lane: 1 });
  assert.equal(dodged.leaks, 0);
  assert.equal(dodged.squadAfter, 20);
  assert.equal(dodged.dodged, true);

  const fought = resolveWave({ squadSize: 20, weapon: weapon(), wave, lane: 0 });
  assert.ok(fought.leaks > 0);
  assert.ok(fought.squadAfter < 20);
});

test('a boss removes its contact loss per contact and can be out-damaged', () => {
  const boss = { hp: 1e12, speed: 5.5, contactLoss: 4, escort: null };
  const crushed = resolveBoss({ squadSize: 20, weapon: weapon(), boss });
  assert.equal(crushed.dead, true);
  assert.equal(crushed.squadAfter, 0);

  const beatable = resolveBossEncounter({
    squadSize: 60, weapon: weapon(), boss: { ...boss, hp: 500 }
  });
  assert.equal(beatable.dead, false);
  assert.ok(beatable.squadAfter > 0);
});

test('simulator efficiency is conservative: gameplay never does worse than the simulation', () => {
  const params = {
    weapon: weapon(), enemyHp: 220, enemyCount: 45, enemySpeed: CONFIG.enemies.baseSpeed
  };
  for (let size = 5; size <= 120; size += 5) {
    const simulated = resolveLaneStream({ ...params, squadSize: size, efficiency: CONFIG.combat.simulatorEfficiency });
    const played = resolveLaneStream({ ...params, squadSize: size, efficiency: 1 });
    assert.ok(played.squadAfter >= simulated.squadAfter,
      `gameplay (${played.squadAfter}) was worse than simulation (${simulated.squadAfter}) at squad ${size}`);
  }
});

test('effective soldiers rise monotonically with squad size', () => {
  let previous = 0;
  for (let size = 0; size <= 2000; size += 13) {
    const value = effectiveSoldiers(size, CONFIG);
    assert.ok(value >= previous);
    previous = value;
  }
});

test('minimumSquadForStream finds the true threshold', () => {
  const params = { weapon: weapon(), enemyHp: 200, enemyCount: 30, enemySpeed: CONFIG.enemies.baseSpeed };
  const minimum = minimumSquadForStream(params);
  assert.ok(minimum > 0);
  assert.equal(resolveLaneStream({ ...params, squadSize: minimum }).dead, false);
  assert.equal(resolveLaneStream({ ...params, squadSize: minimum - 1 }).dead, true);
});

test('RunState keeps the squad integral and lifetime points monotonic', () => {
  const profile = new Profile(new MemoryStorage());
  const run = new RunState(CONFIG, profile);
  run.setSquad(10);
  const pointsAfterStart = profile.soldierPoints;

  run.applyGate({ type: 'PLUS', value: 25 });
  assert.equal(run.squad, 35);
  assert.equal(profile.soldierPoints, pointsAfterStart + 25);

  run.removeSoldiers(12);
  assert.equal(run.squad, 23);
  assert.equal(profile.soldierPoints, pointsAfterStart + 25, 'lifetime points must not drop when soldiers die');

  run.applyGate({ type: 'DIVIDE', value: 2 });
  assert.equal(run.squad, 11);
  assert.ok(Number.isInteger(run.squad));

  run.applyGate({ type: 'MINUS', value: 999 });
  assert.equal(run.squad, 0);
  assert.equal(run.alive, false);
  assert.equal(profile.soldierPoints, pointsAfterStart + 25);
});
