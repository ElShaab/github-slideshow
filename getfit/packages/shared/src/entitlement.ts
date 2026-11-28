import { planForProduct } from './constants';
import type { BillingPlatform, Entitlement, SubscriptionStatus } from './types';

/**
 * Entitlement without a server.
 *
 * The store is the source of truth, and it is asked again on every launch and
 * every return to the foreground. Nothing here ever reads a stored "isPremium"
 * flag — a boolean in local storage is a claim the device makes about itself,
 * and the first person to edit it is premium forever.
 *
 * What is stored is the *answer the store last gave*, so the app keeps working
 * on a plane. That answer is trusted for a bounded window; past it, access
 * lapses until the store can be reached again. Without a server there is no
 * way to learn about a refund or a chargeback except by asking the store, so
 * the window is the whole defence.
 */

/** How long a store answer is honoured while the store cannot be reached. */
export const OFFLINE_TRUST_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One entitlement the store currently considers the customer to hold. */
export interface ActivePurchase {
  productId: string;
  platform: BillingPlatform;
  /** The store's own transaction identifier. */
  transactionId: string;
  purchasedAt: string;
  /**
   * Only when the store actually reported one. Never estimated from a purchase
   * date — a guessed renewal date shown as fact is worse than no date.
   */
  expiresAt: string | null;
  /** Play reports this directly; StoreKit leaves it null. */
  autoRenewing: boolean | null;
}

/** The last answer the store gave, and when it gave it. */
export interface CachedEntitlement {
  entitlement: Entitlement;
  verifiedAt: string;
}

function noEntitlement(now: Date): Entitlement {
  return {
    active: false,
    status: 'none',
    expiresAt: null,
    productId: null,
    platform: null,
    evaluatedAt: now.toISOString(),
  };
}

/**
 * Reads entitlement out of what the store says the customer currently owns.
 *
 * Both stores exclude lapsed subscriptions from this list, so a product
 * appearing here is itself the grant. Products we do not sell are ignored
 * rather than trusted — a purchase of something absent from the catalogue
 * cannot unlock anything.
 */
export function entitlementFromPurchases(purchases: ActivePurchase[], now = new Date()): Entitlement {
  const known = purchases.filter((purchase) => planForProduct(purchase.productId));
  if (known.length === 0) return noEntitlement(now);

  // The most recent purchase wins: an upgrade from monthly to yearly leaves
  // both visible for a while, and the newer one is the live one.
  const current = known.reduce((latest, purchase) =>
    Date.parse(purchase.purchasedAt) > Date.parse(latest.purchasedAt) ? purchase : latest,
  );

  // A store-reported expiry in the past means the list is stale, not that the
  // customer is entitled.
  if (current.expiresAt && Date.parse(current.expiresAt) <= now.getTime()) {
    return {
      active: false,
      status: 'expired',
      expiresAt: current.expiresAt,
      productId: current.productId,
      platform: current.platform,
      evaluatedAt: now.toISOString(),
    };
  }

  // Turning off auto-renewal does not end the period already paid for, so it
  // still grants access — it only changes what the app says will happen next.
  const status: SubscriptionStatus = current.autoRenewing === false ? 'cancelled' : 'active';

  return {
    active: true,
    status,
    expiresAt: current.expiresAt,
    productId: current.productId,
    platform: current.platform,
    evaluatedAt: now.toISOString(),
  };
}

/**
 * Evaluates the stored answer when the store cannot be reached.
 *
 * Access survives being offline, but not indefinitely: past the trust window
 * the app stops honouring an answer it can no longer confirm.
 */
export function entitlementFromCache(
  cached: CachedEntitlement | null,
  now = new Date(),
): Entitlement {
  if (!cached) return noEntitlement(now);

  const { entitlement, verifiedAt } = cached;
  const verifiedMs = Date.parse(verifiedAt);
  if (!Number.isFinite(verifiedMs)) return noEntitlement(now);

  // A period the store already told us had ended needs no second opinion.
  if (entitlement.expiresAt && Date.parse(entitlement.expiresAt) <= now.getTime()) {
    return { ...entitlement, active: false, status: 'expired', evaluatedAt: now.toISOString() };
  }

  if (now.getTime() - verifiedMs > OFFLINE_TRUST_DAYS * DAY_MS) {
    // Deliberately not 'expired': the subscription may well be fine, and the
    // app should say it needs to check rather than that the user has lapsed.
    return { ...entitlement, active: false, status: 'pending', evaluatedAt: now.toISOString() };
  }

  return { ...entitlement, evaluatedAt: now.toISOString() };
}

/** Whether a cached answer is stale enough that the UI should say so. */
export function needsRevalidation(cached: CachedEntitlement | null, now = new Date()): boolean {
  if (!cached) return true;
  const verifiedMs = Date.parse(cached.verifiedAt);
  if (!Number.isFinite(verifiedMs)) return true;
  return now.getTime() - verifiedMs > OFFLINE_TRUST_DAYS * DAY_MS;
}

/** One line in the local purchase log. Nothing here touches payment details. */
export interface PurchaseRecord {
  productId: string;
  platform: BillingPlatform;
  transactionId: string;
  recordedAt: string;
  kind: 'purchase' | 'restore';
  /** What the customer was shown, in their own currency. */
  price: string;
}

/** Newest first, de-duplicated by transaction so a restore cannot flood it. */
export function mergePurchaseHistory(
  existing: PurchaseRecord[],
  incoming: PurchaseRecord,
  limit = 100,
): PurchaseRecord[] {
  const withoutDuplicate = existing.filter(
    (record) =>
      !(record.transactionId === incoming.transactionId && record.kind === incoming.kind),
  );
  return [incoming, ...withoutDuplicate]
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
    .slice(0, limit);
}
