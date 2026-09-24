/**
 * Localized pricing.
 *
 * The rule these enforce: the figure on screen is the figure the store charges.
 * GetFit never converts currency — Apple and Google set each storefront's price
 * from the product's price point, and any exchange-rate arithmetic of our own
 * would display a number the customer is not billed, which is exactly the
 * Guideline 3.1.2 mismatch this replaced.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRODUCT_ID,
  YEARLY_PRODUCT_ID,
  planForProduct,
} from '../src/constants';
import { formatCurrency, indexStorePrices, planPricing, type StorePrice } from '../src/pricing';

const monthlyPlan = SUBSCRIPTION_PLANS.find((p) => p.productId === SUBSCRIPTION_PRODUCT_ID);
const yearlyPlan = SUBSCRIPTION_PLANS.find((p) => p.productId === YEARLY_PRODUCT_ID);
assert.ok(monthlyPlan && yearlyPlan, 'the catalogue is missing a plan');

const price = (
  productId: string,
  localizedPrice: string,
  currencyCode: string,
  amount: number,
): StorePrice => ({ productId, localizedPrice, currencyCode, amount });

const ukMonthly = price(SUBSCRIPTION_PRODUCT_ID, '£4.49', 'GBP', 4.49);
const ukYearly = price(YEARLY_PRODUCT_ID, '£17.99', 'GBP', 17.99);
const usMonthly = price(SUBSCRIPTION_PRODUCT_ID, '$4.99', 'USD', 4.99);
const usYearly = price(YEARLY_PRODUCT_ID, '$19.99', 'USD', 19.99);
const jpYearly = price(YEARLY_PRODUCT_ID, '¥3,000', 'JPY', 3000);

describe('the store price is what gets displayed', () => {
  test("a UK customer sees Apple's pounds, never a converted dollar figure", () => {
    const pricing = planPricing(yearlyPlan, ukYearly, {
      plan: monthlyPlan,
      storePrice: ukMonthly,
    });

    assert.equal(pricing.price, '£17.99');
    assert.ok(!pricing.price.includes('$'), 'a dollar sign reached a UK storefront');
    assert.equal(pricing.fromStore, true);
  });

  test('the store string is passed through untouched, whatever its shape', () => {
    // Yen has no minor unit and Apple formats it without decimals. Reformatting
    // it ourselves would be a chance to get it wrong for no benefit.
    const pricing = planPricing(yearlyPlan, jpYearly);
    assert.equal(pricing.price, '¥3,000');
  });

  test('falls back to the bundled USD price until the store answers', () => {
    const pricing = planPricing(yearlyPlan);
    assert.equal(pricing.fromStore, false);
    // Asserted against the catalogue rather than a literal, so the fallback
    // stays tied to the price the app actually sells at.
    assert.equal(pricing.price, formatCurrency(yearlyPlan.priceUsd, 'USD'));
  });
});

describe('the struck-through price', () => {
  test('is never shown, because no such price was ever charged', () => {
    // A reference price the seller never used is deceptive under App Review
    // 3.1.1 and under consumer law in the EU, the UK and the US. Both plans
    // carry listPriceUsd: null, so there is nothing to strike through.
    assert.equal(planPricing(yearlyPlan, usYearly, { plan: monthlyPlan, storePrice: usMonthly }).listPrice, null);
    assert.equal(planPricing(yearlyPlan, ukYearly, { plan: monthlyPlan, storePrice: ukMonthly }).listPrice, null);
    assert.equal(planPricing(monthlyPlan, usMonthly).listPrice, null);
    assert.equal(planPricing(monthlyPlan).listPrice, null);
  });

  test('but the saving against monthly survives, because that one is true', () => {
    // 12 x 4.99 = 59.88 against 19.99 is a real comparison: both are prices
    // the customer can actually pay today.
    const pricing = planPricing(yearlyPlan, usYearly, { plan: monthlyPlan, storePrice: usMonthly });
    assert.ok(pricing.savingPercent && pricing.savingPercent > 50, `got ${pricing.savingPercent}`);
  });

  test('the machinery still works if a genuine past price is ever set', () => {
    // Kept so the capability is not quietly lost: if GetFit really does raise
    // its price one day, the previous one can be shown again.
    const everSold = { ...yearlyPlan, listPriceUsd: 29.99 };
    assert.equal(
      planPricing(everSold, usYearly, { plan: monthlyPlan, storePrice: usMonthly }).listPrice,
      formatCurrency(29.99, 'USD'),
    );
  });

  test('and is withheld outside USD rather than converted at a rate we invented', () => {
    const everSold = { ...yearlyPlan, listPriceUsd: 29.99 };
    assert.equal(
      planPricing(everSold, ukYearly, { plan: monthlyPlan, storePrice: ukMonthly }).listPrice,
      null,
    );
  });
});

describe('the per-month equivalent', () => {
  test('is derived in the same currency the customer is charged in', () => {
    const pricing = planPricing(yearlyPlan, ukYearly, { plan: monthlyPlan, storePrice: ukMonthly });
    // 17.99 / 12 = 1.499 -> 1.50
    assert.ok(pricing.perMonth?.includes('1.50'), `got ${pricing.perMonth}`);
    assert.ok(!pricing.perMonth?.includes('$'));
  });

  test('is not offered for a monthly plan, which would be meaningless', () => {
    assert.equal(planPricing(monthlyPlan, usMonthly).perMonth, null);
  });

  test('uses the fallback price when the store is silent', () => {
    // 20 / 12 = 1.666... -> 1.67
    assert.ok(planPricing(yearlyPlan).perMonth?.includes('1.67'));
  });
});

describe('the saving claim', () => {
  test('compares against twelve months at the store\'s own monthly rate', () => {
    // 4.49 * 12 = 53.88 against 17.99 -> 67%
    const pricing = planPricing(yearlyPlan, ukYearly, { plan: monthlyPlan, storePrice: ukMonthly });
    assert.equal(pricing.savingPercent, 67);
  });

  test('refuses to compare two different currencies', () => {
    // A yen yearly against a pound monthly is not a ratio that means anything.
    const pricing = planPricing(yearlyPlan, jpYearly, { plan: monthlyPlan, storePrice: ukMonthly });
    assert.equal(pricing.savingPercent, null);
  });

  test('is withheld when the yearly plan is not actually cheaper', () => {
    const overpriced = price(YEARLY_PRODUCT_ID, '£99.00', 'GBP', 99);
    const pricing = planPricing(yearlyPlan, overpriced, { plan: monthlyPlan, storePrice: ukMonthly });
    assert.equal(pricing.savingPercent, null, 'claimed a saving on a more expensive plan');
  });

  test('claims nothing at all when there is neither a store price nor a past price', () => {
    // The catalogue carries no reference price, so with no monthly plan to
    // compare against there is no honest saving to state — and silence is the
    // right answer rather than a number pulled from somewhere.
    assert.equal(planPricing(yearlyPlan).savingPercent, null);
  });

  test('falls back to a genuine past price when one exists', () => {
    // (29.99 - 19.99) / 29.99 = 33%
    const everSold = { ...yearlyPlan, listPriceUsd: 29.99 };
    assert.equal(planPricing(everSold).savingPercent, 33);
  });
});

describe('formatCurrency', () => {
  test('formats an amount we derived, in the given currency', () => {
    assert.ok(formatCurrency(1.67, 'USD').includes('1.67'));
    assert.ok(formatCurrency(4.49, 'GBP').includes('4.49'));
  });

  test('degrades to an unambiguous string for an unknown currency', () => {
    const formatted = formatCurrency(12.5, 'XYZ');
    assert.ok(formatted.includes('12.5'), `got ${formatted}`);
    assert.ok(formatted.includes('XYZ'), `got ${formatted}`);
  });
});

describe('indexStorePrices', () => {
  test('keys prices by product id for lookup beside the catalogue', () => {
    const index = indexStorePrices([ukMonthly, ukYearly]);
    assert.equal(index[SUBSCRIPTION_PRODUCT_ID]?.localizedPrice, '£4.49');
    assert.equal(index[YEARLY_PRODUCT_ID]?.localizedPrice, '£17.99');
    assert.equal(index.getfit_membership_free, undefined);
  });

  test('an empty store response indexes to nothing, leaving the fallback', () => {
    assert.deepEqual(indexStorePrices([]), {});
  });
});

describe('every catalogue plan renders without a store', () => {
  test('no plan produces an empty or NaN price on first paint', () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      const pricing = planPricing(plan);
      assert.ok(pricing.price.length > 0, `${plan.productId} rendered no price`);
      assert.ok(!pricing.price.includes('NaN'), `${plan.productId} rendered NaN`);
      assert.ok(!/undefined/.test(pricing.price), `${plan.productId} rendered undefined`);
    }
    assert.ok(planForProduct(SUBSCRIPTION_PRODUCT_ID));
  });
});
