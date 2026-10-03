/**
 * The StoreKit configuration file.
 *
 * It lets purchases run in the iOS Simulator with no Apple Developer account
 * and no App Store Connect setup — but only if every product in it matches the
 * catalogue the app asks for. A drifted id is the single most common cause of
 * an empty product list, and it fails silently: the paywall simply shows
 * nothing to buy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { SUBSCRIPTION_PLANS } from '@getfit/shared';

interface StoreKitSubscription {
  productID: string;
  displayPrice: string;
  recurringSubscriptionPeriod: string;
  groupNumber: number;
  subscriptionGroupID: string;
  introductoryOffer: unknown;
  localizations: Array<{ displayName: string; description: string; locale: string }>;
}

const config = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', 'GetFit.storekit'), 'utf8'),
) as {
  subscriptionGroups: Array<{ id: string; subscriptions: StoreKitSubscription[] }>;
};

const subscriptions = config.subscriptionGroups.flatMap((group) => group.subscriptions);
const byId = new Map(subscriptions.map((entry) => [entry.productID, entry]));

describe('the simulator catalogue matches the real one', () => {
  test('every plan the app sells exists in the config', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      assert.ok(
        byId.has(plan.productId),
        `${plan.productId} is missing, so the paywall would show nothing to buy`,
      );
    }
  });

  test('it sells nothing the app does not', () => {
    const known = new Set(SUBSCRIPTION_PLANS.map((plan) => plan.productId));
    for (const entry of subscriptions) {
      assert.ok(known.has(entry.productID), `${entry.productID} is not in the catalogue`);
    }
  });

  test('prices match, so the simulator shows what the store will charge', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      const entry = byId.get(plan.productId);
      assert.equal(
        Number(entry?.displayPrice),
        plan.priceUsd,
        `${plan.productId} is priced differently in the simulator`,
      );
    }
  });

  test('periods match the plan they belong to', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      const entry = byId.get(plan.productId);
      assert.equal(entry?.recurringSubscriptionPeriod, plan.period === 'year' ? 'P1Y' : 'P1M');
    }
  });
});

describe('the group is configured the way App Store Connect is', () => {
  test('both plans sit in one group, so one replaces the other', () => {
    assert.equal(config.subscriptionGroups.length, 1);
    const groups = new Set(subscriptions.map((entry) => entry.subscriptionGroupID));
    assert.equal(groups.size, 1, 'a second group would let someone hold both plans at once');
  });

  test('yearly outranks monthly, so an upgrade takes effect immediately', () => {
    const monthly = byId.get('getfit_membership_monthly');
    const yearly = byId.get('getfit_membership_yearly');
    assert.ok(monthly && yearly);
    assert.ok(
      yearly.groupNumber > monthly.groupNumber,
      'ranked this way round, upgrading would wait until the period ended',
    );
  });

  test('no introductory offer, because GetFit has no free trial', () => {
    for (const entry of subscriptions) {
      assert.equal(entry.introductoryOffer, null, `${entry.productID} carries an offer`);
    }
  });

  test('each plan is named and described for the purchase sheet', () => {
    for (const entry of subscriptions) {
      const [localization] = entry.localizations;
      assert.ok(localization?.displayName, `${entry.productID} has no name`);
      assert.ok(
        localization.description.length > 20,
        `${entry.productID} needs a real description, not a placeholder`,
      );
    }
  });
});
