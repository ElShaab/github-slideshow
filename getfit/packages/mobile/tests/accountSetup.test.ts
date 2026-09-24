/**
 * The rules behind account setup.
 *
 * This runs immediately after someone has been charged, so every failure here
 * strands a paying customer: a step that advances before the email was sent
 * asks for a code that is not coming, and a flow that forgets an unfinished
 * account leaves them signed in on one phone and locked out of every other.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CODE_LENGTH,
  MIN_PASSWORD_LENGTH,
  cleanCode,
  isValidCode,
  isValidEmail,
  nextStep,
  passwordProblem,
  resumeStep,
} from '../src/state/accountSetup';

describe('accepting an email address', () => {
  test('ordinary addresses pass', () => {
    for (const email of [
      'someone@example.com',
      'a.b@example.co.uk',
      'first+tag@gmail.com',
      "o'brien@example.ie",
      'user@sub.domain.travel',
    ]) {
      assert.ok(isValidEmail(email), `${email} should be accepted`);
    }
  });

  test('surrounding whitespace is tolerated, since keyboards add it', () => {
    assert.ok(isValidEmail('  someone@example.com  '));
  });

  test('things that cannot be an address are refused', () => {
    for (const email of ['', 'someone', 'someone@', '@example.com', 'someone@example', 'a b@c.com']) {
      assert.ok(!isValidEmail(email), `${email} should be refused`);
    }
  });
});

describe('the emailed code', () => {
  test('exactly six digits', () => {
    assert.ok(isValidCode('123456'));
    assert.equal(CODE_LENGTH, 6);
  });

  test('anything shorter, longer or non-numeric is not a code', () => {
    for (const code of ['12345', '1234567', 'abcdef', '12 34 56', '']) {
      assert.ok(!isValidCode(code), `${code} should be refused`);
    }
  });

  test('pasting the code out of the email still works', () => {
    // People paste the surrounding sentence, or the code with a space in it.
    assert.equal(cleanCode('Your code is 123456'), '123456');
    assert.equal(cleanCode('123 456'), '123456');
    assert.equal(cleanCode('1234567890'), '123456');
  });
});

describe('choosing a password', () => {
  test('a long enough one is accepted', () => {
    assert.equal(passwordProblem('correct horse battery'), null);
  });

  test('a short one says how short', () => {
    const problem = passwordProblem('short');
    assert.ok(problem);
    assert.match(problem, new RegExp(String(MIN_PASSWORD_LENGTH)));
  });

  test('one past bcrypt’s limit is refused rather than silently truncated', () => {
    // Everything beyond 72 bytes is ignored by the hash, so accepting it would
    // mean a password that is not the one the user typed.
    assert.ok(passwordProblem('a'.repeat(73)));
    assert.equal(passwordProblem('a'.repeat(72)), null);
  });

  test('spaces alone are not a password', () => {
    assert.ok(passwordProblem('          '));
  });

  test('no composition rules, because length is what resists guessing', () => {
    assert.equal(passwordProblem('all lower case and long'), null);
  });
});

describe('moving through the steps', () => {
  const start = { step: 'email' as const, email: '' };

  test('the code screen appears only once the email was actually sent', () => {
    const after = nextStep(start, { type: 'code-sent', email: 'someone@example.com' });
    assert.equal(after.step, 'code');
    assert.equal(after.email, 'someone@example.com');
  });

  test('the address is trimmed on the way through, so the code screen shows it cleanly', () => {
    const after = nextStep(start, { type: 'code-sent', email: '  someone@example.com ' });
    assert.equal(after.email, 'someone@example.com');
  });

  test('verifying leads to the password, keeping the address', () => {
    const sent = nextStep(start, { type: 'code-sent', email: 'someone@example.com' });
    const verified = nextStep(sent, { type: 'code-verified' });
    assert.equal(verified.step, 'password');
    assert.equal(verified.email, 'someone@example.com');
  });

  test('setting the password finishes it', () => {
    const done = nextStep({ step: 'password', email: 'a@b.com' }, { type: 'password-set' });
    assert.equal(done.step, 'done');
  });

  test('a mistyped address can be corrected without reinstalling the app', () => {
    const sent = nextStep(start, { type: 'code-sent', email: 'typo@example.com' });
    const back = nextStep(sent, { type: 'change-email' });
    assert.equal(back.step, 'email');
  });
});

describe('coming back to a half-finished account', () => {
  test('nobody signed in starts at the beginning', () => {
    assert.equal(resumeStep(null), 'email');
    assert.equal(resumeStep({ signedIn: false, passwordSet: false }), 'email');
  });

  test('signed in with no password resumes at the password', () => {
    // The code signed them in, so they look finished. They are not: without a
    // password they could never sign in on a second phone.
    assert.equal(resumeStep({ signedIn: true, passwordSet: false }), 'password');
  });

  test('a finished account is not asked again', () => {
    assert.equal(resumeStep({ signedIn: true, passwordSet: true }), 'done');
  });
});
