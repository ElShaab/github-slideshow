/**
 * CombatModel.js -- THE single source of combat truth.
 *
 * Both the real-time gameplay (WeaponSystem / EnemySpawner) and the offline
 * LevelSimulator call into this module.  There is deliberately no second
 * implementation of the combat maths anywhere in the project (spec 51).
 *
 * How combat works
 * ----------------
 * Soldiers engage only the enemies in the lane the squad currently occupies.
 * Enemies in other lanes run straight past -- that is what makes lane choice
 * a real decision.
 *
 * Firepower is modelled as a damage-per-second pool that is applied to the
 * front-most living enemy of the engaged lane; surplus damage carries over to
 * the enemy behind it.  Projectiles on screen are the visualisation of that
 * pool, not an independent hit-registration system, which is precisely why
 * the simulator can never disagree with what the player sees.
 *
 * An enemy that reaches the squad is removed and costs exactly one soldier
 * (spec 12); any partial damage already dealt to it is lost.
 */
import { CONFIG } from './Config.js';

/**
 * Effective firing soldiers.  Linear up to a soft cap, then sub-linear so that
 * gigantic squads stay strong without trivialising later stages.
 * Setting softCapExponent to 1 reproduces the literal spec formula.
 */
export function effectiveSoldiers (squadSize, config = CONFIG) {
  const { softCapSoldiers: cap, softCapExponent: exp } = config.combat;
  if (squadSize <= cap) return squadSize;
  return cap + Math.pow(squadSize - cap, exp);
}

/**
 * Damage per second produced by a squad.
 * dps = effectiveSoldiers * fireRate * damage * bullets * area
 */
export function squadDps (squadSize, weapon, config = CONFIG) {
  if (squadSize <= 0) return 0;
  return effectiveSoldiers(squadSize, config) *
    weapon.fireRate * weapon.damage * weapon.bullets * weapon.area;
}

/**
 * Head-line combat power (spec 16):
 *   SquadPower = SquadSize x DamageF x FireRateF x RangeF x BulletF x AreaF
 * Range participates here even though it does not raise dps directly -- in the
 * engagement model a longer range buys more seconds of fire per enemy.
 */
export function combatPower (squadSize, weapon, config = CONFIG) {
  if (squadSize <= 0) return 0;
  return effectiveSoldiers(squadSize, config) *
    weapon.factor('damage') * weapon.factor('fireRate') * weapon.factor('range') *
    weapon.factor('bullets') * weapon.factor('area') * config.combat.powerScale;
}

/** Closing speed between the forward-running squad and an incoming enemy. */
export function closingSpeed (enemySpeed, config = CONFIG) {
  return config.squad.forwardSpeed + enemySpeed;
}

/** Seconds an enemy spends inside weapon range before it touches the squad. */
export function engagementTime (weapon, enemySpeed, config = CONFIG) {
  return weapon.range / closingSpeed(enemySpeed, config);
}

/**
 * Resolves one lane of a running enemy stream against the squad.
 *
 * @param {object} params
 * @param {number} params.squadSize    soldiers entering the engagement
 * @param {WeaponStats} params.weapon
 * @param {number} params.enemyHp      hit points of a single enemy
 * @param {number} params.enemyCount   enemies in this lane
 * @param {number} params.enemySpeed   metres/second
 * @param {number} [params.spacing]    metres between enemies in the stream
 * @param {number} [params.efficiency] 1 for gameplay, <1 for the conservative simulator
 * @returns {{squadAfter:number, kills:number, leaks:number, duration:number, dead:boolean}}
 */
export function resolveLaneStream (params) {
  const config = params.config || CONFIG;
  const {
    squadSize, weapon, enemyHp, enemyCount, enemySpeed,
    spacing = config.enemies.spacing,
    efficiency = 1
  } = params;

  if (enemyCount <= 0 || enemyHp <= 0) {
    return { squadAfter: squadSize, kills: 0, leaks: 0, duration: 0, dead: squadSize <= 0 };
  }

  const closing = closingSpeed(enemySpeed, config);
  const arrivalGap = spacing / closing;            // seconds between two enemies entering range
  const timeUnderFire = engagementTime(weapon, enemySpeed, config);
  const contactLoss = config.combat.enemyContactSoldierLoss;

  let squad = Math.max(0, Math.floor(squadSize));
  let pool = 0;          // damage accumulated against the front-most enemy
  let head = 0;          // index of the front-most enemy still alive
  let kills = 0;
  let leaks = 0;
  let lastTime = 0;

  for (let i = 0; i < enemyCount; i++) {
    const contactTime = i * arrivalGap + timeUnderFire;
    pool += squadDps(squad, weapon, config) * efficiency * (contactTime - lastTime);
    lastTime = contactTime;

    // Spend the damage pool front-to-back; surplus carries over to the next enemy.
    while (head <= i && pool >= enemyHp) {
      pool -= enemyHp;
      head++;
      kills++;
    }

    if (head <= i) {
      // Enemy i survived long enough to touch the squad.
      leaks++;
      squad = Math.max(0, squad - contactLoss);
      head = i + 1;
      pool = 0;                       // damage invested in that enemy is lost
      if (squad === 0) {
        return {
          squadAfter: 0, kills, leaks, dead: true,
          duration: contactTime + (enemyCount - i - 1) * arrivalGap
        };
      }
    }
  }

  return {
    squadAfter: squad,
    kills,
    leaks,
    dead: squad <= 0,
    duration: lastTime
  };
}

/**
 * Resolves a whole wave: the squad only fights the lane it stands in.
 * @param {object} params - as resolveLaneStream, plus `wave` and `lane`.
 */
export function resolveWave (params) {
  const { wave, lane } = params;
  const laneData = wave.lanes[lane];
  if (!laneData || laneData.count <= 0) {
    // Lane is clear: the squad runs through untouched.
    return {
      squadAfter: params.squadSize, kills: 0, leaks: 0, dead: params.squadSize <= 0,
      duration: wave.duration || 0, dodged: true
    };
  }
  const result = resolveLaneStream({
    ...params,
    enemyHp: laneData.hp,
    enemyCount: laneData.count,
    enemySpeed: wave.speed,
    // Per-lane spacing: every lane of a wave is the same LENGTH of running
    // enemies, so a lane holding more of them is visibly denser.  That is
    // what makes "take the lighter lane" a decision the player can actually
    // see and make, instead of a hidden coin flip.
    spacing: laneData.spacing !== undefined ? laneData.spacing : wave.spacing
  });
  return { ...result, dodged: false };
}

/**
 * Resolves a boss encounter.  The boss advances, the squad shoots; on contact
 * it removes `contactLoss` soldiers and falls back to re-approach.
 *
 * @returns {{squadAfter:number, dead:boolean, contacts:number, duration:number}}
 */
export function resolveBoss (params) {
  const config = params.config || CONFIG;
  const { squadSize, weapon, boss, efficiency = 1 } = params;

  let squad = Math.max(0, Math.floor(squadSize));
  let hp = boss.hp;
  let contacts = 0;
  let duration = 0;

  const closing = closingSpeed(boss.speed, config);
  // The boss is engaged from the moment it enters weapon range.
  const approach = Math.min(config.bosses.approachDistance, weapon.range);
  const cycleTime = approach / closing;
  const maxCycles = 4000; // safety valve; a boss this tanky is rejected anyway

  // Analytic early-out: total damage the squad could ever deal, even if it
  // fights to the last soldier.  Lets the generator's hit-point search reject
  // an over-sized boss in O(1) instead of walking thousands of contacts.
  const maxContacts = Math.floor(squad / Math.max(1, boss.contactLoss)) + 1;
  const damageCeiling = squadDps(squad, weapon, config) * efficiency * cycleTime * maxContacts;
  if (hp > damageCeiling) {
    return { squadAfter: 0, dead: true, contacts: maxContacts, duration: cycleTime * maxContacts };
  }

  while (contacts < maxCycles) {
    if (squad <= 0) return { squadAfter: 0, dead: true, contacts, duration };
    const damage = squadDps(squad, weapon, config) * efficiency * cycleTime;
    hp -= damage;
    duration += cycleTime;
    if (hp <= 0) return { squadAfter: squad, dead: false, contacts, duration };
    squad = Math.max(0, squad - boss.contactLoss);
    contacts++;
  }
  return { squadAfter: squad, dead: squad <= 0, contacts, duration };
}

/**
 * Smallest squad size that survives a given lane stream.
 * Relies on monotonicity: more soldiers never produce a worse outcome.
 * Returns null when no squad size below `upperBound` survives.
 */
export function minimumSquadForStream (params, upperBound = 20000) {
  const test = (size) => {
    const r = resolveLaneStream({ ...params, squadSize: size });
    return !r.dead && r.squadAfter >= (params.minSurvivors || 1);
  };
  if (!test(upperBound)) return null;
  let low = 1;
  let high = upperBound;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (test(mid)) high = mid; else low = mid + 1;
  }
  return low;
}

/** Smallest squad size that beats a boss. Null when the boss is unbeatable. */
export function minimumSquadForBoss (params, upperBound = 20000) {
  const test = (size) => {
    const r = resolveBoss({ ...params, squadSize: size });
    return !r.dead && r.squadAfter >= (params.minSurvivors || 1);
  };
  if (!test(upperBound)) return null;
  let low = 1;
  let high = upperBound;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (test(mid)) high = mid; else low = mid + 1;
  }
  return low;
}

/**
 * Full boss encounter: an optional unavoidable escort stream (present on the
 * HORDE and COMBO archetypes) followed by the boss core itself.
 * Used identically by BossManager during play and by the LevelSimulator.
 */
export function resolveBossEncounter (params) {
  const config = params.config || CONFIG;
  const { boss, weapon, efficiency = 1 } = params;
  let squad = Math.max(0, Math.floor(params.squadSize));
  let kills = 0;
  let leaks = 0;
  let duration = 0;

  if (boss.escort && boss.escort.count > 0) {
    const escort = resolveLaneStream({
      squadSize: squad,
      weapon,
      enemyHp: boss.escort.hp,
      enemyCount: boss.escort.count,
      enemySpeed: boss.escort.speed !== undefined ? boss.escort.speed : boss.speed,
      spacing: boss.escort.spacing || config.enemies.spacing,
      efficiency,
      config
    });
    squad = escort.squadAfter;
    kills += escort.kills;
    leaks += escort.leaks;
    duration += escort.duration;
    if (escort.dead) {
      return { squadAfter: 0, dead: true, kills, leaks, contacts: 0, duration };
    }
  }

  if (boss.hp <= 0) {
    return { squadAfter: squad, dead: squad <= 0, kills, leaks, contacts: 0, duration };
  }

  const core = resolveBoss({ squadSize: squad, weapon, boss, efficiency, config });
  return {
    squadAfter: core.squadAfter,
    dead: core.dead,
    kills: kills + (core.dead ? 0 : 1),
    leaks,
    contacts: core.contacts,
    duration: duration + core.duration
  };
}

/**
 * The live spawn plan for a boss escort, expressed as enemies per lane.
 *
 * `resolveBossEncounter` resolves the escort as `count` enemies in whichever
 * lane the squad occupies, so the game must put the FULL count in every lane.
 * Splitting the escort across the lanes would hand the player an escort a
 * third of the size the stage was certified against, which is why this plan
 * lives here, next to the model it has to agree with.
 */
export function escortLaneSpawns (boss, laneCount) {
  if (!boss || !boss.escort || boss.escort.count <= 0) return [];
  return new Array(laneCount).fill(boss.escort.count);
}

/** Smallest squad size that clears a full boss encounter (escort included). */
export function minimumSquadForEncounter (params, upperBound = 20000) {
  const test = (size) => {
    const r = resolveBossEncounter({ ...params, squadSize: size });
    return !r.dead && r.squadAfter >= (params.minSurvivors || 1);
  };
  if (!test(upperBound)) return null;
  let low = 1;
  let high = upperBound;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (test(mid)) high = mid; else low = mid + 1;
  }
  return low;
}
