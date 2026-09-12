import { createSign } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  BillingVerificationError,
  type BillingProvider,
  type PurchaseVerificationRequest,
  type VerifiedPurchase,
} from './types';

/**
 * Google Play Billing verification via the Android Publisher API.
 *
 * Authenticates with the configured service account using a signed JWT, then
 * reads the subscription purchase server-side. As with Apple, the client's
 * claim about its own subscription is never trusted.
 */
export class GoogleBillingProvider implements BillingProvider {
  readonly platform = 'google' as const;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  async verify(request: PurchaseVerificationRequest): Promise<VerifiedPurchase> {
    if (!env.googleServiceAccountJson) {
      throw new BillingVerificationError('Google billing is not configured.', 'not_configured');
    }

    const packageName = request.packageName ?? env.googlePackageName;
    const accessToken = await this.getAccessToken();
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
      `/purchases/subscriptions/${encodeURIComponent(request.productId)}/tokens/${encodeURIComponent(request.receipt)}`;

    let payload: GooglePurchase;
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        logger.warn('Google purchase verification failed', { status: response.status });
        throw new BillingVerificationError('That purchase could not be verified.', `google_${response.status}`);
      }
      payload = (await response.json()) as GooglePurchase;
    } catch (error) {
      if (error instanceof BillingVerificationError) throw error;
      logger.error('Google verification request failed', error);
      throw new BillingVerificationError('We could not reach Google Play.', 'network');
    }

    const expiry = Number(payload.expiryTimeMillis ?? 0);
    const start = Number(payload.startTimeMillis ?? 0);

    // paymentState: 0 pending, 1 received, 2 free trial, 3 deferred change.
    // A pending payment must not unlock the product, so 0 is never valid no
    // matter what the expiry says. An absent paymentState (Play omits it for
    // already-cancelled subscriptions) leaves the expiry to decide.
    const paymentPending = payload.paymentState === 0;

    return {
      valid: !paymentPending && expiry > Date.now(),
      productId: request.productId,
      originalTransactionId: payload.orderId ?? request.receipt.slice(0, 48),
      periodStart: new Date(start || Date.now()),
      periodEnd: new Date(expiry || Date.now()),
      // userCancellationTimeMillis only means auto-renew was switched off; the
      // user keeps what they paid for until the period ends, exactly as Apple
      // is handled. Only a developer-initiated cancellation (cancelReason 3,
      // typically a refund) voids the entitlement outright.
      cancelAtPeriodEnd: payload.autoRenewing === false || Boolean(payload.userCancellationTimeMillis),
      revoked: payload.cancelReason === 3,
      environment: payload.purchaseType === 0 ? 'sandbox' : 'production',
      raw: { paymentState: payload.paymentState, expiryTimeMillis: payload.expiryTimeMillis },
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }

    const credentials = JSON.parse(env.googleServiceAccountJson) as {
      client_email: string;
      private_key: string;
      token_uri?: string;
    };

    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64Url(
      JSON.stringify({
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      }),
    );

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(credentials.private_key, 'base64url');
    const assertion = `${header}.${claim}.${signature}`;

    const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error('Google service account token request failed', { status: response.status });
      throw new BillingVerificationError('Google Play billing is unavailable.', 'auth');
    }

    const token = (await response.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    return token.access_token;
  }
}

interface GooglePurchase {
  startTimeMillis?: string;
  expiryTimeMillis?: string;
  autoRenewing?: boolean;
  paymentState?: number;
  cancelReason?: number;
  orderId?: string;
  purchaseType?: number;
  userCancellationTimeMillis?: string;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
