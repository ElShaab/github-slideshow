import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackRow } from '../state/feedback';

/** What the outbox needs from a server, so the flush can be tested without one. */
export interface FeedbackBackend {
  submit(rows: FeedbackRow[]): Promise<void>;
}

/**
 * Feedback delivery over PostgREST.
 *
 * An upsert that ignores duplicates rather than a plain insert: the device
 * keeps a message until it is sure it landed, so a response lost on a flaky
 * connection is redelivered, and the composite key turns that second attempt
 * into a no-op instead of a second copy of the same complaint.
 *
 * Nothing is selected back. The table grants insert and nothing else, so
 * asking for the inserted row would turn every successful send into a
 * permission error.
 */
export function createSupabaseFeedbackBackend(client: SupabaseClient): FeedbackBackend {
  return {
    async submit(rows) {
      if (rows.length === 0) return;

      const { error } = await client
        .from('feedback')
        .upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true });

      if (error) throw new Error(error.message);
    },
  };
}
