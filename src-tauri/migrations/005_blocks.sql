CREATE TABLE IF NOT EXISTS blocks (
    id         TEXT PRIMARY KEY,
    page_id    TEXT NOT NULL REFERENCES pages(id),
    block_type TEXT NOT NULL,
    name       TEXT,
    position   INTEGER NOT NULL,
    is_shared  INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS block_items (
    id         TEXT PRIMARY KEY,
    block_id   TEXT NOT NULL REFERENCES blocks(id),
    text       TEXT NOT NULL,
    state      TEXT NOT NULL DEFAULT 'open',
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_page_id ON blocks(page_id);
CREATE INDEX IF NOT EXISTS idx_block_items_block_id ON block_items(block_id);
