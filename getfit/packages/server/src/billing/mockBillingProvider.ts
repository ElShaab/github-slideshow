import { SUBSCRIPTION_PRODUCT_ID, planForProduct } from '@getfit/shared';
import {
  BillingVerificationError,
  type BillingProvider,
  type PurchaseVerificationRequest,
  type VerifiedPurchase,
} from './types';

/**
 * Development billing provider.
 *
 * The receipt string doubles as a scenario selector so every subscription state
 * can be exercised end to end without a real store account:
 *
 *   mock-success            → a fresh period, sized to the plan
 *   mock-expired            → a period that ended yesterday
 *   mock-cancelled          → active but set to cancel at period end
 *   mock-failed             → the store rejects the purchase
 *   mock-revoked            → refunded / revoked by the store
 *   mock-expiring-<minutes> → a period ending in N minutes, for expiry testing
 */
export class MockBillingProvider implements BillingProvider {
  readonly platform = 'mock' as const;

  async verify(request: PurchaseVerificationRequest): Promise<VerifiedPurchase> {
    const scenario = (request.receipt || 'mock-success').trim();
    const now = new Date();
    const productId = request.productId || SUBSCRIPTION_PRODUCT_ID;
    const originalTransactionId = `mock_${hash(scenario + productId)}`;
    // The granted period follows the plan, so a yearly purchase is exercised
    // as a year rather than silently behaving like the monthly one.
    const periodDays = planForProduct(productId)?.period === 'year' ? 365 : 30;

    if (scenario === 'mock-failed') {
      throw new BillingVerificationError('The payment was declined.', 'declined');
    }

    if (scenario === 'mock-expired') {
      return {
        valid: true,
        productId,
        originalTransactionId,
        periodStart: daysFrom(now, -(periodDays + 1)),
        periodEnd: daysFrom(now, -1),
        cancelAtPeriodEnd: false,
        revoked: false,
        environment: 'mock',
        raw: { scenario },
      };
    }

    if (scenario === 'mock-revoked') {
      return {
        valid: false,
        productId,
        originalTransactionId,
        periodStart: daysFrom(now, -10),
        periodEnd: daysFrom(now, 20),
        cancelAtPeriodEnd: false,
        revoked: true,
        environment: 'mock',
        raw: { scenario },
      };
    }

    const expiringMatch = /^mock-expiring-(\d+)$/.exec(scenario);
    if (expiringMatch) {
      const minutes = Number.parseInt(expiringMatch[1], 10);
      return {
        valid: true,
        productId,
        originalTransactionId,
        periodStart: now,
        periodEnd: new Date(now.getTime() + minutes * 60_000),
        cancelAtPeriodEnd: false,
        revoked: false,
        environment: 'mock',
        raw: { scenario },
      };
    }

    return {
      valid: true,
      productId,
      originalTransactionId,
      periodStart: now,
      periodEnd: daysFrom(now, periodDays),
      cancelAtPeriodEnd: scenario === 'mock-cancelled',
      revoked: false,
      environment: 'mock',
      raw: { scenario },
    };
  }
}

function daysFrom(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
