/**
 * Config.js
 *
 * Single source of truth for every tunable number in the game.
 * Nothing gameplay-related may be hard-coded elsewhere: gameplay, the level
 * generator and the level simulator all read from this object so that the
 * simulation can never drift away from what actually happens on screen.
 *
 * The object is deliberately plain data (JSON-compatible) so it can be
 * serialised, diffed, or swapped out by a balancing tool later.
 */

export const CONFIG = {
  /* ------------------------------------------------------------------ lanes */
  lanes: {
    count: 3,
    width: 3.2,          // metres between lane centres
    switchSpeed: 11.0,   // lateral metres/second when changing lane
    swipeThresholdPx: 28 // minimum horizontal travel for a swipe to register
  },

  /* ------------------------------------------------------------------ squad */
  squad: {
    startingSize: 10,    // spec default; freely configurable
    maxRendered: 260,    // hard cap on individually rendered soldiers (LOD/perf)
    forwardSpeed: 14.0,  // metres/second the squad runs
    radiusPerSoldier: 0.30,
    minSpacing: 0.62,
    formationMaxWidth: 2.7,  // keeps the squad readable inside one lane
    formationMaxDepth: 5.2
  },

  /* ---------------------------------------------------------------- weapons */
  weapons: {
    base: {
      fireRate: 2.6,     // shots per second per soldier
      damage: 9.0,       // damage per bullet
      range: 20.0,       // metres
      bullets: 1,        // bullets per shot
      area: 1.0          // area-damage multiplier (1 = single target)
    },
    // Each upgrade adds one level to a stat; factor = 1 + level * increment
    increments: {
      fireRate: 0.14,
      damage: 0.16,
      range: 0.10,
      bullets: 0.22,
      area: 0.18
    },
    maxLevelPerStat: 24,
    // Cosmetic weapon tiers unlocked by total upgrade levels.
    visualTiers: [
      { name: 'Pistol', minLevels: 0 },
      { name: 'SMG', minLevels: 3 },
      { name: 'Assault Rifle', minLevels: 8 },
      { name: 'Advanced Rifle', minLevels: 15 }
    ]
  },

  /* ---------------------------------------------------------------- combat */
  combat: {
    // SquadPower = size * damageF * fireRateF * rangeF * bulletF * areaF * powerScale
    powerScale: 1.0,
    // Damage per second contributed by ONE soldier at base stats:
    //   dpsPerSoldier = fireRate * damage * bullets * area (range excluded,
    //   range instead buys engagement time, see CombatModel)
    // Simulation applies this efficiency so it can never be optimistic
    // relative to real gameplay (real gameplay carries over surplus damage,
    // the simulator throws a slice of it away).
    simulatorEfficiency: 0.92,
    // Soldiers can only realistically bring a fraction of their firepower to
    // bear on the front rank; a soft cap keeps huge squads from trivialising
    // the game while remaining strictly monotonic in squad size.
    softCapSoldiers: 30,
    softCapExponent: 0.80,
    enemyContactSoldierLoss: 1, // spec: exactly one soldier per enemy contact
    projectileSpeed: 70
  },

  /* ---------------------------------------------------------------- enemies */
  enemies: {
    baseHp: 26,
    baseSpeed: 8.5,             // metres/second toward the squad
    spacing: 2.1,               // metres between enemies in a running stream
    laneJitter: 0.9,
    hpGrowthPerStage: 0.11,     // enemy HP scaling with stage
    speedStepOdd: 0.01,         // spec 20: stage 11,13,15... => +1%
    speedStepEven: 0.07,        // spec 20: stage 12,14,16... => +7%
    speedRampStartStage: 11
  },

  /* ----------------------------------------------------------------- bosses */
  bosses: {
    approachDistance: 26,       // metres the boss covers between contacts
    maxFightSeconds: 16,        // hit-point ceiling: a boss is a fight, not a sponge
    types: {
      // contactLossFraction keeps a boss threatening against any squad size:
      // the absolute loss per contact scales with the squad it faces.
      GIANT: { hpFactor: 1.0, speed: 5.5, contactLoss: 3, contactLossFraction: 0.10, scale: 3.0 },
      TANK: { hpFactor: 1.3, speed: 4.2, contactLoss: 5, contactLossFraction: 0.14, scale: 3.6 },
      HORDE: { hpFactor: 0.55, speed: 7.5, contactLoss: 2, contactLossFraction: 0.06, scale: 2.2, escort: 1.0 },
      COMBO: { hpFactor: 0.9, speed: 6.0, contactLoss: 4, contactLossFraction: 0.11, scale: 3.2, escort: 0.55 }
    },
    order: ['GIANT', 'HORDE', 'TANK', 'COMBO']
  },

  /* ------------------------------------------------------------- difficulty */
  difficulty: {
    base: 0.70,
    stepPerStage: 0.03,
    max: 0.95,
    // The spec's difficulty number is a STAGE-LEVEL guarantee: a player who
    // enters with only `difficulty` of their squad must still have a winning
    // route.  Individual fights are tuned separately, because one enemy
    // contact costs exactly one soldier and sizing every fight at the stage
    // target would compound into a near-certain wipe.
    // Fights are designed by how many soldiers they take from a squad at full
    // strength; the stage-level guarantee above is then measured and enforced
    // by the validator.  A weakened squad loses proportionally far more, which
    // is what makes a bad gate choice fatal.
    fightLossBase: 0.11,         // stage 1: a wave costs ~11% of the squad
    fightLossAtCap: 0.21,        // ... rising to ~21% once difficulty caps
    bossLossMultiplier: 1.7,     // the boss bites harder than a wave
    partialWaveLossMultiplier: 1.35, // taking an occupied lane of a dodgeable wave
    entryRequirementTolerance: 0.02,
    minEntryRequirementRatio: 0.30 // reject stages that pose no threat at all
  },

  /* ------------------------------------------------------------ generation */
  generation: {
    targetStageSeconds: 150,     // ~2.5 minutes
    minStageSeconds: 110,
    maxStageSeconds: 195,
    sectionsMin: 4,              // gate rows (decision points) before the boss
    sectionsMax: 5,
    // Waves per section.  Decisions stay few enough to enumerate every path,
    // while the action stays dense between them.
    wavesPerSectionMin: 2,
    wavesPerSectionMax: 3,
    waveGapMeters: 34,           // clear ground between two streams
    sectionTailMargin: 60,       // room to read the next gate row in peace
    sectionLengthMin: 240,       // metres
    sectionLengthMax: 330,
    gateRowSpacing: 62,
    maxAttempts: 220,            // regeneration attempts before widening rules
    // Gate value pools (unequal on purpose -- spec section 8)
    plusRange: [4, 30],
    minusRange: [2, 30],
    multiplyOptions: [2, 3, 4],
    divideOptions: [2, 3],
    // Multiply gates are the genre's signature but must not inflate the run
    // forever, so big factors are only offered while the squad is small.
    multiplyCeiling: { 2: 130, 3: 55, 4: 26 },
    plusScale: 0.03,            // plus gates grow only very gently with the squad
    // Because one enemy contact costs exactly one soldier, a wave can never
    // threaten more soldiers than it has enemies: counts therefore track the
    // squad, bounded for on-screen readability and performance.
    // Enemy COUNT is the spectacle and gradation dial: well above the number
    // of soldiers a fight is designed to threaten, so a strong squad shreds
    // the wave while a weakened one is overrun.
    waveCountMargin: [2.4, 3.6],
    waveCountMin: 12,
    waveCountPerSoldier: [0.8, 1.5], // a wave is a wall, sized against the squad
    minEnemySpacing: 1.15,      // densest a lane of runners may be packed
    waveCountMax: 120,
    escortShare: 2.6,
    escortCountMax: 130,
    weaponGateChance: 0.34,
    trapLaneChance: 0.52,
    // Waves that leave a lane open are positioning puzzles: entering the wrong
    // lane must hurt without being an instant run-ender.
    partialWavePressure: 0.55
  },

  /* -------------------------------------------------------------- economy */
  economy: {
    startingGems: 3,
    continueBaseCost: 1,
    continueCostStep: 5,
    // Continue restoration (spec 28)
    continueSafetyMargin: 1.25,  // multiply the mathematically-required squad
    continueRestoreBias: 0.65,   // 0 = bare minimum, 1 = full previous squad
    continueRestoreCap: 0.85,    // never exceed this fraction of previous squad
    continueMinSquad: 5,
    gemPacks: [
      { id: 'pack_small', gems: 10, priceLabel: '$0.99' },
      { id: 'pack_mid', gems: 50, priceLabel: '$3.99' },
      { id: 'pack_large', gems: 100, priceLabel: '$6.99' }
    ]
  },

  /* --------------------------------------------------------------- camera */
  camera: {
    distance: 13.0,
    height: 8.0,
    fov: 54,
    lookAhead: 15.0,
    followSpeed: 6.5,
    lateralFollow: 0.72,
    shakeDamping: 6.0,
    maxShake: 0.45
  },

  /* --------------------------------------------------------------- render */
  render: {
    corridorWidth: 13.0,
    drawDistance: 170,
    maxProjectiles: 320,
    maxEnemiesRendered: 420,
    maxParticles: 220
  },

  debug: {
    enabled: false // toggled by ?debug=1 or the D key; never on in production
  }
};

/** Deep-freeze so no system can mutate shared balance data by accident. */
function deepFreeze (obj) {
  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

deepFreeze(CONFIG);

/** Returns a deep, mutable copy -- used by tests and the balancing tools. */
export function cloneConfig (source = CONFIG) {
  return JSON.parse(JSON.stringify(source));
}
