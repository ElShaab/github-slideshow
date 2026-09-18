import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivePurchase, CachedEntitlement, Entitlement, PurchaseRecord } from '@getfit/shared';
import { LocalBilling } from './billingStore';
import type { StoreProvider } from './storeAdapter';

/**
 * The device binding for on-device membership state.
 *
 * This file answers the two questions `LocalBilling` deliberately does not ask:
 * where storage lives, and whether this is a development build. Every rule is
 * in `billingStore.ts`, where it can be tested without a device.
 *
 * These keys survive signing out of GetFit, deliberately. An App Store
 * subscription belongs to the Apple or Google account on the device, not to a
 * GetFit login, so someone who signs out and back in is still entitled.
 */
const billing = new LocalBilling(AsyncStorage, __DEV__);

export const resolveEntitlement = (store: StoreProvider): Promise<Entitlement> =>
  billing.resolveEntitlement(store);

export const readCachedEntitlement = (): Promise<CachedEntitlement | null> =>
  billing.readCachedEntitlement();

export const readPurchaseHistory = (): Promise<PurchaseRecord[]> => billing.readPurchaseHistory();

export const recordPurchase = (record: PurchaseRecord): Promise<void> =>
  billing.recordPurchase(record);

export const recordDevGrant = (grant: ActivePurchase): Promise<void> =>
  billing.recordDevGrant(grant);

export const clearLocalBilling = (): Promise<void> => billing.clear();
