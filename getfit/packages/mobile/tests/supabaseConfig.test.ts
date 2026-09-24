/**
 * Configuration, and the keychain the session is kept in.
 *
 * Both are small and both fail quietly when they are wrong: a misread config
 * means a build that silently never syncs, and a session too large for the
 * keychain means a user who is signed out every time they close the app.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isLegacyAnonKey, readSupabaseConfig } from '../src/supabase/config';
import {
  CHUNK_SIZE,
  createChunkedStorage,
  splitValue,
  type SecureKeyValueStore,
} from '../src/supabase/secureStorage';

const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_publishable_1TtRObB7-1UUGf-OiKLT1Q_ol-hSWnG';

describe('reading the project configuration', () => {
  test('the environment is enough', () => {
    const config = readSupabaseConfig(
      { EXPO_PUBLIC_SUPABASE_URL: URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY },
      null,
    );
    assert.deepEqual(config, { url: URL, publishableKey: KEY });
  });

  test('app.json is the fallback', () => {
    const config = readSupabaseConfig({}, { supabase: { url: URL, publishableKey: KEY } });
    assert.deepEqual(config, { url: URL, publishableKey: KEY });
  });

  test('the environment wins, so a build can be pointed elsewhere without a commit', () => {
    const config = readSupabaseConfig(
      { EXPO_PUBLIC_SUPABASE_URL: URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY },
      { supabase: { url: 'https://other.supabase.co', publishableKey: 'sb_publishable_other' } },
    );
    assert.equal(config?.url, URL);
  });

  test('a build with nothing configured is the local-only app, not a broken one', () => {
    assert.equal(readSupabaseConfig({}, null), null);
    assert.equal(readSupabaseConfig({}, {}), null);
  });

  test('half a configuration is no configuration', () => {
    assert.equal(readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: URL }, null), null);
    assert.equal(readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY }, null), null);
  });

  test('cleartext is refused; iOS would block it and the data would be in the open', () => {
    const config = readSupabaseConfig(
      {
        EXPO_PUBLIC_SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
      },
      null,
    );
    assert.equal(config, null);
  });

  test('a trailing slash does not become a double slash in every request', () => {
    const config = readSupabaseConfig(
      { EXPO_PUBLIC_SUPABASE_URL: `${URL}/`, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY },
      null,
    );
    assert.equal(config?.url, URL);
  });

  test('whitespace from a pasted value is trimmed', () => {
    const config = readSupabaseConfig(
      { EXPO_PUBLIC_SUPABASE_URL: `  ${URL}  `, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ` ${KEY} ` },
      null,
    );
    assert.deepEqual(config, { url: URL, publishableKey: KEY });
  });

  test('the legacy anon key is recognisable, because it is the one pasted by mistake', () => {
    assert.equal(isLegacyAnonKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def'), true);
    assert.equal(isLegacyAnonKey(KEY), false);
  });
});

/** SecureStore, in a Map, refusing anything a real one would refuse. */
function fakeKeychain(limit = 2048) {
  const data = new Map<string, string>();
  const store: SecureKeyValueStore = {
    getItemAsync: (key) => Promise.resolve(data.get(key) ?? null),
    setItemAsync: (key, value) => {
      if (value.length > limit) return Promise.reject(new Error('Value too large'));
      data.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
  return { store, data };
}

describe('keeping the session in the keychain', () => {
  test('a session larger than the keychain allows still round trips', async () => {
    const { store } = fakeKeychain();
    const storage = createChunkedStorage(store);
    // A real Supabase session with the user object is comfortably this size.
    const session = JSON.stringify({ access_token: 'a'.repeat(4000), refresh_token: 'b'.repeat(200) });

    await storage.setItem('session', session);
    assert.equal(await storage.getItem('session'), session);
  });

  test('a short session is stored too', async () => {
    const { store } = fakeKeychain();
    const storage = createChunkedStorage(store);
    await storage.setItem('session', 'small');
    assert.equal(await storage.getItem('session'), 'small');
  });

  test('nothing stored reads as nothing, not as a crash', async () => {
    const storage = createChunkedStorage(fakeKeychain().store);
    assert.equal(await storage.getItem('session'), null);
  });

  test('a shorter session does not leave the tail of the longer one behind', async () => {
    const { store, data } = fakeKeychain();
    const storage = createChunkedStorage(store);

    await storage.setItem('session', 'x'.repeat(CHUNK_SIZE * 4));
    await storage.setItem('session', 'y'.repeat(CHUNK_SIZE));

    assert.equal(await storage.getItem('session'), 'y'.repeat(CHUNK_SIZE));
    const leftovers = [...data.keys()].filter((key) => /\.\d+$/.test(key));
    assert.equal(leftovers.length, 1, `stale chunks left: ${leftovers.join(', ')}`);
  });

  test('signing out removes every part', async () => {
    const { store, data } = fakeKeychain();
    const storage = createChunkedStorage(store);

    await storage.setItem('session', 'z'.repeat(CHUNK_SIZE * 3));
    await storage.removeItem('session');

    assert.equal(await storage.getItem('session'), null);
    assert.equal(data.size, 0);
  });

  test('a half-written session reads as signed out rather than as a broken token', async () => {
    const { store, data } = fakeKeychain();
    const storage = createChunkedStorage(store);

    await storage.setItem('session', 'q'.repeat(CHUNK_SIZE * 3));
    data.delete('session.1');

    assert.equal(await storage.getItem('session'), null);
  });

  test('a keychain that refuses to write does not throw into the sign-in', async () => {
    const storage = createChunkedStorage({
      getItemAsync: () => Promise.reject(new Error('locked')),
      setItemAsync: () => Promise.reject(new Error('locked')),
      deleteItemAsync: () => Promise.reject(new Error('locked')),
    });

    await storage.setItem('session', 'anything');
    assert.equal(await storage.getItem('session'), null);
    await storage.removeItem('session');
  });

  test('every chunk stays within what the keychain accepts', () => {
    for (const chunk of splitValue('m'.repeat(10_000))) {
      assert.ok(chunk.length <= CHUNK_SIZE);
    }
  });

  test('splitting and rejoining is lossless, including non-Latin text', () => {
    const value = 'محمد '.repeat(900);
    assert.equal(splitValue(value).join(''), value);
  });
});
