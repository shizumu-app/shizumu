CREATE TABLE IF NOT EXISTS shared_objects (
    id TEXT PRIMARY KEY,
    lineage_id TEXT REFERENCES lineages(id),
    source_page_id TEXT NOT NULL REFERENCES pages(id),
    object_type TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_objects_lineage ON shared_objects(lineage_id);
CREATE INDEX IF NOT EXISTS idx_shared_objects_page ON shared_objects(source_page_id);
