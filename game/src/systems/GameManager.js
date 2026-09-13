/**
 * GameManager.js -- the conductor.
 *
 * Owns the render loop and the game state machine, and wires the pure core
 * (generator, simulator, run state, economy) to the presentation systems.
 * Deliberately thin: rules live in src/core, visuals live in the other
 * systems, and this file just makes them talk to each other.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';
import { RunState } from '../core/RunState.js';
import { Profile, MemoryStorage } from '../core/Profile.js';
import { GemManager, continueCost, continueRestoration } from '../core/Economy.js';
import { LevelGenerator } from '../core/LevelGenerator.js';
import { LevelSimulator } from '../core/LevelSimulator.js';
import { GateType, gateLabel, WEAPON_STAT_ICONS, WEAPON_STAT_LABELS } from '../core/GateMath.js';
import { WEAPON_STATS } from '../core/WeaponStats.js';
import { combatPower, squadDps } from '../core/CombatModel.js';

import { LaneController } from './LaneController.js';
import { InputManager } from './InputManager.js';
import { SquadManager } from './SquadManager.js';
import { EnemyManager } from './EnemyManager.js';
import { WeaponSystem } from './WeaponSystem.js';
import { GateManager } from './GateManager.js';
import { BossManager } from './BossManager.js';
import { LevelManager } from './LevelManager.js';
import { CameraController } from './CameraController.js';
import { EnvironmentManager, THEMES } from './EnvironmentManager.js';
import { VFXManager } from './VFXManager.js';
import { AudioManager } from './AudioManager.js';
import { UIManager, formatCount } from './UIManager.js';
import { DebugOverlay } from './DebugOverlay.js';

export const GameState = Object.freeze({
  LOADING: 'LOADING',
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  STAGE_CLEAR: 'STAGE_CLEAR',
  DEAD: 'DEAD'
});

const MAX_FRAME_DELTA = 1 / 20;   // never simulate more than this in one frame
const LANE_MARKER_COLORS = [0xff5555, 0x55ff55, 0x5599ff, 0xffdd55, 0xcc66ff];

export class GameManager {
  constructor (canvas, config = CONFIG) {
    this.canvas = canvas;
    this.config = config;
    this.state = GameState.LOADING;

    /* ---- persistent + run data ---- */
    this.profile = new Profile(safeStorage(), config);
    this.gems = new GemManager(this.profile, config);
    this.run = new RunState(config, this.profile);
    this.generator = new LevelGenerator(config);
    this.simulator = new LevelSimulator(config);

    // Generation is by far the most expensive thing a stage transition does:
    // it generates a candidate, simulates it, and rejects it until one is
    // provably winnable, which on an unlucky seed takes a hundred rounds. Done
    // on the PLAY tap that is a visible freeze on a phone, so we do it while
    // the player is reading the menu or the STAGE CLEAR banner instead.
    this._prefetched = null;      // { key, generated }
    this._prefetchTimer = 0;

    /* ---- renderer ---- */
    this.renderer = createRenderer(canvas);
    // iOS drops WebGL contexts when the tab is backgrounded or memory runs
    // short. Without this the canvas silently stops updating forever.
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      console.warn('WebGL context lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('WebGL context restored');
      this._loopFailed = false;
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(THEMES[0].sky);
    this.scene.fog = new THREE.Fog(THEMES[0].sky, 70, config.render.drawDistance);

    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 1, 0.1, 400);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x4a6b52, 1.05);
    const sun = new THREE.DirectionalLight(0xfff3d6, 1.15);
    sun.position.set(-18, 34, 22);
    this.scene.add(hemisphere, sun);

    /* ---- systems ---- */
    this.lanes = new LaneController(config);
    this.squad = new SquadManager(this.scene, this.lanes, config);
    this.enemies = new EnemyManager(this.scene, this.lanes, config);
    this.vfx = new VFXManager(this.scene, config);
    this.audio = new AudioManager();
    this.gateManager = new GateManager(this.scene, this.lanes, this.vfx, config);
    this.bossManager = new BossManager(this.scene, this.lanes, this.enemies, this.vfx, config);
    this.weapons = new WeaponSystem({
      squad: this.squad, enemies: this.enemies, vfx: this.vfx,
      lanes: this.lanes, audio: this.audio, config
    });
    this.levelManager = new LevelManager({
      gates: this.gateManager, enemies: this.enemies, boss: this.bossManager,
      lanes: this.lanes, config
    });
    this.environment = new EnvironmentManager(this.scene, config);
    this.cameraController = new CameraController(this.camera, this.lanes, config);
    this.ui = new UIManager(this);
    this.debug = new DebugOverlay(this);

    this.input = new InputManager(canvas, config);
    this.input.on('move', (direction) => this.onSwipe(direction));
    this.input.on('pause', () => (this.state === GameState.PAUSED ? this.resume() : this.pause()));
    this.input.on('debug', () => this.debug.toggle());

    /* ---- loop state ---- */
    this.squadZ = 0;
    this.lastTime = 0;
    this.fps = 60;
    this.laneMarkers = null;
    this.lastGateText = '';
    this.lastSimulationText = '';
    this.debugTimeScale = 1;
    this.stageClearTimer = 0;
    this.deathSnapshot = null;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === GameState.PLAYING) this.pause();
    });
    this._onResize();

    this.applySkin();
    this.cameraController.snapTo(0);
  }

  /* --------------------------------------------------------------- setup */

  applySkin () {
    const skin = this.profile.skin;
    this.squad.setAppearance(skin.colors, this.run.weapon.tierIndex);
  }

  _onResize () {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Narrow portrait phones need a slightly wider field of view to keep all
    // three lanes and the upcoming gates on screen.
    const portraitBoost = height > width ? Math.min(14, (height / width - 1) * 16) : 0;
    this.camera.fov = this.config.camera.fov + portraitBoost;
    this.camera.updateProjectionMatrix();
  }

  start () {
    this.state = GameState.MENU;
    this.ui.showLoading(false);
    this.ui.showMenu();
    document.getElementById('audio-toggle').checked = this.profile.settings.audio !== false;
    this.prefetchStage(1, freshEntry(this.config));
    requestAnimationFrame((time) => this._loop(time));
  }

  /* ----------------------------------------------------------- run flow */

  startRun () {
    try {
      this._startRun();
    } catch (error) {
      console.error('startRun failed', error);
      this.ui.showFatal('Could not start the run.', error && (error.stack || error.message));
    }
  }

  _startRun () {
    // If the player tapped before the menu's prefetch ran, let it go rather
    // than have it fire a stage-1 generation in the middle of gameplay.
    this._cancelPrefetch();
    // Sound is cosmetic and the most browser-dependent thing here; it must
    // never be the reason a run fails to start.
    try {
      this.audio.unlock();
      this.audio.setEnabled(this.profile.settings.audio !== false);
      this.audio.startAmbience();
    } catch (error) {
      console.warn('audio unavailable, continuing without it', error);
    }

    this.run.reset();
    this.squadZ = 0;
    this.lanes.reset();
    this.levelManager.clear();
    this.vfx.clear();
    this.weapons.reset();
    this.ui.hideBoss();
    this.applySkin();
    this.cameraController.snapTo(this.squadZ);

    this.loadStage(this.run.stage);
    this.state = GameState.PLAYING;
    this.ui.showHud();
    this.ui.banner('STAGE 1', 'Good luck, commander');
  }

  /**
   * Key for a prefetched stage: a stage is only reusable if it was built for
   * the same stage number AND the same squad + weapon the run is entering it
   * with, because both feed the solvability proof.
   */
  _stageKey (stage, entry) {
    const levels = WEAPON_STATS.map((key) => entry.weapon.levels[key]).join(',');
    return `${stage}|${entry.squad}|${levels}`;
  }

  /** Builds a stage ahead of time, off the critical path. Never throws. */
  prefetchStage (stage, entry) {
    const key = this._stageKey(stage, entry);
    if (this._prefetched && this._prefetched.key === key) return;
    this._cancelPrefetch();
    const frozen = { squad: entry.squad, weapon: entry.weapon.clone() };
    this._prefetchTimer = setTimeout(() => {
      this._prefetchTimer = 0;
      try {
        this._prefetched = { key, generated: this.generator.generate(stage, frozen) };
      } catch (error) {
        // A failed prefetch is not a failed run: loadStage falls back to
        // generating on demand, which reports its own errors.
        console.warn('stage prefetch failed, will generate on demand', error);
        this._prefetched = null;
      }
    }, 0);
  }

  /** Drops a prefetch that has not run yet, so it cannot fire mid-gameplay. */
  _cancelPrefetch () {
    if (this._prefetchTimer) clearTimeout(this._prefetchTimer);
    this._prefetchTimer = 0;
  }

  /** Generates and streams in a stage, carrying the run state untouched. */
  loadStage (stage) {
    const entry = this.run.toEntry();
    const key = this._stageKey(stage, entry);
    let generated;
    if (this._prefetched && this._prefetched.key === key) {
      generated = this._prefetched.generated;
      this._prefetched = null;
      this.lastStageWasPrefetched = true;
    } else {
      generated = this.generator.generate(stage, entry);
      this.lastStageWasPrefetched = false;
    }
    this.level = generated.level;
    this.levelManager.load(this.level, this.squadZ);
    this.environment.setTheme(Math.floor((stage - 1) / 2));
    this.profile.notifyStageReached(stage);

    const validation = this.level.validation;
    this.lastSimulationText =
      `${validation.winningPaths}/${validation.totalPaths} winning paths, best end squad ${validation.bestFinalSquad}`;
    return this.level;
  }

  completeStage () {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.STAGE_CLEAR;
    this.stageClearTimer = 1.6;
    this.ui.hideBoss();
    this.bossManager.clear();
    this.enemies.clear();
    this.audio.play('victory');
    const next = this.run.stage + 1;
    this.ui.banner('STAGE CLEAR', `Stage ${next} — squad ${formatCount(this.run.squad)}`);
    // The banner holds for 1.6s; build the next stage inside that window so
    // the hand-off itself costs nothing.
    this.prefetchStage(next, this.run.toEntry());
  }

  _beginNextStage () {
    // Nothing temporary is reset here: squad, weapon and stats carry over.
    this.run.advanceStage();
    this.levelManager.clear();
    this.loadStage(this.run.stage);
    this.state = GameState.PLAYING;
  }

  die () {
    if (this.state === GameState.DEAD) return;
    this.state = GameState.DEAD;
    this.audio.play('death');
    this.cameraController.addShake(0.3);

    const previousSquad = this.deathSnapshot ? this.deathSnapshot.previousSquad : 0;
    const cost = continueCost(this.run.continues + 1, this.config);
    const restore = this._plannedRestoration();

    this.deathSnapshot = { previousSquad: Math.max(previousSquad, this._lastLivingSquad || 0) };
    this.ui.showDeath({
      stage: this.run.stage,
      squad: this.run.squad,
      kills: this.run.enemiesDefeated,
      points: this.profile.soldierPoints,
      cost,
      gems: this.profile.gems,
      restorePreview: restore,
      canContinue: this.gems.canAfford(cost)
    });
  }

  /**
   * Spec 28: ask the simulator for the smallest squad that still has a
   * survivable route through what is LEFT of the stage, then restore a
   * blend of that and what the player had.
   */
  _plannedRestoration () {
    const previous = Math.max(this.config.economy.continueMinSquad, this._lastLivingSquad || 0);
    let minimumViable = Math.ceil(previous * 0.25);
    if (this.level) {
      const fromSection = Math.min(this.levelManager.currentSection(this.squadZ), this.level.sections.length);
      const computed = this.simulator.minimumEntrySquad(
        this.level, { squad: previous, weapon: this.run.weapon }, { fromSection }
      );
      if (computed !== null) minimumViable = computed;
    }
    return continueRestoration({ minimumViable, previousSquad: previous }, this.config);
  }

  continueRun () {
    const cost = continueCost(this.run.continues + 1, this.config);
    if (!this.gems.spend(cost)) return;

    this.run.continues += 1;
    const restored = this._plannedRestoration();
    // Reinforcements are not "acquired" soldiers: restoring through
    // setSquad would credit lifetime Soldier Points and turn continues into a
    // currency printer.
    this.run.restoreSoldiers(restored);

    // Clear whatever was about to hit, and push the squad clear of the fight.
    this.enemies.clear();
    this.vfx.clear();
    this.weapons.reset();
    if (this.bossManager.active) {
      this.bossManager.z = this.squadZ + 60;
    }

    this.ui.hideDeath();
    this.ui.showHud();
    this.audio.play('continue');
    this.ui.toast(`+${formatCount(restored)} REINFORCEMENTS`, 'good');
    this.state = GameState.PLAYING;
  }

  endRun () {
    // Spec 29: temporary run progression goes; lifetime progression stays.
    this.run.reset();
    this.squadZ = 0;
    this.lanes.reset();
    this.levelManager.clear();
    this.enemies.clear();
    this.vfx.clear();
    this.ui.hideDeath();
    this.ui.hidePause();
    this.ui.hideBoss();
    this.audio.stopAmbience();
    this.state = GameState.MENU;
    this.ui.showMenu();
    this.prefetchStage(1, freshEntry(this.config));
  }

  pause () {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.PAUSED;
    this.ui.showPause();
  }

  resume () {
    if (this.state !== GameState.PAUSED) return;
    this.ui.hidePause();
    this.state = GameState.PLAYING;
  }

  onSwipe (direction) {
    if (this.state !== GameState.PLAYING && this.state !== GameState.STAGE_CLEAR) return;
    if (this.lanes.move(direction)) this.audio.play('ui', { throttleMs: 90 });
  }

  /* ------------------------------------------------------------ gameplay */

  onGateCrossed ({ gate, lane }) {
    const before = this.run.squad;
    this.run.applyGate(gate);
    this.audio.play('gate');

    if (gate.type === GateType.WEAPON) {
      const icon = WEAPON_STAT_ICONS[gate.stat];
      this.lastGateText = `${WEAPON_STAT_LABELS[gate.stat]} upgrade (lane ${lane})`;
      this.ui.toast(`${icon} ${WEAPON_STAT_LABELS[gate.stat]} UP`, 'upgrade');
      this.audio.play('upgrade');
      this.applySkin();     // weapon tier can change the soldier silhouette
    } else {
      const delta = this.run.squad - before;
      this.lastGateText = `${gateLabel(gate)} : ${before} -> ${this.run.squad} (lane ${lane})`;
      if (delta > 0) {
        this.ui.toast(`+${formatCount(delta)}`, 'good');
        this.audio.play('gain');
      } else if (delta < 0) {
        this.ui.toast(`${formatCount(delta)}`, 'bad');
        this.audio.play('loss');
        this.cameraController.addShake(0.12);
      }
    }

    if (this.run.squad <= 0) this.die();
  }

  update (dt) {
    const playing = this.state === GameState.PLAYING || this.state === GameState.STAGE_CLEAR;

    this.lanes.update(dt);
    if (playing) this.squadZ += this.config.squad.forwardSpeed * dt;

    this.squad.setCount(this.run.squad);
    this.squad.z = this.squadZ;
    this.squad.update(dt);
    this.environment.update(dt, this.squadZ);

    if (playing && this.state === GameState.PLAYING) {
      this._updateCombat(dt);
      const { stageComplete } = this.levelManager.update(dt, this.squadZ, {
        squadSize: this.run.squad,
        weapon: this.run.weapon,
        dps: squadDps(this.run.squad, this.run.weapon, this.config),
        onGate: (event) => this.onGateCrossed(event),
        onBossStart: (boss) => {
          this.ui.showBoss(bossDisplayName(boss.type));
          this.audio.play('boss');
          this.cameraController.setZoom(1.12);
        }
      });
      if (stageComplete) this.completeStage();
    }

    this.enemies.update(dt, this.squadZ);
    this.vfx.update(dt);

    if (this.state === GameState.STAGE_CLEAR) {
      this.stageClearTimer -= dt;
      this.cameraController.setZoom(1);
      if (this.stageClearTimer <= 0) this._beginNextStage();
    }

    if (this.laneMarkers) this.laneMarkers.position.z = this.squadZ + 24;

    this.cameraController.update(dt, this.squadZ);

    if (this.run.squad > 0) this._lastLivingSquad = this.run.squad;

    this.ui.updateHud({
      squad: this.run.squad,
      stage: this.run.stage,
      gems: this.profile.gems,
      progress: this.levelManager.progress(this.squadZ),
      weapon: this.run.weapon
    });
    this.debug.update();
  }

  _updateCombat (dt) {
    const weapon = this.run.weapon;

    // Soldiers fire automatically at the lane they are standing in.
    const result = this.weapons.update(dt, {
      squadSize: this.run.squad,
      weapon,
      squadZ: this.squadZ
    });

    if (result.kills > 0) {
      this.run.registerKills(result.kills);
      this.audio.play('hit', { throttleMs: 60 });
    }
    if (result.contacts > 0) {
      // Spec 12: exactly one soldier per enemy that reaches the squad.
      this.run.removeSoldiers(result.contacts * this.config.combat.enemyContactSoldierLoss);
      this.cameraController.addShake(Math.min(0.16, 0.04 * result.contacts));
      this.ui.toast(`−${result.contacts}`, 'bad');
    }

    // Boss.
    if (this.bossManager.active) {
      const bossResult = this.bossManager.update(dt, {
        squadZ: this.squadZ,
        squadSize: this.run.squad,
        weapon,
        dps: squadDps(this.run.squad, weapon, this.config)
      });
      if (bossResult.soldiersLost > 0) {
        this.run.removeSoldiers(bossResult.soldiersLost);
        this.ui.toast(`−${bossResult.soldiersLost}`, 'bad');
        this.cameraController.addShake(0.26);
        this.audio.play('loss');
      }
      if (bossResult.defeated) {
        this.run.registerKills(1);
        this.cameraController.addShake(0.3);
      }
      this.ui.updateBoss(this.bossManager.healthFraction);
    }

    if (this.run.squad <= 0) this.die();
  }

  /* --------------------------------------------------------------- loop */

  _loop (time) {
    requestAnimationFrame((next) => this._loop(next));
    const seconds = time * 0.001;
    let dt = this.lastTime ? seconds - this.lastTime : 1 / 60;
    this.lastTime = seconds;
    if (dt <= 0) return;
    dt = Math.min(dt, MAX_FRAME_DELTA);
    this.fps = this.fps * 0.9 + (1 / dt) * 0.1;
    // Development-only: lets QA run a whole stage in a fraction of the time.
    if (this.debugTimeScale && this.debug.available) dt *= this.debugTimeScale;

    // A throw in here would repeat every frame and look exactly like a frozen
    // game, so report the first one on screen instead of only to the console.
    try {
      if (this.state !== GameState.PAUSED) this.update(dt);
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      if (!this._loopFailed) {
        this._loopFailed = true;
        console.error('frame failed', error);
        this.ui.showFatal('The game hit an error while running.',
          error && (error.stack || error.message));
      }
    }
  }

  /* -------------------------------------------------------- debug hooks */

  debugSpawnWave () {
    const speed = this.level ? this.level.enemySpeed : this.config.enemies.baseSpeed;
    for (let lane = 0; lane < this.config.lanes.count; lane++) {
      this.enemies.spawnLane(lane, {
        count: 24, hp: this.config.enemies.baseHp * 3, speed,
        spacing: this.config.enemies.spacing, squadZ: this.squadZ, lead: 70
      });
    }
  }

  debugWeaponUpgrade () {
    const stats = Object.keys(WEAPON_STAT_ICONS);
    const stat = stats[Math.floor(Math.random() * stats.length)];
    this.run.weapon.upgrade(stat);
    this.applySkin();
    this.ui.toast(`${WEAPON_STAT_ICONS[stat]} ${WEAPON_STAT_LABELS[stat]} UP`, 'upgrade');
  }

  debugRegenerateLevel () {
    this.levelManager.clear();
    this.enemies.clear();
    this.loadStage(this.run.stage);
  }

  debugLogPaths () {
    if (!this.level) return;
    const report = this.simulator.enumeratePaths(this.level, this.run.toEntry());
    console.table({
      winningPaths: report.winningPaths,
      totalPaths: report.totalPaths,
      bestPath: (report.bestPath || []).join('-'),
      bestFinalSquad: report.bestFinalSquad,
      requiredEntrySquad: this.level.requiredEntrySquad,
      combatPower: combatPower(this.run.squad, this.run.weapon, this.config).toFixed(1)
    });
  }

  /** Floating "0 1 2" markers over the lanes, for debugging positioning. */
  setLaneMarkers (visible) {
    if (!visible) {
      if (this.laneMarkers) {
        this.scene.remove(this.laneMarkers);
        this.laneMarkers = null;
      }
      return;
    }
    if (this.laneMarkers) return;
    const group = new THREE.Group();
    for (let lane = 0; lane < this.config.lanes.count; lane++) {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshBasicMaterial({ color: LANE_MARKER_COLORS[lane % LANE_MARKER_COLORS.length] })
      );
      marker.position.set(this.lanes.laneX(lane), 3.2, 0);
      group.add(marker);
    }
    this.scene.add(group);
    this.laneMarkers = group;
  }
}

function bossDisplayName (type) {
  return {
    GIANT: 'GIANT COMMANDER',
    TANK: 'ARMOURED TANK',
    HORDE: 'ENEMY HORDE',
    COMBO: 'WARLORD & GUARD'
  }[type] || 'BOSS';
}

/**
 * Builds the renderer, giving the device more than one chance to say yes.
 *
 * A phone can refuse a high-performance context while happily granting a
 * plain one -- iOS caps how many live WebGL contexts a browser may hold, and
 * hands out the cheap ones longer. Asking once and giving up turns a playable
 * device into a menu whose PLAY button does nothing.
 */
function createRenderer (canvas) {
  const attempts = [
    { antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' },
    { antialias: false },
    { antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false }
  ];
  let last = null;
  for (const options of attempts) {
    try {
      return new THREE.WebGLRenderer({ canvas, ...options });
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error('WebGL is unavailable on this device');
}

/**
 * The squad + weapon a brand new run starts with. Built from a throwaway
 * RunState with no Profile attached, so asking the question never counts as
 * starting a run.
 */
function freshEntry (config) {
  return new RunState(config).toEntry();
}

/** localStorage can throw in private mode; fall back to memory. */
function safeStorage () {
  try {
    const probe = '__probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (error) {
    console.warn('localStorage unavailable, progress will not persist', error);
    return new MemoryStorage();
  }
}
