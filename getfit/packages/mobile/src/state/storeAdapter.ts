/**
 * The store adapter, with no React Native imports.
 *
 * Everything that decides whether a customer is served lives here: how a
 * purchase is awaited, which store errors mean "already entitled" rather than
 * "failed", and how two different response shapes are read. Keeping it free of
 * the platform binding is what makes it testable off-device — and this is
 * logic that must not be first exercised in front of a paying customer.
 *
 * `billing.ts` supplies the real platform and the linked native module.
 */
import {
  SUBSCRIPTION_PRODUCT_ID,
  type ActivePurchase,
  type StorePrice,
} from '@getfit/shared';

export type BillingPlatform = 'apple' | 'google' | 'mock';

/** Which store's response shapes to expect. Injected, never read from here. */
export type DeviceOs = 'ios' | 'android';

export interface StorePurchase {
  platform: BillingPlatform;
  /** Apple: the app receipt. Google: the purchase token. Mock: a scenario key. */
  receipt: string;
  /** The store's own identifier, used to de-duplicate the local log. */
  transactionId: string;
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
  /**
   * What the store says this customer currently owns.
   *
   * Both stores leave lapsed subscriptions out of this list, so an entry here
   * is the entitlement itself. Throws when the store cannot be reached, so the
   * caller can tell "not subscribed" apart from "could not ask" — treating the
   * second as the first would sign a paying customer out on a plane.
   */
  getActivePurchases(): Promise<ActivePurchase[]>;
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

/**
 * The purchase is real but not complete: iOS Ask to Buy awaiting a parent, or
 * a Play payment method that settles later. Never an error to the customer —
 * they have done their part.
 */
export class StorePurchaseDeferred extends Error {
  constructor(
    message = 'Your purchase is waiting to be approved. It will unlock as soon as it clears.',
  ) {
    super(message);
    this.name = 'StorePurchaseDeferred';
  }
}

export class StoreUnavailable extends Error {
  constructor(message = 'In-app purchases are not available on this device.') {
    super(message);
    this.name = 'StoreUnavailable';
  }
}

/** How long to wait for the store to confirm before telling the user. */
const PURCHASE_TIMEOUT_MS = 120_000;

/**
 * Native store adapter, backed by react-native-iap.
 *
 * The module is resolved at runtime so the JavaScript bundle still runs in Expo
 * Go, where no billing native code is linked. Whatever the store returns is
 * only ever a receipt — entitlement is decided from what the store says the
 * customer owns, never from a flag this app wrote.
 *
 * Two things here are load-bearing, and getting either wrong means a customer
 * is charged and not served:
 *
 * 1. **The connection stays open.** Both stores deliver a completed purchase
 *    through a listener, not through the promise that started it. Closing the
 *    connection after each call — as this adapter used to — tears that listener
 *    down in the window the transaction arrives in.
 * 2. **The listener is the source of the result.** `requestSubscription` often
 *    resolves with nothing while the real transaction follows moments later,
 *    and for an Ask-to-Buy purchase it may follow days later. A waiter is
 *    registered before the request so an instant answer cannot be missed.
 */
export class NativeStoreProvider implements StoreProvider {
  readonly platform: BillingPlatform;

  private module: IapModule | null = null;
  private connection: Promise<IapModule> | null = null;
  private listeners: Array<{ remove(): void }> = [];
  private waiters = new Map<string, PurchaseWaiter>();
  /** Transactions the store delivered with nobody waiting — redelivered ones. */
  private unclaimed: IapPurchase[] = [];

  /**
   * @param os          Which store's response shapes to expect.
   * @param resolveModule  Returns the linked billing module, or null where
   *                       there is none — Expo Go links no native code.
   */
  constructor(
    private readonly os: DeviceOs,
    private readonly resolveModule: () => IapModule | null,
  ) {
    this.platform = os === 'ios' ? 'apple' : 'google';
  }

  get available(): boolean {
    return this.loadModule() !== null;
  }

  private loadModule(): IapModule | null {
    if (this.module) return this.module;
    const resolved = this.resolveModule();
    // Expo Go resolves the JS but links no native module, so the functions
    // exist while the bridge does not.
    if (typeof resolved?.initConnection !== 'function') return null;
    this.module = resolved;
    return resolved;
  }

  /**
   * Opens the billing connection once and leaves it open.
   *
   * Staying connected is what lets the store hand back a transaction it could
   * not deliver earlier — an interrupted purchase, or one approved by a parent
   * hours later. A failed attempt clears the cached promise so the next call
   * retries rather than inheriting the failure forever.
   */
  private async connect(): Promise<IapModule> {
    if (this.connection) return this.connection;

    const iap = this.loadModule();
    if (!iap) throw new StoreUnavailable();

    this.connection = (async () => {
      // StoreKit 2, explicitly. The library defaults to StoreKit 1, where
      // `getAvailablePurchases` returns the whole receipt — expired
      // subscriptions included — and the active-only filter is ignored. Since
      // entitlement here is "the store says you own it", that default would
      // leave a lapsed subscriber with the paid product forever. Expo SDK 52
      // requires iOS 15.1, so StoreKit 2 is available on every device that can
      // run this app.
      if (this.os === 'ios' && typeof iap.setup === 'function') {
        iap.setup({ storekitMode: 'STOREKIT2_MODE' });
      }

      await iap.initConnection();
      // Clears purchases Play left pending from an interrupted flow; without
      // this they can block a new purchase of the same subscription.
      if (this.os === 'android') {
        await iap.flushFailedPurchasesCachedAsPendingAndroid().catch(() => undefined);
      }
      this.registerListeners(iap);
      return iap;
    })();

    try {
      return await this.connection;
    } catch (error) {
      this.connection = null;
      throw error;
    }
  }

  private registerListeners(iap: IapModule): void {
    if (this.listeners.length > 0) return;
    if (typeof iap.purchaseUpdatedListener !== 'function') return;

    this.listeners.push(
      iap.purchaseUpdatedListener((purchase) => this.deliver(purchase)),
      iap.purchaseErrorListener((error) => this.reject(error)),
    );
  }

  /** Closes the connection. Only for teardown — not after each purchase. */
  async disconnect(): Promise<void> {
    for (const listener of this.listeners) listener.remove();
    this.listeners = [];
    const iap = this.module;
    this.connection = null;
    if (iap) await iap.endConnection().catch(() => undefined);
  }

  /** A completed transaction arriving from the store. */
  private deliver(purchase: IapPurchase): void {
    if (!purchase?.productId) return;

    // Play reports a purchase awaiting a slow payment method. No money has
    // moved, so this is not an entitlement and must not read as one.
    if (this.os === 'android' && purchase.purchaseStateAndroid === 2) {
      this.waiters.get(purchase.productId)?.reject(new StorePurchaseDeferred());
      return;
    }

    const waiter = this.waiters.get(purchase.productId);
    if (waiter) {
      try {
        waiter.resolve(this.toStorePurchase(purchase, purchase.productId));
      } catch (error) {
        waiter.reject(error);
      }
      return;
    }

    // Nobody was waiting: the store is redelivering something it could not
    // hand over earlier. Keep it so a restore can pick it up.
    if (!this.unclaimed.some((held) => transactionIdOf(held) === transactionIdOf(purchase))) {
      this.unclaimed.push(purchase);
    }
  }

  /** A failure arriving from the store, rather than from our own call. */
  private reject(error: unknown): void {
    const deferred = isDeferred(error);
    for (const waiter of this.waiters.values()) {
      if (isCancellation(error)) waiter.reject(new StorePurchaseCancelled());
      else if (deferred) waiter.reject(new StorePurchaseDeferred());
      else waiter.reject(new StoreUnavailable(storeMessage(error)));
    }
  }

  /**
   * Registers interest in the next transaction for a product, before the
   * request is made — a store that answers immediately must not outrun us.
   */
  private awaitPurchase(productId: string): {
    promise: Promise<StorePurchase>;
    cancel: () => void;
  } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (): void => {
      settled = true;
      if (timer) clearTimeout(timer);
      this.waiters.delete(productId);
    };

    const promise = new Promise<StorePurchase>((resolve, reject) => {
      this.waiters.set(productId, {
        resolve: (purchase) => {
          if (settled) return;
          finish();
          resolve(purchase);
        },
        reject: (error) => {
          if (settled) return;
          finish();
          reject(error);
        },
      });

      timer = setTimeout(() => {
        this.waiters.get(productId)?.reject(
          new StoreUnavailable(
            'The store did not confirm that purchase. If you were charged, use Restore purchase.',
          ),
        );
      }, PURCHASE_TIMEOUT_MS);
    });

    return { promise, cancel: finish };
  }

  async getPrices(productIds: string[]): Promise<StorePrice[]> {
    if (productIds.length === 0) return [];
    try {
      const iap = await this.connect();
      const subscriptions = await iap.getSubscriptions({ skus: productIds });
      return subscriptions
        .map((subscription) => readStorePrice(subscription, this.os))
        .filter((price): price is StorePrice => price !== null);
    } catch {
      // An unreachable store must not empty the paywall — the bundled prices
      // stand in until it answers.
      return [];
    }
  }

  async getActivePurchases(): Promise<ActivePurchase[]> {
    const iap = await this.connect();
    // Asked for explicitly rather than relying on the default, because this
    // single flag is the difference between a lapsed subscriber losing access
    // and keeping it.
    const purchases = await iap.getAvailablePurchases({ onlyIncludeActiveItems: true });
    return [...purchases, ...this.unclaimed]
      .map((purchase) => readActivePurchase(purchase, this.os, this.platform))
      .filter((entry): entry is ActivePurchase => entry !== null);
  }

  async purchase(productId: string): Promise<StorePurchase> {
    const iap = await this.connect();

    const subscriptions = await iap.getSubscriptions({ skus: [productId] });
    const subscription = subscriptions.find((item) => item.productId === productId);
    if (!subscription) {
      throw new StoreUnavailable('That membership is not available on this device.');
    }

    const delivered = this.awaitPurchase(productId);

    try {
      // Play Billing 5 requires the base plan's offer token; StoreKit takes the
      // sku alone. The transaction is deliberately not finished here — that
      // happens only once the purchase has been recorded.
      let result;
      if (this.os === 'android') {
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

      // Some versions resolve with the transaction itself. Use it and stop
      // waiting; most resolve with nothing and the listener delivers instead.
      const immediate = Array.isArray(result) ? result[0] : result;
      if (immediate && receiptOf(immediate, this.os)) {
        delivered.cancel();
        return this.toStorePurchase(immediate, productId);
      }
    } catch (error) {
      delivered.cancel();

      if (isCancellation(error)) throw new StorePurchaseCancelled();
      if (isDeferred(error)) throw new StorePurchaseDeferred();

      // The customer already owns this — bought on another device, or a
      // previous purchase that was never finished. That is an entitlement, not
      // an error, so read it back rather than showing a failure.
      if (isAlreadyOwned(error)) {
        const owned = await this.ownedPurchase(productId);
        if (owned) return owned;
      }

      if (error instanceof StoreUnavailable) throw error;
      throw new StoreUnavailable(storeMessage(error));
    }

    return delivered.promise;
  }

  async restore(): Promise<StorePurchase | null> {
    const iap = await this.connect();
    const purchases = [
      ...(await iap.getAvailablePurchases({ onlyIncludeActiveItems: true })),
      ...this.unclaimed,
    ];

    // The most recent entitlement is the one worth reading back.
    const purchase = [...purchases]
      .sort((a, b) => (b.transactionDate ?? 0) - (a.transactionDate ?? 0))
      .find((item) => Boolean(receiptOf(item, this.os)));

    return purchase ? this.toStorePurchase(purchase, purchase.productId) : null;
  }

  async finishPurchase(purchase: StorePurchase): Promise<void> {
    if (purchase.handle === undefined) return;
    const iap = await this.connect();
    const handle = purchase.handle as IapPurchase;

    // A subscription is never consumed.
    await iap.finishTransaction({ purchase: handle, isConsumable: false });

    this.unclaimed = this.unclaimed.filter(
      (held) => transactionIdOf(held) !== transactionIdOf(handle),
    );
  }

  /** Reads back a product the store says is already owned. */
  private async ownedPurchase(productId: string): Promise<StorePurchase | null> {
    try {
      const iap = await this.connect();
      const purchases = [
        ...(await iap.getAvailablePurchases({ onlyIncludeActiveItems: true })),
        ...this.unclaimed,
      ];
      const owned = purchases.find(
        (item) => item.productId === productId && Boolean(receiptOf(item, this.os)),
      );
      return owned ? this.toStorePurchase(owned, productId) : null;
    } catch {
      return null;
    }
  }

  private toStorePurchase(purchase: IapPurchase, fallbackProductId: string): StorePurchase {
    const receipt = receiptOf(purchase, this.os);
    if (!receipt) throw new StoreUnavailable('That purchase could not be verified.');
    return {
      platform: this.platform,
      receipt,
      transactionId: transactionIdOf(purchase),
      productId: purchase.productId ?? fallbackProductId,
      handle: purchase,
    };
  }
}

interface PurchaseWaiter {
  resolve: (purchase: StorePurchase) => void;
  reject: (error: unknown) => void;
}

/** iOS hands back the app receipt; Android hands back a purchase token. */
function receiptOf(purchase: IapPurchase, os: DeviceOs): string {
  return (os === 'ios' ? purchase.transactionReceipt : purchase.purchaseToken) ?? '';
}

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function isCancellation(error: unknown): boolean {
  return codeOf(error) === 'E_USER_CANCELLED';
}

function isAlreadyOwned(error: unknown): boolean {
  return codeOf(error) === 'E_ALREADY_OWNED';
}

function isDeferred(error: unknown): boolean {
  return codeOf(error) === 'E_DEFERRED_PAYMENT';
}

/** Stable identity for a transaction across the two stores' shapes. */
function transactionIdOf(purchase: IapPurchase): string {
  return purchase.transactionId ?? purchase.purchaseToken ?? `${purchase.productId}-${purchase.transactionDate ?? 0}`;
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

  /**
   * The mock store owns no entitlement of its own. A development purchase is
   * recorded by the caller, exactly as a real one is.
   */
  async getActivePurchases(): Promise<ActivePurchase[]> {
    return [];
  }

  async purchase(productId: string): Promise<StorePurchase> {
    // A short delay so the loading state is visible during testing.
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (this.scenario === 'mock-cancel') throw new StorePurchaseCancelled();
    return {
      platform: 'mock',
      receipt: this.scenario,
      transactionId: `mock-${productId}`,
      productId,
    };
  }

  async restore(): Promise<StorePurchase | null> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      platform: 'mock',
      receipt: 'mock-success',
      transactionId: `mock-${SUBSCRIPTION_PRODUCT_ID}`,
      productId: SUBSCRIPTION_PRODUCT_ID,
    };
  }

  /** Nothing to acknowledge — no real transaction was opened. */
  async finishPurchase(): Promise<void> {}
}

export interface IapPurchase {
  productId: string;
  transactionReceipt?: string;
  purchaseToken?: string;
  transactionDate?: number;
  transactionId?: string;
  /** Play only: whether the subscription is set to renew. */
  autoRenewingAndroid?: boolean;
  /** Play only: 1 means purchased, 2 means pending. */
  purchaseStateAndroid?: number;
  /** Milliseconds since the epoch, when either store reports an expiry. */
  expirationDateIos?: number;
  expiryTimeMillis?: string;
}

/**
 * Normalises one owned purchase, across the two stores' shapes.
 *
 * An expiry is carried through only when the store actually stated one. It is
 * never estimated from the purchase date: a renewal date shown as fact and
 * quietly wrong is worse than showing none and pointing at the store.
 */
function readActivePurchase(
  purchase: IapPurchase,
  os: DeviceOs,
  platform: BillingPlatform,
): ActivePurchase | null {
  if (!purchase.productId) return null;
  // Play reports a pending purchase — awaiting a slow payment method — which
  // is not yet an entitlement.
  if (os === 'android' && purchase.purchaseStateAndroid === 2) return null;

  const expiryMs =
    purchase.expirationDateIos ??
    (purchase.expiryTimeMillis ? Number(purchase.expiryTimeMillis) : undefined);

  return {
    productId: purchase.productId,
    platform,
    transactionId:
      purchase.transactionId ?? purchase.purchaseToken ?? `${purchase.productId}-${purchase.transactionDate ?? 0}`,
    purchasedAt: new Date(purchase.transactionDate ?? Date.now()).toISOString(),
    expiresAt:
      expiryMs !== undefined && Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null,
    autoRenewing: typeof purchase.autoRenewingAndroid === 'boolean' ? purchase.autoRenewingAndroid : null,
  };
}

interface IapPricingPhase {
  formattedPrice?: string;
  priceCurrencyCode?: string;
  /** Play reports amounts in millionths of the currency unit. */
  priceAmountMicros?: string;
  billingPeriod?: string;
}

export interface IapSubscription {
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
function readStorePrice(subscription: IapSubscription, os: DeviceOs): StorePrice | null {
  if (os === 'android') {
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

export interface IapModule {
  initConnection(): Promise<boolean>;
  endConnection(): Promise<boolean>;
  flushFailedPurchasesCachedAsPendingAndroid(): Promise<boolean>;
  getSubscriptions(request: { skus: string[] }): Promise<IapSubscription[]>;
  requestSubscription(
    request:
      | { sku: string; andDangerouslyFinishTransactionAutomaticallyIOS?: boolean }
      | { subscriptionOffers: Array<{ sku: string; offerToken: string }> },
  ): Promise<IapPurchase | IapPurchase[] | null | void>;
  /**
   * `onlyIncludeActiveItems` is honoured by StoreKit 2 and by Play Billing.
   * Under StoreKit 1 it is silently ignored, which is why `setup` above pins
   * StoreKit 2 rather than trusting the library's default.
   */
  getAvailablePurchases(options?: { onlyIncludeActiveItems?: boolean }): Promise<IapPurchase[]>;
  /** Selects the StoreKit generation. iOS only; absent on older library builds. */
  setup?(options: { storekitMode: 'STOREKIT1_MODE' | 'STOREKIT_HYBRID_MODE' | 'STOREKIT2_MODE' }): void;
  purchaseUpdatedListener(listener: (purchase: IapPurchase) => void): { remove(): void };
  purchaseErrorListener(listener: (error: unknown) => void): { remove(): void };
  finishTransaction(request: { purchase: IapPurchase; isConsumable?: boolean }): Promise<unknown>;
}
