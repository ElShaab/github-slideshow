/**
 * LevelGenerator.js -- BACKWARD level generation (spec sections 21 and 22).
 *
 * Nothing here is "generate and hope".  Every stage is built so that a
 * designed golden path exists, then the requirement chain is propagated
 * BACKWARDS from the boss to the stage entrance, and finally the candidate is
 * handed to the LevelSimulator + LevelValidator for forward proof.  A
 * candidate that fails any check is rejected and regenerated.
 *
 * Pipeline per candidate
 *   1. difficulty / enemy stats for the stage            (DifficultyManager)
 *   2. golden lane choice + gate values per section
 *   3. forward projection of the golden squad & weapon
 *   4. waves sized so that "difficulty x available power" is required
 *   5. boss sized the same way
 *   6. BACKWARD requirement propagation boss -> entrance
 *   7. decoy gates for the other two lanes (traps are allowed)
 *   8. forward validation: at least one winning path, or reject
 */
import { CONFIG } from './Config.js';
import { Rng } from './Rng.js';
import { GateType, minimumInputFor, applyGate } from './GateMath.js';
import { WEAPON_STATS } from './WeaponStats.js';
import { DifficultyManager } from './DifficultyManager.js';
import { LevelSimulator } from './LevelSimulator.js';
import {
  resolveWave, resolveLaneStream, minimumSquadForEncounter,
  combatPower, squadDps as squadDpsFor
} from './CombatModel.js';
import { validateLevel } from './LevelValidator.js';

export class LevelGenerator {
  constructor (config = CONFIG) {
    this.config = config;
    this.difficulty = new DifficultyManager(config);
    this.simulator = new LevelSimulator(config);
    this.stats = { generated: 0, rejected: 0, accepted: 0, rejectionReasons: {} };
    this.intensityMemory = new Map();
  }

  /**
   * Generates a validated stage.
   * @param {number} stage
   * @param {{squad:number, weapon:WeaponStats}} entry current run state
   * @param {number} [seed]
   * @returns {{level:object, attempts:number, rejected:number}}
   */
  generate (stage, entry, seed = (Math.random() * 0xffffffff) >>> 0) {
    const rng = new Rng(seed);
    let attempts = 0;
    let rejected = 0;
    let lastReason = 'none';
    // Adaptive intensity: candidates that break the difficulty guarantee make
    // the next attempt gentler, candidates that pose no threat make it
    // sharper.  Generation therefore converges instead of spinning.  What was
    // learnt is remembered per stage, so later runs start from a setting that
    // already worked instead of rediscovering it every time.
    // Keyed by stage AND squad scale: what a ten-soldier squad can survive is
    // nothing like what a three-hundred-soldier squad can, so sharing one
    // learned value between them just wastes attempts.
    const memoryKey = `${stage}:${Math.round(Math.log2(Math.max(2, entry.squad)))}`;
    let intensity = this.intensityMemory.get(memoryKey) || 0.85;

    while (attempts < this.config.generation.maxAttempts) {
      attempts++;
      this.stats.generated++;
      const candidate = this._buildCandidate(stage, entry, rng, intensity);
      const verdict = this._validate(candidate, entry);

      if (verdict.ok) {
        this.stats.accepted++;
        this.intensityMemory.set(memoryKey, intensity);
        candidate.validation = verdict.report;
        candidate.seed = seed;
        candidate.attempts = attempts;
        return { level: candidate, attempts, rejected };
      }

      rejected++;
      this.stats.rejected++;
      lastReason = verdict.reason;
      this.stats.rejectionReasons[verdict.reason] =
        (this.stats.rejectionReasons[verdict.reason] || 0) + 1;

      if (verdict.reason === 'stage-poses-no-threat') {
        intensity = Math.min(4, intensity * 1.18);
      } else {
        // Every other rejection means the candidate asked too much of the
        // player (or collapsed the golden path entirely), so ease off.
        intensity = Math.max(0.06, intensity * 0.82);
      }
    }

    // Guaranteed fallback: a minimal, provably survivable stage.  Reaching
    // this branch means the tuning is off; it must never produce an unfair
    // level, so it is validated too and throws if it somehow fails.
    const fallback = this._buildFallback(stage, entry);
    const verdict = this._validate(fallback, entry, { lenient: true });
    if (!verdict.ok) {
      throw new Error(`LevelGenerator: fallback stage invalid (${verdict.reason}, last: ${lastReason})`);
    }
    fallback.validation = verdict.report;
    fallback.seed = seed;
    fallback.attempts = attempts;
    fallback.fallback = true;
    this.stats.accepted++;
    return { level: fallback, attempts, rejected };
  }

  /* ------------------------------------------------------------------ build */

  _buildCandidate (stage, entry, rng, intensity) {
    const cfg = this.config;
    const gen = cfg.generation;
    const difficulty = this.difficulty.difficultyFor(stage);
    const enemySpeed = this.difficulty.enemySpeed(stage);
    const enemyHp = this.difficulty.enemyHp(stage);
    // How much of a full-strength squad each fight is designed to cost.
    const lossFraction = Math.min(0.6,
      this.difficulty.fightLossFractionFor(stage) * intensity);

    const sectionCount = rng.int(gen.sectionsMin, gen.sectionsMax);
    const targetSeconds = rng.range(
      Math.max(gen.minStageSeconds + 8, gen.targetStageSeconds - 22),
      Math.min(gen.maxStageSeconds - 8, gen.targetStageSeconds + 28)
    );
    const totalLength = targetSeconds * cfg.squad.forwardSpeed;
    const bossRunIn = 120;
    const sectionLength = (totalLength - bossRunIn) / sectionCount;

    const level = {
      stage,
      difficulty,
      lossFraction,
      enemySpeed,
      enemyHp,
      enemySpeedMultiplier: this.difficulty.enemySpeedMultiplier(stage),
      sections: [],
      boss: null,
      lengthMeters: totalLength,
      estimatedSeconds: totalLength / cfg.squad.forwardSpeed,
      entrySquad: entry.squad,
      entryWeaponLevels: entry.weapon.toJSON(),
      goldenPath: [],
      requirements: []
    };

    // Golden-path projection state.
    let squad = Math.max(1, Math.floor(entry.squad));
    const weapon = entry.weapon.clone();
    let weaponGateGiven = false;

    for (let i = 0; i < sectionCount; i++) {
      const startZ = i * sectionLength;
      const gateZ = startZ + sectionLength * 0.28;
      const waveZ = gateZ + Math.max(gen.gateRowSpacing, sectionLength * 0.34);
      const isMajor = i === sectionCount - 1;
      const goldenLane = rng.int(0, cfg.lanes.count - 1);

      // ---- golden gate ------------------------------------------------
      // Every stage offers the player at least one weapon upgrade on the
      // strong lane; further ones appear at random.
      const lastChance = i === sectionCount - 2;
      const wantsWeapon = (!weaponGateGiven && lastChance) ||
        (!weaponGateGiven && rng.chance(gen.weaponGateChance) && i < sectionCount - 1);
      const goldenGate = wantsWeapon && !isMajor
        ? this._weaponGate(rng)
        : this._goodGate(rng, squad, isMajor);
      if (goldenGate.type === GateType.WEAPON) weaponGateGiven = true;

      const gates = new Array(cfg.lanes.count);
      gates[goldenLane] = goldenGate;
      for (let lane = 0; lane < cfg.lanes.count; lane++) {
        if (lane === goldenLane) continue;
        gates[lane] = this._decoyGate(rng, squad, goldenGate, isMajor);
      }

      // Apply the golden gate to the projected state.
      const squadBeforeGate = squad;
      const weaponSnapshot = weapon.clone();
      if (goldenGate.type === GateType.WEAPON) {
        weapon.upgrade(goldenGate.stat);
      } else {
        squad = applyGate(squad, goldenGate);
      }

      // ---- waves sized by the soldiers they should cost -------------------
      // Enemy COUNT is the spectacle; enemy TOUGHNESS is solved for so a wave
      // takes the designed number of soldiers from a squad at full strength.
      // Sizing a fight by "minimum squad that survives" does not work: one
      // enemy contact costs exactly one soldier, so that number can never
      // exceed the enemy count no matter how tough the enemies are.
      //
      // A section carries two or three waves so the run keeps biting between
      // decisions, while the number of DECISIONS (gate rows) stays small
      // enough for the simulator to enumerate every path exhaustively.
      const laneCount = cfg.lanes.count;
      const laneIndices = Array.from({ length: laneCount }, (_, index) => index);
      const maxWaves = rng.int(gen.wavesPerSectionMin, gen.wavesPerSectionMax);
      const waves = [];
      // Waves are laid out by the ground they actually occupy.  A stream of
      // 100 runners is over 200 metres long, so spacing waves evenly across
      // the section would let them overlap -- and a squad fighting two waves
      // at once is a fight the simulator never modelled.
      const tailZ = startZ + sectionLength - gen.sectionTailMargin;
      let cursor = waveZ;

      for (let w = 0; w < maxWaves; w++) {
        if (w > 0 && cursor > tailZ) break;
        const isFinalWave = isMajor && w === maxWaves - 1;
        const occupancy = isFinalWave ? laneCount : this._laneOccupancy(rng, i, sectionCount, w);
        // A three-lane wave is an unavoidable damage check.  A wave that
        // leaves a lane open is a positioning puzzle: taking an occupied lane
        // must hurt without ending the run on its own.
        const laneLoss = occupancy >= laneCount
          ? lossFraction
          : lossFraction * cfg.difficulty.partialWaveLossMultiplier;
        const desiredLoss = Math.max(1, Math.round(laneLoss * squad));
        const engagedCount = this._waveCountFor(rng, desiredLoss, squad);
        // The on-screen enemy cap can stop a wave from reaching its designed
        // cost.  Trim the target instead of pushing enemy toughness through
        // the roof: a wave that leaks every single enemy is not a fight, it is
        // a punishment, and it would kill the kill-feedback the player reads.
        const targetLoss = Math.min(desiredLoss,
          Math.max(1, Math.floor(engagedCount / gen.waveCountMargin[0])));
        const waveHp = this._sizeHpForLoss({
          fullSquad: squad, targetLoss, count: engagedCount, weapon, enemySpeed,
          spacing: cfg.enemies.spacing, baseHp: enemyHp
        });

        // Every occupied lane runs the same LENGTH of enemies; the heavier
        // lanes simply pack more of them into it.  Density is therefore the
        // visible tell, so choosing the lighter lane is a decision the player
        // can read from the road ahead rather than a hidden coin flip.
        const lanes = new Array(laneCount).fill(0);
        const spacings = new Array(laneCount).fill(cfg.enemies.spacing);
        const occupiedLanes = rng.shuffle(laneIndices).slice(0, occupancy);
        const engagedLane = occupiedLanes[0];
        const streamLength = engagedCount * cfg.enemies.spacing;
        for (const lane of occupiedLanes) {
          const count = lane === engagedLane
            ? engagedCount
            : Math.min(gen.waveCountMax, Math.round(engagedCount * rng.range(1.15, 1.5)) + 1);
          lanes[lane] = count;
          spacings[lane] = Math.max(gen.minEnemySpacing, streamLength / count);
        }

        // Ground the squad covers while the whole stream runs past it.
        const closing = cfg.squad.forwardSpeed + enemySpeed;
        const footprint = (streamLength * cfg.squad.forwardSpeed) / closing;

        const wave = {
          z: cursor,
          lanes,
          spacings,
          hp: waveHp,
          speed: enemySpeed,
          spacing: cfg.enemies.spacing,
          occupancy,
          footprint,
          duration: streamLength / closing
        };
        waves.push(wave);
        cursor += footprint + gen.waveGapMeters;

        // Resolve the golden path through this wave to keep the projection of
        // the squad honest for the waves and the boss that follow.
        const waveResult = resolveWave({
          squadSize: squad,
          weapon,
          wave: {
            lanes: lanes.map((c, laneIndex) => ({ count: c, hp: waveHp, spacing: spacings[laneIndex] })),
            speed: enemySpeed,
            spacing: wave.spacing
          },
          lane: this.simulator.bestWaveLane({ lanes }),
          efficiency: this.simulator.efficiency,
          config: cfg
        });
        squad = waveResult.squadAfter;
        if (squad <= 0) break;
      }

      level.sections.push({
        index: i,
        startZ,
        endZ: startZ + sectionLength,
        isMajor,
        gateRow: { z: gateZ, gates },
        waves,
        goldenLane,
        projectedSquad: squad,
        projectedWeapon: weaponSnapshot.toJSON(),
        squadBeforeGate
      });
      level.goldenPath.push(goldenLane);

      if (squad <= 0) break; // candidate will be rejected by validation
    }

    // ---- boss, sized from the power available at the end of the stage ----
    level.boss = this._buildBoss({
      stage, rng, weapon, squad, lossFraction, enemyHp, enemySpeed,
      z: level.sections.length ? level.sections[level.sections.length - 1].endZ + bossRunIn * 0.5 : 200
    });
    level.projectedFinalSquad = squad;
    level.projectedFinalWeapon = weapon.toJSON();
    level.maxPowerAtBoss = combatPower(squad, weapon, cfg);

    // ---- BACKWARD requirement propagation --------------------------------
    level.requirements = this._propagateRequirements(level, entry);
    level.requiredEntrySquad = level.requirements.length ? level.requirements[0] : 1;

    return level;
  }

  /**
   * Walks the stage from the boss back to the entrance working out the
   * smallest squad that still leaves the golden path viable at every point.
   */
  _propagateRequirements (level, entry) {
    const requirements = new Array(level.sections.length + 1).fill(1);
    const weapons = this._goldenWeapons(level, entry);

    // Requirement to clear the boss.
    let required = minimumSquadForEncounter({
      weapon: weapons[level.sections.length],
      boss: level.boss,
      efficiency: this.simulator.efficiency,
      config: this.config
    });
    if (required === null) required = Infinity;
    requirements[level.sections.length] = required;

    for (let i = level.sections.length - 1; i >= 0; i--) {
      const section = level.sections[i];
      const weapon = weapons[i + 1]; // weapon in effect after this section's gate

      // Walk this section's waves backwards: each one must leave enough
      // soldiers alive for the one behind it.
      for (let w = section.waves.length - 1; w >= 0; w--) {
        const wave = section.waves[w];
        const lane = this.simulator.bestWaveLane(wave);
        const count = wave.lanes[lane];
        required = count > 0
          ? this._minSquadLeaving({
            required, weapon, hp: wave.hp, count, speed: wave.speed,
            spacing: wave.spacings ? wave.spacings[lane] : wave.spacing
          })
          : required;
      }

      // Invert the golden gate to get the requirement before the gate row.
      const gate = section.gateRow.gates[section.goldenLane];
      const beforeGate = minimumInputFor(required, gate);
      required = beforeGate === null ? Infinity : Math.max(1, beforeGate);
      requirements[i] = required;
    }
    return requirements;
  }

  /** Golden-path weapon snapshots: index i = weapon after i gates. */
  _goldenWeapons (level, entry) {
    const weapons = [entry.weapon.clone()];
    for (let i = 0; i < level.sections.length; i++) {
      const next = weapons[i].clone();
      const gate = level.sections[i].gateRow.gates[level.sections[i].goldenLane];
      if (gate.type === GateType.WEAPON) next.upgrade(gate.stat);
      weapons.push(next);
    }
    return weapons;
  }

  /** Smallest squad entering a stream that leaves at least `required` alive. */
  _minSquadLeaving ({ required, weapon, hp, count, speed, spacing }) {
    const test = (size) => {
      const r = resolveLaneStream({
        squadSize: size, weapon, enemyHp: hp, enemyCount: count,
        enemySpeed: speed, spacing, efficiency: this.simulator.efficiency, config: this.config
      });
      return !r.dead && r.squadAfter >= required;
    };
    let high = Math.max(4, required);
    let guard = 0;
    while (!test(high) && guard++ < 24) high *= 2;
    if (!test(high)) return Infinity;
    let low = 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (test(mid)) high = mid; else low = mid + 1;
    }
    return low;
  }

  /**
   * Enemies in the engaged lane.
   *
   * The count tracks the SQUAD, not the damage the wave is meant to do: a
   * wall of runners is what the genre is about, and it is also what makes the
   * fight graded rather than binary.  With far more enemies than the wave is
   * designed to cost, a strong squad mows most of them down while a weakened
   * one is overrun -- whereas a handful of very tough enemies would either
   * all die or all get through.  The ceiling keeps the scene readable and the
   * draw call cheap.
   */
  _waveCountFor (rng, targetLoss, squad) {
    const gen = this.config.generation;
    const fromLoss = targetLoss * rng.range(gen.waveCountMargin[0], gen.waveCountMargin[1]);
    const fromSquad = Math.max(1, squad) * rng.range(gen.waveCountPerSoldier[0], gen.waveCountPerSoldier[1]);
    return Math.max(gen.waveCountMin,
      Math.min(gen.waveCountMax, Math.round(Math.max(fromLoss, fromSquad))));
  }

  /**
   * Solves for the enemy toughness that costs a full-strength squad exactly
   * `targetLoss` soldiers.  Leaks grow monotonically with enemy hit points,
   * so a bisection is exact.
   */
  _sizeHpForLoss ({ fullSquad, targetLoss, count, weapon, enemySpeed, spacing, baseHp }) {
    const lossFor = (hp) => {
      const result = resolveLaneStream({
        squadSize: fullSquad, weapon, enemyHp: hp, enemyCount: count,
        enemySpeed, spacing, efficiency: this.simulator.efficiency, config: this.config
      });
      return result.leaks;
    };

    let low = Math.max(0.5, baseHp * 0.05);
    let high = Math.max(low * 2, baseHp * 120);
    if (lossFor(low) > targetLoss) return low;
    if (lossFor(high) <= targetLoss) return high;
    for (let iteration = 0; iteration < 34 && high - low > 0.01; iteration++) {
      const mid = (low + high) / 2;
      if (lossFor(mid) <= targetLoss) low = mid; else high = mid;
    }
    return Math.max(0.5, Number(low.toFixed(3)));
  }

  /**
   * Bosses are designed by the damage they do, not by a raw hit-point number:
   * the encounter is sized to cost a full-strength squad a set share of its
   * soldiers, which keeps every archetype dangerous at any squad size while
   * staying mathematically beatable.
   */
  _buildBoss ({ stage, rng, weapon, squad, lossFraction, enemyHp, enemySpeed, z }) {
    const cfg = this.config;
    const gen = cfg.generation;
    const type = this.difficulty.bossTypeFor(stage);
    const template = cfg.bosses.types[type];
    const safeSquad = Math.max(1, squad);
    const bossLoss = Math.min(0.8, lossFraction * cfg.difficulty.bossLossMultiplier);
    const totalTargetLoss = Math.max(1, Math.round(bossLoss * safeSquad));

    // Split the loss budget between the escort stream and the boss itself.
    const escortShareOfLoss = template.escort ? Math.min(0.75, 0.45 * template.escort) : 0;
    const escortLoss = Math.round(totalTargetLoss * escortShareOfLoss);
    const coreLoss = Math.max(1, totalTargetLoss - escortLoss);

    const boss = {
      z,
      type,
      speed: template.speed * this.difficulty.enemySpeedMultiplier(stage),
      // A boss must stay dangerous to a squad of any size, so the soldiers it
      // takes per contact scale with the squad it was designed against.
      contactLoss: Math.max(template.contactLoss,
        Math.round(safeSquad * template.contactLossFraction)),
      scale: template.scale,
      escort: null,
      hp: 1
    };

    let appliedEscortLoss = 0;
    if (escortLoss > 0) {
      const count = Math.max(gen.waveCountMin, Math.min(gen.escortCountMax,
        Math.round(escortLoss * gen.escortShare)));
      appliedEscortLoss = Math.min(escortLoss,
        Math.max(1, Math.floor(count / gen.waveCountMargin[0])));
      boss.escort = {
        count,
        hp: enemyHp,
        speed: enemySpeed,
        spacing: cfg.enemies.spacing * 0.85
      };
      boss.escort.hp = this._sizeHpForLoss({
        fullSquad: safeSquad, targetLoss: appliedEscortLoss, count, weapon,
        enemySpeed: boss.escort.speed, spacing: boss.escort.spacing, baseHp: enemyHp
      });
    }

    // Squad strength once the escort has been dealt with.
    const squadAtCore = Math.max(1, safeSquad - appliedEscortLoss);
    // The boss should land `contacts` hits before dying, each costing
    // contactLoss soldiers.  Hit points follow directly from the squad's
    // damage output over that many approach cycles.
    const contacts = Math.max(1, Math.round(coreLoss / boss.contactLoss));
    const closing = cfg.squad.forwardSpeed + boss.speed;
    const cycleTime = Math.min(cfg.bosses.approachDistance, weapon.range) / closing;
    const dps = squadDpsFor(squadAtCore, weapon, cfg) * this.simulator.efficiency;
    const cappedContacts = Math.min(contacts, Math.ceil(cfg.bosses.maxFightSeconds / cycleTime));
    boss.hp = Math.max(1, Math.round(dps * cycleTime * (cappedContacts + 0.5) * template.hpFactor));

    // Safety net: never ship a boss the designed squad cannot actually kill.
    const ceiling = Math.round(dps * cfg.bosses.maxFightSeconds);
    boss.hp = Math.min(boss.hp, Math.max(1, ceiling));
    return boss;
  }

  _bossHpCeiling (weapon, squad) {
    // Damage a full-strength squad could deal across a generous encounter.
    const dps = Math.max(1, squad) * weapon.fireRate * weapon.damage * weapon.bullets * weapon.area;
    return Math.max(1000, dps * 120);
  }

  /* ------------------------------------------------------------------ gates */

  /**
   * The strong lane.  Gates aim at a designed per-section growth factor, and
   * multiply gates are withdrawn as the squad grows so a long run settles into
   * a readable range instead of inflating without bound.
   */
  _goodGate (rng, squad, isMajor) {
    const gen = this.config.generation;
    const growth = isMajor ? rng.range(1.45, 2.1) : rng.range(1.22, 1.6);
    const target = Math.max(squad + 4, Math.round(squad * growth));

    const factor = Math.round(target / Math.max(1, squad));
    const ceiling = gen.multiplyCeiling[factor];
    const multiplyFits = factor >= 2 &&
      gen.multiplyOptions.includes(factor) &&
      ceiling !== undefined && squad <= ceiling;

    if (multiplyFits && rng.chance(0.55)) {
      return { type: GateType.MULTIPLY, value: factor };
    }
    // Plus gates stay in a readable band and scale only gently with the squad.
    const span = gen.plusRange[1] + Math.round(squad * gen.plusScale);
    const value = Math.max(gen.plusRange[0], Math.min(span, target - squad));
    return { type: GateType.PLUS, value: Math.max(1, Math.round(value)) };
  }

  _weaponGate (rng) {
    const stat = rng.pick(WEAPON_STATS);
    return { type: GateType.WEAPON, stat };
  }

  /**
   * A decoy lane.  Some decoys are traps, some are merely worse, and a few are
   * genuinely competitive -- the three lanes must never be mathematically
   * equal (spec section 8).
   */
  _decoyGate (rng, squad, goldenGate, isMajor) {
    const gen = this.config.generation;
    const roll = rng.next();

    if (roll < gen.trapLaneChance * 0.45) {
      return { type: GateType.DIVIDE, value: rng.pick(gen.divideOptions) };
    }
    if (roll < gen.trapLaneChance) {
      return {
        type: GateType.MINUS,
        value: Math.max(gen.minusRange[0], Math.min(gen.minusRange[1] + Math.round(squad * 0.2),
          rng.int(2, Math.max(4, Math.round(squad * 0.35)))))
      };
    }
    if (roll < gen.trapLaneChance + 0.22) {
      // A genuine alternative: firepower instead of bodies.
      return this._weaponGate(rng);
    }
    if (roll < gen.trapLaneChance + 0.32 && !isMajor && squad <= gen.multiplyCeiling[2]) {
      return { type: GateType.MULTIPLY, value: 2 };
    }
    const small = Math.max(2, Math.round(squad * rng.range(0.05, 0.22)));
    return { type: GateType.PLUS, value: Math.min(gen.plusRange[1], small) };
  }

  /**
   * How many lanes a wave blocks.  The last wave before the boss is always
   * unavoidable; the rest mix one-, two- and three-lane patterns so lane
   * positioning keeps mattering (spec 10).
   */
  _laneOccupancy (rng, index, sectionCount, waveIndex = 0) {
    const laneCount = this.config.lanes.count;
    if (index === sectionCount - 1 && waveIndex > 0) return laneCount;
    const roll = rng.next();
    if (roll < 0.18) return 1;
    if (roll < 0.48) return Math.min(2, laneCount);
    return laneCount;
  }

  /* -------------------------------------------------------------- fallback */

  _buildFallback (stage, entry) {
    const cfg = this.config;
    const enemySpeed = this.difficulty.enemySpeed(stage);
    const enemyHp = this.difficulty.enemyHp(stage);
    const bossRunIn = 120;
    const sectionCount = 4;
    const totalLength = cfg.generation.targetStageSeconds * cfg.squad.forwardSpeed;
    const sectionLength = (totalLength - bossRunIn) / sectionCount;
    const squad = Math.max(1, Math.floor(entry.squad));
    const weapon = entry.weapon.clone();

    const sections = [0, 1, 2, 3].map((i) => {
      const startZ = i * sectionLength;
      const count = 14;
      const hp = this._sizeHpForLoss({
        fullSquad: squad, targetLoss: Math.max(1, Math.round(squad * 0.06)),
        count, weapon, enemySpeed, spacing: cfg.enemies.spacing, baseHp: enemyHp
      });
      return {
        index: i,
        startZ,
        endZ: startZ + sectionLength,
        isMajor: i === 3,
        gateRow: {
          z: startZ + sectionLength * 0.28,
          gates: [
            { type: GateType.PLUS, value: 12 },
            { type: GateType.MULTIPLY, value: 2 },
            { type: GateType.MINUS, value: 3 }
          ]
        },
        waves: [{
          z: startZ + sectionLength * 0.62,
          lanes: [count, count, count],
          spacings: [cfg.enemies.spacing, cfg.enemies.spacing, cfg.enemies.spacing],
          hp,
          speed: enemySpeed,
          spacing: cfg.enemies.spacing,
          occupancy: 3,
          duration: (count * cfg.enemies.spacing) / (cfg.squad.forwardSpeed + enemySpeed)
        }],
        goldenLane: 1,
        projectedSquad: squad,
        projectedWeapon: weapon.toJSON(),
        squadBeforeGate: squad
      };
    });

    const level = {
      stage,
      difficulty: this.difficulty.difficultyFor(stage),
      lossFraction: 0.06,
      enemySpeed,
      enemyHp,
      enemySpeedMultiplier: this.difficulty.enemySpeedMultiplier(stage),
      sections,
      boss: null,
      lengthMeters: totalLength,
      estimatedSeconds: totalLength / cfg.squad.forwardSpeed,
      entrySquad: entry.squad,
      entryWeaponLevels: entry.weapon.toJSON(),
      goldenPath: [1, 1, 1, 1],
      requirements: []
    };

    // Placeholder so the projection pass can run before the real boss exists.
    level.boss = { z: 0, type: 'GIANT', hp: 1, speed: 1, contactLoss: 1, scale: 1, escort: null };
    const projected = this.simulator.simulatePath(level, entry, level.goldenPath);
    level.boss = this._buildBoss({
      stage,
      rng: new Rng(stage * 7919 + 13),
      weapon,
      squad: Math.max(2, projected.finalSquad || squad),
      lossFraction: 0.06,
      enemyHp,
      enemySpeed,
      z: sections[sections.length - 1].endZ + bossRunIn * 0.5
    });
    level.requirements = this._propagateRequirements(level, entry);
    level.requiredEntrySquad = level.requirements[0];
    level.maxPowerAtBoss = combatPower(Math.max(1, projected.finalSquad), weapon, cfg);
    return level;
  }

  /* ------------------------------------------------------------- validation */

  _validate (level, entry, options = {}) {
    const structural = validateLevel(level, this.config);
    if (!structural.ok) return { ok: false, reason: structural.reason };

    if (!Number.isFinite(level.requiredEntrySquad)) {
      return { ok: false, reason: 'unreachable-requirement' };
    }
    if (level.requiredEntrySquad > entry.squad) {
      return { ok: false, reason: 'entry-squad-too-small' };
    }
    // Spec 19: a player entering with only `difficulty` of their squad must
    // still have a mathematically viable route through the stage.
    // Requirements are whole soldiers, so the bound carries one soldier of
    // slack: without it a squad of two could never satisfy "70% of two", and
    // a player who continues with a handful of units would be handed stages
    // the generator then refuses to accept.
    const allowedEntryRequirement = Math.max(1,
      (level.difficulty + this.config.difficulty.entryRequirementTolerance) * entry.squad) + 1;
    if (!options.lenient && level.requiredEntrySquad > allowedEntryRequirement) {
      return { ok: false, reason: 'stage-harder-than-difficulty-target' };
    }
    level.entryRequirementRatio = level.requiredEntrySquad / Math.max(1, entry.squad);
    // A stage that cannot threaten the player at all is rejected too: the
    // guarantee is "always beatable", not "always trivial".
    if (!options.lenient &&
        level.entryRequirementRatio < this.config.difficulty.minEntryRequirementRatio) {
      return { ok: false, reason: 'stage-poses-no-threat' };
    }

    const paths = this.simulator.enumeratePaths(level, entry);
    if (paths.winningPaths < 1) return { ok: false, reason: 'no-winning-path' };

    return {
      ok: true,
      report: {
        winningPaths: paths.winningPaths,
        totalPaths: paths.totalPaths,
        bestPath: paths.bestPath,
        bestFinalSquad: paths.bestFinalSquad,
        requiredEntrySquad: level.requiredEntrySquad,
        entryRequirementRatio: level.entryRequirementRatio,
        maxPowerAtBoss: level.maxPowerAtBoss,
        difficulty: level.difficulty
      }
    };
  }

  resetStats () {
    this.stats = { generated: 0, rejected: 0, accepted: 0, rejectionReasons: {} };
  }
}
