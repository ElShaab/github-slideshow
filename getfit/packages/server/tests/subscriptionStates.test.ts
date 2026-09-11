/**
 * Subscription state machine against a real database.
 *
 * Entitlement is the gate for every paid feature, so each state it can reach is
 * exercised here: none → failed → active → cancelled → expired → restored.
 *
 * Skipped automatically when no database is reachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.MOCK_BILLING = 'true';
process.env.DEV_MODE = 'true';
process.env.LOG_LEVEL = 'error';

let available = true;
let userId = '';

before(async () => {
  const { pool } = await import('../src/db/pool');
  try {
    await pool.query('SELECT 1');
  } catch {
    available = false;
    return;
  }
  const { runMigrations } = await import('../src/db/migrate');
  const { seed } = await import('../src/db/seed');
  await runMigrations();
  await seed();

  const { userRepository } = await import('../src/repositories/userRepository');
  const user = await userRepository.createGuest();
  userId = user.id;
});

after(async () => {
  if (available && userId) {
    const { userRepository } = await import('../src/repositories/userRepository');
    await userRepository.deleteAccount(userId).catch(() => undefined);
  }
  const { closePool } = await import('../src/db/pool');
  await closePool().catch(() => undefined);
});

describe('subscription entitlement', () => {
  test('a user with no subscription is not entitled', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');

    const entitlement = await subscriptionService.getEntitlement(userId);
    assert.equal(entitlement.active, false);
    assert.equal(entitlement.status, 'none');
    assert.equal(entitlement.expiresAt, null);
  });

  test('a declined purchase records failed and grants nothing', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');

    await assert.rejects(
      subscriptionService.purchase({ userId, platform: 'mock', receipt: 'mock-failed' }),
      /payment could not be completed|could not be completed/i,
    );

    const entitlement = await subscriptionService.getEntitlement(userId);
    assert.equal(entitlement.active, false);
    assert.equal(entitlement.status, 'failed');
  });

  test('a verified purchase activates the membership', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');

    const result = await subscriptionService.purchase({
      userId,
      platform: 'mock',
      receipt: 'mock-success',
    });

    assert.equal(result.entitlement.active, true);
    assert.equal(result.entitlement.status, 'active');
    assert.ok(result.entitlement.expiresAt);
    assert.ok(new Date(result.entitlement.expiresAt).getTime() > Date.now());
  });

  test('a cancelled membership keeps access until the paid period ends', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');

    const entitlement = await subscriptionService.cancel(userId);
    assert.equal(entitlement.status, 'cancelled');
    // This is the rule both stores follow: cancelling stops renewal, it does
    // not revoke the period the user already paid for.
    assert.equal(entitlement.active, true);
  });

  test('a period that has ended expires on the next evaluation', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');
    const { subscriptionRepository } = await import('../src/repositories/subscriptionRepository');

    await subscriptionRepository.upsert({
      userId,
      status: 'active',
      platform: 'mock',
      productId: 'getfit_membership_monthly',
      priceUsd: 5,
      originalTransactionId: 'mock-test',
      currentPeriodStart: new Date(Date.now() - 40 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() - 1000),
      cancelAtPeriodEnd: false,
    });

    const entitlement = await subscriptionService.getEntitlement(userId);
    assert.equal(entitlement.active, false);
    assert.equal(entitlement.status, 'expired');

    // The transition is persisted, not just computed for this one call.
    const stored = await subscriptionRepository.get(userId);
    assert.equal(stored?.status, 'expired');
  });

  test('an expired purchase from the store does not grant access', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');

    const result = await subscriptionService.purchase({
      userId,
      platform: 'mock',
      receipt: 'mock-expired',
    });
    assert.equal(result.entitlement.active, false);
    assert.equal(result.entitlement.status, 'expired');
  });

  test('a revoked purchase is rejected', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');

    await assert.rejects(
      subscriptionService.purchase({ userId, platform: 'mock', receipt: 'mock-revoked' }),
      /no longer valid/i,
    );
  });

  test('restoring a valid purchase brings access back', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionService } = await import('../src/services/subscriptionService');

    const result = await subscriptionService.restore({
      userId,
      platform: 'mock',
      receipt: 'mock-success',
    });
    assert.equal(result.entitlement.active, true);
    assert.equal(result.entitlement.status, 'restored');
  });

  test('every transition is written to the audit trail', async (t) => {
    if (!available) return t.skip('No database available');
    const { subscriptionRepository } = await import('../src/repositories/subscriptionRepository');

    const events = await subscriptionRepository.listEvents(userId, 100);
    const types = new Set(events.map((event) => event.event_type as string));

    for (const expected of [
      'purchase_attempt',
      'purchase_failed',
      'purchase_verified',
      'cancellation_requested',
      'period_ended',
      'purchase_revoked',
      'purchase_restored',
    ]) {
      assert.ok(types.has(expected), `missing audit event: ${expected}`);
    }
  });

});
