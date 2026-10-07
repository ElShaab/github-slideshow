import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { describeError } from '../utils/describeError';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /**
   * What actually failed, for whoever has to fix it.
   *
   * `error` is written for the user and says nothing; this is the line that
   * makes a bug report actionable. Null when the failure already explained
   * itself, so nothing is repeated back twice.
   */
  detail: string | null;
  /** True when the failure was a lost connection rather than a server error. */
  offline: boolean;
  reload: () => void;
  refreshing: boolean;
}

/**
 * Loads data on mount and exposes a reload. Errors arrive already translated
 * into a message that is safe to show a user.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  /**
   * What is being loaded, for the log.
   *
   * A release bundle is minified, so a stack trace names bundle offsets and
   * nothing else. This is the only thing that survives to say which of the
   * app's twenty loaders failed, so it is worth the twenty call sites.
   */
  label = 'data',
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
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
    setDetail(null);

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
        setDetail(`${label}: ${describeError(caught) ?? 'failed'}`);
        // The message stays generic — a raw failure is not something to show
        // a user — but the cause is logged so a release build leaves a trace.
        console.error(
          `GetFit load failed (${label}):`,
          caught instanceof Error ? (caught.stack ?? caught.message) : caught,
        );
        setError('Something went wrong.');
        setOffline(false);
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [label]);

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    loading,
    error,
    detail,
    offline,
    refreshing,
    reload: () => {
      void run(true);
    },
  };
}
