/**
 * On-device membership state.
 *
 * With no server, these rules are the whole gate on the paid product. The one
 * that matters most: a development grant must never unlock a release build,
 * because local storage is editable by anyone holding the device.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SUBSCRIPTION_PRODUCT_ID, type ActivePurchase } from '@getfit/shared';
import { BILLING_KEYS, LocalBilling, type KeyValueStore } from '../src/state/billingStore';
import type { StoreProvider } from '../src/state/storeAdapter';

class FakeStorage implements KeyValueStore {
  data = new Map<string, string>();
  failReads = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('storage unavailable');
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }

  /** Writes a raw value, as a person editing the file on disk would. */
  poke(key: string, value: unknown): void {
    this.data.set(key, JSON.stringify(value));
  }
}

const owned = (over: Partial<ActivePurchase> = {}): ActivePurchase => ({
  productId: SUBSCRIPTION_PRODUCT_ID,
  platform: 'apple',
  transactionId: 'tx-1',
  purchasedAt: new Date().toISOString(),
  expiresAt: null,
  autoRenewing: null,
  ...over,
});

/** A store that owns the given purchases, or cannot be reached at all. */
function fakeStore(result: ActivePurchase[] | Error): StoreProvider {
  return {
    platform: 'apple',
    available: true,
    async getPrices() {
      return [];
    },
    async getActivePurchases() {
      if (result instanceof Error) throw result;
      return result;
    },
    async purchase() {
      throw new Error('not used');
    },
    async restore() {
      return null;
    },
    async finishPurchase() {},
  };
}

describe('entitlement comes from the store', () => {
  test('a store that reports a purchase grants the membership', async () => {
    const storage = new FakeStorage();
    const billing = new LocalBilling(storage, false);

    const entitlement = await billing.resolveEntitlement(fakeStore([owned()]));
    assert.equal(entitlement.active, true);
    assert.equal(entitlement.productId, SUBSCRIPTION_PRODUCT_ID);
  });

  test('a store that reports nothing means not subscribed', async () => {
    const billing = new LocalBilling(new FakeStorage(), false);
    const entitlement = await billing.resolveEntitlement(fakeStore([]));
    assert.equal(entitlement.active, false);
    assert.equal(entitlement.status, 'none');
  });

  test('the answer is kept, so a later launch works offline', async () => {
    const storage = new FakeStorage();
    const billing = new LocalBilling(storage, false);

    await billing.resolveEntitlement(fakeStore([owned()]));
    // Now the store is unreachable — a basement, a plane, a flaky network.
    const offline = await billing.resolveEntitlement(fakeStore(new Error('unreachable')));

    assert.equal(offline.active, true, 'a paying customer was cut off when offline');
  });

  test('an unreachable store with nothing cached grants nothing', async () => {
    const billing = new LocalBilling(new FakeStorage(), false);
    const entitlement = await billing.resolveEntitlement(fakeStore(new Error('unreachable')));
    assert.equal(entitlement.active, false);
  });

  test('"not subscribed" overwrites a previous "subscribed"', async () => {
    // A refund or a lapse has to be able to take access away, or the cache
    // becomes a permanent membership.
    const storage = new FakeStorage();
    const billing = new LocalBilling(storage, false);

    await billing.resolveEntitlement(fakeStore([owned()]));
    const after = await billing.resolveEntitlement(fakeStore([]));

    assert.equal(after.active, false);
    // And the stored answer agrees, so the next offline launch also says no.
    const offline = await billing.resolveEntitlement(fakeStore(new Error('unreachable')));
    assert.equal(offline.active, false);
  });

  test('unreadable storage grants nothing rather than everything', async () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    const billing = new LocalBilling(storage, false);

    const entitlement = await billing.resolveEntitlement(fakeStore(new Error('unreachable')));
    assert.equal(entitlement.active, false);
  });
});

describe('a development grant cannot unlock a release build', () => {
  const grant = owned({ platform: 'mock', transactionId: 'mock-1' });

  test('a release build ignores the development key entirely', async () => {
    // This is the attack: edit local storage, claim a membership. A shipped
    // build must never read this key.
    const storage = new FakeStorage();
    storage.poke(BILLING_KEYS.devGrant, [grant]);
    const release = new LocalBilling(storage, false);

    const entitlement = await release.resolveEntitlement(fakeStore([]));
    assert.equal(entitlement.active, false, 'a planted grant unlocked a release build');
    assert.equal(entitlement.status, 'none');
  });

  test('a release build refuses to write one', async () => {
    const storage = new FakeStorage();
    const release = new LocalBilling(storage, false);

    await release.recordDevGrant(grant);
    assert.equal(storage.data.has(BILLING_KEYS.devGrant), false);
  });

  test('a development build honours it, or Expo Go cannot reach the product', async () => {
    const storage = new FakeStorage();
    const dev = new LocalBilling(storage, true);

    await dev.recordDevGrant(grant);
    const entitlement = await dev.resolveEntitlement(fakeStore([]));
    assert.equal(entitlement.active, true);
  });

  test('a development grant that has expired does not grant', async () => {
    const storage = new FakeStorage();
    const dev = new LocalBilling(storage, true);

    await dev.recordDevGrant(
      owned({
        platform: 'mock',
        transactionId: 'mock-expired',
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    );
    const entitlement = await dev.resolveEntitlement(fakeStore([]));
    assert.equal(entitlement.active, false);
    assert.equal(entitlement.status, 'expired');
  });

  test('a real purchase still wins over a development grant', async () => {
    const storage = new FakeStorage();
    const dev = new LocalBilling(storage, true);
    await dev.recordDevGrant(grant);

    const entitlement = await dev.resolveEntitlement(
      fakeStore([owned({ transactionId: 'tx-real', purchasedAt: new Date().toISOString() })]),
    );
    assert.ok(entitlement.active);
  });
});

describe('the purchase log', () => {
  const record = {
    productId: SUBSCRIPTION_PRODUCT_ID,
    platform: 'apple' as const,
    transactionId: 'tx-1',
    recordedAt: new Date().toISOString(),
    kind: 'purchase' as const,
    price: '$5.00',
  };

  test('keeps what was bought, and for how much', async () => {
    const billing = new LocalBilling(new FakeStorage(), false);
    await billing.recordPurchase(record);

    const [entry] = await billing.readPurchaseHistory();
    assert.equal(entry.productId, SUBSCRIPTION_PRODUCT_ID);
    assert.equal(entry.price, '$5.00');
  });

  test('a log entry is not a membership', async () => {
    // The log is a record, not a grant. Writing to it must not unlock
    // anything, or it becomes the bypass the dev-grant key is not.
    const billing = new LocalBilling(new FakeStorage(), false);
    await billing.recordPurchase(record);

    const entitlement = await billing.resolveEntitlement(fakeStore([]));
    assert.equal(entitlement.active, false);
  });

  test('starts empty and survives corrupt contents', async () => {
    const storage = new FakeStorage();
    assert.deepEqual(await new LocalBilling(storage, false).readPurchaseHistory(), []);

    storage.data.set(BILLING_KEYS.history, 'not json at all');
    assert.deepEqual(await new LocalBilling(storage, false).readPurchaseHistory(), []);
  });

  test('clearing removes every billing key', async () => {
    const storage = new FakeStorage();
    const billing = new LocalBilling(storage, true);
    await billing.recordPurchase(record);
    await billing.recordDevGrant(owned({ platform: 'mock' }));
    await billing.resolveEntitlement(fakeStore([owned()]));

    await billing.clear();
    assert.equal(storage.data.size, 0);
  });
});
