import type { BillingPlatform } from '@getfit/shared';

export interface PurchaseVerificationRequest {
  platform: BillingPlatform;
  /** Apple: base64 receipt. Google: purchase token. Mock: a scenario keyword. */
  receipt: string;
  productId: string;
  /** Google only. */
  packageName?: string;
}

export interface VerifiedPurchase {
  valid: boolean;
  productId: string;
  originalTransactionId: string;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  /** Set when the store reports the purchase as already refunded or revoked. */
  revoked: boolean;
  environment: 'production' | 'sandbox' | 'mock';
  raw: Record<string, unknown>;
}

export interface BillingProvider {
  readonly platform: BillingPlatform;
  verify(request: PurchaseVerificationRequest): Promise<VerifiedPurchase>;
}

export class BillingVerificationError extends Error {
  constructor(message: string, public readonly reason: string) {
    super(message);
    this.name = 'BillingVerificationError';
  }
}
