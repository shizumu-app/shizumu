-- Phase 13: op-log foundation (silent engine refactor for v0.4 sync).
-- See docs/v0.3.0-phase13-op-log.md for the full design rationale.
--
-- This migration adds a content-addressed audit trail of every mutation.
-- v0.3 fills payload_blob with serde-JSON. v0.4 will populate ciphertext
-- with encrypted op envelopes. Every v0.4 column is nullable here so the
-- schema is forward-compatible.

CREATE TABLE IF NOT EXISTS op_log (
    op_id        TEXT PRIMARY KEY,
    op_kind      TEXT NOT NULL,
    doc_id       TEXT,
    doc_id_ct    BLOB,
    stream_id    INTEGER NOT NULL DEFAULT 0,
    payload_blob BLOB NOT NULL,
    ciphertext   BLOB,
    hlc_ts       INTEGER NOT NULL,
    device_id    TEXT,
    state        TEXT NOT NULL DEFAULT 'local_only'
                 CHECK (state IN ('local_only','pending_upload','committed','received')),
    user_seq     INTEGER,
    applied_at   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS op_log_kind_hlc ON op_log(op_kind, hlc_ts);
CREATE INDEX IF NOT EXISTS op_log_state ON op_log(state) WHERE state != 'committed';
CREATE INDEX IF NOT EXISTS op_log_doc ON op_log(doc_id, hlc_ts);

-- Tracks invariants like "backfill_complete" so eager backfill never
-- runs twice. Also used to record op_log schema invariants (writer
-- pool last-flush timestamp, etc.) during the bake.
CREATE TABLE IF NOT EXISTS op_log_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- HLC persistence: a single-row table holding (physical_ms, logical).
-- Bootstrapped lazily on first emission. Not seeded here.
CREATE TABLE IF NOT EXISTS hlc_state (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    physical_ms INTEGER NOT NULL,
    logical     INTEGER NOT NULL
);
