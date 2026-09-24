/**
 * The rules behind creating an account after payment.
 *
 * Three steps: give an email, prove you own it with the code that arrives, then
 * choose a password. Each one is a separate screen, and this is the part that
 * decides which screen comes next and what counts as valid — kept out of the
 * component so it can be tested without a device, because the failure modes
 * here strand a customer who has already been charged.
 */

export type AccountStep = 'email' | 'code' | 'password' | 'done';

/** The length Supabase's `{{ .Token }}` email code is generated at. */
export const CODE_LENGTH = 6;

/** Short enough to be guessable in bulk is the risk; 8 is Supabase's own floor. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Deliberately permissive.
 *
 * The only check that means anything is whether the code arrives, and that
 * happens one step later. A stricter pattern here rejects real addresses —
 * apostrophes, plus-addressing, long or new TLDs — and there is nothing more
 * annoying than an app refusing the address you have used for ten years.
 */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(trimmed);
}

/** Digits only, and exactly as many as the email carries. */
export function isValidCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code.trim());
}

/** Keeps only what could be part of a code, so a pasted email body still works. */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/**
 * What is wrong with a password, phrased for the person typing it.
 *
 * Returns null when nothing is. There is no upper-case-and-a-symbol rule: length
 * is what resists guessing, and composition rules mostly produce `Password1!`.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 72) {
    // bcrypt truncates past 72 bytes, so anything longer is silently ignored.
    return 'Use 72 characters or fewer.';
  }
  if (password.trim() === '') return 'Use something other than spaces.';
  return null;
}

export interface AccountSetupState {
  step: AccountStep;
  email: string;
}

export type AccountSetupEvent =
  | { type: 'code-sent'; email: string }
  | { type: 'code-verified' }
  | { type: 'password-set' }
  | { type: 'change-email' };

/**
 * Advances the flow.
 *
 * Only ever moves on a confirmed outcome, never on a button press: "the code
 * was sent", not "they tapped send". A step that advanced optimistically would
 * ask for a code that is not coming.
 */
export function nextStep(
  state: AccountSetupState,
  event: AccountSetupEvent,
): AccountSetupState {
  switch (event.type) {
    case 'code-sent':
      return { step: 'code', email: event.email.trim() };
    case 'code-verified':
      return { ...state, step: 'password' };
    case 'password-set':
      return { ...state, step: 'done' };
    // Mistyped addresses are the common case, and the way back has to exist
    // or the only escape is deleting the app.
    case 'change-email':
      return { step: 'email', email: state.email };
    default:
      return state;
  }
}

/**
 * Where someone who closed the app mid-flow should resume.
 *
 * Verifying the code signs them in, so a session alone does not mean the
 * account is finished — without a password they could never sign in on another
 * phone, which is the entire point of having an account.
 */
export function resumeStep(account: {
  signedIn: boolean;
  passwordSet: boolean;
} | null): AccountStep {
  if (!account?.signedIn) return 'email';
  return account.passwordSet ? 'done' : 'password';
}
