/**
 * The feedback outbox, end to end against a fake server.
 *
 * feedback.test.ts covers the rules in isolation. This covers the path the
 * sheet actually takes: press Send, land in storage, go out over the wire, come
 * off the queue. The interesting cases are all failures — no account yet, no
 * connection, a response lost after the server already took the row — because
 * the sheet's one promise is that nothing a user writes is thrown away.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { DOCUMENT_KEYS, emptyFeedback, type FeedbackDocument } from '../src/local/documents';
import { DocumentStore } from '../src/local/store';
import type { KeyValueStore } from '../src/local/keyValue';
import { PROMPT_AFTER_WORKOUTS, type FeedbackRow } from '../src/state/feedback';
import type { FeedbackBackend } from '../src/supabase/feedback';
import { FeedbackOutbox, type OutboxEnvironment } from '../src/supabase/outbox';

/** AsyncStorage, in a Map. */
class FakeStorage implements KeyValueStore {
  readonly items = new Map<string, string>();

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.items.get(key) ?? null);
  }

  setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
    return Promise.resolve();
  }

  multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) this.items.delete(key);
    return Promise.resolve();
  }
}

/** A server that records what it was sent and can be told to fail. */
class FakeBackend implements FeedbackBackend {
  /** Every call, including the ones that failed after taking the rows. */
  readonly calls: FeedbackRow[][] = [];
  /** What a real table would hold, keyed the way the real one is. */
  readonly stored = new Map<string, FeedbackRow>();

  failWith: Error | null = null;
  /** True when a failure should still store the rows — a lost response. */
  storeBeforeFailing = false;

  submit(rows: FeedbackRow[]): Promise<void> {
    this.calls.push(rows);

    if (!this.failWith || this.storeBeforeFailing) {
      // on conflict do nothing: the composite key is what makes this safe.
      for (const row of rows) {
        const key = `${row.user_id}/${row.id}`;
        if (!this.stored.has(key)) this.stored.set(key, row);
      }
    }

    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve();
  }
}

let storage: FakeStorage;
let store: DocumentStore;
let backend: FakeBackend;
let signedInAs: string | null;
let nextId: number;

const environment = (): OutboxEnvironment => ({
  userId: () => Promise.resolve(signedInAs),
  appVersion: () => '1.0.0 (9)',
  platform: () => 'ios',
  id: () => `feedback_${(nextId += 1)}`,
  now: () => new Date('2026-10-03T09:00:00.000Z'),
});

const outboxWith = (withBackend: FeedbackBackend | null = backend) =>
  new FeedbackOutbox(store, withBackend, environment());

const pending = async (): Promise<FeedbackDocument> =>
  store.read<FeedbackDocument>(DOCUMENT_KEYS.feedback, emptyFeedback);

beforeEach(() => {
  storage = new FakeStorage();
  store = new DocumentStore(storage);
  backend = new FakeBackend();
  signedInAs = 'user-1';
  nextId = 0;
});

describe('sending feedback', () => {
  test('reaches the server and leaves the outbox empty', async () => {
    const delivery = await outboxWith().submit('The rest timer is too quiet');

    assert.equal(delivery, 'sent');
    assert.equal(backend.stored.size, 1);
    assert.equal((await pending()).pending.length, 0);
    assert.equal((await pending()).sent, 1);
  });

  test('sends the row the table expects', async () => {
    await outboxWith().submit('  More cardio options  ');

    const [row] = [...backend.stored.values()];
    assert.deepEqual(row, {
      user_id: 'user-1',
      id: 'feedback_1',
      message: 'More cardio options',
      app_version: '1.0.0 (9)',
      platform: 'ios',
      written_at: '2026-10-03T09:00:00.000Z',
    });
  });
});

describe('when it cannot be sent', () => {
  test('a message written with no account is kept, not lost', async () => {
    signedInAs = null;

    const delivery = await outboxWith().submit('Typed before signing up');

    assert.equal(delivery, 'queued-no-account');
    assert.equal(backend.calls.length, 0, 'nothing should be attempted without an account');
    assert.deepEqual(
      (await pending()).pending.map((item) => item.message),
      ['Typed before signing up'],
    );
  });

  test('and goes out as soon as there is one', async () => {
    signedInAs = null;
    await outboxWith().submit('Typed before signing up');

    signedInAs = 'user-1';
    assert.equal(await outboxWith().flush(), 'sent');
    assert.equal([...backend.stored.values()][0].message, 'Typed before signing up');
    assert.equal((await pending()).pending.length, 0);
  });

  test('a message written offline is kept, not lost', async () => {
    backend.failWith = new Error('Network request failed');

    const delivery = await outboxWith().submit('Typed on a plane');

    assert.equal(delivery, 'queued-offline');
    assert.deepEqual(
      (await pending()).pending.map((item) => item.message),
      ['Typed on a plane'],
    );
  });

  test('and goes out on the next attempt', async () => {
    backend.failWith = new Error('Network request failed');
    await outboxWith().submit('Typed on a plane');

    backend.failWith = null;
    assert.equal(await outboxWith().flush(), 'sent');
    assert.equal(backend.stored.size, 1);
    assert.equal((await pending()).pending.length, 0);
  });

  test('a build with no project keeps feedback rather than pretending', async () => {
    // Nothing can be sent, so the honest answer is that it is still waiting.
    const delivery = await new FeedbackOutbox(store, null, environment()).submit('Anything');

    assert.equal(delivery, 'queued-no-account');
    assert.equal((await pending()).pending.length, 1);
  });
});

describe('redelivery', () => {
  test('a response lost after the server stored it does not duplicate', async () => {
    // The worst case the composite key exists for: the row landed, the reply
    // did not, so the device still believes it has something to send.
    backend.failWith = new Error('socket hang up');
    backend.storeBeforeFailing = true;
    assert.equal(await outboxWith().submit('Counted once, please'), 'queued-offline');

    backend.failWith = null;
    assert.equal(await outboxWith().flush(), 'sent');

    assert.equal(backend.calls.length, 2, 'it should have been attempted twice');
    assert.equal(backend.stored.size, 1, 'but stored once');
    assert.equal((await pending()).pending.length, 0);
  });

  test('flushing an empty outbox sends nothing and reports delivered', async () => {
    assert.equal(await outboxWith().flush(), 'sent');
    assert.equal(backend.calls.length, 0);
  });
});

describe('a second message written while the first is in flight', () => {
  test('survives the flush that did not include it', async () => {
    // The flush removes ids, not the queue, precisely so this cannot be eaten.
    // Initialised with a no-op rather than null: TypeScript cannot see that
    // the executor runs synchronously, so a nullable one narrows to never.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow: FeedbackBackend = {
      async submit(rows) {
        await held;
        await backend.submit(rows);
      },
    };

    const first = new FeedbackOutbox(store, slow, environment()).submit('First');
    // Let the first message land in storage and reach the backend call.
    await new Promise((resolve) => setImmediate(resolve));

    await new FeedbackOutbox(store, null, environment()).submit('Second, written meanwhile');
    release();

    assert.equal(await first, 'sent');

    const after = await pending();
    assert.deepEqual(
      after.pending.map((item) => item.message),
      ['Second, written meanwhile'],
      'the second message must still be waiting',
    );
    assert.equal(after.sent, 1);
  });
});

describe('asking on its own', () => {
  test('waits for enough workouts, then asks once', async () => {
    const outbox = outboxWith();

    assert.equal(await outbox.promptDue(PROMPT_AFTER_WORKOUTS - 1), false);
    assert.equal(await outbox.promptDue(PROMPT_AFTER_WORKOUTS), true);

    await outbox.notePrompted();
    assert.equal(await outbox.promptDue(PROMPT_AFTER_WORKOUTS), false);
  });

  test('does not ask someone who already sent feedback', async () => {
    await outboxWith().submit('Said it already');
    assert.equal(await outboxWith().promptDue(PROMPT_AFTER_WORKOUTS), false);
  });

  test('does not ask when there is no project to send to', async () => {
    const outbox = new FeedbackOutbox(store, null, environment());
    assert.equal(await outbox.promptDue(PROMPT_AFTER_WORKOUTS), false);
  });
});

describe('clearing the device', () => {
  test('takes undelivered feedback with it', async () => {
    // Sign-out and account deletion both call clear(). Feedback typed but
    // never sent is still the user's words and must not survive on the phone.
    signedInAs = null;
    await outboxWith().submit('Never made it out');
    assert.equal(storage.items.has(DOCUMENT_KEYS.feedback), true);

    await store.clear();

    assert.equal(storage.items.has(DOCUMENT_KEYS.feedback), false);
    assert.equal((await pending()).pending.length, 0);
  });
});
