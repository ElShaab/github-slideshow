/**
 * What happens when StoreKit 2 cannot be engaged.
 *
 * This is the failure that took the membership screens down in a real build.
 * `setup({storekitMode: 'STOREKIT2_MODE'})` is synchronous and makes a blocking
 * synchronous native call to ask whether StoreKit 2 is available. Under the
 * bridgeless runtime this app enables, that method is not exposed — so instead
 * of answering "no" it throws `undefined is not a function`, and because the
 * library points itself at the StoreKit 2 module *before* making that call, it
 * is left aimed at a module it never confirmed and every later call throws the
 * same error.
 *
 * The fake below reproduces exactly that: it throws for STOREKIT2_MODE, stays
 * poisoned until asked for STOREKIT1_MODE, and throws from every other entry
 * point while poisoned.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  NativeStoreProvider,
  purchaseHasLapsed,
  type IapModule,
} from '../src/state/storeAdapter';

const MONTHLY = 'getfit_membership_monthly';
const DAY = 86_400_000;

/** react-native-iap as it behaves when the synchronous availability call is absent. */
class BridgelessStore {
  modeCalls: string[] = [];
  /** True while the library points at a StoreKit 2 module it never confirmed. */
  poisoned = false;
  connections = 0;
  owned: Array<Record<string, unknown>> = [];

  /** Every library entry point re-checks availability while poisoned. */
  private checkAvailability(): void {
    if (this.poisoned) throw new TypeError('undefined is not a function');
  }

  get module(): IapModule {
    return {
      setup: (options: { storekitMode: string }) => {
        this.modeCalls.push(options.storekitMode);
        if (options.storekitMode === 'STOREKIT2_MODE') {
          // The module pointer is moved first, then the call throws.
          this.poisoned = true;
          throw new TypeError('undefined is not a function');
        }
        // Asking for StoreKit 1 re-aims the library before it calls anything.
        this.poisoned = false;
      },
      initConnection: async () => {
        this.checkAvailability();
        this.connections += 1;
        return true;
      },
      endConnection: async () => true,
      flushFailedPurchasesCachedAsPendingAndroid: async () => true,
      getSubscriptions: async () => {
        this.checkAvailability();
        return [{ productId: MONTHLY, localizedPrice: '$4.99', currency: 'USD', price: '4.99' }] as never;
      },
      getAvailablePurchases: async () => {
        this.checkAvailability();
        return this.owned as never;
      },
      requestSubscription: async () => undefined as never,
      finishTransaction: async () => true,
      purchaseUpdatedListener: () => ({ remove: () => undefined }),
      purchaseErrorListener: () => ({ remove: () => undefined }),
    } as unknown as IapModule;
  }
}

const provider = (store: BridgelessStore): NativeStoreProvider =>
  new NativeStoreProvider('ios', () => store.module);

/** The fallback is meant to be loud; the test output does not need to be. */
let warnings: unknown[][] = [];
const realWarn = console.warn;

beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
});
afterEach(() => {
  console.warn = realWarn;
});

describe('when the StoreKit 2 switch throws', () => {
  test('the billing connection still opens', async () => {
    const store = new BridgelessStore();
    await provider(store).getActivePurchases();
    assert.equal(store.connections, 1);
  });

  test('the library is put back on StoreKit 1 rather than left poisoned', async () => {
    const store = new BridgelessStore();
    await provider(store).getActivePurchases();

    assert.deepEqual(store.modeCalls, ['STOREKIT2_MODE', 'STOREKIT1_MODE']);
    assert.equal(store.poisoned, false);
  });

  test('membership can be read — this is the screen that broke', async () => {
    const store = new BridgelessStore();
    store.owned = [
      { productId: MONTHLY, transactionId: 'tx-1', transactionReceipt: 'r', transactionDate: Date.now() },
    ];

    const active = await provider(store).getActivePurchases();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.productId, MONTHLY);
  });

  test('prices still come back, so the paywall shows the store’s own figures', async () => {
    const store = new BridgelessStore();
    const prices = await provider(store).getPrices([MONTHLY]);
    assert.equal(prices[0]?.localizedPrice, '$4.99');
  });

  test('a second call does not throw, because nothing stayed poisoned', async () => {
    const store = new BridgelessStore();
    const native = provider(store);
    await native.getActivePurchases();
    await native.getActivePurchases();
    // Connected once and reused; the switch is not re-attempted per call.
    assert.equal(store.connections, 1);
  });

  test('the downgrade is reported, because it changes how membership is decided', async () => {
    const store = new BridgelessStore();
    await provider(store).getActivePurchases();
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0]), /StoreKit 1/);
  });
});

describe('a lapsed subscription on StoreKit 1', () => {
  test('is not served, even though the active-only flag was ignored', async () => {
    // StoreKit 1 hands back the whole receipt, expired entries included. The
    // adapter used to trust the flag; here it checks the expiry itself.
    const store = new BridgelessStore();
    store.owned = [
      {
        productId: MONTHLY,
        transactionId: 'tx-old',
        transactionReceipt: 'r',
        transactionDate: Date.now() - 60 * DAY,
        expirationDateIos: Date.now() - DAY,
      },
    ];

    assert.deepEqual(await provider(store).getActivePurchases(), []);
  });

  test('and restoring it does not report a success that unlocks nothing', async () => {
    const store = new BridgelessStore();
    store.owned = [
      {
        productId: MONTHLY,
        transactionId: 'tx-old',
        transactionReceipt: 'r',
        transactionDate: Date.now() - 60 * DAY,
        expirationDateIos: Date.now() - DAY,
      },
    ];

    assert.equal(await provider(store).restore(), null);
  });

  test('a current subscription is still served', async () => {
    const store = new BridgelessStore();
    store.owned = [
      {
        productId: MONTHLY,
        transactionId: 'tx-now',
        transactionReceipt: 'r',
        transactionDate: Date.now(),
        expirationDateIos: Date.now() + 20 * DAY,
      },
    ];

    const active = await provider(store).getActivePurchases();
    assert.equal(active.length, 1);
  });
});

describe('deciding whether the store says a subscription has ended', () => {
  const now = Date.parse('2026-09-23T00:00:00.000Z');

  test('an expiry in the past means it has', () => {
    assert.equal(purchaseHasLapsed({ productId: MONTHLY, expirationDateIos: now - DAY }, now), true);
  });

  test('an expiry in the future means it has not', () => {
    assert.equal(purchaseHasLapsed({ productId: MONTHLY, expirationDateIos: now + DAY }, now), false);
  });

  test("Play's expiry, which arrives as a string, is read too", () => {
    assert.equal(
      purchaseHasLapsed({ productId: MONTHLY, expiryTimeMillis: String(now - DAY) }, now),
      true,
    );
  });

  test('no stated expiry is never treated as expired', () => {
    // Guessing one from the purchase date would revoke a paying customer's
    // membership, which is far worse than the revenue it would recover.
    assert.equal(purchaseHasLapsed({ productId: MONTHLY }, now), false);
    assert.equal(
      purchaseHasLapsed({ productId: MONTHLY, transactionDate: now - 400 * DAY }, now),
      false,
    );
  });

  test('an unreadable expiry is not treated as expired either', () => {
    assert.equal(purchaseHasLapsed({ productId: MONTHLY, expiryTimeMillis: 'soon' }, now), false);
  });
});
