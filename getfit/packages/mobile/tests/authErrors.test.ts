/**
 * What a failed sign-in or sign-up says to the person holding the phone.
 *
 * They have already paid by this point, so a message that misdescribes the
 * problem does not cost a log line — it costs them the account. The case that
 * prompted these tests: a password rejected by Supabase was reported as
 * "at least 8 characters" whatever the project's actual rule was, so someone
 * whose project asked for twelve could type eight, be refused, read the same
 * sentence, and try eight again.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeAuthError } from '../src/supabase/authErrors';

describe('password rules', () => {
  test('repeats the length the project actually demands', () => {
    assert.equal(
      describeAuthError('Password should be at least 12 characters'),
      'Choose a password of at least 12 characters.',
    );
    assert.equal(
      describeAuthError('Password should be at least 6 characters.'),
      'Choose a password of at least 6 characters.',
    );
  });

  test('a character-class rule is explained in words, not as a length', () => {
    // Supabase states this one as a list of alphabets, which is precise and
    // unreadable. Saying "8 characters" instead would be readable and wrong.
    assert.equal(
      describeAuthError(
        'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.',
      ),
      'Your password needs upper and lower case letters, a number and a symbol.',
    );
  });

  test('an unrecognised password complaint does not invent a rule', () => {
    assert.equal(
      describeAuthError('Password is too weak'),
      "That password does not meet this app's requirements. Try a longer one.",
    );
  });
});

describe('the other things that go wrong', () => {
  test('an address that already has an account is pointed at sign-in', () => {
    assert.match(describeAuthError('User already registered'), /Sign in instead/);
  });

  test('a wrong password does not say which half was wrong', () => {
    // Saying "no account with that email" would tell anyone who asked which
    // addresses have accounts.
    assert.equal(
      describeAuthError('Invalid login credentials'),
      'That email and password do not match an account.',
    );
  });

  test('an expired code says to send another', () => {
    assert.match(describeAuthError('Token has expired or is invalid'), /expired/i);
  });

  test('rate limiting says to wait rather than to retry now', () => {
    assert.match(
      describeAuthError('For security purposes, you can only request this after 46 seconds'),
      /Wait a minute/,
    );
  });

  test('being offline says the training is safe, because that is the worry', () => {
    assert.match(describeAuthError('Network request failed'), /offline.*saved on this device/);
  });

  test('anything unrecognised is not shown verbatim', () => {
    // Auth errors are about tokens and grants and would mean nothing here.
    assert.equal(
      describeAuthError('AuthApiError: invalid_grant refresh_token_not_found'),
      'Something went wrong. Try again.',
    );
  });
});
