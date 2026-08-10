CREATE TABLE IF NOT EXISTS shukonin_sessions (
    id            TEXT PRIMARY KEY,
    page_id       TEXT NOT NULL REFERENCES pages(id),
    intended_min  INTEGER NOT NULL,
    actual_sec    INTEGER NOT NULL,
    completed     INTEGER NOT NULL DEFAULT 0,
    started_at    TEXT NOT NULL,
    ended_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shukonin_page_id ON shukonin_sessions(page_id);
CREATE INDEX IF NOT EXISTS idx_shukonin_started_at ON shukonin_sessions(started_at);
