import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** True when the failure was a lost connection rather than a server error. */
  offline: boolean;
  reload: () => void;
  refreshing: boolean;
}

/**
 * Loads data on mount and exposes a reload. Errors arrive already translated
 * into a message that is safe to show a user.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await loaderRef.current();
      if (!mounted.current) return;
      setData(result);
      setOffline(false);
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof ApiError) {
        setError(caught.message);
        setOffline(caught.isOffline);
      } else {
        setError('Something went wrong.');
        setOffline(false);
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    loading,
    error,
    offline,
    refreshing,
    reload: () => {
      void run(true);
    },
  };
}
