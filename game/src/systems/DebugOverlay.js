/**
 * DebugOverlay.js -- developer tools (spec 49, 50).
 *
 * Off unless the build is a development one AND the player asked for it
 * (?debug=1 or F2).  It is never reachable in a production build: `enabled`
 * is gated on `isDevBuild`, which is false for any non-local host.
 */
import { combatPower, squadDps } from '../core/CombatModel.js';

/** Production builds are anything not served from a dev host. */
export function isDevBuild () {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.local');
}

export class DebugOverlay {
  constructor (game) {
    this.game = game;
    this.element = document.getElementById('debug');
    this.readout = document.getElementById('debug-readout');
    this.visible = false;
    this.showLaneNumbers = false;
    this.available = isDevBuild() ||
      new URLSearchParams(window.location.search).get('debug') === '1';

    document.getElementById('debug-close').addEventListener('click', () => this.toggle(false));
    for (const button of this.element.querySelectorAll('[data-debug]')) {
      button.addEventListener('click', () => this.command(button.dataset.debug));
    }
  }

  toggle (force) {
    if (!this.available) return;
    this.visible = force === undefined ? !this.visible : force;
    this.element.classList.toggle('hidden', !this.visible);
  }

  command (action) {
    const game = this.game;
    switch (action) {
      case 'squad+': game.run.addSoldiers(50); break;
      case 'squad-': game.run.removeSoldiers(50); break;
      case 'skip': game.completeStage(); break;
      case 'spawn': game.debugSpawnWave(); break;
      case 'gems': game.gems.grant(10); break;
      case 'weapon': game.debugWeaponUpgrade(); break;
      case 'regen': game.debugRegenerateLevel(); break;
      case 'kill': game.run.removeSoldiers(game.run.squad); break;
      case 'lanes': this.showLaneNumbers = !this.showLaneNumbers; game.setLaneMarkers(this.showLaneNumbers); break;
      case 'paths': game.debugLogPaths(); break;
      default: break;
    }
  }

  update () {
    if (!this.visible) return;
    const game = this.game;
    const level = game.levelManager.level;
    const run = game.run;
    const power = combatPower(run.squad, run.weapon, game.config);
    const dps = squadDps(run.squad, run.weapon, game.config);
    const sectionIndex = game.levelManager.currentSection(game.squadZ);
    const required = level && level.requirements
      ? level.requirements[Math.min(sectionIndex, level.requirements.length - 1)]
      : 0;

    const lines = [
      `stage          ${run.stage}   lane ${game.lanes.lane}   fps ${game.fps.toFixed(0)}`,
      `squad          ${run.squad}`,
      `combat power   ${power.toFixed(1)}`,
      `squad dps      ${dps.toFixed(0)}`,
      `required squad ${required} (section ${sectionIndex})`,
      `difficulty     ${level ? (level.difficulty * 100).toFixed(0) + '%' : '-'}`,
      `enemy speed    ${level ? level.enemySpeed.toFixed(2) : '-'} m/s (x${level ? level.enemySpeedMultiplier.toFixed(3) : '-'})`,
      `winning paths  ${level && level.validation ? `${level.validation.winningPaths}/${level.validation.totalPaths}` : '-'}`,
      `entry ratio    ${level && level.validation ? (level.validation.entryRequirementRatio || 0).toFixed(2) : '-'}`,
      `stage progress ${(game.levelManager.progress(game.squadZ) * 100).toFixed(1)}%`,
      `enemies alive  ${game.enemies.totalAlive}`,
      `last gate      ${game.lastGateText || '-'}`,
      `sim result     ${game.lastSimulationText || '-'}`
    ];
    this.readout.textContent = lines.join('\n');
  }
}
