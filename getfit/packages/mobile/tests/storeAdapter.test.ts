/**
 * The purchase flow, against a fake store.
 *
 * Every case here is a way a real purchase goes wrong on a real device, and
 * each one ends with the customer charged. The adapter used to fail four of
 * them: it closed the billing connection immediately after asking to purchase,
 * registered no listener to receive the transaction, treated "you already own
 * this" as a failure, and reported a purchase awaiting parental approval as an
 * error.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  NativeStoreProvider,
  StorePurchaseCancelled,
  StorePurchaseDeferred,
  StoreUnavailable,
  type DeviceOs,
  type IapModule,
} from '../src/state/storeAdapter';

const MONTHLY = 'getfit_membership_monthly';

type Listener = (value: never) => void;

/**
 * A stand-in for react-native-iap that behaves like the real thing: the
 * promise from requestSubscription resolves with nothing, and the transaction
 * arrives separately through the listener.
 */
class FakeStore {
  connections = 0;
  endCalls = 0;
  finished: string[] = [];
  owned: Array<Record<string, unknown>> = [];
  purchaseListeners: Listener[] = [];
  errorListeners: Listener[] = [];
  /** What requestSubscription should do when called. */
  behaviour: 'deliver' | 'resolve-directly' | 'throw' = 'deliver';
  throwCode = 'E_UNKNOWN';
  private products: Array<Record<string, unknown>>;

  constructor(os: DeviceOs) {
    this.products =
      os === 'android'
        ? [
            {
              productId: MONTHLY,
              subscriptionOfferDetails: [
                {
                  offerToken: 'offer-1',
                  pricingPhases: {
                    pricingPhaseList: [
                      { formattedPrice: '£4.49', priceCurrencyCode: 'GBP', priceAmountMicros: '4490000' },
                    ],
                  },
                },
              ],
            },
          ]
        : [{ productId: MONTHLY, localizedPrice: '$5.00', currency: 'USD', price: '5' }];
  }

  private transaction(): Record<string, unknown> {
    return {
      productId: MONTHLY,
      transactionId: 'tx-1',
      transactionReceipt: 'receipt-data',
      purchaseToken: 'token-data',
      transactionDate: Date.now(),
    };
  }

  get module(): IapModule {
    return {
      initConnection: async () => {
        this.connections += 1;
        return true;
      },
      endConnection: async () => {
        this.endCalls += 1;
        return true;
      },
      flushFailedPurchasesCachedAsPendingAndroid: async () => true,
      getSubscriptions: async () => this.products as never,
      requestSubscription: async () => {
        if (this.behaviour === 'throw') {
          throw Object.assign(new Error('store said no'), { code: this.throwCode });
        }
        if (this.behaviour === 'resolve-directly') return this.transaction() as never;
        // The real library's usual shape: resolves empty, delivers later.
        setTimeout(() => this.emitPurchase(this.transaction()), 0);
        return undefined as never;
      },
      getAvailablePurchases: async () => this.owned as never,
      finishTransaction: async ({ purchase }: { purchase: { productId?: string } }) => {
        this.finished.push(purchase.productId ?? '');
        return true;
      },
      purchaseUpdatedListener: (listener: Listener) => {
        this.purchaseListeners.push(listener);
        return { remove: () => undefined };
      },
      purchaseErrorListener: (listener: Listener) => {
        this.errorListeners.push(listener);
        return { remove: () => undefined };
      },
    } as unknown as IapModule;
  }

  emitPurchase(purchase: Record<string, unknown>): void {
    for (const listener of this.purchaseListeners) listener(purchase as never);
  }

  emitError(code: string): void {
    for (const listener of this.errorListeners) listener({ code } as never);
  }
}

function build(os: DeviceOs = 'ios'): { store: FakeStore; provider: NativeStoreProvider } {
  const store = new FakeStore(os);
  return { store, provider: new NativeStoreProvider(os, () => store.module) };
}

describe('a purchase the store confirms through its listener', () => {
  test('completes, which the old adapter could not do at all', async () => {
    const { provider } = build();
    const purchase = await provider.purchase(MONTHLY);

    assert.equal(purchase.productId, MONTHLY);
    assert.equal(purchase.receipt, 'receipt-data');
    assert.equal(purchase.platform, 'apple');
  });

  test('the billing connection is still open when the transaction lands', async () => {
    // Closing it after the request is what dropped the transaction: the money
    // is taken and the app reports a failure.
    const { store, provider } = build();
    await provider.purchase(MONTHLY);
    assert.equal(store.endCalls, 0, 'the connection was closed before the store replied');
  });

  test('the connection is opened once across many calls', async () => {
    const { store, provider } = build();
    await provider.getPrices([MONTHLY]);
    await provider.purchase(MONTHLY);
    await provider.getActivePurchases();
    assert.equal(store.connections, 1);
  });

  test('a store that answers instantly is not missed', async () => {
    // The waiter is registered before the request, so there is no window in
    // which a transaction can arrive unobserved.
    const { store, provider } = build();
    store.behaviour = 'resolve-directly';
    const purchase = await provider.purchase(MONTHLY);
    assert.equal(purchase.receipt, 'receipt-data');
  });

  test('Android reads the purchase token rather than the receipt', async () => {
    const { provider } = build('android');
    const purchase = await provider.purchase(MONTHLY);
    assert.equal(purchase.receipt, 'token-data');
    assert.equal(purchase.platform, 'google');
  });
});

describe('purchases that must not read as failures', () => {
  test('already owning it returns the entitlement instead of an error', async () => {
    // Bought on another device, or a transaction that was never finished.
    // Showing "purchase failed" to someone who has paid is the worst outcome.
    const { store, provider } = build();
    store.behaviour = 'throw';
    store.throwCode = 'E_ALREADY_OWNED';
    store.owned = [
      { productId: MONTHLY, transactionId: 'tx-old', transactionReceipt: 'old-receipt', transactionDate: 1 },
    ];

    const purchase = await provider.purchase(MONTHLY);
    assert.equal(purchase.receipt, 'old-receipt');
  });

  test('awaiting approval is reported as deferred, not failed', async () => {
    const { store, provider } = build();
    store.behaviour = 'throw';
    store.throwCode = 'E_DEFERRED_PAYMENT';

    await assert.rejects(() => provider.purchase(MONTHLY), StorePurchaseDeferred);
  });

  test('a pending Play purchase is deferred, since no money has moved', async () => {
    const { store, provider } = build('android');
    const pending = provider.purchase(MONTHLY);
    // Play delivers the pending state through the same listener.
    setTimeout(
      () => store.emitPurchase({ productId: MONTHLY, purchaseStateAndroid: 2, purchaseToken: 'tok' }),
      0,
    );
    await assert.rejects(() => pending, StorePurchaseDeferred);
  });
});

describe('purchases that genuinely fail', () => {
  test('cancelling is reported as cancellation, not an error', async () => {
    const { store, provider } = build();
    store.behaviour = 'throw';
    store.throwCode = 'E_USER_CANCELLED';
    await assert.rejects(() => provider.purchase(MONTHLY), StorePurchaseCancelled);
  });

  test('a cancellation arriving through the listener is also honoured', async () => {
    const { store, provider } = build();
    const pending = provider.purchase(MONTHLY);
    setTimeout(() => store.emitError('E_USER_CANCELLED'), 0);
    await assert.rejects(() => pending, StorePurchaseCancelled);
  });

  test('a product the store does not sell fails before charging anyone', async () => {
    const { provider } = build();
    await assert.rejects(() => provider.purchase('getfit_membership_unknown'), StoreUnavailable);
  });

  test('an Android product with no active offer fails clearly', async () => {
    // Play returns the product but with no base-plan offer, so there is
    // nothing to buy. Better to say so than to start a flow that cannot work.
    const store = new FakeStore('android');
    const provider = new NativeStoreProvider('android', () => ({
      ...store.module,
      getSubscriptions: async () =>
        [{ productId: MONTHLY, subscriptionOfferDetails: [] }] as never,
    }));

    await assert.rejects(
      () => provider.purchase(MONTHLY),
      (error: Error) => {
        assert.match(error.message, /no active offer/);
        return true;
      },
    );
  });
});

describe('reading back what the customer owns', () => {
  test('a redelivered transaction with nobody waiting is not lost', async () => {
    // StoreKit replays a transaction that was never finished. Before, with no
    // listener at all, it went nowhere.
    const { store, provider } = build();
    await provider.getActivePurchases();
    store.emitPurchase({
      productId: MONTHLY,
      transactionId: 'tx-replay',
      transactionReceipt: 'replayed',
      transactionDate: Date.now(),
    });

    const restored = await provider.restore();
    assert.equal(restored?.receipt, 'replayed');
  });

  test('a pending Android purchase is not an entitlement', async () => {
    const { store, provider } = build('android');
    store.owned = [{ productId: MONTHLY, purchaseToken: 'tok', purchaseStateAndroid: 2 }];
    assert.deepEqual(await provider.getActivePurchases(), []);
  });

  test('restore returns nothing when nothing is owned', async () => {
    const { provider } = build();
    assert.equal(await provider.restore(), null);
  });

  test('finishing a transaction clears it from the redelivery set', async () => {
    const { store, provider } = build();
    const purchase = await provider.purchase(MONTHLY);
    await provider.finishPurchase(purchase);
    assert.deepEqual(store.finished, [MONTHLY]);
  });
});

describe('prices come through in the customer\'s currency', () => {
  test('iOS reports the StoreKit-formatted price', async () => {
    const { provider } = build('ios');
    const [price] = await provider.getPrices([MONTHLY]);
    assert.equal(price.localizedPrice, '$5.00');
    assert.equal(price.currencyCode, 'USD');
  });

  test('Android reads the recurring phase and converts from micros', async () => {
    const { provider } = build('android');
    const [price] = await provider.getPrices([MONTHLY]);
    assert.equal(price.localizedPrice, '£4.49');
    assert.equal(price.currencyCode, 'GBP');
    assert.equal(price.amount, 4.49);
  });

  test('an unreachable store leaves the paywall to its fallback', async () => {
    const provider = new NativeStoreProvider('ios', () => null);
    assert.deepEqual(await provider.getPrices([MONTHLY]), []);
  });
});
