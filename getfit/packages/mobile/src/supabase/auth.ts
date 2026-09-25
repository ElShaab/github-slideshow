import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './client';
import { describeAuthError } from './authErrors';

export { describeAuthError };

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
  /**
   * What the server actually said.
   *
   * `message` is rewritten for the person reading it, and a rewrite that
   * guesses wrong is invisible — it reads as a confident, useless instruction.
   * Keeping the original means a screenshot says which rule was broken instead
   * of which sentence this app chose.
   */
  readonly cause: string | null;

  constructor(message: string, cause: string | null = null) {
    super(message);
    this.name = 'AuthError';
    this.cause = cause;
  }
}

export interface Account {
  id: string;
  email: string | null;
  /**
   * Whether this account has finished setup.
   *
   * Verifying the emailed code signs the user in, so being signed in is not the
   * same as being done: until a password is chosen they could never sign in on
   * another device. The flag is written into the user's own metadata when the
   * password is set, because that is the only place that survives a reinstall.
   */
  passwordSet: boolean;
}

const NOT_CONFIGURED = 'Accounts are not available in this build.';

function requireClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) throw new AuthError(NOT_CONFIGURED);
  return client;
}

const toAccount = (user: User | null): Account | null =>
  user
    ? {
        id: user.id,
        email: user.email ?? null,
        passwordSet: user.user_metadata?.passwordSet === true,
      }
    : null;

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

/**
 * Emails a one-time code, creating the account if the address is new.
 *
 * Supabase sends a magic link unless the project's email template uses
 * `{{ .Token }}`; with it, the same call sends the six-digit code this flow
 * asks for. See SUPABASE.md — a project left on the default template will send
 * links that this screen cannot accept.
 */
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw new AuthError(describeAuthError(error.message), error.message);
}

/**
 * Emails a code to an account that already exists, for a forgotten password.
 *
 * Unlike the setup call this never creates a user: telling someone a code is on
 * its way to an address that has no account would be a way to find out which
 * addresses do, and Supabase deliberately answers the same either way.
 *
 * The Reset Password template needs `{{ .Token }}` for this to arrive as a code
 * rather than a link, exactly like the signup one.
 */
export async function sendPasswordResetCode(email: string): Promise<void> {
  const { error } = await requireClient().auth.resetPasswordForEmail(email.trim());
  if (error) throw new AuthError(describeAuthError(error.message), error.message);
}

/** Exchanges a recovery code for a session, so a new password can be set. */
export async function verifyPasswordResetCode(email: string, code: string): Promise<Account> {
  const { data, error } = await requireClient().auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'recovery',
  });
  if (error) throw new AuthError(describeAuthError(error.message), error.message);

  const account = toAccount(data.user);
  if (!account) throw new AuthError('That code is not right. Check it and try again.');
  return account;
}

/** Exchanges the emailed code for a session. This is what proves the address. */
export async function verifyEmailCode(email: string, code: string): Promise<Account> {
  const { data, error } = await requireClient().auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw new AuthError(describeAuthError(error.message), error.message);

  const account = toAccount(data.user);
  if (!account) throw new AuthError('That code is not right. Check it and try again.');
  return account;
}

/**
 * Sets the password and records that setup finished.
 *
 * The flag goes in the user's metadata rather than anywhere local, so a
 * reinstall or a second device can tell a finished account from one abandoned
 * between the code and the password.
 */
export async function setPassword(password: string): Promise<Account> {
  const { data, error } = await requireClient().auth.updateUser({
    password,
    data: { passwordSet: true },
  });
  if (error) throw new AuthError(describeAuthError(error.message), error.message);

  const account = toAccount(data.user);
  if (!account) throw new AuthError('Something went wrong. Try again.');
  return account;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const { data, error } = await requireClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new AuthError(describeAuthError(error.message), error.message);

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
 * Verifying the emailed code is what produces a session. Until then every
 * table write would be refused by row-level security, so syncing before that
 * point would look like a bug rather than the wait it is.
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
