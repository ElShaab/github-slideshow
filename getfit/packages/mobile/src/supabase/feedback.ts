import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackRow } from '../state/feedback';

/** What the outbox needs from a server, so the flush can be tested without one. */
export interface FeedbackBackend {
  submit(rows: FeedbackRow[]): Promise<void>;
}

/** unique_violation: this exact message is already on the server. */
const ALREADY_DELIVERED = '23505';

/**
 * Feedback delivery over PostgREST.
 *
 * A plain insert per row, with a duplicate key read as success.
 *
 * This was an upsert with `ignoreDuplicates`, which is the obvious way to make
 * redelivery idempotent and the wrong one here. PostgREST's upsert needs a path
 * to update the conflicting row, and this table deliberately grants insert and
 * nothing else — so every send came back 42501, "new row violates row-level
 * security policy". Not just the retries: the app upserted on the first attempt
 * too, so no feedback could be filed at all.
 *
 * Doing it client-side instead costs nothing and needs no privilege the table
 * does not want to give. The device keeps a message until it is sure it landed,
 * so a response lost on a flaky connection means the same row is offered again;
 * the composite primary key makes that second offer a duplicate, and a
 * duplicate is exactly the outcome we wanted — it is already there.
 *
 * One row at a time, because a single statement is all-or-nothing: a batch
 * where one message had already landed would be rejected whole, and the other
 * messages in it would be lost. Batches here are one or two messages, so the
 * extra round trips cost nothing worth measuring.
 *
 * Nothing is selected back. The table grants insert only, so asking for the
 * inserted row would turn every successful send into a permission error.
 */
export function createSupabaseFeedbackBackend(client: SupabaseClient): FeedbackBackend {
  return {
    async submit(rows) {
      for (const row of rows) {
        const { error } = await client.from('feedback').insert(row);

        if (!error) continue;
        if (error.code === ALREADY_DELIVERED) continue;

        // Thrown rather than skipped: the outbox keeps everything it did not
        // manage to deliver, including the rows after this one.
        throw new Error(error.message);
      }
    },
  };
}
