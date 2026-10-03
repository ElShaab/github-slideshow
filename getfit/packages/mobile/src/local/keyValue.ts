/**
 * The slice of AsyncStorage the local data layer needs.
 *
 * Declared as an interface rather than imported so everything built on it can
 * be tested off-device — the same reason the store adapter takes its native
 * module as an argument.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
}
