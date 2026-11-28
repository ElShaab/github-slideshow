import { DOCUMENT_KEYS, emptyFeedback, type FeedbackDocument } from '../local/documents';
import type { DocumentStore } from '../local/store';
import {
  addPending,
  markPrompted,
  removeSent,
  shouldPromptForFeedback,
  toFeedbackRows,
  type FeedbackDelivery,
} from '../state/feedback';
import type { FeedbackBackend } from './feedback';

/** The device facts a message is stamped with, and who it belongs to. */
export interface OutboxEnvironment {
  /** The signed-in account, or null when there is not one yet. */
  userId: () => Promise<string | null>;
  appVersion: () => string | null;
  platform: () => string | null;
  /** A fresh id per message. Makes a redelivery an upsert, not a duplicate. */
  id: () => string;
  now?: () => Date;
}

/**
 * The feedback outbox: write first, send second.
 *
 * Built like SyncEngine, and for the same reason — it takes its store and its
 * backend rather than reaching for them, so the behaviour that matters can be
 * tested without a device or a project. What matters here is not the request;
 * it is what happens when the request fails. Someone typing on a train, or who
 * has postponed creating their account, still pressed Send, and losing their
 * words because the network was not ready is the one outcome the sheet must
 * never produce.
 */
export class FeedbackOutbox {
  constructor(
    private readonly store: DocumentStore,
    /** Null in a build with no Supabase project, where nothing can be sent. */
    private readonly backend: FeedbackBackend | null,
    private readonly environment: OutboxEnvironment,
  ) {}

  private read(): Promise<FeedbackDocument> {
    return this.store.read<FeedbackDocument>(DOCUMENT_KEYS.feedback, emptyFeedback);
  }

  private change(
    apply: (current: FeedbackDocument) => FeedbackDocument,
  ): Promise<FeedbackDocument> {
    return this.store.update<FeedbackDocument>(DOCUMENT_KEYS.feedback, emptyFeedback, apply);
  }

  /**
   * Stores what the user wrote, then tries to deliver it.
   *
   * The returned status is what the sheet tells them, so it has to be the truth
   * about where the message is rather than a hopeful "sent".
   */
  async submit(message: string): Promise<FeedbackDelivery> {
    const now = this.environment.now?.() ?? new Date();

    await this.change((current) =>
      addPending(current, {
        id: this.environment.id(),
        message,
        appVersion: this.environment.appVersion(),
        platform: this.environment.platform(),
        writtenAt: now.toISOString(),
      }),
    );

    return this.flush();
  }

  /**
   * Delivers everything waiting.
   *
   * Never throws. A failure leaves the messages where they are, to be tried
   * again on the next send or the next sign-in — which is the whole point of
   * keeping them.
   */
  async flush(): Promise<FeedbackDelivery> {
    const document = await this.read();
    // An overlapping flush may already have taken it. That is a delivery.
    if (document.pending.length === 0) return 'sent';

    const userId = this.backend ? await this.environment.userId() : null;
    if (!this.backend || !userId) return 'queued-no-account';

    const delivering = document.pending;

    try {
      await this.backend.submit(toFeedbackRows(delivering, userId));
    } catch (error) {
      console.warn('GetFit: feedback is still waiting to be delivered:', error);
      return 'queued-offline';
    }

    // Re-read through update rather than writing back the document from above:
    // the user may have written a second message while the first was in flight,
    // and only the ids that actually landed may be removed.
    await this.change((current) =>
      removeSent(
        current,
        delivering.map((item) => item.id),
      ),
    );

    return 'sent';
  }

  /** Whether the app should open the sheet on its own after this much use. */
  async promptDue(completedWorkouts: number): Promise<boolean> {
    // No project means nowhere for it to go, so asking would be a form that
    // quietly discards what it collects.
    if (!this.backend) return false;
    return shouldPromptForFeedback(await this.read(), completedWorkouts);
  }

  /** Records that the app has asked, so it never asks by itself again. */
  async notePrompted(): Promise<void> {
    await this.change((current) => markPrompted(current, this.environment.now?.() ?? new Date()));
  }
}
