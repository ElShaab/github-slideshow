// supabase-js builds request URLs with the WHATWG URL API, which React Native
// only partially implements. Must come before the client is created.
import 'react-native-url-polyfill/auto';

import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createChunkedStorage } from './secureStorage';
import { isLegacyAnonKey, readSupabaseConfig, type SupabaseConfig } from './config';

export type { SupabaseConfig };

const SESSION_KEY = 'getfit.supabase.session';

export const supabaseConfig: SupabaseConfig | null = readSupabaseConfig(
  {
    // Written out in full, and not through a variable or a spread. Expo
    // substitutes this exact expression at build time; anything less literal
    // ships a lookup that finds nothing on the device.
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  Constants.expoConfig?.extra as { supabase?: { url?: string; publishableKey?: string } } | null,
);

/**
 * Whether this build can reach Supabase at all.
 *
 * A build without the keys is not broken — it is the local-only app, exactly as
 * it shipped before. Every caller checks this rather than assuming a client,
 * so the sync layer stays an addition rather than a new way to fail.
 */
export const isSupabaseConfigured = supabaseConfig !== null;

/** SecureStore is unavailable on web, which falls back to AsyncStorage. */
const sessionStorage =
  Platform.OS === 'web'
    ? AsyncStorage
    : createChunkedStorage({
        // Called through arrows rather than passed by reference: an unbound
        // native method is the classic source of an "undefined is not a
        // function" that only shows up in a release build.
        getItemAsync: (key) => SecureStore.getItemAsync(key),
        setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
        deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
      });

let client: SupabaseClient | null = null;
let clientFailed = false;

/**
 * The Supabase client, or null when this build has no project configured.
 *
 * Created on first use rather than at import: a throw at module scope takes
 * down the whole bundle before any error boundary exists, and a missing or
 * malformed configuration is not worth that.
 */
export function getSupabase(): SupabaseClient | null {
  if (client || clientFailed || !supabaseConfig) return client;

  try {
    if (isLegacyAnonKey(supabaseConfig.publishableKey) && __DEV__) {
      console.warn(
        'GetFit: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY looks like the legacy anon JWT. ' +
          'Use the sb_publishable_… key from Project Settings → API keys.',
      );
    }

    client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        storage: sessionStorage,
        // Named rather than left to the default, so signing out and clearing
        // the device both know exactly which entry to remove.
        storageKey: SESSION_KEY,
        // Keep the user signed in across launches, and refresh in the
        // background so a session that expired overnight is not a sign-in
        // prompt the next morning.
        persistSession: true,
        autoRefreshToken: true,
        // There is no browser redirect in a native app.
        detectSessionInUrl: false,
      },
    });
  } catch (error) {
    console.error('GetFit: Supabase client could not be created:', error);
    clientFailed = true;
    return null;
  }

  return client;
}
