/**
 * Integration parity (spec 51, 58).
 *
 * Replays a generated stage the way the LIVE GAME runs it -- squad advancing
 * metre by metre, waves spawned ahead at the same distance LevelManager uses,
 * damage stepped frame by frame through LaneEngagement, gates applied when
 * they are crossed -- and checks the result against the LevelSimulator's
 * prediction for the same lane choices.
 *
 * If these two ever disagree, the promise that "every accepted level is
 * beatable" would be worthless, so the tolerance here is deliberately tight.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { LevelGenerator } from '../src/core/LevelGenerator.js';
import { LevelSimulator } from '../src/core/LevelSimulator.js';
import { LaneEngagement } from '../src/core/LaneEngagement.js';
import { WeaponStats } from '../src/core/WeaponStats.js';
import { applyGate, GateType } from '../src/core/GateMath.js';
import { resolveBossEncounter } from '../src/core/CombatModel.js';

const WAVE_SPAWN_LEAD = 96;   // must match LevelManager
const DT = 1 / 60;

/**
 * Headless twin of the live game loop.  Deliberately written against the same
 * core modules the browser build uses, so it exercises the real rules rather
 * than a second implementation of them.
 */
/** True when something is close enough that changing lanes is reckless. */
function laneIsBlocked (queues, z) {
  for (const queue of queues) {
    for (const enemy of queue) {
      const ahead = enemy.z - z;
      if (ahead > 0 && ahead < 32) return true;
    }
  }
  return false;
}

function playLevel (level, entry, lanePath, { log = false } = {}) {
  const config = CONFIG;
  let squad = entry.squad;
  const weapon = entry.weapon.clone();
  let z = 0;
  let kills = 0;
  let losses = 0;
  const events = [];

  const queues = [[], [], []];
  const engagement = new LaneEngagement(config);
  const spawned = new Set();
  const crossed = new Set();

  const endZ = level.boss.z;
  let lane = 1;

  while (z < endZ && squad > 0) {
    z += config.squad.forwardSpeed * DT;

    // --- gates: cross the row in the lane this path chose ---------------
    level.sections.forEach((section, index) => {
      if (crossed.has(index)) return;
      if (z < section.gateRow.z) {
        // Move into position well before the row (the live player swipes).
        if (section.gateRow.z - z < 40 && !laneIsBlocked(queues, z)) lane = lanePath[index];
        return;
      }
      crossed.add(index);
      const gate = section.gateRow.gates[lanePath[index]];
      if (gate.type === GateType.WEAPON) weapon.upgrade(gate.stat);
      else {
        const before = squad;
        squad = applyGate(squad, gate);
        if (log) events.push({ kind: 'gate', index, gate, before, after: squad });
      }
    });

    // --- waves: spawn ahead exactly like LevelManager --------------------
    level.sections.forEach((section, sectionIndex) => {
      section.waves.forEach((wave, waveIndex) => {
        const key = `${sectionIndex}:${waveIndex}`;
        if (spawned.has(key) || wave.z - z > WAVE_SPAWN_LEAD) return;
        spawned.add(key);
        wave.lanes.forEach((count, laneIndex) => {
          if (count <= 0) return;
          const spacing = wave.spacings ? wave.spacings[laneIndex] : wave.spacing;
          for (let i = 0; i < count; i++) {
            queues[laneIndex].push({ hp: wave.hp, z: z + WAVE_SPAWN_LEAD + i * spacing, speed: wave.speed });
          }
          queues[laneIndex].sort((a, b) => a.z - b.z);
        });
      });
    });

    // --- pick the lane BEFORE the pack arrives, then hold it -------------
    // This is how the simulator models a wave (one lane for the whole
    // stream) and how a player actually plays it: swerving into a lane at
    // the last moment just inherits whatever is already at arm's length in
    // that lane.
    let nearest = Infinity;
    for (const queue of queues) {
      for (const enemy of queue) {
        const ahead = enemy.z - z;
        if (ahead > 0 && ahead < nearest) nearest = ahead;
      }
    }
    if (nearest < 90 && nearest > 32) {
      const pressure = queues.map((queue) =>
        queue.filter((enemy) => {
          const ahead = enemy.z - z;
          return ahead > 0 && ahead < nearest + 60;
        }).length);
      lane = pressure.indexOf(Math.min(...pressure));
    }

    // --- move enemies, then fight the engaged lane -----------------------
    for (const queue of queues) {
      for (const enemy of queue) enemy.z -= enemy.speed * DT;
    }
    const engaged = queues[lane];
    for (const enemy of engaged) enemy.distance = enemy.z - z;

    const result = engagement.step({
      dt: DT, squadSize: squad, weapon, enemies: engaged,
      onKill: () => { kills++; },
      onContact: () => { losses++; },
      onPassed: () => {}
    });
    squad = result.squadAfter;

    // Retire anything that ran past.
    for (let i = 0; i < queues.length; i++) {
      queues[i] = queues[i].filter((enemy) => enemy.z - z > -10);
    }
  }

  if (squad <= 0) return { survived: false, finalSquad: 0, kills, losses, events, failedAt: 'wave' };

  const boss = resolveBossEncounter({ squadSize: squad, weapon, boss: level.boss, efficiency: 1, config });
  return {
    survived: !boss.dead,
    finalSquad: boss.squadAfter,
    kills: kills + boss.kills,
    losses: losses + (squad - boss.squadAfter),
    events,
    failedAt: boss.dead ? 'boss' : null
  };
}

test('the live rules clear every stage the simulator says is clearable', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  const failures = [];

  for (let seed = 0; seed < 60; seed++) {
    const entry = {
      squad: 8 + (seed * 7) % 160,
      weapon: WeaponStats.fromLevels({ damage: seed % 4, fireRate: seed % 3, range: seed % 2 })
    };
    const stage = (seed % 14) + 1;
    const { level } = generator.generate(stage, entry, seed * 3671 + 17);
    const path = level.validation.bestPath || level.goldenPath;

    const predicted = simulator.simulatePath(level, entry, path);
    const played = playLevel(level, entry, path);

    if (predicted.survived && !played.survived) {
      failures.push({
        seed, stage, entry: entry.squad, path,
        predictedFinal: predicted.finalSquad, playedFailedAt: played.failedAt
      });
    }
  }

  assert.deepEqual(failures, [], 'the live game lost stages the simulator certified');
});

test('live outcomes stay close to the simulated ones', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  const ratios = [];

  for (let seed = 0; seed < 40; seed++) {
    const entry = { squad: 20 + (seed * 11) % 140, weapon: WeaponStats.fromLevels({ damage: 1 }) };
    const { level } = generator.generate((seed % 10) + 1, entry, seed * 977 + 5);
    const path = level.validation.bestPath || level.goldenPath;
    const predicted = simulator.simulatePath(level, entry, path);
    const played = playLevel(level, entry, path);
    if (!predicted.survived || !played.survived) continue;
    ratios.push(played.finalSquad / Math.max(1, predicted.finalSquad));
  }

  assert.ok(ratios.length > 15, 'not enough comparable runs');
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const worst = Math.min(...ratios);
  // The live game should land at or above the (deliberately conservative)
  // simulation, and never dramatically below it.
  assert.ok(mean >= 0.9, `live runs averaged ${(mean * 100).toFixed(0)}% of the simulated squad`);
  assert.ok(worst >= 0.5, `one live run finished with only ${(worst * 100).toFixed(0)}% of the simulated squad`);
});
