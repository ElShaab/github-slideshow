-- A store receipt entitles exactly one account.
--
-- The original index was non-unique, so the same purchased receipt could be
-- replayed against any number of accounts and each would be granted the paid
-- product. Binding it in the database means the guarantee survives a bug in
-- the service layer.
--
-- The mock billing provider issues a fixed scenario key as its transaction id,
-- so the constraint is restricted to real stores; development can keep reusing
-- 'mock-success' across throwaway accounts.

DROP INDEX IF EXISTS subscriptions_original_txn_idx;

-- Any deployment that ran the unbound code may already hold duplicates, and a
-- unique index over them would abort this migration and the deploy with it.
-- The earliest binding is the real one, so later claims on the same receipt
-- are released; those accounts revert to unsubscribed and can purchase again.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY original_transaction_id
           ORDER BY current_period_start ASC NULLS LAST, created_at ASC
         ) AS claim
  FROM subscriptions
  WHERE original_transaction_id IS NOT NULL
    AND platform IN ('apple', 'google')
)
UPDATE subscriptions AS s
SET original_transaction_id = NULL,
    status = 'expired',
    current_period_end = LEAST(current_period_end, NOW())
FROM ranked
WHERE ranked.id = s.id AND ranked.claim > 1;

CREATE UNIQUE INDEX subscriptions_original_txn_key
  ON subscriptions (original_transaction_id)
  WHERE original_transaction_id IS NOT NULL
    AND platform IN ('apple', 'google');

CREATE INDEX subscriptions_original_txn_idx
  ON subscriptions (original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;
