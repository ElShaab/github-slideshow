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

const TOKEN_KEY = 'getfit.accessToken';
const CACHE_PREFIX = 'getfit.cache.';

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  if (fromConfig) return fromConfig.replace(/\/$/, '');

  // The Android emulator reaches the host machine on 10.0.2.2.
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

export const API_BASE_URL = resolveBaseUrl();

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
