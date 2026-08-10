CREATE TABLE IF NOT EXISTS session_markers (
    id        TEXT PRIMARY KEY,
    page_id   TEXT NOT NULL REFERENCES pages(id),
    timestamp TEXT NOT NULL,
    label     TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_markers_page_id ON session_markers(page_id);
