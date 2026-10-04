/**
 * Whether a membership can actually be bought right now.
 *
 * App Review's note on build 9 was that an error message appeared when they
 * tapped the button to start a membership. The app had let them tap it: the
 * paywall shows the bundled USD price whenever the store answers with nothing,
 * so a plan the store had never heard of looked exactly like one it sells,
 * priced and ready, until the tap turned it into an error.
 *
 * Asking the store for a price is already how the app finds out. A product the
 * store will sell comes back with a localized price; one it will not — wrong
 * identifier, metadata not submitted, an agreement not in effect, the wrong
 * storefront — comes back absent. So the price is the answer to "can this be
 * bought", and it arrives before the customer touches anything.
 *
 * Pure, and separate from the screen, because the interesting part is a small
 * state machine over two booleans and the screen cannot be rendered in a test.
 */
import type { BillingPlatform } from '@getfit/shared';

export type PlanAvailability =
  /** The store has not answered yet. */
  | 'checking'
  /** The store priced it, so it exists and can be bought. */
  | 'offered'
  /** The store answered and did not price it. Tapping buy would fail. */
  | 'unavailable'
  /** No real store to ask — the development mock. Never shipped to anyone. */
  | 'unchecked';

export interface PlanAvailabilityInput {
  /** True once the store has answered, whatever it said. */
  answered: boolean;
  /** True when the store returned a price for this product. */
  priced: boolean;
  /** The mock store prices nothing by design, so it is never judged. */
  platform: BillingPlatform;
}

export function planAvailability({
  answered,
  priced,
  platform,
}: PlanAvailabilityInput): PlanAvailability {
  if (platform === 'mock') return 'unchecked';
  if (priced) return 'offered';
  return answered ? 'unavailable' : 'checking';
}

/** Whether the buy button should do anything. */
export function canBuy(availability: PlanAvailability): boolean {
  return availability === 'offered' || availability === 'unchecked';
}

/**
 * Whether the button should read as working rather than broken.
 *
 * A store that is slow is not a store that has refused, and a paywall that
 * says "unavailable" for the second it takes to answer would be wrong far
 * more often than it was right.
 */
export function isChecking(availability: PlanAvailability): boolean {
  return availability === 'checking';
}

/**
 * What to tell the customer, or null when there is nothing wrong.
 *
 * It names no cause, because the app cannot tell which of several it is: the
 * identifier may not exist, the product may not have been submitted for
 * review, the storefront may not sell it, or the device may be offline. What
 * it can honestly say is that nothing was charged and that trying again is
 * worth doing — and it carries the same code the purchase path would have
 * thrown, so a screenshot of this screen and a screenshot of that error point
 * at the same place.
 */
export function unavailableMessage(availability: PlanAvailability): string | null {
  if (availability !== 'unavailable') return null;
  return 'The App Store is not offering this membership on this device right now. Nothing has been charged. Check your connection and try again.';
}

/**
 * What the app asked the store for, and what the store answered.
 *
 * Shown under the message above, small and muted. It is developer-facing text
 * on a customer-facing screen, which needs justifying: when a product is
 * missing, the one fact nobody has is whether the identifier the binary asks
 * for matches the identifier the store holds, and that fact is otherwise only
 * obtainable by attaching a debugger to a TestFlight build. A support email or
 * a reviewer's screenshot carrying this line answers it outright.
 *
 * It names identifiers, not prices or accounts, so there is nothing here the
 * App Store listing does not already make public.
 */
export function requestedVersusOffered(
  requested: string | undefined,
  offered: readonly string[],
): string {
  const asked = requested ?? 'nothing';
  const answered = offered.length > 0 ? [...offered].sort().join(', ') : 'nothing';
  return `Asked for ${asked} · the store offered ${answered}`;
}
