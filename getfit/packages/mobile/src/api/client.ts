import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Thrown for every failed request. Always carries a user-safe message. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isSubscriptionRequired(): boolean {
    return this.code === 'subscription_required';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isOffline(): boolean {
    return this.code === 'network_error';
  }
}

/** Matches PORT in the server's .env. */
const DEV_API_PORT = 4000;

const TOKEN_KEY = 'getfit.accessToken';
const CACHE_PREFIX = 'getfit.cache.';

/**
 * Where the API lives.
 *
 * A release build must be given an https URL. The development fallbacks below
 * are cleartext http, which App Transport Security blocks outright — shipping
 * one would put a reviewer in front of an app that cannot reach its server,
 * which is a Guideline 2.1 rejection. So release builds get no fallback at all;
 * `releaseReadiness()` turns the omission into a visible, explained failure
 * instead of a silent one.
 */
function resolveBaseUrl(): string {
  const configured =
    process.env.EXPO_PUBLIC_API_URL ??
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

  if (configured) return configured.replace(/\/$/, '');
  if (!__DEV__) return '';

  // On a physical phone, `localhost` is the phone — not the laptop running the
  // API. Expo tells us the machine serving the bundle, so reuse that host and
  // swap the port: the app finds the dev server on the same Wi-Fi with nothing
  // to configure.
  const bundlerHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (bundlerHost && !bundlerHost.startsWith('127.') && bundlerHost !== 'localhost') {
    return `http://${bundlerHost}:${DEV_API_PORT}`;
  }

  // The Android emulator reaches the host machine on 10.0.2.2.
  return Platform.OS === 'android'
    ? `http://10.0.2.2:${DEV_API_PORT}`
    : `http://localhost:${DEV_API_PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();

/** True when the API is reachable over TLS, as a shipped build requires. */
export const apiBaseUrlIsSecure = /^https:\/\/[^\s/]+\.[^\s/]+/.test(API_BASE_URL);

/**
 * The access token lives in the device keychain/keystore, never in plain
 * AsyncStorage. SecureStore is unavailable on web, where it falls back.
 */
const tokenStore = {
  async get(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return AsyncStorage.getItem(TOKEN_KEY);
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') await AsyncStorage.setItem(TOKEN_KEY, token);
      else await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch {
      // A device that refuses secure storage still works for this session.
    }
  },
  async clear(): Promise<void> {
    try {
      if (Platform.OS === 'web') await AsyncStorage.removeItem(TOKEN_KEY);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // Nothing to do — the in-memory token is cleared regardless.
    }
  },
};

let memoryToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export async function loadToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  memoryToken = await tokenStore.get();
  return memoryToken;
}

export async function setToken(token: string): Promise<void> {
  memoryToken = token;
  await tokenStore.set(token);
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  await tokenStore.clear();
}

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  /** Cache the successful response under this key for offline reads. */
  cacheKey?: string;
  /** Serve the cached value when the network is unavailable. */
  fallbackToCache?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The single HTTP entry point.
 *
 * Every failure is normalised into an ApiError with a message written for a
 * user — the server already refuses to send stack traces, and anything
 * unexpected here becomes "Something went wrong." rather than leaking detail.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, cacheKey, fallbackToCache = false, timeoutMs = 20_000 } = options;

  const token = await loadToken();
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (form) {
    payload = form as unknown as BodyInit;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    if (fallbackToCache && cacheKey) {
      const cached = await readCache<T>(cacheKey);
      if (cached !== null) return cached;
    }
    throw new ApiError(
      'You appear to be offline. Check your connection and try again.',
      'network_error',
      0,
    );
  }
  clearTimeout(timeout);

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errorBody = parsed as { error?: { code?: string; message?: string }; details?: unknown } | null;
    const code = errorBody?.error?.code ?? 'internal_error';
    const message = errorBody?.error?.message ?? 'Something went wrong.';

    if (response.status === 401) unauthorizedHandler?.();
    throw new ApiError(message, code, response.status, errorBody?.details);
  }

  const result = parsed as T;
  if (cacheKey) await writeCache(cacheKey, result);
  return result;
}

/* --------------------------- offline cache --------------------------- */

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({ at: Date.now(), value }),
    );
  } catch {
    // A full disk must not break the request that just succeeded.
  }
}

export async function readCache<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: T };
    if (maxAgeMs !== undefined && Date.now() - parsed.at > maxAgeMs) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((key) => key.startsWith(CACHE_PREFIX));
    if (ours.length > 0) await AsyncStorage.multiRemove(ours);
  } catch {
    // Nothing further to do.
  }
}
