/**
 * Economy.js -- gems, continue pricing and continue restoration (spec 27, 28).
 */
import { CONFIG } from './Config.js';

/**
 * Cost of the n-th continue during a run: 1, 6, 11, 16, 21, ...
 * @param {number} continueNumber 1-based
 */
export function continueCost (continueNumber, config = CONFIG) {
  const n = Math.max(1, Math.trunc(continueNumber));
  return config.economy.continueBaseCost + config.economy.continueCostStep * (n - 1);
}

/**
 * How many soldiers to hand back when the player pays to continue.
 *
 * The floor comes from the LevelSimulator: the smallest squad that still has a
 * mathematically survivable route through the rest of the stage.  On top of
 * that the player gets a configurable share of what they had, so continuing
 * feels like a recovery rather than a restart -- capped so it can never be
 * farmed into a stronger position than the run had earned.
 *
 * @param {object} params
 * @param {number} params.minimumViable  from LevelSimulator.minimumEntrySquad
 * @param {number} params.previousSquad  squad size before the wipe
 */
export function continueRestoration ({ minimumViable, previousSquad }, config = CONFIG) {
  const eco = config.economy;
  const safeMinimum = Math.max(eco.continueMinSquad, Math.ceil((minimumViable || 1) * eco.continueSafetyMargin));
  const previous = Math.max(0, Math.trunc(previousSquad));

  // Blend between the bare minimum and the previous squad.
  const blended = Math.round(safeMinimum + (Math.max(previous, safeMinimum) - safeMinimum) * eco.continueRestoreBias);
  const capped = Math.min(blended, Math.max(safeMinimum, Math.floor(previous * eco.continueRestoreCap)));
  return Math.max(safeMinimum, capped);
}

/** Gem wallet with a mock store that a real IAP provider can replace. */
export class GemManager {
  constructor (profile, config = CONFIG) {
    this.profile = profile;
    this.config = config;
    this.purchaseProvider = null; // injected later: Apple / Google billing
  }

  get gems () { return this.profile.gems; }

  canAfford (amount) { return this.profile.gems >= amount; }

  spend (amount) {
    const cost = Math.max(0, Math.trunc(amount));
    if (this.profile.gems < cost) return false;
    this.profile.gems -= cost;
    this.profile.save();
    return true;
  }

  grant (amount) {
    this.profile.gems += Math.max(0, Math.trunc(amount));
    this.profile.save();
    return this.profile.gems;
  }

  get packs () { return this.config.economy.gemPacks; }

  /**
   * Mock purchase.  A real build injects a provider exposing
   * `purchase(packId) -> Promise<{ok:boolean}>`; nothing else changes.
   */
  async purchasePack (packId) {
    const pack = this.packs.find((entry) => entry.id === packId);
    if (!pack) return { ok: false, reason: 'unknown-pack' };
    if (this.purchaseProvider) {
      const result = await this.purchaseProvider.purchase(packId);
      if (!result || !result.ok) return { ok: false, reason: 'purchase-failed' };
    }
    this.grant(pack.gems);
    return { ok: true, gems: pack.gems, balance: this.profile.gems };
  }
}
