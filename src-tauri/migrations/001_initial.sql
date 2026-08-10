-- Pages table
CREATE TABLE IF NOT EXISTS pages (
    id              TEXT PRIMARY KEY,
    date            TEXT NOT NULL,
    page_number     INTEGER NOT NULL,
    context         TEXT,
    what_matters_now TEXT,
    what_shifted    TEXT,
    what_shifted_complete INTEGER DEFAULT 0,
    what_shifted_edited   INTEGER DEFAULT 0,
    voice_memo_path TEXT,
    voice_memo_transcript TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(date, page_number)
);

-- Lines table
CREATE TABLE IF NOT EXISTS lines (
    id                    TEXT PRIMARY KEY,
    page_id               TEXT NOT NULL,
    position              INTEGER NOT NULL,
    text                  TEXT NOT NULL,
    state                 TEXT NOT NULL DEFAULT 'settled',
    margin_mark           INTEGER DEFAULT 0,
    is_commitment         INTEGER DEFAULT 0,
    commitment_confirmed  INTEGER DEFAULT 0,
    commitment_closed     INTEGER DEFAULT 0,
    commitment_context    TEXT,
    pause_duration_ms     INTEGER,
    created_at            TEXT NOT NULL,
    FOREIGN KEY(page_id) REFERENCES pages(id)
);

CREATE INDEX IF NOT EXISTS idx_lines_page_id ON lines(page_id);
CREATE INDEX IF NOT EXISTS idx_lines_position ON lines(page_id, position);

-- Full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
    page_id UNINDEXED,
    content,
    what_matters_now,
    what_shifted,
    voice_memo_transcript
);

-- Index for date-based queries (THREAD, navigation)
CREATE INDEX IF NOT EXISTS idx_pages_date ON pages(date, page_number);
