/**
 * Spec section 25 -- the 10,000 level generation stress test.
 *
 * Runs as part of `npm test` (node --test tests/) and can also be executed
 * directly for the full report:  node tests/stress-levels.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { LevelGenerator } from '../src/core/LevelGenerator.js';
import { LevelSimulator } from '../src/core/LevelSimulator.js';
import { validateLevel } from '../src/core/LevelValidator.js';
import { WeaponStats } from '../src/core/WeaponStats.js';
import { DifficultyManager } from '../src/core/DifficultyManager.js';
import { Rng } from '../src/core/Rng.js';
import { isValidGate, applyGate } from '../src/core/GateMath.js';

const LEVEL_TARGET = Number(process.env.STRESS_LEVELS || 10000);

/**
 * Generates and fully audits `count` stages across the whole stage range and
 * a wide spread of entry states.
 */
export function runStressTest (count = LEVEL_TARGET, { verbose = false } = {}) {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  const difficulty = new DifficultyManager();
  const rng = new Rng(0xC0FFEE);

  const report = {
    requested: count,
    generated: 0,
    rejected: 0,
    accepted: 0,
    winningPaths: { total: 0, min: Infinity, max: 0 },
    difficultySum: 0,
    attemptsSum: 0,
    durationSum: 0,
    failures: [],
    rejectionReasons: null,
    elapsedMs: 0
  };

  const started = Date.now();

  for (let i = 0; i < count; i++) {
    const stage = rng.int(1, 30);
    // Entry states span everything a real run can present: a fresh start, a
    // healthy mid-run squad, and the wreckage left after a continue.
    const squad = rng.chance(0.12)
      ? rng.int(1, 6)
      : rng.int(7, 420);
    const weapon = WeaponStats.fromLevels({
      fireRate: rng.int(0, 8), damage: rng.int(0, 8), range: rng.int(0, 6),
      bullets: rng.int(0, 6), area: rng.int(0, 6)
    });
    const entry = { squad, weapon };

    const { level, attempts, rejected } = generator.generate(stage, entry, rng.int(1, 0x7ffffffe));
    report.accepted++;
    report.attemptsSum += attempts;
    report.rejected += rejected;
    report.durationSum += level.estimatedSeconds;
    report.difficultySum += level.difficulty;

    const fail = (reason) => report.failures.push({ index: i, stage, squad, seed: level.seed, reason });

    /* ---- structural audit of an ACCEPTED level ---- */
    const structural = validateLevel(level);
    if (!structural.ok) fail(`structure:${structural.reason}`);

    if (level.difficulty > CONFIG.difficulty.max + 1e-9) fail('difficulty-above-cap');
    if (Math.abs(level.difficulty - difficulty.difficultyFor(stage)) > 1e-9) fail('difficulty-mismatch');
    if (Math.abs(level.enemySpeed - difficulty.enemySpeed(stage)) > 1e-9) fail('enemy-speed-invalid');
    if (level.estimatedSeconds < CONFIG.generation.minStageSeconds ||
        level.estimatedSeconds > CONFIG.generation.maxStageSeconds) fail('duration-out-of-range');

    for (const section of level.sections) {
      for (const gate of section.gateRow.gates) {
        if (!isValidGate(gate)) fail('invalid-gate');
        if (gate.type !== 'WEAPON') {
          const probe = applyGate(37, gate);
          if (!Number.isInteger(probe) || probe < 0) fail('gate-math-invalid');
        }
      }
      for (const wave of section.waves) {
        if (wave.lanes.some((c) => !Number.isInteger(c) || c < 0)) fail('wave-count-invalid');
        if (!(wave.hp > 0)) fail('wave-hp-invalid');
      }
    }

    if (!(level.boss.hp > 0) || !Number.isFinite(level.boss.hp)) fail('boss-hp-invalid');

    /* ---- the promise: at least one path survives ---- */
    const paths = simulator.enumeratePaths(level, entry);
    if (paths.winningPaths < 1) fail('no-winning-path');

    // Walk the reported best path and re-check every invariant on the way.
    const result = simulator.simulatePath(level, entry, paths.bestPath || level.goldenPath, { collectLog: true });
    if (!result.survived) fail('best-path-died');
    if (!Number.isInteger(result.finalSquad) || result.finalSquad < 0) fail('final-squad-invalid');
    for (const step of result.log || []) {
      if (step.squadAfter !== undefined &&
          (!Number.isInteger(step.squadAfter) || step.squadAfter < 0)) fail('fractional-or-negative-squad');
    }

    report.winningPaths.total += paths.winningPaths;
    report.winningPaths.min = Math.min(report.winningPaths.min, paths.winningPaths);
    report.winningPaths.max = Math.max(report.winningPaths.max, paths.winningPaths);

    if (verbose && (i + 1) % 1000 === 0) {
      process.stdout.write(`  ${i + 1}/${count} levels audited\n`);
    }
  }

  report.elapsedMs = Date.now() - started;
  report.generated = generator.stats.generated;
  report.rejectionReasons = generator.stats.rejectionReasons;
  report.averageWinningPaths = report.winningPaths.total / Math.max(1, report.accepted);
  report.averageDifficulty = report.difficultySum / Math.max(1, report.accepted);
  report.averageDurationSeconds = report.durationSum / Math.max(1, report.accepted);
  report.averageAttempts = report.attemptsSum / Math.max(1, report.accepted);
  report.rejectionRate = report.generated ? report.rejected / report.generated : 0;
  return report;
}

export function formatReport (report) {
  return [
    '--- LEVEL GENERATION STRESS TEST ------------------------------',
    `accepted levels        : ${report.accepted}`,
    `candidates generated   : ${report.generated}`,
    `candidates rejected    : ${report.rejected} (${(report.rejectionRate * 100).toFixed(1)}%)`,
    `avg attempts / stage   : ${report.averageAttempts.toFixed(2)}`,
    `winning paths  min/avg/max : ${report.winningPaths.min} / ${report.averageWinningPaths.toFixed(1)} / ${report.winningPaths.max}`,
    `average difficulty     : ${(report.averageDifficulty * 100).toFixed(1)}%`,
    `average stage duration : ${report.averageDurationSeconds.toFixed(1)}s`,
    `generation time        : ${report.elapsedMs}ms  (${(report.elapsedMs / Math.max(1, report.accepted)).toFixed(2)}ms per level)`,
    `rejection reasons      : ${JSON.stringify(report.rejectionReasons)}`,
    `failures               : ${report.failures.length}`,
    '---------------------------------------------------------------'
  ].join('\n');
}

test(`spec 25: ${LEVEL_TARGET} generated levels are all valid and beatable`, { timeout: 20 * 60 * 1000 }, () => {
  const report = runStressTest(LEVEL_TARGET);
  console.log(formatReport(report));

  assert.equal(report.failures.length, 0,
    `invalid accepted levels: ${JSON.stringify(report.failures.slice(0, 5), null, 2)}`);
  assert.equal(report.accepted, LEVEL_TARGET);
  assert.ok(report.winningPaths.min >= 1, 'every accepted level must have at least one winning path');
  assert.ok(report.averageDifficulty <= CONFIG.difficulty.max + 1e-9);
  assert.ok(report.averageDurationSeconds >= CONFIG.generation.minStageSeconds);
  assert.ok(report.averageDurationSeconds <= CONFIG.generation.maxStageSeconds);
});

// Direct execution: node tests/stress-levels.test.mjs
if (process.argv[1] && process.argv[1].endsWith('stress-levels.test.mjs') && !process.env.NODE_TEST_CONTEXT) {
  console.log(formatReport(runStressTest(LEVEL_TARGET, { verbose: true })));
}
