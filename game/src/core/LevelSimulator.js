/**
 * LevelSimulator.js -- spec sections 21, 23, 24, 28, 51.
 *
 * Plays a generated level the way a player would: for every meaningful lane
 * choice at every gate row it works out the resulting squad, weapon stats,
 * combat power, kills, losses and boss survival.
 *
 * It calls the very same CombatModel functions the live game uses, with a
 * conservative efficiency factor (<= 1) so the simulator can never claim a
 * level is beatable when real gameplay would be harsher.
 *
 * Path model
 * ----------
 * A "path" is one lane choice per gate row (3^sections paths).  Within a
 * path the wave lane is picked greedily: every lane of a wave shares the same
 * enemy type, so the lane holding the fewest enemies is provably the best
 * choice and a real player can always reach it (the generator enforces enough
 * distance between a gate row and the following wave).
 */
import { CONFIG } from './Config.js';
import { applyGate, GateType } from './GateMath.js';
import {
  resolveWave, resolveBossEncounter, combatPower, minimumSquadForEncounter
} from './CombatModel.js';

export class LevelSimulator {
  constructor (config = CONFIG) {
    this.config = config;
    this.efficiency = config.combat.simulatorEfficiency;
  }

  /** Index of the lane a rational player fights a wave in (fewest enemies). */
  bestWaveLane (wave) {
    let best = 0;
    for (let lane = 1; lane < wave.lanes.length; lane++) {
      if (wave.lanes[lane] < wave.lanes[best]) best = lane;
    }
    return best;
  }

  /**
   * Simulates a single path.
   * @param {object} level
   * @param {{squad:number, weapon:WeaponStats}} entry
   * @param {number[]} laneChoices one lane per section (gate row)
   * @param {object} [options] { fromSection, collectLog }
   */
  simulatePath (level, entry, laneChoices, options = {}) {
    const fromSection = options.fromSection || 0;
    const log = options.collectLog ? [] : null;

    let squad = Math.max(0, Math.floor(entry.squad));
    const weapon = entry.weapon.clone();
    let kills = 0;
    let losses = 0;
    let gained = 0;

    for (let i = fromSection; i < level.sections.length; i++) {
      const section = level.sections[i];
      const lane = laneChoices[i - fromSection];
      const gate = section.gateRow.gates[lane];

      // --- gate -------------------------------------------------------
      const before = squad;
      if (gate.type === GateType.WEAPON) {
        weapon.upgrade(gate.stat);
      } else {
        squad = applyGate(squad, gate);
        if (squad > before) gained += squad - before;
      }
      if (log) {
        log.push({
          kind: 'gate', section: i, lane, gate: { ...gate }, squadBefore: before, squadAfter: squad
        });
      }
      if (squad <= 0) {
        return this._fail(log, i, 'gate', { squad, weapon, kills, losses, gained });
      }

      // --- waves ------------------------------------------------------
      for (let w = 0; w < section.waves.length; w++) {
        const wave = section.waves[w];
        const waveLane = this.bestWaveLane(wave);
        const waveResult = resolveWave({
          squadSize: squad,
          weapon,
          wave: this._waveForModel(wave),
          lane: waveLane,
          efficiency: this.efficiency,
          config: this.config
        });
        kills += waveResult.kills;
        losses += squad - waveResult.squadAfter;
        squad = waveResult.squadAfter;
        if (log) {
          log.push({
            kind: 'wave', section: i, wave: w, lane: waveLane, kills: waveResult.kills,
            leaks: waveResult.leaks, squadAfter: squad
          });
        }
        if (squad <= 0) {
          return this._fail(log, i, 'wave', { squad, weapon, kills, losses, gained });
        }
      }
    }

    // --- boss -----------------------------------------------------------
    const bossResult = resolveBossEncounter({
      squadSize: squad,
      weapon,
      boss: level.boss,
      efficiency: this.efficiency,
      config: this.config
    });
    kills += bossResult.kills;
    losses += squad - bossResult.squadAfter;
    squad = bossResult.squadAfter;
    if (log) {
      log.push({ kind: 'boss', contacts: bossResult.contacts, squadAfter: squad });
    }

    return {
      survived: !bossResult.dead && squad > 0,
      finalSquad: squad,
      weapon,
      power: combatPower(squad, weapon, this.config),
      kills,
      losses,
      gained,
      failedAt: bossResult.dead ? { section: level.sections.length, kind: 'boss' } : null,
      log
    };
  }

  _fail (log, section, kind, state) {
    return {
      survived: false,
      finalSquad: 0,
      weapon: state.weapon,
      power: 0,
      kills: state.kills,
      losses: state.losses,
      gained: state.gained,
      failedAt: { section, kind },
      log
    };
  }

  /** Normalises a stored wave into the shape CombatModel expects. */
  _waveForModel (wave) {
    return {
      lanes: wave.lanes.map((count, lane) => ({
        count,
        hp: wave.hp,
        spacing: wave.spacings ? wave.spacings[lane] : wave.spacing
      })),
      speed: wave.speed,
      spacing: wave.spacing,
      duration: wave.duration
    };
  }

  /**
   * Enumerates every meaningful path through the level.
   * @returns {{totalPaths:number, winningPaths:number, bestPath:number[]|null,
   *            bestFinalSquad:number, firstWinningPath:number[]|null}}
   */
  enumeratePaths (level, entry, options = {}) {
    const fromSection = options.fromSection || 0;
    const depth = level.sections.length - fromSection;
    const laneCount = this.config.lanes.count;
    const totalPaths = Math.pow(laneCount, Math.max(0, depth));
    const stopAtFirstWin = !!options.stopAtFirstWin;

    let winningPaths = 0;
    let bestFinalSquad = -1;
    let bestPath = null;
    let firstWinningPath = null;

    const choices = new Array(Math.max(0, depth)).fill(0);

    const walk = (index) => {
      if (index === depth) {
        const result = this.simulatePath(level, entry, choices, { fromSection });
        if (result.survived) {
          winningPaths++;
          if (!firstWinningPath) firstWinningPath = choices.slice();
          if (result.finalSquad > bestFinalSquad) {
            bestFinalSquad = result.finalSquad;
            bestPath = choices.slice();
          }
        }
        return stopAtFirstWin && winningPaths > 0;
      }
      for (let lane = 0; lane < laneCount; lane++) {
        choices[index] = lane;
        if (walk(index + 1)) return true;
      }
      return false;
    };

    walk(0);

    return {
      totalPaths,
      winningPaths,
      bestPath,
      bestFinalSquad: Math.max(0, bestFinalSquad),
      firstWinningPath
    };
  }

  /** Fast acceptance test: does at least one path survive? */
  hasWinningPath (level, entry, options = {}) {
    return this.enumeratePaths(level, entry, { ...options, stopAtFirstWin: true }).winningPaths > 0;
  }

  /**
   * Minimum entry squad for which at least one path through the remaining
   * level survives.  Backs the CONTINUE system (spec 28) and the generator's
   * backward requirement propagation.
   *
   * Monotonic in squad size, so a binary search is exact.
   */
  minimumEntrySquad (level, entry, options = {}) {
    const upper = options.upperBound || 5000;
    const test = (squad) =>
      this.hasWinningPath(level, { squad, weapon: entry.weapon }, options);
    if (!test(upper)) return null;
    let low = 1;
    let high = upper;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (test(mid)) high = mid; else low = mid + 1;
    }
    return low;
  }

  /** Minimum squad required to clear just the boss encounter. */
  minimumSquadForBoss (level, weapon) {
    return minimumSquadForEncounter({
      weapon, boss: level.boss, efficiency: this.efficiency, config: this.config
    });
  }
}

export const defaultSimulator = new LevelSimulator();
