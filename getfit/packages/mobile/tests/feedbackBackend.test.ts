/**
 * Delivery over PostgREST.
 *
 * This is the layer that was wrong and had no test: it upserted, PostgREST
 * needs a way to update the conflicting row to do that, and the table grants
 * insert and nothing else — so every send came back 42501 and no feedback
 * could be filed at all. The outbox tests passed throughout, because they used
 * a fake backend and the fake was not wrong.
 *
 * What is pinned here is the contract with the table: insert only, one row at a
 * time, and a duplicate key read as "already there" rather than an error.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackRow } from '../src/state/feedback';
import { createSupabaseFeedbackBackend } from '../src/supabase/feedback';

interface PostgrestError {
  code: string;
  message: string;
}

/** Enough of supabase-js to record what the backend asked the server to do. */
function fakeClient(answer: (row: FeedbackRow) => PostgrestError | null) {
  const inserted: FeedbackRow[] = [];
  const tables: string[] = [];

  const client = {
    from(table: string) {
      tables.push(table);
      return {
        insert(row: FeedbackRow) {
          inserted.push(row);
          return Promise.resolve({ error: answer(row) });
        },
        // Present so a reintroduced upsert fails loudly here rather than in
        // production, where the table refuses it.
        upsert() {
          throw new Error('upsert is not available on this table — insert only');
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, inserted, tables };
}

const row = (id: string): FeedbackRow => ({
  user_id: 'user-1',
  id,
  message: `message ${id}`,
  app_version: '1.0.0 (9)',
  platform: 'ios',
  written_at: '2026-10-03T09:00:00.000Z',
});

describe('delivering feedback', () => {
  test('inserts into the feedback table', async () => {
    const { client, inserted, tables } = fakeClient(() => null);

    await createSupabaseFeedbackBackend(client).submit([row('a')]);

    assert.deepEqual(tables, ['feedback']);
    assert.deepEqual(inserted, [row('a')]);
  });

  test('sends one row at a time, so one failure cannot take the others down', async () => {
    // A single statement is all-or-nothing: a batch holding one message that
    // had already landed would be rejected whole.
    const { client, inserted } = fakeClient(() => null);

    await createSupabaseFeedbackBackend(client).submit([row('a'), row('b'), row('c')]);

    assert.deepEqual(
      inserted.map((item) => item.id),
      ['a', 'b', 'c'],
    );
  });

  test('treats a duplicate key as already delivered', async () => {
    // The device keeps a message until it is sure it landed, so re-offering a
    // row the server already has is the normal path after a dropped response.
    const { client } = fakeClient(() => ({
      code: '23505',
      message: 'duplicate key value violates unique constraint "feedback_pkey"',
    }));

    await assert.doesNotReject(() => createSupabaseFeedbackBackend(client).submit([row('a')]));
  });

  test('and carries on with the rest of the batch', async () => {
    const seen: string[] = [];
    const { client } = fakeClient((item) => {
      seen.push(item.id);
      return item.id === 'a' ? { code: '23505', message: 'duplicate key' } : null;
    });

    await createSupabaseFeedbackBackend(client).submit([row('a'), row('b')]);

    assert.deepEqual(seen, ['a', 'b']);
  });

  test('raises anything else, so the outbox keeps the message', async () => {
    const { client } = fakeClient(() => ({
      code: '42501',
      message: 'new row violates row-level security policy for table "feedback"',
    }));

    await assert.rejects(
      () => createSupabaseFeedbackBackend(client).submit([row('a')]),
      /row-level security/,
    );
  });

  test('stops at the row that failed rather than sending past it', async () => {
    // Everything from the failure onwards stays in the outbox and is retried.
    const seen: string[] = [];
    const { client } = fakeClient((item) => {
      seen.push(item.id);
      return item.id === 'b' ? { code: '08006', message: 'connection failure' } : null;
    });

    await assert.rejects(() =>
      createSupabaseFeedbackBackend(client).submit([row('a'), row('b'), row('c')]),
    );
    assert.deepEqual(seen, ['a', 'b'], 'c should not have been attempted');
  });

  test('an empty batch asks the server for nothing', async () => {
    const { client, tables } = fakeClient(() => null);

    await createSupabaseFeedbackBackend(client).submit([]);

    assert.deepEqual(tables, []);
  });
});
