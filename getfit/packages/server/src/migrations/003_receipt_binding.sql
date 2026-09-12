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

CREATE UNIQUE INDEX subscriptions_original_txn_key
  ON subscriptions (original_transaction_id)
  WHERE original_transaction_id IS NOT NULL
    AND platform IN ('apple', 'google');

CREATE INDEX subscriptions_original_txn_idx
  ON subscriptions (original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;
