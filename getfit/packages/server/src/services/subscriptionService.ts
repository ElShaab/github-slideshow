import {
  SUBSCRIPTION_PRICE_USD,
  SUBSCRIPTION_PRODUCT_ID,
  type BillingPlatform,
  type Entitlement,
  type Subscription,
  type SubscriptionStatus,
} from '@getfit/shared';
import { BillingVerificationError, getBillingProvider } from '../billing';
import { subscriptionRepository } from '../repositories/subscriptionRepository';
import { errors } from '../utils/errors';
import { logger } from '../utils/logger';

export interface PurchaseInput {
  userId: string;
  platform: BillingPlatform;
  receipt: string;
  productId?: string;
  packageName?: string;
}

/**
 * SubscriptionService
 *
 * The single source of truth for whether a user may use the paid product.
 * Entitlement is always recomputed on the server from a stored, store-verified
 * period — the client's own claim is never consulted.
 */
export class SubscriptionService {
  /**
   * Evaluates entitlement now. An `active` subscription whose period has
   * already ended is transitioned to `expired` here rather than waiting for a
   * background job, so the very next request is correctly gated.
   */
  async getEntitlement(userId: string, now = new Date()): Promise<Entitlement> {
    const subscription = await subscriptionRepository.get(userId);

    if (!subscription || subscription.status === 'none') {
      return {
        active: false,
        status: 'none',
        expiresAt: null,
        productId: null,
        platform: null,
        evaluatedAt: now.toISOString(),
      };
    }

    const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
    const withinPeriod = periodEnd !== null && periodEnd.getTime() > now.getTime();

    let status = subscription.status;

    // `cancelled` still grants access until the paid period runs out.
    const grantsAccess = status === 'active' || status === 'restored' || status === 'cancelled';

    if (grantsAccess && !withinPeriod) {
      status = 'expired';
      await subscriptionRepository.setStatus(userId, 'expired');
      await subscriptionRepository.recordEvent({
        userId,
        subscriptionId: subscription.id,
        eventType: 'period_ended',
        fromStatus: subscription.status,
        toStatus: 'expired',
        platform: subscription.platform,
        payload: { periodEnd: subscription.currentPeriodEnd },
      });
    }

    return {
      active: grantsAccess && withinPeriod,
      status,
      expiresAt: subscription.currentPeriodEnd,
      productId: subscription.productId || null,
      platform: subscription.platform,
      evaluatedAt: now.toISOString(),
    };
  }

  /** Verifies a store purchase and, if valid, grants the membership. */
  async purchase(input: PurchaseInput): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    const productId = input.productId ?? SUBSCRIPTION_PRODUCT_ID;
    const existing = await subscriptionRepository.get(input.userId);

    await subscriptionRepository.recordEvent({
      userId: input.userId,
      subscriptionId: existing?.id ?? null,
      eventType: 'purchase_attempt',
      fromStatus: existing?.status ?? null,
      toStatus: 'pending',
      platform: input.platform,
      payload: { productId },
    });

    let verified;
    try {
      const provider = getBillingProvider(input.platform);
      verified = await provider.verify({
        platform: input.platform,
        receipt: input.receipt,
        productId,
        packageName: input.packageName,
      });
    } catch (error) {
      const reason = error instanceof BillingVerificationError ? error.reason : 'unknown';
      logger.warn('Purchase verification failed', { reason, platform: input.platform });

      await subscriptionRepository.upsert({
        userId: input.userId,
        status: 'failed',
        platform: input.platform,
        productId,
        priceUsd: SUBSCRIPTION_PRICE_USD,
        originalTransactionId: existing?.id ? null : null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
      await subscriptionRepository.recordEvent({
        userId: input.userId,
        subscriptionId: existing?.id ?? null,
        eventType: 'purchase_failed',
        fromStatus: existing?.status ?? null,
        toStatus: 'failed',
        platform: input.platform,
        payload: { reason },
      });

      throw errors.paymentFailed();
    }

    if (!verified.valid || verified.revoked) {
      await subscriptionRepository.upsert({
        userId: input.userId,
        status: verified.revoked ? 'cancelled' : 'failed',
        platform: input.platform,
        productId,
        priceUsd: SUBSCRIPTION_PRICE_USD,
        originalTransactionId: verified.originalTransactionId,
        currentPeriodStart: verified.periodStart,
        currentPeriodEnd: verified.revoked ? new Date() : null,
        cancelAtPeriodEnd: verified.cancelAtPeriodEnd,
      });
      await subscriptionRepository.recordEvent({
        userId: input.userId,
        subscriptionId: existing?.id ?? null,
        eventType: verified.revoked ? 'purchase_revoked' : 'purchase_invalid',
        fromStatus: existing?.status ?? null,
        toStatus: verified.revoked ? 'cancelled' : 'failed',
        platform: input.platform,
        payload: verified.raw,
      });
      throw errors.paymentFailed('That purchase is no longer valid.');
    }

    const active = verified.periodEnd.getTime() > Date.now();
    const status: SubscriptionStatus = active
      ? verified.cancelAtPeriodEnd
        ? 'cancelled'
        : 'active'
      : 'expired';

    const subscription = await subscriptionRepository.upsert({
      userId: input.userId,
      status,
      platform: input.platform,
      productId: verified.productId,
      priceUsd: SUBSCRIPTION_PRICE_USD,
      originalTransactionId: verified.originalTransactionId,
      currentPeriodStart: verified.periodStart,
      currentPeriodEnd: verified.periodEnd,
      cancelAtPeriodEnd: verified.cancelAtPeriodEnd,
    });

    await subscriptionRepository.recordEvent({
      userId: input.userId,
      subscriptionId: subscription.id,
      eventType: 'purchase_verified',
      fromStatus: existing?.status ?? null,
      toStatus: status,
      platform: input.platform,
      payload: { environment: verified.environment, periodEnd: verified.periodEnd.toISOString() },
    });

    return { subscription, entitlement: await this.getEntitlement(input.userId) };
  }

  /** "Restore purchases" — re-verifies an existing receipt on a new device. */
  async restore(input: PurchaseInput): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    const result = await this.purchase(input);
    if (result.entitlement.active) {
      const restored = await subscriptionRepository.setStatus(input.userId, 'restored');
      await subscriptionRepository.recordEvent({
        userId: input.userId,
        subscriptionId: result.subscription.id,
        eventType: 'purchase_restored',
        fromStatus: result.subscription.status,
        toStatus: 'restored',
        platform: input.platform,
        payload: {},
      });
      return {
        subscription: restored ?? result.subscription,
        entitlement: await this.getEntitlement(input.userId),
      };
    }
    return result;
  }

  /**
   * Records a user-initiated cancellation. Access continues until the paid
   * period ends, which is how both stores behave.
   */
  async cancel(userId: string): Promise<Entitlement> {
    const existing = await subscriptionRepository.get(userId);
    if (!existing) throw errors.notFound('No membership found.');

    await subscriptionRepository.setStatus(userId, 'cancelled');
    await subscriptionRepository.recordEvent({
      userId,
      subscriptionId: existing.id,
      eventType: 'cancellation_requested',
      fromStatus: existing.status,
      toStatus: 'cancelled',
      platform: existing.platform,
      payload: {},
    });
    return this.getEntitlement(userId);
  }

  /** Development helper used by the dev-mode test harness. */
  async forceExpire(userId: string): Promise<Entitlement> {
    const existing = await subscriptionRepository.get(userId);
    if (!existing) throw errors.notFound('No membership found.');

    await subscriptionRepository.upsert({
      userId,
      status: 'expired',
      platform: existing.platform,
      productId: existing.productId,
      priceUsd: existing.priceUsd,
      originalTransactionId: null,
      currentPeriodStart: existing.currentPeriodStart ? new Date(existing.currentPeriodStart) : null,
      currentPeriodEnd: new Date(Date.now() - 1000),
      cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
    });
    await subscriptionRepository.recordEvent({
      userId,
      subscriptionId: existing.id,
      eventType: 'forced_expiry',
      fromStatus: existing.status,
      toStatus: 'expired',
      platform: existing.platform,
      payload: { dev: true },
    });
    return this.getEntitlement(userId);
  }
}

export const subscriptionService = new SubscriptionService();
