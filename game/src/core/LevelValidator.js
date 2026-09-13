/**
 * LevelValidator.js -- spec section 24.
 *
 * Structural proof-reading of a candidate level.  Anything that fails here is
 * rejected by the generator and never reaches the player.  The checks are
 * intentionally paranoid: they are the last line of defence for the
 * "guaranteed solvability" promise.
 */
import { CONFIG } from './Config.js';
import { isValidGate, GateType, applyGate } from './GateMath.js';
import { DifficultyManager } from './DifficultyManager.js';

const fail = (reason) => ({ ok: false, reason });

export function validateLevel (level, config = CONFIG) {
  const difficulty = new DifficultyManager(config);

  if (!level || !Array.isArray(level.sections)) return fail('no-sections');
  if (level.sections.length < config.generation.sectionsMin) return fail('too-few-sections');
  if (!level.boss) return fail('no-boss');

  /* --------------------------------------------------------- difficulty */
  const expected = difficulty.difficultyFor(level.stage);
  if (Math.abs(level.difficulty - expected) > 1e-6) return fail('difficulty-mismatch');
  if (level.difficulty > config.difficulty.max + 1e-9) return fail('difficulty-above-cap');

  /* ------------------------------------------------------- enemy speed */
  const expectedSpeed = difficulty.enemySpeed(level.stage);
  if (Math.abs(level.enemySpeed - expectedSpeed) > 1e-6) return fail('enemy-speed-mismatch');
  const expectedMultiplier = difficulty.enemySpeedMultiplier(level.stage);
  if (Math.abs(level.enemySpeedMultiplier - expectedMultiplier) > 1e-9) {
    return fail('enemy-speed-progression-invalid');
  }

  /* ------------------------------------------------------- stage length */
  if (!(level.estimatedSeconds >= config.generation.minStageSeconds &&
        level.estimatedSeconds <= config.generation.maxStageSeconds)) {
    return fail('stage-duration-out-of-range');
  }

  /* ----------------------------------------------------------- sections */
  let previousEnd = -Infinity;
  for (const section of level.sections) {
    if (!section.gateRow || !Array.isArray(section.gateRow.gates)) return fail('missing-gate-row');
    if (section.gateRow.gates.length !== config.lanes.count) return fail('gate-row-lane-count');

    for (const gate of section.gateRow.gates) {
      if (!isValidGate(gate)) return fail('invalid-gate');
      if (gate.type !== GateType.WEAPON && !Number.isInteger(gate.value)) return fail('fractional-gate-value');
    }

    // Spec 8: the three lanes must not all be mathematically identical.
    const probe = Math.max(10, section.squadBeforeGate || 10);
    const outcomes = new Set(section.gateRow.gates.map((gate) =>
      gate.type === GateType.WEAPON ? `w:${gate.stat}` : String(applyGate(probe, gate))));
    if (outcomes.size < 2) return fail('gate-row-all-equal');

    // Gate math must keep squad counts whole and non-negative.
    for (const gate of section.gateRow.gates) {
      if (gate.type === GateType.WEAPON) continue;
      const result = applyGate(probe, gate);
      if (!Number.isInteger(result) || result < 0) return fail('gate-math-invalid');
    }

    if (!Array.isArray(section.waves) || section.waves.length === 0) return fail('missing-wave');
    for (const wave of section.waves) {
      if (!wave || !Array.isArray(wave.lanes)) return fail('missing-wave');
      if (wave.lanes.length !== config.lanes.count) return fail('wave-lane-count');
      if (wave.lanes.some((count) => !Number.isInteger(count) || count < 0)) return fail('wave-count-invalid');
      if (wave.lanes.every((count) => count === 0)) return fail('empty-wave');
      if (!(wave.hp > 0)) return fail('wave-hp-invalid');
      if (wave.spacings) {
        if (wave.spacings.length !== config.lanes.count) return fail('wave-spacing-lane-count');
        for (let lane = 0; lane < wave.lanes.length; lane++) {
          if (wave.lanes[lane] > 0 && !(wave.spacings[lane] >= config.generation.minEnemySpacing - 1e-9)) {
            return fail('wave-spacing-too-dense');
          }
        }
      }
      if (Math.abs(wave.speed - expectedSpeed) > 1e-6) return fail('wave-speed-mismatch');
      if (wave.z <= section.gateRow.z) return fail('wave-before-gate');
    }

    // Two streams must never share the same stretch of road: the combat model
    // resolves one stream at a time, so overlapping waves would make the
    // simulation optimistic about what the player actually faces.
    for (let w = 1; w < section.waves.length; w++) {
      const previous = section.waves[w - 1];
      const gap = section.waves[w].z - (previous.z + (previous.footprint || 0));
      if (gap < 0) return fail('waves-overlap');
    }

    // The player must have room to reposition between a gate row and the
    // first wave that follows it.
    const reposition = (section.waves[0].z - section.gateRow.z) / config.squad.forwardSpeed;
    const laneSwitchTime = config.lanes.width / config.lanes.switchSpeed;
    if (reposition < laneSwitchTime * 2.5) return fail('gate-to-wave-too-tight');

    // Tolerance is a micrometre: section bounds are floating-point metres, and
    // a boundary that lands a fraction of an ULP short is adjacent, not
    // overlapping. Without it the validator discards perfectly good stages.
    if (section.startZ < previousEnd - 1e-6) return fail('sections-overlap');
    previousEnd = section.endZ;
  }

  /* --------------------------------------------------------------- boss */
  const boss = level.boss;
  if (!(boss.hp > 0)) return fail('boss-hp-invalid');
  if (!Number.isFinite(boss.hp)) return fail('boss-hp-not-finite');
  if (!(boss.contactLoss >= 1)) return fail('boss-contact-loss-invalid');
  if (!(boss.speed > 0)) return fail('boss-speed-invalid');
  if (boss.escort && (!Number.isInteger(boss.escort.count) || boss.escort.count < 0)) {
    return fail('boss-escort-invalid');
  }
  if (boss.z <= previousEnd - 1) return fail('boss-before-sections');

  /* ------------------------------------------------------- requirements */
  if (!Array.isArray(level.requirements) || level.requirements.length !== level.sections.length + 1) {
    return fail('requirements-missing');
  }
  for (const requirement of level.requirements) {
    if (!Number.isFinite(requirement)) return fail('requirement-not-finite');
    if (requirement < 0) return fail('requirement-negative');
    if (!Number.isInteger(requirement)) return fail('requirement-fractional');
  }

  return { ok: true, reason: 'valid' };
}
