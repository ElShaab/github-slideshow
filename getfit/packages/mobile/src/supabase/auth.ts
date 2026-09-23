import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './client';

/**
 * Accounts.
 *
 * The app worked without them and still does: an install with no Supabase
 * project configured, or a user who never signs in, keeps everything on the
 * device exactly as before. An account adds one thing — the training history
 * survives the phone, and follows the user to the next one.
 *
 * Every message here is written to be shown to a user. Supabase's own errors
 * are precise and occasionally alarming ("User already registered"), and a
 * couple of them leak whether an address has an account, so they are mapped
 * rather than surfaced raw.
 */

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface Account {
  id: string;
  email: string | null;
}

const NOT_CONFIGURED = 'Accounts are not available in this build.';

function requireClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) throw new AuthError(NOT_CONFIGURED);
  return client;
}

const toAccount = (user: User | null): Account | null =>
  user ? { id: user.id, email: user.email ?? null } : null;

/**
 * Turns a Supabase auth failure into something worth reading.
 *
 * The default arm is deliberate: an unrecognised auth error is not shown
 * verbatim, because the ones that exist are about tokens and grants and would
 * mean nothing to the person reading them.
 */
export function describeAuthError(message: string): string {
  const text = message.toLowerCase();

  if (text.includes('already registered') || text.includes('already been registered')) {
    return 'That email already has an account. Sign in instead.';
  }
  if (text.includes('invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (text.includes('email not confirmed')) {
    return 'Check your email and confirm your address, then sign in.';
  }
  if (text.includes('password should be') || text.includes('password is too')) {
    return 'Choose a password of at least 8 characters.';
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (text.includes('fetch') || text.includes('network')) {
    return 'You appear to be offline. Your training is saved on this device.';
  }
  return 'Something went wrong. Try again.';
}

export const accountsAvailable = (): boolean => isSupabaseConfigured && getSupabase() !== null;

export async function currentAccount(): Promise<Account | null> {
  const client = getSupabase();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return toAccount(data.session?.user ?? null);
  } catch {
    // An unreadable stored session is a signed-out user, not a crash.
    return null;
  }
}

export async function signUp(email: string, password: string): Promise<Account> {
  const { data, error } = await requireClient().auth.signUp({
    email: email.trim(),
    password,
  });
  if (error) throw new AuthError(describeAuthError(error.message));

  const account = toAccount(data.user);
  if (!account) throw new AuthError('Something went wrong. Try again.');
  return account;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const { data, error } = await requireClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new AuthError(describeAuthError(error.message));

  const account = toAccount(data.user);
  if (!account) throw new AuthError('That email and password do not match an account.');
  return account;
}

export async function signOut(): Promise<void> {
  const client = getSupabase();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch {
    // The stored session is dropped either way; a failed revoke on the server
    // must not leave the user stuck signed in on the device.
  }
}

/**
 * Whether a session is confirmed enough to sync.
 *
 * With email confirmation switched on, signUp returns a user but no session,
 * and every table write would be refused by row-level security. Syncing then
 * would look like a bug; waiting for confirmation is the honest behaviour.
 */
export const hasUsableSession = (session: Session | null): boolean =>
  Boolean(session?.access_token && session.user?.id);

/** Fires on sign-in, sign-out and token refresh. Returns an unsubscribe. */
export function onAuthChange(handler: (account: Account | null) => void): () => void {
  const client = getSupabase();
  if (!client) return () => undefined;

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    handler(hasUsableSession(session) ? toAccount(session?.user ?? null) : null);
  });
  return () => data.subscription.unsubscribe();
}
