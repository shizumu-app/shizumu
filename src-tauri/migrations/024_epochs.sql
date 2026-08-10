-- Key rotation plan 3: tag each op with the key epoch it was encrypted
-- under, and track the account's current epoch locally. Epoch 0 is the
-- existing phrase-derived keyring (backward-compatible: all existing ops
-- are epoch 0). Epoch secrets themselves live in sync_keys (role
-- epoch_secret_<N>), not here.
ALTER TABLE op_log ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN current_epoch INTEGER NOT NULL DEFAULT 0;
