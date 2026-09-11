/**
 * LevelManager.js -- streams a generated stage into the world.
 *
 * The generator produces a stage in stage-local metres; the run is one endless
 * forward corridor, so every stage is placed at an ever-growing world offset
 * and stage transitions need no reset of anything (spec 18, 57).
 *
 * Content is spawned just before the squad can see it and recycled once it is
 * behind them, which keeps the scene graph small no matter how long the run.
 */
import { CONFIG } from '../core/Config.js';
import { BossPhase } from './BossManager.js';

const WAVE_SPAWN_LEAD = 96;      // metres ahead of the squad a wave appears
const GATE_SPAWN_LEAD = 150;     // gates must be readable while still far away

export class LevelManager {
  constructor ({ gates, enemies, boss, lanes, config = CONFIG }) {
    this.gates = gates;
    this.enemies = enemies;
    this.boss = boss;
    this.lanes = lanes;
    this.config = config;

    this.level = null;
    this.stageStartZ = 0;
    this.spawnedGates = new Set();
    this.spawnedWaves = new Set();
    this.bossStarted = false;
    this.stageComplete = false;
  }

  /** Places a freshly generated stage at the squad's current position. */
  load (level, squadZ) {
    this.level = level;
    this.stageStartZ = squadZ;
    this.spawnedGates.clear();
    this.spawnedWaves.clear();
    this.bossStarted = false;
    this.stageComplete = false;
  }

  worldZ (levelZ) { return this.stageStartZ + levelZ; }

  get bossWorldZ () { return this.level ? this.worldZ(this.level.boss.z) : Infinity; }

  progress (squadZ) {
    if (!this.level) return 0;
    return Math.max(0, Math.min(1, (squadZ - this.stageStartZ) / this.level.lengthMeters));
  }

  /** Section the squad is currently inside -- used by the continue system. */
  currentSection (squadZ) {
    if (!this.level) return 0;
    const local = squadZ - this.stageStartZ;
    for (let i = 0; i < this.level.sections.length; i++) {
      if (local < this.level.sections[i].gateRow.z) return i;
    }
    return this.level.sections.length;
  }

  update (dt, squadZ, { squadSize, weapon, dps, onGate, onBossStart }) {
    if (!this.level) return { stageComplete: false };

    // --- gates ---------------------------------------------------------
    for (let i = 0; i < this.level.sections.length; i++) {
      if (this.spawnedGates.has(i)) continue;
      const section = this.level.sections[i];
      const worldZ = this.worldZ(section.gateRow.z);
      if (worldZ - squadZ <= GATE_SPAWN_LEAD) {
        this.gates.spawnRow(section, worldZ);
        this.spawnedGates.add(i);
      }
    }
    this.gates.update(dt, squadZ, onGate);

    // --- waves ---------------------------------------------------------
    for (let i = 0; i < this.level.sections.length; i++) {
      const section = this.level.sections[i];
      for (let w = 0; w < section.waves.length; w++) {
        const key = `${i}:${w}`;
        if (this.spawnedWaves.has(key)) continue;
        const wave = section.waves[w];
        const worldZ = this.worldZ(wave.z);
        if (worldZ - squadZ > WAVE_SPAWN_LEAD) continue;
        wave.lanes.forEach((count, lane) => {
          if (count <= 0) return;
          this.enemies.spawnLane(lane, {
            count,
            hp: wave.hp,
            speed: wave.speed,
            spacing: wave.spacings ? wave.spacings[lane] : wave.spacing,
            squadZ,
            lead: WAVE_SPAWN_LEAD
          });
        });
        this.spawnedWaves.add(key);
      }
    }

    // --- boss ----------------------------------------------------------
    if (!this.bossStarted && this.bossWorldZ - squadZ <= 62) {
      this.bossStarted = true;
      this.boss.start(this.level.boss, squadZ);
      if (onBossStart) onBossStart(this.level.boss);
    }

    if (this.bossStarted && this.boss.phase === BossPhase.DEFEATED && !this.stageComplete) {
      this.stageComplete = true;
    }

    return { stageComplete: this.stageComplete };
  }

  clear () {
    this.gates.clear();
    this.enemies.clear();
    this.boss.clear();
    this.level = null;
  }
}
