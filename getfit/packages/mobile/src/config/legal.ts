import Constants from 'expo-constants';

/**
 * The legal and support URLs the App Store requires to be reachable from
 * inside the binary.
 *
 * Guideline 3.1.2 is explicit: an auto-renewable subscription app must show the
 * title, length and price of the subscription on the purchase screen, together
 * with functional links to the privacy policy and the terms of use. A link that
 * 404s is a rejection, so these are checked at startup rather than discovered
 * by a reviewer.
 */

/**
 * Apple publishes a standard EULA that apps may adopt instead of writing their
 * own. It is always live, so it is a correct default rather than a placeholder
 * — replace it only if you have your own terms.
 */
const APPLE_STANDARD_EULA =
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  legal?: { privacyPolicyUrl?: string; termsOfUseUrl?: string; supportUrl?: string };
};

/** Accepts only an absolute https URL with a hostname that has a dot in it. */
export function httpsUrlOrNull(value: string | undefined): string | null {
  if (!value) return null;
  return /^https:\/\/[^\s/]+\.[^\s/]+/.test(value) ? value.replace(/\/$/, '') : null;
}

export const legal = {
  privacyPolicyUrl: httpsUrlOrNull(extra.legal?.privacyPolicyUrl),
  termsOfUseUrl: httpsUrlOrNull(extra.legal?.termsOfUseUrl) ?? APPLE_STANDARD_EULA,
  supportUrl: httpsUrlOrNull(extra.legal?.supportUrl),
  manageSubscriptionUrl: {
    // Apple's canonical subscription management deep link. Opening it is the
    // only correct way to cancel an App Store subscription — an in-app button
    // that only updates our own records leaves the user still being billed.
    ios: 'https://apps.apple.com/account/subscriptions',
    android: 'https://play.google.com/store/account/subscriptions',
  },
};

/** The fields the operator still has to fill in, named for the error message. */
export function missingLegalFields(): string[] {
  const missing: string[] = [];
  if (legal.privacyPolicyUrl === null) missing.push('extra.legal.privacyPolicyUrl');
  if (legal.supportUrl === null) missing.push('extra.legal.supportUrl');
  return missing;
}
