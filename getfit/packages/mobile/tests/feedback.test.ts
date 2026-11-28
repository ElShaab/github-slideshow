/**
 * The feedback outbox.
 *
 * Feedback is written to the device before it is sent, because the account is
 * deferrable and the network is not guaranteed at the moment somebody presses
 * Send. That makes three things worth pinning down: a message is never lost, a
 * redelivery is never a duplicate, and the app asks at most once by itself.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { emptyFeedback, type PendingFeedback } from '../src/local/documents';
import {
  FEEDBACK_MAX_LENGTH,
  MAX_PENDING,
  PROMPT_AFTER_WORKOUTS,
  addPending,
  feedbackError,
  markPrompted,
  removeSent,
  shouldPromptForFeedback,
  toFeedbackRows,
} from '../src/state/feedback';

const entry = (id: string, message = 'It is good'): PendingFeedback => ({
  id,
  message,
  appVersion: '1.0.0 (9)',
  platform: 'ios',
  writtenAt: '2026-09-29T10:00:00.000Z',
});

describe('feedbackError', () => {
  test('refuses an empty message', () => {
    assert.equal(feedbackError(''), 'Type something first.');
  });

  test('refuses whitespace, which the database counts as empty', () => {
    // length(btrim(message)) >= 1 is the check constraint. Catching it here
    // means the refusal lands next to the field rather than as a failed insert.
    assert.equal(feedbackError('   \n\t  '), 'Type something first.');
  });

  test('says how much too long, not just that it is', () => {
    const problem = feedbackError('x'.repeat(FEEDBACK_MAX_LENGTH + 12));
    assert.equal(problem, 'That is 12 characters too long.');
  });

  test('accepts a message of exactly the maximum', () => {
    assert.equal(feedbackError('x'.repeat(FEEDBACK_MAX_LENGTH)), null);
  });

  test('measures the trimmed length, so trailing newlines are not content', () => {
    assert.equal(feedbackError(`${'x'.repeat(FEEDBACK_MAX_LENGTH)}\n\n  `), null);
  });
});

describe('addPending', () => {
  test('keeps what the user wrote', () => {
    const document = addPending(emptyFeedback(), entry('a', 'The timer is too loud'));
    assert.equal(document.pending.length, 1);
    assert.equal(document.pending[0].message, 'The timer is too loud');
  });

  test('trims, because a multiline field collects trailing newlines', () => {
    const document = addPending(emptyFeedback(), entry('a', '  needs dark mode\n\n'));
    assert.equal(document.pending[0].message, 'needs dark mode');
  });

  test('drops the oldest once the outbox is full', () => {
    // Someone who never creates an account would otherwise queue forever. The
    // newest message is the one that still describes what they are looking at.
    let document = emptyFeedback();
    for (let index = 0; index < MAX_PENDING + 3; index += 1) {
      document = addPending(document, entry(`id-${index}`));
    }

    assert.equal(document.pending.length, MAX_PENDING);
    assert.equal(document.pending[0].id, 'id-3');
    assert.equal(document.pending[MAX_PENDING - 1].id, `id-${MAX_PENDING + 2}`);
  });
});

describe('removeSent', () => {
  test('removes only what actually landed', () => {
    // A flush reads the outbox, sends, then writes back. A message written
    // while that was in flight has not been sent and must survive.
    const document = addPending(addPending(emptyFeedback(), entry('a')), entry('b'));
    const after = removeSent(document, ['a']);

    assert.deepEqual(
      after.pending.map((item) => item.id),
      ['b'],
    );
  });

  test('counts what it removed', () => {
    const document = addPending(addPending(emptyFeedback(), entry('a')), entry('b'));
    assert.equal(removeSent(document, ['a', 'b']).sent, 2);
  });

  test('ignores ids that are no longer there', () => {
    // Two flushes can overlap; the second must not count the first's work.
    const document = addPending(emptyFeedback(), entry('a'));
    const after = removeSent(removeSent(document, ['a']), ['a']);
    assert.equal(after.sent, 1);
    assert.equal(after.pending.length, 0);
  });
});

describe('shouldPromptForFeedback', () => {
  test('waits until the user has trained enough to have a view', () => {
    assert.equal(shouldPromptForFeedback(emptyFeedback(), PROMPT_AFTER_WORKOUTS - 1), false);
    assert.equal(shouldPromptForFeedback(emptyFeedback(), PROMPT_AFTER_WORKOUTS), true);
  });

  test('never asks twice', () => {
    const asked = markPrompted(emptyFeedback(), new Date('2026-09-29T10:00:00.000Z'));
    assert.equal(shouldPromptForFeedback(asked, PROMPT_AFTER_WORKOUTS * 10), false);
  });

  test('does not ask someone who already sent feedback from Settings', () => {
    const sent = removeSent(addPending(emptyFeedback(), entry('a')), ['a']);
    assert.equal(shouldPromptForFeedback(sent, PROMPT_AFTER_WORKOUTS), false);
  });

  test('does not ask while a message is still waiting to go out', () => {
    // They have already said their piece; it just has not left the phone.
    const queued = addPending(emptyFeedback(), entry('a'));
    assert.equal(shouldPromptForFeedback(queued, PROMPT_AFTER_WORKOUTS), false);
  });
});

describe('toFeedbackRows', () => {
  test('maps to the column names the table uses', () => {
    const rows = toFeedbackRows([entry('a', 'More cardio options')], 'user-1');

    assert.deepEqual(rows, [
      {
        user_id: 'user-1',
        id: 'a',
        message: 'More cardio options',
        app_version: '1.0.0 (9)',
        platform: 'ios',
        written_at: '2026-09-29T10:00:00.000Z',
      },
    ]);
  });

  test('carries the device id through, so a retry is an upsert not a copy', () => {
    const pending = [entry('fixed-id')];
    assert.equal(toFeedbackRows(pending, 'user-1')[0].id, toFeedbackRows(pending, 'user-1')[0].id);
  });
});
