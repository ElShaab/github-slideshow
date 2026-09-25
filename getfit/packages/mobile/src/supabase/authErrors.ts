/**
 * Turns a Supabase auth failure into something worth reading.
 *
 * Pure, and in its own file so it can be tested: every string here is shown to
 * someone who has already paid and is stuck, so getting one wrong costs them
 * the account rather than costing a log line.
 *
 * The default arm is deliberate. An unrecognised auth error is not shown
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

  // Password rules are set per Supabase project and can be stricter than this
  // app's own floor, so what the server demands is repeated rather than
  // replaced with a guess. Answering "at least 8 characters" to a project that
  // wants twelve sends someone to type eight and be refused again, with the
  // same sentence, forever.
  if (text.includes('password')) {
    // Supabase refuses a password identical to the current one. It reads as a
    // rejected password and is the opposite: the password was already set, so
    // an earlier attempt succeeded further than it appeared to.
    if (text.includes('different from the old password') || text.includes('same_password')) {
      return 'That is already your password — it was set on an earlier try. Use it to sign in.';
    }

    const length = /at least (\d+) characters?/.exec(text);
    if (length) return `Choose a password of at least ${length[1]} characters.`;

    if (text.includes('one character of each') || text.includes('lowercase')) {
      return 'Your password needs upper and lower case letters, a number and a symbol.';
    }
    if (text.includes('should be') || text.includes('is too') || text.includes('weak')) {
      return 'That password does not meet this app\'s requirements. Try a longer one.';
    }
  }

  if (text.includes('rate limit') || text.includes('too many') || text.includes('for security purposes')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (text.includes('expired') || text.includes('otp_expired')) {
    return 'That code has expired. Send a new one.';
  }
  // "token" here means the emailed code. A refresh token failing is a
  // different thing entirely — the stored session going stale — and telling
  // someone their code is wrong when they have not typed one sends them
  // hunting for an email that was never sent.
  if (text.includes('invalid') && text.includes('token') && !text.includes('refresh')) {
    return 'That code is not right. Check it and try again.';
  }
  if (text.includes('email address') && text.includes('invalid')) {
    return 'That email address does not look right.';
  }
  if (text.includes('fetch') || text.includes('network')) {
    return 'You appear to be offline. Your training is saved on this device.';
  }
  return 'Something went wrong. Try again.';
}
