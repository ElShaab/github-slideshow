import { Platform } from 'react-native';
import { localStore } from '../local/api';
import { localId } from '../local/repository';
import { DOCUMENT_KEYS, emptyFeedback, type FeedbackDocument } from '../local/documents';
import { appVersion } from '../config/appInfo';
import {
  addPending,
  markPrompted,
  removeSent,
  shouldPromptForFeedback,
  toFeedbackRows,
  type FeedbackDelivery,
} from '../state/feedback';
import { getSupabase } from './client';
import { createSupabaseBackend } from './backend';
import { createSupabaseFeedbackBackend } from './feedback';
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

    // The outbox is not one of the synced documents — it travels one way and is
    // never pulled back. Delivery is driven by flushFeedback, called where the
    // message is written and again on sign-in; routing it through the sync
    // engine here would only mark the account dirty and push data that has not
    // changed.
    if (key === DOCUMENT_KEYS.feedback) return;

    void getEngine()
      ?.noteLocalChange(key)
      .then(() => schedulePush());
  });

  unsubscribeAuth?.();
  unsubscribeAuth = onAuthChange((account) => {
    if (!account) return;
    void syncNow();
    // Feedback written before the account existed has somewhere to go now.
    void flushFeedback();
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

/* -------------------------------- feedback ------------------------------ */

const readFeedback = (): Promise<FeedbackDocument> =>
  localStore.read<FeedbackDocument>(DOCUMENT_KEYS.feedback, emptyFeedback);

/**
 * Takes what the user wrote and tries to deliver it.
 *
 * Written to the device first, always, and sent second. Someone who has
 * postponed creating their account, or who is typing with no signal, still
 * pressed Send — losing their words because the network was not ready would be
 * the one outcome the sheet must never produce. The returned status is what the
 * sheet tells them, so it has to be the truth about where the message is.
 */
export async function submitFeedback(message: string): Promise<FeedbackDelivery> {
  await localStore.update<FeedbackDocument>(DOCUMENT_KEYS.feedback, emptyFeedback, (current) =>
    addPending(current, {
      id: localId('feedback'),
      message,
      appVersion: appVersion(),
      platform: Platform.OS,
      writtenAt: new Date().toISOString(),
    }),
  );

  return flushFeedback();
}

/**
 * Delivers everything waiting in the outbox.
 *
 * Never throws. A failure here means the message stays on the device and is
 * tried again on the next send or the next sign-in, which is the whole point of
 * keeping it.
 */
export async function flushFeedback(): Promise<FeedbackDelivery> {
  const document = await readFeedback();
  // Another flush may already have taken it, which is a delivery, not a gap.
  if (document.pending.length === 0) return 'sent';

  const client = getSupabase();
  const account = client ? await currentAccount() : null;
  if (!client || !account) return 'queued-no-account';

  const delivering = document.pending;

  try {
    await createSupabaseFeedbackBackend(client).submit(toFeedbackRows(delivering, account.id));
  } catch (error) {
    console.warn('GetFit: feedback is still waiting to be delivered:', error);
    return 'queued-offline';
  }

  // Re-read through update rather than writing back the document from above:
  // the user may have written a second message while the first was in flight,
  // and only the ids that actually landed are removed.
  await localStore.update<FeedbackDocument>(DOCUMENT_KEYS.feedback, emptyFeedback, (current) =>
    removeSent(
      current,
      delivering.map((entry) => entry.id),
    ),
  );

  return 'sent';
}

/** Whether the app should open the sheet on its own after this many workouts. */
export async function feedbackPromptDue(completedWorkouts: number): Promise<boolean> {
  // No project configured means nowhere for it to go, so asking would be a
  // form that quietly discards what it collects.
  if (!accountsAvailable()) return false;
  return shouldPromptForFeedback(await readFeedback(), completedWorkouts);
}

/** Records that the app has asked, so it never asks by itself again. */
export async function noteFeedbackPrompted(): Promise<void> {
  await localStore.update<FeedbackDocument>(DOCUMENT_KEYS.feedback, emptyFeedback, (current) =>
    markPrompted(current),
  );
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
