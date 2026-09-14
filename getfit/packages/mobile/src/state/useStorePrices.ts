import { useEffect, useState } from 'react';
import { indexStorePrices, type StorePrice } from '@getfit/shared';
import type { StoreProvider } from './billing';

export interface StorePricesState {
  /** Store prices by product id. Empty until the store answers, or if it cannot. */
  prices: Record<string, StorePrice>;
  loading: boolean;
}

/**
 * Asks the store what it will charge this customer.
 *
 * The paywall renders the bundled USD prices while this resolves, then swaps in
 * the store's own figures, so there is never a moment with no price on screen.
 * A store that cannot be reached simply leaves the fallback in place.
 */
export function useStorePrices(
  store: StoreProvider,
  productIds: string[],
): StorePricesState {
  const [prices, setPrices] = useState<Record<string, StorePrice>>({});
  const [loading, setLoading] = useState(true);

  // Compared by value: the caller builds this list from the plan catalogue, so
  // a fresh array with the same ids must not re-open the billing connection.
  const key = productIds.join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      let resolved: StorePrice[] = [];
      try {
        resolved = await store.getPrices(key ? key.split(',') : []);
      } catch {
        resolved = [];
      }
      if (cancelled) return;
      setPrices(indexStorePrices(resolved));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [key, store]);

  return { prices, loading };
}
