import {
  entitlementFromCache,
  entitlementFromPurchases,
  mergePurchaseHistory,
  type ActivePurchase,
  type CachedEntitlement,
  type Entitlement,
  type PurchaseRecord,
} from '@getfit/shared';
import type { StoreProvider } from './storeAdapter';

/**
 * Membership state held on the device, with no React Native imports.
 *
 * The store is asked on every launch and every return to the foreground, and
 * its answer decides entitlement. What is kept here is that answer, so the app
 * still works on a plane — not a verdict this app reached on its own.
 *
 * Storage is injected so the rules below can be tested off-device. They are
 * the whole gate on the paid product now that there is no server, and the one
 * that matters most is that a development grant can never unlock a release
 * build.
 */

/** The slice of AsyncStorage this needs. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
}

export const BILLING_KEYS = {
  entitlement: 'getfit.billing.entitlement',
  history: 'getfit.billing.history',
  devGrant: 'getfit.billing.devGrant',
} as const;

export class LocalBilling {
  /**
   * @param storage Where the store's last answer is kept.
   * @param isDev   Whether this is a development build. A release build never
   *                reads the development grant, so a value written to that key
   *                — by hand or otherwise — cannot unlock a shipped app.
   */
  constructor(
    private readonly storage: KeyValueStore,
    private readonly isDev: boolean,
  ) {}

  private async readJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      // Unreadable or corrupt storage grants nothing. Every caller treats null
      // as "not entitled", which is the safe direction to fail in.
      return null;
    }
  }

  private async writeJson(key: string, value: unknown): Promise<void> {
    try {
      await this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // A failed write costs a re-query next launch, which is not worth
      // surfacing to someone mid-purchase.
    }
  }

  /**
   * Asks the store what the customer owns, and falls back to its last answer.
   *
   * The distinction that matters: a store which answers "nothing" means not
   * subscribed, while a store that cannot be reached means unknown. The
   * adapter throws for the second, so a paying customer in a basement keeps
   * their membership instead of being told it lapsed.
   */
  async resolveEntitlement(store: StoreProvider): Promise<Entitlement> {
    try {
      const owned = await store.getActivePurchases();
      const entitlement = entitlementFromPurchases([...owned, ...(await this.devGrants())]);
      await this.writeJson(BILLING_KEYS.entitlement, {
        entitlement,
        verifiedAt: new Date().toISOString(),
      } satisfies CachedEntitlement);
      return entitlement;
    } catch {
      return entitlementFromCache(
        await this.readJson<CachedEntitlement>(BILLING_KEYS.entitlement),
      );
    }
  }

  /** The stored answer and when it was given, for the "last checked" line. */
  readCachedEntitlement(): Promise<CachedEntitlement | null> {
    return this.readJson<CachedEntitlement>(BILLING_KEYS.entitlement);
  }

  async readPurchaseHistory(): Promise<PurchaseRecord[]> {
    return (await this.readJson<PurchaseRecord[]>(BILLING_KEYS.history)) ?? [];
  }

  /** Appends one purchase or restore. Nothing here touches payment details. */
  async recordPurchase(record: PurchaseRecord): Promise<void> {
    const history = await this.readPurchaseHistory();
    await this.writeJson(BILLING_KEYS.history, mergePurchaseHistory(history, record));
  }

  /**
   * A purchase made against the development mock store.
   *
   * Expo Go links no billing module, so the mock store is the only way to
   * reach the paid product while developing.
   */
  private async devGrants(): Promise<ActivePurchase[]> {
    if (!this.isDev) return [];
    return (await this.readJson<ActivePurchase[]>(BILLING_KEYS.devGrant)) ?? [];
  }

  async recordDevGrant(grant: ActivePurchase): Promise<void> {
    if (!this.isDev) return;
    const existing = await this.devGrants();
    const without = existing.filter((held) => held.transactionId !== grant.transactionId);
    await this.writeJson(BILLING_KEYS.devGrant, [grant, ...without]);
  }

  async clear(): Promise<void> {
    await this.storage.multiRemove(Object.values(BILLING_KEYS)).catch(() => undefined);
  }
}
