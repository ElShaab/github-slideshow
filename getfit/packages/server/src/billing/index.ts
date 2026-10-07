import type { BillingPlatform } from '@getfit/shared';
import { env } from '../config/env';
import { AppleBillingProvider } from './appleBillingProvider';
import { GoogleBillingProvider } from './googleBillingProvider';
import { MockBillingProvider } from './mockBillingProvider';
import { BillingVerificationError, type BillingProvider } from './types';

const providers = new Map<BillingPlatform, BillingProvider>();

export function getBillingProvider(platform: BillingPlatform): BillingProvider {
  const existing = providers.get(platform);
  if (existing) return existing;

  let provider: BillingProvider;
  switch (platform) {
    case 'apple':
      provider = new AppleBillingProvider();
      break;
    case 'google':
      provider = new GoogleBillingProvider();
      break;
    case 'mock':
      if (!env.mockBilling) {
        throw new BillingVerificationError('Mock billing is disabled.', 'mock_disabled');
      }
      provider = new MockBillingProvider();
      break;
    default:
      throw new BillingVerificationError('Unsupported store.', 'unsupported_platform');
  }

  providers.set(platform, provider);
  return provider;
}

export { BillingVerificationError };
export type { BillingProvider, VerifiedPurchase, PurchaseVerificationRequest } from './types';
