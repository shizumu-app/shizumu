-- Phase 14: sync engine configuration + persisted key material.
-- See /home/dev/projects/shizumi-relay/2026-05-08-shizumi-relay-spec.md.
--
-- Sync is OFF by default. A user (or test harness) flips sync_state.enabled
-- to 1 once a relay URL is configured AND enrollment has populated user_id
-- + device_id. Until then, the op_log keeps accumulating local_only rows
-- and the upload pipeline does nothing -- preserving the v0.3 invariant
-- that the engine is silent at the app boundary.

CREATE TABLE IF NOT EXISTS sync_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    relay_url           TEXT,
    user_id             TEXT,
    device_id           TEXT,
    enrolled_at_ms      INTEGER,
    last_seen_user_seq  INTEGER NOT NULL DEFAULT 0,
    enabled             INTEGER NOT NULL DEFAULT 0,
    last_sync_at_ms     INTEGER,
    last_error          TEXT
);

-- Persisted key material. role is one of:
--
--   bip39_phrase        -- the 24-word recovery phrase (UTF-8 text)
--   user_sign_priv      -- Ed25519 signing key (32 bytes, derived from phrase)
--   user_kex_priv       -- X25519 key-exchange key (32 bytes, derived)
--   content_master_key  -- 32-byte symmetric key for envelope encryption
--   meta_key            -- 32-byte HMAC key for doc_id_ct
--   device_sign_priv    -- Ed25519 signing key (32 bytes, RANDOM per device)
--
-- Derived user keys are cached here so the BIP-39 PBKDF2+HKDF pipeline
-- runs once at first launch, not on every command. The bip39_phrase row
-- is the recovery contract -- if every derived row were lost, the phrase
-- regenerates them. The device_sign_priv row is NOT recoverable and is
-- the one row that MUST survive across launches.
CREATE TABLE IF NOT EXISTS sync_keys (
    role        TEXT PRIMARY KEY,
    key_data    BLOB NOT NULL,
    created_at  INTEGER NOT NULL
);
