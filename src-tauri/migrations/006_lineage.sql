CREATE TABLE IF NOT EXISTS lineages (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

ALTER TABLE pages ADD COLUMN lineage_id TEXT REFERENCES lineages(id);
CREATE INDEX IF NOT EXISTS idx_pages_lineage_id ON pages(lineage_id);
