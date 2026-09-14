import { Platform } from 'react-native';
import { SUBSCRIPTION_PRODUCT_ID, type StorePrice } from '@getfit/shared';

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
  /**
   * What the store will charge this customer, in their own currency.
   *
   * Returns an empty list when there is no store to ask, and the caller falls
   * back to the bundled USD figures. Never throws: a paywall that cannot show a
   * price is worse than one showing the fallback.
   */
  getPrices(productIds: string[]): Promise<StorePrice[]>;
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
 * Native store adapter, backed by react-native-iap.
 *
 * The module is resolved at runtime so the JavaScript bundle still runs in Expo
 * Go, where no billing native code is linked. Whatever the store returns is
 * only ever a receipt — the server decides whether the membership is active.
 */
export class NativeStoreProvider implements StoreProvider {
  readonly platform: BillingPlatform = Platform.OS === 'ios' ? 'apple' : 'google';
  private module: IapModule | null = null;

  get available(): boolean {
    return this.loadModule() !== null;
  }

  private loadModule(): IapModule | null {
    if (this.module) return this.module;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const resolved = require('react-native-iap') as IapModule;
      // Expo Go resolves the JS but links no native module, so the functions
      // exist while the bridge does not.
      if (typeof resolved?.initConnection !== 'function') return null;
      this.module = resolved;
      return resolved;
    } catch {
      return null;
    }
  }

  /** Opens the billing connection and always closes it again. */
  private async withConnection<T>(fn: (iap: IapModule) => Promise<T>): Promise<T> {
    const iap = this.loadModule();
    if (!iap) throw new StoreUnavailable();

    await iap.initConnection();
    try {
      // Clears purchases Play left pending from an interrupted flow; without
      // this they can block a new purchase of the same subscription.
      if (Platform.OS === 'android') {
        await iap.flushFailedPurchasesCachedAsPendingAndroid().catch(() => undefined);
      }
      return await fn(iap);
    } finally {
      await iap.endConnection().catch(() => undefined);
    }
  }

  async getPrices(productIds: string[]): Promise<StorePrice[]> {
    if (productIds.length === 0) return [];
    try {
      return await this.withConnection(async (iap) => {
        const subscriptions = await iap.getSubscriptions({ skus: productIds });
        return subscriptions
          .map((subscription) => readStorePrice(subscription))
          .filter((price): price is StorePrice => price !== null);
      });
    } catch {
      // An unreachable store must not empty the paywall — the bundled USD
      // prices stand in until it answers.
      return [];
    }
  }

  async purchase(productId: string): Promise<StorePurchase> {
    return this.withConnection(async (iap) => {
      const subscriptions = await iap.getSubscriptions({ skus: [productId] });
      const subscription = subscriptions.find((item) => item.productId === productId);
      if (!subscription) {
        throw new StoreUnavailable('That membership is not available on this device.');
      }

      let result;
      try {
        // Play Billing 5 requires the base plan's offer token; StoreKit takes
        // the sku alone. The transaction is deliberately not finished here —
        // that happens only after the server grants entitlement.
        if (Platform.OS === 'android') {
          const offerToken = subscription.subscriptionOfferDetails?.[0]?.offerToken;
          if (!offerToken) {
            throw new StoreUnavailable('That membership has no active offer on Google Play.');
          }
          result = await iap.requestSubscription({
            subscriptionOffers: [{ sku: productId, offerToken }],
          });
        } else {
          result = await iap.requestSubscription({
            sku: productId,
            andDangerouslyFinishTransactionAutomaticallyIOS: false,
          });
        }
      } catch (error) {
        if (isCancellation(error)) throw new StorePurchaseCancelled();
        if (error instanceof StoreUnavailable) throw error;
        throw new StoreUnavailable(storeMessage(error));
      }

      const purchase = Array.isArray(result) ? result[0] : result;
      if (!purchase) throw new StoreUnavailable('That purchase could not be completed.');

      const receipt = receiptOf(purchase);
      if (!receipt) throw new StoreUnavailable('That purchase could not be verified.');

      return {
        platform: this.platform,
        receipt,
        productId: purchase.productId ?? productId,
        handle: purchase,
      };
    });
  }

  async restore(): Promise<StorePurchase | null> {
    return this.withConnection(async (iap) => {
      const purchases = await iap.getAvailablePurchases();
      // The most recent entitlement is the one worth re-verifying.
      const purchase = [...purchases]
        .sort((a, b) => (b.transactionDate ?? 0) - (a.transactionDate ?? 0))
        .find((item) => Boolean(receiptOf(item)));
      if (!purchase) return null;

      const receipt = receiptOf(purchase);
      if (!receipt) return null;

      return {
        platform: this.platform,
        receipt,
        productId: purchase.productId,
        handle: purchase,
      };
    });
  }

  async finishPurchase(purchase: StorePurchase): Promise<void> {
    if (purchase.handle === undefined) return;
    await this.withConnection(async (iap) => {
      // A subscription is never consumed.
      await iap.finishTransaction({
        purchase: purchase.handle as IapPurchase,
        isConsumable: false,
      });
    });
  }
}

/** iOS hands back the app receipt; Android hands back a purchase token. */
function receiptOf(purchase: IapPurchase): string {
  return (Platform.OS === 'ios' ? purchase.transactionReceipt : purchase.purchaseToken) ?? '';
}

function isCancellation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'E_USER_CANCELLED';
}

function storeMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'E_ALREADY_OWNED') {
    return 'You already own this membership. Try Restore purchase.';
  }
  if (code === 'E_NETWORK_ERROR' || code === 'E_SERVICE_ERROR') {
    return 'The store could not be reached. Please try again.';
  }
  if (code === 'E_DEFERRED_PAYMENT') {
    return 'Your purchase is pending approval. It will unlock once it clears.';
  }
  return 'That purchase could not be completed.';
}

/**
 * Development store. Exercises every purchase outcome without a store account;
 * the server only accepts these while MOCK_BILLING is enabled.
 */
export class MockStoreProvider implements StoreProvider {
  readonly platform: BillingPlatform = 'mock';
  readonly available = true;

  constructor(private readonly scenario: string = 'mock-success') {}

  /** There is no store behind the mock, so the bundled USD prices are used. */
  async getPrices(): Promise<StorePrice[]> {
    return [];
  }

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

/* Structural types for the optional native billing module, so the app compiles
 * and runs in Expo Go where react-native-iap is not linked. */
export interface IapPurchase {
  productId: string;
  transactionReceipt?: string;
  purchaseToken?: string;
  transactionDate?: number;
}

interface IapPricingPhase {
  formattedPrice?: string;
  priceCurrencyCode?: string;
  /** Play reports amounts in millionths of the currency unit. */
  priceAmountMicros?: string;
  billingPeriod?: string;
}

interface IapSubscription {
  productId: string;
  /** iOS: StoreKit's pre-formatted price for the customer's storefront. */
  localizedPrice?: string;
  currency?: string;
  /** iOS: the same amount as a numeric string. */
  price?: string;
  /** Android only: Play Billing 5 base-plan offers. */
  subscriptionOfferDetails?: Array<{
    offerToken: string;
    pricingPhases?: { pricingPhaseList?: IapPricingPhase[] };
  }>;
}

/**
 * Normalises one subscription into a price, across two different shapes.
 *
 * StoreKit hands back a formatted string directly. Play Billing nests it in
 * the base plan's pricing phases, in millionths, and a product can carry
 * several phases — an introductory or free phase first, then the recurring
 * one. The recurring phase is the price the customer keeps paying, so the last
 * phase is the one to show.
 */
function readStorePrice(subscription: IapSubscription): StorePrice | null {
  if (Platform.OS === 'android') {
    const phases = subscription.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList;
    const phase = phases?.[phases.length - 1];
    if (!phase?.formattedPrice || !phase.priceCurrencyCode) return null;

    const micros = Number(phase.priceAmountMicros);
    return {
      productId: subscription.productId,
      localizedPrice: phase.formattedPrice,
      currencyCode: phase.priceCurrencyCode,
      amount: Number.isFinite(micros) ? micros / 1_000_000 : 0,
    };
  }

  if (!subscription.localizedPrice || !subscription.currency) return null;
  const amount = Number(subscription.price);
  return {
    productId: subscription.productId,
    localizedPrice: subscription.localizedPrice,
    currencyCode: subscription.currency,
    amount: Number.isFinite(amount) ? amount : 0,
  };
}

interface IapModule {
  initConnection(): Promise<boolean>;
  endConnection(): Promise<boolean>;
  flushFailedPurchasesCachedAsPendingAndroid(): Promise<boolean>;
  getSubscriptions(request: { skus: string[] }): Promise<IapSubscription[]>;
  requestSubscription(
    request:
      | { sku: string; andDangerouslyFinishTransactionAutomaticallyIOS?: boolean }
      | { subscriptionOffers: Array<{ sku: string; offerToken: string }> },
  ): Promise<IapPurchase | IapPurchase[] | null | void>;
  getAvailablePurchases(): Promise<IapPurchase[]>;
  finishTransaction(request: { purchase: IapPurchase; isConsumable?: boolean }): Promise<unknown>;
}
