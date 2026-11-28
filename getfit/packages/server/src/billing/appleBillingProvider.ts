import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  BillingVerificationError,
  type BillingProvider,
  type PurchaseVerificationRequest,
  type VerifiedPurchase,
} from './types';

/**
 * Apple In-App Purchase verification.
 *
 * The client never decides whether a membership is active — it forwards the
 * receipt and this runs the server-to-server check with Apple. Production
 * receipts are tried first and the sandbox is retried on status 21007, which is
 * what Apple's review process requires.
 */
export class AppleBillingProvider implements BillingProvider {
  readonly platform = 'apple' as const;

  async verify(request: PurchaseVerificationRequest): Promise<VerifiedPurchase> {
    if (!env.appleSharedSecret) {
      throw new BillingVerificationError('Apple billing is not configured.', 'not_configured');
    }

    let response = await this.call(env.appleVerifyUrl, request.receipt);
    let environment: 'production' | 'sandbox' = 'production';

    if (response.status === 21007) {
      response = await this.call(env.appleSandboxVerifyUrl, request.receipt);
      environment = 'sandbox';
    }

    if (response.status !== 0) {
      logger.warn('Apple receipt verification failed', { status: response.status });
      throw new BillingVerificationError('That purchase could not be verified.', `apple_${response.status}`);
    }

    const renewals = response.latest_receipt_info ?? [];
    const matching = renewals
      .filter((item) => item.product_id === request.productId)
      .sort((a, b) => Number(b.expires_date_ms ?? 0) - Number(a.expires_date_ms ?? 0));
    const latest = matching[0];

    if (!latest) {
      throw new BillingVerificationError('No matching purchase was found.', 'no_transaction');
    }

    const renewalInfo = (response.pending_renewal_info ?? []).find(
      (info) => info.original_transaction_id === latest.original_transaction_id,
    );

    return {
      valid: true,
      productId: latest.product_id,
      originalTransactionId: latest.original_transaction_id,
      periodStart: new Date(Number(latest.purchase_date_ms)),
      periodEnd: new Date(Number(latest.expires_date_ms)),
      cancelAtPeriodEnd: renewalInfo?.auto_renew_status === '0',
      revoked: Boolean(latest.cancellation_date_ms),
      environment,
      // Only non-sensitive fields are retained for the audit log.
      raw: { environment, productId: latest.product_id, expiresDateMs: latest.expires_date_ms },
    };
  }

  private async call(url: string, receipt: string): Promise<AppleVerifyResponse> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          'receipt-data': receipt,
          password: env.appleSharedSecret,
          'exclude-old-transactions': true,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return (await response.json()) as AppleVerifyResponse;
    } catch (error) {
      logger.error('Apple verification request failed', error);
      throw new BillingVerificationError('We could not reach the App Store.', 'network');
    }
  }
}

interface AppleVerifyResponse {
  status: number;
  latest_receipt_info?: Array<{
    product_id: string;
    original_transaction_id: string;
    purchase_date_ms: string;
    expires_date_ms: string;
    cancellation_date_ms?: string;
  }>;
  pending_renewal_info?: Array<{
    original_transaction_id: string;
    auto_renew_status?: string;
  }>;
}
