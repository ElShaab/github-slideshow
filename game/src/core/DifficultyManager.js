/**
 * DifficultyManager.js -- spec sections 19 and 20.
 *
 * `difficulty` is an INTERNAL number and is never shown to the player.
 * It means: "roughly this fraction of the maximum power the player could
 * reasonably reach in the stage is required to survive it".
 *
 *   Stage 1..9 : 0.70, 0.73, ... 0.94
 *   Stage 10+  : capped at 0.95
 *
 * From stage 11 onwards combat difficulty stays at the cap and only enemy
 * MOVEMENT SPEED grows, alternating +1% / +7% relative to the previous stage.
 */
import { CONFIG } from './Config.js';

export class DifficultyManager {
  constructor (config = CONFIG) {
    this.config = config;
  }

  /** Internal combat-difficulty target for a stage (0..0.95). */
  difficultyFor (stage) {
    const { base, stepPerStage, max } = this.config.difficulty;
    const raw = base + stepPerStage * (Math.max(1, stage) - 1);
    return Math.min(max, Number(raw.toFixed(6)));
  }

  /**
   * Fraction of a full-strength squad a single fight is designed to cost.
   * Scales from `fightLossBase` at stage 1 to `fightLossAtCap` once the stage
   * difficulty reaches its cap.
   */
  fightLossFractionFor (stage) {
    const d = this.config.difficulty;
    const span = Math.max(1e-6, d.max - d.base);
    const t = Math.min(1, Math.max(0, (this.difficultyFor(stage) - d.base) / span));
    return d.fightLossBase + (d.fightLossAtCap - d.fightLossBase) * t;
  }

  /**
   * Cumulative enemy-speed multiplier for a stage.
   * Stages 1..10 => 1.0.  Stage 11 => x1.01, stage 12 => x1.01x1.07, ...
   */
  enemySpeedMultiplier (stage) {
    const { speedRampStartStage, speedStepOdd, speedStepEven } = this.config.enemies;
    let multiplier = 1;
    for (let s = speedRampStartStage; s <= stage; s++) {
      const isOddStep = (s - speedRampStartStage) % 2 === 0; // 11,13,15... => +1%
      multiplier *= 1 + (isOddStep ? speedStepOdd : speedStepEven);
    }
    return multiplier;
  }

  /** Per-stage step applied on top of the previous stage (1.01 or 1.07 or 1). */
  enemySpeedStep (stage) {
    const { speedRampStartStage, speedStepOdd, speedStepEven } = this.config.enemies;
    if (stage < speedRampStartStage) return 1;
    const isOddStep = (stage - speedRampStartStage) % 2 === 0;
    return 1 + (isOddStep ? speedStepOdd : speedStepEven);
  }

  /** Absolute enemy speed in metres/second for a stage. */
  enemySpeed (stage) {
    return this.config.enemies.baseSpeed * this.enemySpeedMultiplier(stage);
  }

  /** Enemy hit points for a stage. */
  enemyHp (stage) {
    const growth = 1 + this.config.enemies.hpGrowthPerStage * (Math.max(1, stage) - 1);
    return this.config.enemies.baseHp * growth;
  }

  /** Boss archetype for a stage, cycling through the configured order. */
  bossTypeFor (stage) {
    const order = this.config.bosses.order;
    return order[(Math.max(1, stage) - 1) % order.length];
  }
}

export const defaultDifficulty = new DifficultyManager();
