import type { SubscriptionPlan } from './types';

/**
 * Pricing, in the currency the store will actually charge.
 *
 * GetFit never converts currency. Apple and Google set each storefront's local
 * price from the price point the product was created with, and that is the
 * amount the customer is billed — so the only correct thing to display is what
 * the store reports. An exchange-rate calculation of our own would put a number
 * on screen that differs from the charge, which is the Guideline 3.1.2 mismatch
 * this exists to avoid.
 *
 * The bundled USD figures are a fallback for the moments before the store
 * answers, and for builds with no billing module at all.
 */

/** One product's price as the store reports it for this customer. */
export interface StorePrice {
  productId: string;
  /** Store-formatted for the customer's locale: "$5.00", "£4.49", "¥800". */
  localizedPrice: string;
  /** ISO 4217 code the store is charging in. */
  currencyCode: string;
  /** The same amount as a number, for deriving per-month and savings figures. */
  amount: number;
}

export interface PlanPricing {
  /** The headline price, exactly as the store states it. */
  price: string;
  /**
   * Struck-through reference price, or null when it cannot be stated honestly.
   * The "was" figure is our own claim in USD, so it is shown only where the
   * customer is actually charged in USD — never converted at a rate we invented.
   */
  listPrice: string | null;
  /** A yearly plan's equivalent monthly cost, in the same currency. */
  perMonth: string | null;
  /** Whole-percent saving against paying monthly, or against the list price. */
  savingPercent: number | null;
  /** False while showing the bundled USD fallback rather than a store price. */
  fromStore: boolean;
}

/**
 * Formats an amount we derived ourselves — a per-month equivalent, or our own
 * list price. A store-reported price is never passed through here; it is
 * displayed verbatim, because the store already formatted it correctly.
 */
export function formatCurrency(amount: number, currencyCode: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(amount);
  } catch {
    // Intl is absent or the code is unknown. "USD 1.67" is unambiguous, which
    // matters more here than being pretty.
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Everything the paywall needs to render one plan.
 *
 * `monthly` is the monthly plan's store price, used to state a yearly plan's
 * saving in the customer's own currency — a comparison that is true in every
 * storefront, unlike our USD list price.
 */
export function planPricing(
  plan: SubscriptionPlan,
  storePrice?: StorePrice | null,
  monthly?: { plan: SubscriptionPlan; storePrice?: StorePrice | null } | null,
): PlanPricing {
  const fromStore = Boolean(storePrice);
  const currency = storePrice?.currencyCode ?? 'USD';
  const amount = storePrice?.amount ?? plan.priceUsd;
  const price = storePrice?.localizedPrice ?? formatCurrency(plan.priceUsd, 'USD');

  // Our "was $40" is a statement about US pricing. In any other currency we
  // have no honest figure to strike through, so none is shown.
  const listPrice =
    plan.listPriceUsd !== null && plan.listPriceUsd > plan.priceUsd && currency === 'USD'
      ? formatCurrency(plan.listPriceUsd, 'USD')
      : null;

  const perMonth =
    plan.period === 'year' ? formatCurrency(round(amount / 12), currency) : null;

  return {
    price,
    listPrice,
    perMonth,
    savingPercent: savingPercent(plan, amount, storePrice, monthly),
    fromStore,
  };
}

/**
 * How much a plan saves, as a whole percent.
 *
 * A yearly plan is compared against twelve months at the monthly rate, in the
 * store's own numbers — true in every currency. Failing that, it falls back to
 * our USD list price, which is only meaningful in a USD storefront.
 */
function savingPercent(
  plan: SubscriptionPlan,
  amount: number,
  storePrice?: StorePrice | null,
  monthly?: { plan: SubscriptionPlan; storePrice?: StorePrice | null } | null,
): number | null {
  if (plan.period === 'year' && monthly) {
    const monthlyAmount = monthly.storePrice?.amount ?? monthly.plan.priceUsd;
    // Only compare like with like: two prices in different currencies would
    // produce a meaningless ratio.
    const sameCurrency =
      (storePrice?.currencyCode ?? 'USD') === (monthly.storePrice?.currencyCode ?? 'USD');
    const yearAtMonthlyRate = monthlyAmount * 12;

    if (sameCurrency && monthlyAmount > 0 && yearAtMonthlyRate > amount) {
      return Math.round(((yearAtMonthlyRate - amount) / yearAtMonthlyRate) * 100);
    }
  }

  if (plan.listPriceUsd !== null && plan.listPriceUsd > plan.priceUsd && !storePrice) {
    return Math.round(((plan.listPriceUsd - plan.priceUsd) / plan.listPriceUsd) * 100);
  }

  return null;
}

/** Indexes store prices by product id for lookup beside the plan catalogue. */
export function indexStorePrices(prices: StorePrice[]): Record<string, StorePrice> {
  return Object.fromEntries(prices.map((price) => [price.productId, price]));
}
