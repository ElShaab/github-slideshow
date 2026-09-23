/**
 * Session storage for Supabase auth, backed by the device keychain.
 *
 * The session Supabase hands back holds an access token and a refresh token —
 * the refresh token is a long-lived credential for this user's data, so it goes
 * in the keychain rather than AsyncStorage, the same place the app already
 * keeps its access token.
 *
 * SecureStore refuses values much beyond 2 KB, and a Supabase session is
 * routinely larger than that once the user object is included. So values are
 * split: the key itself holds the chunk count, and the parts live beside it.
 * Writing fewer chunks than last time deletes the leftovers — otherwise a stale
 * tail would be read back as part of the next session and parse as nothing.
 */

/** The slice of expo-secure-store this needs, declared so it can be tested. */
export interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * Well under SecureStore's limit, measured in UTF-16 units rather than bytes so
 * a chunk of non-Latin text cannot sneak past the ceiling.
 */
export const CHUNK_SIZE = 1500;

/** Holds the number of parts, so a read knows how many to fetch. */
const header = (key: string): string => `${key}.chunks`;
const part = (key: string, index: number): string => `${key}.${index}`;

export function splitValue(value: string, size = CHUNK_SIZE): string[] {
  if (value === '') return [''];
  const chunks: string[] = [];
  for (let at = 0; at < value.length; at += size) chunks.push(value.slice(at, at + size));
  return chunks;
}

export function createChunkedStorage(store: SecureKeyValueStore) {
  /** Removes parts from `from` upward until one is missing. */
  const dropFrom = async (key: string, from: number): Promise<void> => {
    for (let index = from; ; index += 1) {
      const existing = await store.getItemAsync(part(key, index));
      if (existing === null) return;
      await store.deleteItemAsync(part(key, index));
    }
  };

  return {
    async getItem(key: string): Promise<string | null> {
      try {
        const count = Number(await store.getItemAsync(header(key)));
        if (!Number.isInteger(count) || count <= 0) return null;

        const parts: string[] = [];
        for (let index = 0; index < count; index += 1) {
          const chunk = await store.getItemAsync(part(key, index));
          // A missing part means a half-written session. Report nothing rather
          // than a truncated token that would fail in a more confusing place.
          if (chunk === null) return null;
          parts.push(chunk);
        }
        return parts.join('');
      } catch {
        // A device that refuses the keychain signs the user in again.
        return null;
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      try {
        const chunks = splitValue(value);
        for (const [index, chunk] of chunks.entries()) {
          await store.setItemAsync(part(key, index), chunk);
        }
        await store.setItemAsync(header(key), String(chunks.length));
        await dropFrom(key, chunks.length);
      } catch {
        // The session still works for as long as the app stays open.
      }
    },

    async removeItem(key: string): Promise<void> {
      try {
        await store.deleteItemAsync(header(key));
        await dropFrom(key, 0);
      } catch {
        // Nothing further to do; the in-memory session is dropped regardless.
      }
    },
  };
}
