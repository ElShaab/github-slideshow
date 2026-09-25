import { DOCUMENT_KEYS } from './documents';
import type { KeyValueStore } from './keyValue';

/**
 * A tiny document store over key-value storage.
 *
 * Reads that fail — missing, unparseable, storage unavailable — fall back to
 * the empty document rather than throwing. A corrupt file should cost the user
 * their history, not the ability to open the app.
 *
 * Writes are serialised per key. Two sets logged in the same tick would
 * otherwise both read the old document and the second would discard the first.
 */
export class DocumentStore {
  private queues = new Map<string, Promise<unknown>>();

  /**
   * Told about every document that changes, once the write has landed.
   *
   * The cloud sync registers here rather than the other way round: local
   * storage stays the thing that works, and syncing is something that listens.
   * A listener that throws is ignored — nothing it does is allowed to fail a
   * write the user just made.
   */
  private listener: ((key: string) => void) | null = null;

  constructor(private readonly storage: KeyValueStore) {}

  onChange(listener: ((key: string) => void) | null): void {
    this.listener = listener;
  }

  private notify(key: string): void {
    try {
      this.listener?.(key);
    } catch {
      // A broken listener must not break the write it was told about.
    }
  }

  async read<T>(key: string, fallback: () => T): Promise<T> {
    try {
      const raw = await this.storage.getItem(key);
      if (!raw) return fallback();
      return JSON.parse(raw) as T;
    } catch {
      return fallback();
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    await this.storage.setItem(key, JSON.stringify(value));
  }

  /**
   * Reads, transforms and writes one document as a unit.
   *
   * Every mutation goes through here, and updates to the same key run one
   * after another — a read-modify-write pair that interleaves loses data, and
   * logging sets during a workout is exactly the interleaving case.
   */
  update<T>(key: string, fallback: () => T, change: (current: T) => T | Promise<T>): Promise<T> {
    const queued = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      const current = await this.read<T>(key, fallback);
      const next = await change(current);
      await this.write(key, next);
      this.notify(key);
      return next;
    });

    // Keep the chain alive even if this link rejects, or one failure would
    // block every later write to the same document.
    this.queues.set(
      key,
      queued.catch(() => undefined),
    );
    return queued;
  }

  /** Wipes every document. Used by account deletion. */
  async clear(): Promise<void> {
    this.queues.clear();
    await this.storage.multiRemove(Object.values(DOCUMENT_KEYS));
  }

}
