import { Platform } from 'react-native';
import { SUBSCRIPTION_PRODUCT_ID } from '@getfit/shared';

export type BillingPlatform = 'apple' | 'google' | 'mock';

export interface StorePurchase {
  platform: BillingPlatform;
  /** Apple: the app receipt. Google: the purchase token. Mock: a scenario key. */
  receipt: string;
  productId: string;
  /** Opaque native transaction, carried so the purchase can be acknowledged. */
  handle?: unknown;
}

export interface StoreProvider {
  readonly platform: BillingPlatform;
  readonly available: boolean;
  purchase(productId: string): Promise<StorePurchase>;
  restore(): Promise<StorePurchase | null>;
  /**
   * Tells the store the purchase has been delivered. This is not optional
   * bookkeeping: Google automatically refunds a purchase that is not
   * acknowledged within three days, and StoreKit redelivers an unfinished
   * transaction on every launch forever.
   */
  finishPurchase(purchase: StorePurchase): Promise<void>;
}

export class StorePurchaseCancelled extends Error {
  constructor() {
    super('Purchase cancelled');
    this.name = 'StorePurchaseCancelled';
  }
}

export class StoreUnavailable extends Error {
  constructor(message = 'In-app purchases are not available on this device.') {
    super(message);
    this.name = 'StoreUnavailable';
  }
}

/**
 * Native store adapter.
 *
 * The native billing module (`expo-in-app-purchases` or `react-native-iap`) is
 * resolved at runtime so the JavaScript bundle still runs in Expo Go, where no
 * billing native code is linked. Whatever it returns is only ever a receipt —
 * the server decides whether the membership is actually active.
 */
export class NativeStoreProvider implements StoreProvider {
  readonly platform: BillingPlatform = Platform.OS === 'ios' ? 'apple' : 'google';
  private module: NativeBillingModule | null = null;

  get available(): boolean {
    return this.loadModule() !== null;
  }

  private loadModule(): NativeBillingModule | null {
    if (this.module) return this.module;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const resolved = require('expo-in-app-purchases') as NativeBillingModule;
      this.module = resolved;
      return resolved;
    } catch {
      return null;
    }
  }

  async purchase(productId: string): Promise<StorePurchase> {
    const billing = this.loadModule();
    if (!billing) throw new StoreUnavailable();

    await billing.connectAsync();
    try {
      await billing.getProductsAsync([productId]);
      const result = await billing.purchaseItemAsync(productId);

      if (result.responseCode === billing.IAPResponseCode.USER_CANCELED) {
        throw new StorePurchaseCancelled();
      }
      if (result.responseCode !== billing.IAPResponseCode.OK || !result.results?.length) {
        throw new StoreUnavailable('That purchase could not be completed.');
      }

      const purchase = result.results[0];
      // iOS hands back the app receipt; Android hands back a purchase token.
      const receipt =
        Platform.OS === 'ios' ? purchase.transactionReceipt : purchase.purchaseToken ?? '';
      if (!receipt) throw new StoreUnavailable('That purchase could not be verified.');

      // Finished only once the server has granted entitlement, so a purchase
      // we could not verify is never acknowledged.
      return { platform: this.platform, receipt, productId, handle: purchase };
    } finally {
      await billing.disconnectAsync().catch(() => undefined);
    }
  }

  async restore(): Promise<StorePurchase | null> {
    const billing = this.loadModule();
    if (!billing) throw new StoreUnavailable();

    await billing.connectAsync();
    try {
      const history = await billing.getPurchaseHistoryAsync();
      const purchase = history.results?.[0];
      if (!purchase) return null;
      const receipt =
        Platform.OS === 'ios' ? purchase.transactionReceipt : purchase.purchaseToken ?? '';
      if (!receipt) return null;
      return { platform: this.platform, receipt, productId: purchase.productId, handle: purchase };
    } finally {
      await billing.disconnectAsync().catch(() => undefined);
    }
  }

  async finishPurchase(purchase: StorePurchase): Promise<void> {
    const billing = this.loadModule();
    if (!billing || purchase.handle === undefined) return;

    await billing.connectAsync();
    try {
      // A subscription is never consumed, so consumeItem is false.
      await billing.finishTransactionAsync(purchase.handle, false);
    } finally {
      await billing.disconnectAsync().catch(() => undefined);
    }
  }
}

/**
 * Development store. Exercises every purchase outcome without a store account;
 * the server only accepts these while MOCK_BILLING is enabled.
 */
export class MockStoreProvider implements StoreProvider {
  readonly platform: BillingPlatform = 'mock';
  readonly available = true;

  constructor(private readonly scenario: string = 'mock-success') {}

  async purchase(productId: string): Promise<StorePurchase> {
    // A short delay so the loading state is visible during testing.
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (this.scenario === 'mock-cancel') throw new StorePurchaseCancelled();
    return { platform: 'mock', receipt: this.scenario, productId };
  }

  async restore(): Promise<StorePurchase | null> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { platform: 'mock', receipt: 'mock-success', productId: SUBSCRIPTION_PRODUCT_ID };
  }

  /** Nothing to acknowledge — no real transaction was opened. */
  async finishPurchase(): Promise<void> {}
}

export function createStoreProvider(options: {
  mockAvailable: boolean;
  scenario?: string;
}): StoreProvider {
  const native = new NativeStoreProvider();
  if (native.available) return native;
  if (options.mockAvailable) return new MockStoreProvider(options.scenario);
  return native;
}

/* Minimal structural type for the optional native billing module. */
interface NativeBillingModule {
  connectAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
  getProductsAsync(ids: string[]): Promise<unknown>;
  purchaseItemAsync(id: string): Promise<{
    responseCode: number;
    results?: Array<{ transactionReceipt: string; purchaseToken?: string; productId: string }>;
  }>;
  getPurchaseHistoryAsync(): Promise<{
    results?: Array<{ transactionReceipt: string; purchaseToken?: string; productId: string }>;
  }>;
  finishTransactionAsync(purchase: unknown, consumeItem: boolean): Promise<void>;
  IAPResponseCode: { OK: number; USER_CANCELED: number };
}
