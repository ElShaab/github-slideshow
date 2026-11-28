import type { FeedbackDocument, PendingFeedback } from '../local/documents';

/**
 * The rules behind the feedback sheet, with no React and no network in them.
 *
 * Kept here for the same reason accountSetup.ts is: "when do we ask", "is this
 * message sendable" and "what is left in the outbox" are the parts worth being
 * sure about, and they are only testable while nothing around them imports
 * react-native.
 */

/** Matches the check constraint on public.feedback.message. */
export const FEEDBACK_MAX_LENGTH = 2000;

/** Completed workouts before the app offers the sheet on its own. */
export const PROMPT_AFTER_WORKOUTS = 3;

/**
 * How many undelivered messages the outbox keeps.
 *
 * Someone who never creates an account could otherwise fill storage with
 * messages that have nowhere to go. When it overflows the oldest is dropped:
 * the newest is the one that still describes what they are looking at.
 */
export const MAX_PENDING = 20;

export type FeedbackDelivery = 'sent' | 'queued-offline' | 'queued-no-account';

/** A row of public.feedback, as the device would insert it. */
export interface FeedbackRow {
  user_id: string;
  id: string;
  message: string;
  app_version: string | null;
  platform: string | null;
  written_at: string;
}

/**
 * Why this message cannot be sent, or null when it can.
 *
 * Length is checked against the same bound the database enforces, so an
 * over-long message is refused while it is still in front of the person who
 * wrote it rather than by Postgres after they have pressed Send.
 */
export function feedbackError(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) return 'Type something first.';
  if (trimmed.length > FEEDBACK_MAX_LENGTH) {
    return `That is ${trimmed.length - FEEDBACK_MAX_LENGTH} characters too long.`;
  }
  return null;
}

/**
 * Adds a message to the outbox.
 *
 * Trims, because trailing newlines from a multiline field are not content, and
 * the database counts a blank-but-for-whitespace message as empty.
 */
export function addPending(
  document: FeedbackDocument,
  entry: PendingFeedback,
): FeedbackDocument {
  const pending = [...document.pending, { ...entry, message: entry.message.trim() }];
  return {
    ...document,
    // Drop from the front: the oldest undelivered message is the stalest.
    pending: pending.slice(Math.max(0, pending.length - MAX_PENDING)),
  };
}

/**
 * Removes the messages that landed, and counts them.
 *
 * Takes ids rather than a count because a flush reads the outbox, sends, and
 * writes back — and the user may have added another message in between. Only
 * what was actually sent is removed.
 */
export function removeSent(document: FeedbackDocument, ids: readonly string[]): FeedbackDocument {
  const sent = new Set(ids);
  const remaining = document.pending.filter((entry) => !sent.has(entry.id));
  return {
    ...document,
    pending: remaining,
    sent: document.sent + (document.pending.length - remaining.length),
  };
}

/** Marks that the app has now asked on its own, so it will not ask again. */
export function markPrompted(document: FeedbackDocument, now: Date = new Date()): FeedbackDocument {
  return { ...document, promptedAt: now.toISOString() };
}

/**
 * Whether the app should open the sheet by itself.
 *
 * Once, ever, and only after the user has done enough to have an opinion. An
 * app that asks for feedback on day one is asking about an app nobody has
 * used yet, and one that asks repeatedly is a reason to uninstall it — so
 * anything already written, sent, or asked for closes the question for good.
 * Settings keeps the door open after that.
 */
export function shouldPromptForFeedback(
  document: FeedbackDocument,
  completedWorkouts: number,
): boolean {
  if (document.promptedAt !== null) return false;
  if (document.sent > 0) return false;
  if (document.pending.length > 0) return false;
  return completedWorkouts >= PROMPT_AFTER_WORKOUTS;
}

/** The outbox as rows for the account that is finally signed in. */
export function toFeedbackRows(
  pending: readonly PendingFeedback[],
  userId: string,
): FeedbackRow[] {
  return pending.map((entry) => ({
    user_id: userId,
    id: entry.id,
    message: entry.message,
    app_version: entry.appVersion,
    platform: entry.platform,
    written_at: entry.writtenAt,
  }));
}
