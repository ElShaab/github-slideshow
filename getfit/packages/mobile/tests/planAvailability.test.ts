/**
 * Never offer a membership the store will not sell.
 *
 * App Review's finding on build 9 was that tapping the button to start a
 * membership produced an error message. It did, and the app had no business
 * letting them tap it: the paywall falls back to the bundled USD prices
 * whenever the store answers with nothing, so a product the store had never
 * heard of looked identical to one it sells — priced, selected, ready — and
 * the only way to discover otherwise was to try to buy it.
 *
 * The store answers the question before anyone touches the screen. A product
 * it will sell comes back with a localized price; one it will not comes back
 * absent. These tests pin that reading, and in particular the difference
 * between "the store said no" and "the store has not said anything yet",
 * which is what the old code conflated.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  canBuy,
  isChecking,
  planAvailability,
  requestedVersusOffered,
  unavailableMessage,
  type PlanAvailability,
} from '../src/state/planAvailability';
import { STORE_FAILURE, withFailureCode } from '../src/state/storeFailures';

const apple = (answered: boolean, priced: boolean): PlanAvailability =>
  planAvailability({ answered, priced, platform: 'apple' });

describe('reading the store’s answer', () => {
  test('a priced product is one the store will sell', () => {
    assert.equal(apple(true, true), 'offered');
  });

  test('no answer yet is not an answer of no', () => {
    // The whole paywall would read "unavailable" for the second the store
    // takes to reply if these two were the same thing.
    assert.equal(apple(false, false), 'checking');
  });

  test('an answer with no price is the store declining to sell it', () => {
    assert.equal(apple(true, false), 'unavailable');
  });

  test('a price that arrives before the answered flag still counts', () => {
    // Defensive: a price can only come from the store, so it settles the
    // question whatever the flag says.
    assert.equal(apple(false, true), 'offered');
  });

  test('the development mock is never judged, because it prices nothing', () => {
    // MockStoreProvider.getPrices returns [] by design. Treating that as a
    // refusal would make the paywall untestable on a simulator.
    assert.equal(planAvailability({ answered: true, priced: false, platform: 'mock' }), 'unchecked');
  });

  test('Google is read the same way as Apple', () => {
    assert.equal(planAvailability({ answered: true, priced: false, platform: 'google' }), 'unavailable');
    assert.equal(planAvailability({ answered: true, priced: true, platform: 'google' }), 'offered');
  });
});

describe('what the screen does with it', () => {
  test('the button works only when there is something to buy', () => {
    assert.equal(canBuy('offered'), true);
    assert.equal(canBuy('unchecked'), true);
    assert.equal(canBuy('unavailable'), false);
    assert.equal(canBuy('checking'), false);
  });

  test('a slow store reads as working, not as broken', () => {
    assert.equal(isChecking('checking'), true);
    assert.equal(isChecking('unavailable'), false);
    assert.equal(isChecking('offered'), false);
  });

  test('only the refusal says anything', () => {
    assert.equal(unavailableMessage('offered'), null);
    assert.equal(unavailableMessage('checking'), null);
    assert.equal(unavailableMessage('unchecked'), null);
    assert.ok(unavailableMessage('unavailable'));
  });

  test('the message promises nothing was charged, because nothing was', () => {
    const message = unavailableMessage('unavailable') ?? '';
    assert.match(message, /nothing has been charged/i);
    assert.ok(!/cancel/i.test(message), 'this is not a cancellation and must not say so');
  });

  test('it carries the code the purchase path would have thrown', () => {
    // GF-03 is "the store has no such product". A customer who never tapped
    // the button and a reviewer who did should be able to send a screenshot
    // apiece and have them point at the same line.
    const shown = withFailureCode(unavailableMessage('unavailable') ?? '', STORE_FAILURE.productMissing);
    assert.match(shown, /\(GF-03\)$/);
  });
});

describe('saying which identifiers were involved', () => {
  test('names the one asked for and the ones the store answered with', () => {
    assert.equal(
      requestedVersusOffered('getfit_monthly_membership', ['getfit_membership_yearly']),
      'Asked for getfit_monthly_membership \u00b7 the store offered getfit_membership_yearly',
    );
  });

  test('says so plainly when the store offered nothing at all', () => {
    // Nothing offered means the whole catalogue is missing — a different
    // problem from one product being misnamed, and worth telling apart.
    assert.equal(
      requestedVersusOffered('getfit_monthly_membership', []),
      'Asked for getfit_monthly_membership \u00b7 the store offered nothing',
    );
  });

  test('lists several in a stable order, so two screenshots can be compared', () => {
    const line = requestedVersusOffered('getfit_monthly_membership', [
      'getfit_membership_yearly',
      'getfit_extra',
    ]);
    assert.match(line, /getfit_extra, getfit_membership_yearly$/);
  });

  test('survives having nothing selected', () => {
    assert.equal(
      requestedVersusOffered(undefined, []),
      'Asked for nothing \u00b7 the store offered nothing',
    );
  });

  test('carries no price, account or receipt — only identifiers', () => {
    // It is shown on a customer's screen. Product ids are already public in
    // the App Store listing; nothing else here may be.
    const line = requestedVersusOffered('getfit_monthly_membership', ['getfit_membership_yearly']);
    assert.ok(!/\d+\.\d\d/.test(line), 'a price leaked into the diagnostic');
    assert.ok(!/@/.test(line), 'an address leaked into the diagnostic');
  });
});
