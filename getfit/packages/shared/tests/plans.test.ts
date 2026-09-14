/**
 * The subscription catalogue.
 *
 * These numbers are the ones App Store Connect and Play Console are configured
 * with by hand, and the app renders them directly onto the purchase screen.
 * Guideline 3.1.2 requires the price shown to be the price charged, so a drift
 * between this file and the store products is a rejection — and it is exactly
 * the kind of drift nothing else would catch.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICE_USD,
  SUBSCRIPTION_PRODUCT_ID,
  YEARLY_PRODUCT_ID,
  planForProduct,
  planPeriodMonths,
} from '../src/constants';

describe('subscription catalogue', () => {
  test('monthly is $5 under the product id the stores are configured with', () => {
    const monthly = planForProduct(SUBSCRIPTION_PRODUCT_ID);
    assert.ok(monthly, 'the monthly plan is missing from the catalogue');
    assert.equal(monthly.productId, 'getfit_membership_monthly');
    assert.equal(monthly.priceUsd, 5);
    assert.equal(monthly.period, 'month');
    assert.equal(monthly.listPriceUsd, null, 'the monthly plan is not discounted');
    assert.equal(SUBSCRIPTION_PRICE_USD, 5, 'the legacy constant drifted from the plan');
  });

  test('yearly is $20, marked down from $40, and badged', () => {
    const yearly = planForProduct(YEARLY_PRODUCT_ID);
    assert.ok(yearly, 'the yearly plan is missing from the catalogue');
    assert.equal(yearly.productId, 'getfit_membership_yearly');
    assert.equal(yearly.priceUsd, 20);
    assert.equal(yearly.period, 'year');
    assert.equal(yearly.listPriceUsd, 40, 'the struck-through price changed');
    assert.equal(yearly.badge, 'BEST DEAL');
    assert.equal(yearly.limitedTime, true);
  });

  test('the yearly plan is genuinely the better deal it claims to be', () => {
    const monthly = planForProduct(SUBSCRIPTION_PRODUCT_ID);
    const yearly = planForProduct(YEARLY_PRODUCT_ID);
    assert.ok(monthly && yearly, 'both plans must exist to compare them');

    const yearAtMonthlyRate = monthly.priceUsd * 12;
    assert.ok(
      yearly.priceUsd < yearAtMonthlyRate,
      `"BEST DEAL" costs $${yearly.priceUsd} against $${yearAtMonthlyRate} paid monthly`,
    );
    // The paywall advertises the effective monthly rate; it must beat monthly.
    assert.ok(yearly.priceUsd / 12 < monthly.priceUsd);
  });

  test('a struck-through price is never below the price charged', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      if (plan.listPriceUsd === null) continue;
      assert.ok(
        plan.listPriceUsd > plan.priceUsd,
        `${plan.productId} shows a "was" price at or below what it charges`,
      );
    }
  });

  test('every plan is whole-dollar, matching a real store price point', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      assert.equal(
        plan.priceUsd,
        Math.round(plan.priceUsd),
        `${plan.productId} is $${plan.priceUsd}; the store products are whole dollars`,
      );
      assert.ok(plan.priceUsd > 0);
    }
  });

  test('product ids are unique and resolvable, since the store keys on them', () => {
    const ids = SUBSCRIPTION_PLANS.map((plan) => plan.productId);
    assert.equal(new Set(ids).size, ids.length, 'two plans share a product id');
    for (const id of ids) assert.ok(planForProduct(id), `${id} does not resolve`);

    // An id we do not sell must not resolve, or a forged purchase would price
    // itself against whichever plan happened to be first.
    assert.equal(planForProduct('getfit_membership_free'), undefined);
    assert.equal(planForProduct(''), undefined);
    assert.equal(planForProduct(null), undefined);
  });

  test('period length is what the server dates the paid period from', () => {
    const monthly = planForProduct(SUBSCRIPTION_PRODUCT_ID);
    const yearly = planForProduct(YEARLY_PRODUCT_ID);
    assert.ok(monthly && yearly);

    assert.equal(planPeriodMonths(monthly), 1);
    assert.equal(planPeriodMonths(yearly), 12);
  });
});
