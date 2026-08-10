-- Local index of attachments referenced by any page. Lets the storage
-- panel show "47 files" and the GC walk identify orphans without
-- parsing every content_json. Synced separately from this table; the
-- table is rebuilt from page content on demand.
CREATE TABLE IF NOT EXISTS attachments (
    blob_hash    TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    mime_type    TEXT,
    size_bytes   INTEGER NOT NULL,
    sync         INTEGER NOT NULL DEFAULT 1,
    has_local    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
CREATE INDEX attachments_has_local ON attachments(has_local);
