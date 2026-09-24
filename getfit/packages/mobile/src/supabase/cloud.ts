import { localStore } from '../local/api';
import { getSupabase } from './client';
import { createSupabaseBackend } from './backend';
import { SYNC_KEY, SyncEngine, emptySyncMeta, type SyncMeta, type SyncResult } from './sync';
import { accountsAvailable, currentAccount, onAuthChange, signOut } from './auth';

/**
 * The app's one connection to the account.
 *
 * Everything below this is testable in isolation; this is the wiring, and it is
 * deliberately thin. Two rules hold throughout:
 *
 *   - A build with no Supabase project configured behaves exactly as the app
 *     did before. Every entry point returns early rather than failing.
 *   - A sync never blocks a screen and never surfaces an error the user has to
 *     act on. The device is the working copy; the account is a copy of it.
 */

/** How long to wait after a local write before pushing, so a set logged mid-workout
 *  does not fire one request per set. */
const PUSH_DELAY_MS = 4_000;

let engine: SyncEngine | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeAuth: (() => void) | null = null;

function getEngine(): SyncEngine | null {
  if (engine) return engine;
  const client = getSupabase();
  if (!client) return null;
  engine = new SyncEngine(localStore, createSupabaseBackend(client));
  return engine;
}

/**
 * Starts listening for local writes and for sign-in.
 *
 * Called once from the provider. Safe to call twice: the second call replaces
 * the listeners rather than stacking them.
 */
export function startCloudSync(): void {
  if (!accountsAvailable()) return;

  localStore.onChange((key) => {
    if (key === SYNC_KEY) return; // Recording a change is not itself a change.
    void getEngine()
      ?.noteLocalChange(key)
      .then(() => schedulePush());
  });

  unsubscribeAuth?.();
  unsubscribeAuth = onAuthChange((account) => {
    if (account) void syncNow();
  });
}

export function stopCloudSync(): void {
  localStore.onChange(null);
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, PUSH_DELAY_MS);
}

/**
 * Reconciles now, if there is an account to reconcile with.
 *
 * Returns 'pending' rather than throwing when there is no account or no
 * project: the caller's job is to keep going either way.
 */
export async function syncNow(): Promise<SyncResult> {
  const current = getEngine();
  if (!current) return { outcome: 'pending', error: null };

  const account = await currentAccount();
  if (!account) return { outcome: 'pending', error: null };

  return current.sync(account.id);
}

/**
 * Signs out and drops everything the account left on this device.
 *
 * The local documents hold body-composition figures and training history. On a
 * shared phone the next person to sign in must not be served the previous
 * account's data off disk, so they go with the session.
 */
export async function signOutAndClearLocal(): Promise<void> {
  await signOut();
  await localStore.clear();
  await localStore.update<SyncMeta>(SYNC_KEY, emptySyncMeta, () => emptySyncMeta());
}

/**
 * Account deletion, as Guideline 5.1.1(v) requires it to work: from inside the
 * app, in one step, removing the data rather than hiding it.
 *
 * The rows go first. If that fails the local data is left alone and the error
 * is raised, because telling someone their data is deleted when it is still on
 * a server would be a lie.
 */
export async function deleteAccountEverywhere(): Promise<void> {
  const current = getEngine();
  const account = current ? await currentAccount() : null;

  if (current && account) {
    await current.deleteRemote(account.id);
    await signOut();
  }

  await localStore.clear();
  await localStore.update<SyncMeta>(SYNC_KEY, emptySyncMeta, () => emptySyncMeta());
}
