/**
 * UIManager.js -- all DOM screens (spec 33, 34, 35).
 *
 * The 3D scene stays free of UI: the HUD, menus, death screen, skin shop and
 * gem store are plain HTML, which keeps text crisp on every device and costs
 * the renderer nothing.  Every button here is wired to real behaviour -- there
 * are no decorative controls (spec 56).
 */
import { SKINS } from '../core/SkinCatalog.js';
import { WEAPON_STAT_ICONS, WEAPON_STAT_LABELS } from '../core/GateMath.js';
import { WEAPON_STATS } from '../core/WeaponStats.js';

const $ = (id) => document.getElementById(id);

/** Error text is shown as text, never parsed as markup. */
function escapeHtml (value) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 1 234 -> "1.2K" so a five-digit squad never breaks the HUD. */
export function formatCount (value) {
  const n = Math.trunc(value);
  if (n < 10000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 100000 ? 1 : 0)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

export class UIManager {
  constructor (game) {
    this.game = game;
    this.elements = {
      hud: $('hud'),
      squad: $('hud-squad'),
      stage: $('hud-stage'),
      gems: $('hud-gems'),
      progress: $('hud-progress'),
      weaponName: $('hud-weapon-name'),
      weaponStats: $('hud-weapon-stats'),
      bossBar: $('boss-bar'),
      bossName: $('boss-name'),
      bossFill: $('boss-fill'),
      toasts: $('toast-stack'),
      menu: $('menu'),
      death: $('death'),
      skins: $('skins'),
      store: $('store'),
      pause: $('pause'),
      banner: $('stage-banner'),
      bannerSub: $('banner-sub'),
      loading: $('loading')
    };
    this._lastSquad = -1;
    this._bindButtons();
  }

  _bindButtons () {
    $('play-button').addEventListener('click', () => this.game.startRun());
    $('skins-button').addEventListener('click', () => this.openSkins());
    $('store-button').addEventListener('click', () => this.openStore());
    $('continue-button').addEventListener('click', () => this.game.continueRun());
    $('endrun-button').addEventListener('click', () => this.game.endRun());
    $('pause-button').addEventListener('click', () => this.game.pause());
    // Lane buttons fire on pointerdown so they feel immediate, and they call
    // the same path a swipe does.
    for (const [id, direction] of [['lane-left', -1], ['lane-right', 1]]) {
      $(id).addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.game.onSwipe(direction);
      });
    }
    $('resume-button').addEventListener('click', () => this.game.resume());
    $('quit-button').addEventListener('click', () => this.game.endRun());
    $('audio-toggle').addEventListener('change', (event) => {
      this.game.audio.setEnabled(event.target.checked);
      this.game.profile.settings.audio = event.target.checked;
      this.game.profile.save();
    });
    for (const button of document.querySelectorAll('[data-close]')) {
      button.addEventListener('click', () => this.closePanel(button.dataset.close));
    }
  }

  /**
   * Shows a failure the player can read and report, instead of a control that
   * silently does nothing. Anything thrown while starting a run lands here.
   */
  showFatal (message, detail = '') {
    let box = document.getElementById('fatal');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatal';
      box.className = 'fatal-banner';
      document.getElementById('app').appendChild(box);
    }
    box.innerHTML = `<strong>Something broke</strong><span>${escapeHtml(String(message))}</span>` +
      (detail ? `<code>${escapeHtml(String(detail).slice(0, 400))}</code>` : '');
    box.classList.remove('hidden');
  }

  hideFatal () {
    const box = document.getElementById('fatal');
    if (box) box.classList.add('hidden');
  }

  /* ------------------------------------------------------------- screens */

  showLoading (visible) { this.elements.loading.classList.toggle('hidden', !visible); }

  showMenu () {
    this._hideAll();
    this.elements.menu.classList.remove('hidden');
    $('menu-points').textContent = formatCount(this.game.profile.soldierPoints);
    $('menu-gems').textContent = formatCount(this.game.profile.gems);
    $('menu-best').textContent = this.game.profile.bestStage;
  }

  showHud () {
    this._hideAll();
    this.elements.hud.classList.remove('hidden');
    this.elements.hud.setAttribute('aria-hidden', 'false');
  }

  showPause () { this.elements.pause.classList.remove('hidden'); }
  hidePause () { this.elements.pause.classList.add('hidden'); }

  showDeath ({ stage, squad, kills, points, cost, gems, restorePreview, canContinue }) {
    this.elements.death.classList.remove('hidden');
    $('death-stage').textContent = stage;
    $('death-squad').textContent = formatCount(squad);
    $('death-kills').textContent = formatCount(kills);
    $('death-points').textContent = formatCount(points);
    $('death-cost').textContent = `💎 ${cost}`;
    $('death-gems').textContent = `💎 ${gems}`;
    $('death-restore').textContent = canContinue
      ? `Continuing puts ${formatCount(restorePreview)} soldiers back in the field — enough for a mathematically survivable route through the rest of the stage.`
      : 'Not enough gems for this continue. You can buy more from the menu store, or end the run and keep your Soldier Points.';
    const button = $('continue-button');
    button.disabled = !canContinue;
  }

  hideDeath () { this.elements.death.classList.add('hidden'); }

  closePanel (id) {
    this.elements[id].classList.add('hidden');
    if (this.game.state === 'MENU') this.showMenu();
  }

  _hideAll () {
    for (const key of ['menu', 'death', 'skins', 'store', 'pause']) {
      this.elements[key].classList.add('hidden');
    }
    this.elements.hud.classList.add('hidden');
  }

  /* ----------------------------------------------------------------- HUD */

  updateHud (state) {
    const { squad, stage, gems, progress, weapon } = state;
    if (squad !== this._lastSquad) {
      this.elements.squad.textContent = formatCount(squad);
      this.elements.squad.classList.remove('pop');
      void this.elements.squad.offsetWidth;     // restart the CSS animation
      this.elements.squad.classList.add('pop');
      this._lastSquad = squad;
    }
    this.elements.stage.textContent = stage;
    this.elements.gems.textContent = formatCount(gems);
    this.elements.progress.style.width = `${(progress * 100).toFixed(1)}%`;
    this.elements.weaponName.textContent = weapon.tierName;

    const parts = [];
    for (const stat of WEAPON_STATS) {
      const level = weapon.levels[stat];
      if (level > 0) parts.push(`<span title="${WEAPON_STAT_LABELS[stat]}">${WEAPON_STAT_ICONS[stat]}<b>${level}</b></span>`);
    }
    this.elements.weaponStats.innerHTML = parts.join('') ||
      '<span class="muted">no upgrades yet</span>';
  }

  showBoss (name) {
    this.elements.bossBar.classList.remove('hidden');
    this.elements.bossName.textContent = name;
  }

  updateBoss (fraction) {
    this.elements.bossFill.style.width = `${Math.max(0, fraction * 100).toFixed(1)}%`;
  }

  hideBoss () { this.elements.bossBar.classList.add('hidden'); }

  toast (text, kind = 'info') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = text;
    this.elements.toasts.appendChild(node);
    setTimeout(() => node.remove(), 1000);
  }

  banner (title, sub) {
    const element = this.elements.banner;
    element.querySelector('.banner-title').textContent = title;
    this.elements.bannerSub.textContent = sub;
    element.classList.remove('hidden');
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = '';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => element.classList.add('hidden'), 2200);
  }

  /* --------------------------------------------------------------- shops */

  openSkins () {
    this._hideAll();
    this.elements.skins.classList.remove('hidden');
    this.renderSkins();
  }

  renderSkins () {
    const profile = this.game.profile;
    $('skins-points').textContent = formatCount(profile.soldierPoints);
    const list = $('skin-list');
    list.innerHTML = '';

    for (const skin of SKINS) {
      const owned = profile.isSkinUnlocked(skin.id);
      const selected = profile.selectedSkin === skin.id;
      const card = document.createElement('div');
      card.className = `card${selected ? ' selected' : ''}`;

      const swatch = document.createElement('div');
      swatch.className = 'card-swatch';
      swatch.style.background = `linear-gradient(135deg, #${skin.colors.uniform.toString(16).padStart(6, '0')}, #${skin.colors.accent.toString(16).padStart(6, '0')})`;

      const body = document.createElement('div');
      body.className = 'card-body';
      body.innerHTML = `<div class="card-name">${skin.name}</div>
        <div class="card-meta">${owned ? (selected ? 'Equipped' : 'Owned') : `🎖️ ${formatCount(skin.cost)} Soldier Points`}</div>`;

      const action = document.createElement('button');
      action.className = `button${owned ? '' : ' primary'}`;
      action.textContent = owned ? (selected ? 'EQUIPPED' : 'EQUIP') : 'BUY';
      action.disabled = selected || (!owned && profile.soldierPoints < skin.cost);
      action.addEventListener('click', () => {
        if (owned) profile.selectSkin(skin.id);
        else profile.purchaseSkin(skin.id);
        this.game.applySkin();
        this.renderSkins();
        this.game.audio.play('ui');
      });

      card.append(swatch, body, action);
      list.appendChild(card);
    }
  }

  openStore () {
    this._hideAll();
    this.elements.store.classList.remove('hidden');
    this.renderStore();
  }

  renderStore () {
    $('store-gems').textContent = formatCount(this.game.profile.gems);
    const list = $('pack-list');
    list.innerHTML = '';

    for (const pack of this.game.gems.packs) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="card-swatch" style="background:linear-gradient(135deg,#2f8fd8,#8ef2ff)"></div>
        <div class="card-body">
          <div class="card-name">💎 ${pack.gems} Gems</div>
          <div class="card-meta">${pack.priceLabel} · mock purchase</div>
        </div>`;
      const action = document.createElement('button');
      action.className = 'button primary';
      action.textContent = 'BUY';
      action.addEventListener('click', async () => {
        action.disabled = true;
        const result = await this.game.gems.purchasePack(pack.id);
        action.disabled = false;
        if (result.ok) {
          this.game.audio.play('gain');
          this.renderStore();
        }
      });
      card.appendChild(action);
      list.appendChild(card);
    }
  }
}
