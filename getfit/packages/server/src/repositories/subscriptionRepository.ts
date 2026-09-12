import type { BillingPlatform, Subscription, SubscriptionStatus } from '@getfit/shared';
import { query } from '../db/pool';

export const subscriptionRepository = {
  async get(userId: string): Promise<Subscription | null> {
    const result = await query(`SELECT * FROM subscriptions WHERE user_id = $1`, [userId]);
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  },

  /** Finds the account a store transaction is already bound to, if any. */
  async findByTransaction(
    platform: BillingPlatform,
    originalTransactionId: string,
  ): Promise<Subscription | null> {
    const result = await query(
      `SELECT * FROM subscriptions
       WHERE platform = $1 AND original_transaction_id = $2
       LIMIT 1`,
      [platform, originalTransactionId],
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  },

  async upsert(args: {
    userId: string;
    status: SubscriptionStatus;
    platform: BillingPlatform;
    productId: string;
    priceUsd: number;
    originalTransactionId: string | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }): Promise<Subscription> {
    const result = await query(
      `INSERT INTO subscriptions (
         user_id, status, platform, product_id, price_usd, original_transaction_id,
         current_period_start, current_period_end, cancel_at_period_end
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         platform = EXCLUDED.platform,
         product_id = EXCLUDED.product_id,
         price_usd = EXCLUDED.price_usd,
         -- Passing null leaves the stored receipt binding intact; a failed
         -- verification must not unbind a purchase that is still valid.
         original_transaction_id = COALESCE(
           EXCLUDED.original_transaction_id,
           subscriptions.original_transaction_id
         ),
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end
       RETURNING *`,
      [
        args.userId,
        args.status,
        args.platform,
        args.productId,
        args.priceUsd,
        args.originalTransactionId,
        args.currentPeriodStart,
        args.currentPeriodEnd,
        args.cancelAtPeriodEnd,
      ],
    );
    return mapSubscription(result.rows[0]);
  },

  async setStatus(userId: string, status: SubscriptionStatus): Promise<Subscription | null> {
    const result = await query(
      `UPDATE subscriptions SET status = $2 WHERE user_id = $1 RETURNING *`,
      [userId, status],
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  },

  /** Append-only audit trail of every subscription state transition. */
  async recordEvent(args: {
    userId: string;
    subscriptionId: string | null;
    eventType: string;
    fromStatus: SubscriptionStatus | null;
    toStatus: SubscriptionStatus | null;
    platform: BillingPlatform | null;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await query(
      `INSERT INTO subscription_events (
         user_id, subscription_id, event_type, from_status, to_status, platform, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        args.userId,
        args.subscriptionId,
        args.eventType,
        args.fromStatus,
        args.toStatus,
        args.platform,
        JSON.stringify(args.payload),
      ],
    );
  },

  async listEvents(userId: string, limit = 30): Promise<Array<Record<string, unknown>>> {
    const result = await query(
      `SELECT event_type, from_status, to_status, platform, created_at
       FROM subscription_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows;
  },
};

function mapSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    status: row.status as SubscriptionStatus,
    platform: row.platform as BillingPlatform,
    productId: (row.product_id as string) ?? '',
    priceUsd: row.price_usd === null ? 0 : Number(row.price_usd),
    currentPeriodStart: row.current_period_start
      ? (row.current_period_start as Date).toISOString()
      : null,
    currentPeriodEnd: row.current_period_end ? (row.current_period_end as Date).toISOString() : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}
